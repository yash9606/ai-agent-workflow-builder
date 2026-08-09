import { after } from "next/server";
import { getPool, query, withTransaction } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/executor/audit";
import { executeStep } from "@/lib/executor/steps";
import { consumeQuota } from "@/lib/quota";
import type {
  JsonObject,
  RunStatus,
  TriggerType,
  Workflow,
  WorkflowRun,
  WorkflowStep,
} from "@/lib/types";

const RETRYABLE_TYPES = new Set(["llm_call", "http_request"]);

export function runExecutionInBackground(fn: () => Promise<void>): void {
  const wrapped = async () => {
    try {
      await fn();
    } catch (error) {
      console.error("[executor] Background execution failed:", error);
    }
  };

  try {
    after(wrapped);
  } catch {
    void wrapped();
  }
}

async function loadWorkflowWithSteps(
  workflowId: string
): Promise<{ workflow: Workflow; steps: WorkflowStep[] }> {
  const workflowResult = await query<Workflow>(
    `SELECT id, org_id, name, description, active, created_by,
            created_at::text, updated_at::text
     FROM workflows
     WHERE id = $1
     LIMIT 1`,
    [workflowId]
  );

  const workflow = workflowResult.rows[0];
  if (!workflow) {
    throw new AppError("NOT_FOUND", "Workflow not found", 404);
  }

  const stepsResult = await query<WorkflowStep>(
    `SELECT id, workflow_id, position, name, type, config,
            created_at::text, updated_at::text
     FROM workflow_steps
     WHERE workflow_id = $1
     ORDER BY position ASC`,
    [workflowId]
  );

  return { workflow, steps: stepsResult.rows };
}

async function markRun(
  runId: string,
  status: RunStatus,
  error?: string | null
): Promise<void> {
  if (status === "running") {
    await query(
      `UPDATE workflow_runs
       SET status = $2, started_at = COALESCE(started_at, now()), error = NULL
       WHERE id = $1`,
      [runId, status]
    );
    return;
  }

  if (status === "paused") {
    await query(
      `UPDATE workflow_runs SET status = $2, error = NULL WHERE id = $1`,
      [runId, status]
    );
    return;
  }

  await query(
    `UPDATE workflow_runs
     SET status = $2,
         error = $3,
         completed_at = CASE
           WHEN $2 IN ('completed','failed','cancelled') THEN now()
           ELSE completed_at
         END
     WHERE id = $1`,
    [runId, status, error ?? null]
  );
}

async function createStepRun(
  runId: string,
  stepId: string,
  input: JsonObject
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO step_runs (workflow_run_id, workflow_step_id, status, input)
     VALUES ($1, $2, 'pending', $3::jsonb)
     RETURNING id`,
    [runId, stepId, JSON.stringify(input)]
  );
  return result.rows[0].id;
}

async function updateStepRun(
  stepRunId: string,
  patch: {
    status: string;
    output?: JsonObject | null;
    error?: string | null;
    attemptCount?: number;
    approvedBy?: string | null;
    setApprovedAt?: boolean;
  }
): Promise<void> {
  await query(
    `UPDATE step_runs
     SET status = $2,
         output = COALESCE($3::jsonb, output),
         error = $4,
         attempt_count = COALESCE($5, attempt_count),
         approved_by = COALESCE($6, approved_by),
         approved_at = CASE WHEN $7 THEN now() ELSE approved_at END,
         started_at = CASE
           WHEN $2 IN ('running','paused') THEN COALESCE(started_at, now())
           ELSE started_at
         END,
         completed_at = CASE
           WHEN $2 IN ('completed','failed','skipped') THEN now()
           ELSE completed_at
         END
     WHERE id = $1`,
    [
      stepRunId,
      patch.status,
      patch.output ? JSON.stringify(patch.output) : null,
      patch.error ?? null,
      patch.attemptCount ?? null,
      patch.approvedBy ?? null,
      Boolean(patch.setApprovedAt),
    ]
  );
}

async function markSkippedSteps(
  runId: string,
  steps: WorkflowStep[],
  fromIndex: number,
  toIndexExclusive: number,
  input: JsonObject,
  reason: string
): Promise<void> {
  for (let i = fromIndex; i < toIndexExclusive && i < steps.length; i++) {
    const step = steps[i];
    const stepRunId = await createStepRun(runId, step.id, input);
    await updateStepRun(stepRunId, {
      status: "skipped",
      output: {
        skipped: true,
        reason,
        step_name: step.name,
        step_type: step.type,
      },
      attemptCount: 0,
      error: null,
    });
  }
}

async function executeStepsFrom(options: {
  workflow: Workflow;
  steps: WorkflowStep[];
  runId: string;
  startIndex: number;
  initialInput: JsonObject;
}): Promise<{ status: RunStatus; error?: string }> {
  let previousOutput = options.initialInput;

  for (let i = options.startIndex; i < options.steps.length; i++) {
    const step = options.steps[i];
    const stepRunId = await createStepRun(
      options.runId,
      step.id,
      previousOutput
    );

    await updateStepRun(stepRunId, {
      status: "running",
      attemptCount: 1,
    });

    const maxAttempts = RETRYABLE_TYPES.has(step.type) ? 2 : 1;
    let lastError: string | null = null;
    let succeeded = false;
    let jumpTo: number | undefined;
    let endRun = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await updateStepRun(stepRunId, {
          status: "running",
          attemptCount: attempt,
          error: null,
        });
      }

      try {
        const result = await executeStep({
          client: getPool(),
          orgId: options.workflow.org_id,
          workflowRunId: options.runId,
          stepRunId,
          previousOutput,
          step,
          steps: options.steps,
          currentIndex: i,
        });

        if (result.pause) {
          await updateStepRun(stepRunId, {
            status: "paused",
            output: result.output,
            attemptCount: attempt,
          });
          await markRun(options.runId, "paused");
          return { status: "paused" };
        }

        await updateStepRun(stepRunId, {
          status: "completed",
          output: result.output,
          attemptCount: attempt,
          error: null,
        });
        previousOutput = result.output;
        jumpTo = result.nextIndex;
        endRun = Boolean(result.endRun);
        succeeded = true;
        break;
      } catch (error) {
        lastError =
          error instanceof AppError
            ? error.publicMessage
            : error instanceof Error
              ? error.message
              : "Step execution failed";

        await updateStepRun(stepRunId, {
          status: attempt < maxAttempts ? "running" : "failed",
          error: lastError,
          attemptCount: attempt,
        });

        if (attempt >= maxAttempts) {
          await markRun(options.runId, "failed", lastError);
          return { status: "failed", error: lastError };
        }
      }
    }

    if (!succeeded) {
      await markRun(options.runId, "failed", lastError || "Step failed");
      return { status: "failed", error: lastError || "Step failed" };
    }

    if (endRun) {
      await markSkippedSteps(
        options.runId,
        options.steps,
        i + 1,
        options.steps.length,
        previousOutput,
        "conditional_branch end"
      );
      await markRun(options.runId, "completed");
      return { status: "completed" };
    }

    if (typeof jumpTo === "number" && jumpTo !== i + 1) {
      if (jumpTo < i + 1 || jumpTo > options.steps.length) {
        await markRun(
          options.runId,
          "failed",
          "conditional_branch produced an invalid jump target"
        );
        return {
          status: "failed",
          error: "conditional_branch produced an invalid jump target",
        };
      }
      await markSkippedSteps(
        options.runId,
        options.steps,
        i + 1,
        jumpTo,
        previousOutput,
        "conditional_branch skip"
      );
      // for-loop increments; set so next iteration is jumpTo
      i = jumpTo - 1;
    }
  }

  await markRun(options.runId, "completed");
  return { status: "completed" };
}

export async function startWorkflowRun(options: {
  workflowId: string;
  triggeredBy: string | null;
  triggerType: TriggerType;
  initialInput?: JsonObject;
}): Promise<WorkflowRun> {
  const { workflowId, triggeredBy, triggerType, initialInput = {} } = options;

  const { workflow, steps } = await loadWorkflowWithSteps(workflowId);

  if (!workflow.active) {
    throw new AppError("INVALID_STATE", "Workflow is not active", 400);
  }

  if (steps.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Workflow has no steps", 400);
  }

  const run = await withTransaction(async (client) => {
    const runInsert = await client.query<WorkflowRun>(
      `INSERT INTO workflow_runs (workflow_id, triggered_by, trigger_type, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, workflow_id, triggered_by, trigger_type, status,
                 started_at::text, completed_at::text, error, created_at::text`,
      [workflowId, triggeredBy, triggerType]
    );

    const created = runInsert.rows[0];

    try {
      await consumeQuota(
        client,
        workflow.org_id,
        created.id,
        `${triggerType}_trigger`
      );
    } catch (error) {
      await client.query(
        `UPDATE workflow_runs
         SET status = 'failed', error = $2, completed_at = now()
         WHERE id = $1`,
        [
          created.id,
          error instanceof AppError
            ? error.publicMessage
            : "Quota exceeded",
        ]
      );
      throw error instanceof AppError
        ? error
        : new AppError(
            "QUOTA_EXCEEDED",
            "Organization monthly call quota exceeded",
            429
          );
    }

    await client.query(
      `UPDATE workflow_runs
       SET status = 'running', started_at = now(), error = NULL
       WHERE id = $1`,
      [created.id]
    );

    await writeAuditLog(client, {
      orgId: workflow.org_id,
      userId: triggeredBy,
      action: "workflow_run.started",
      resourceType: "workflow_run",
      resourceId: created.id,
      details: {
        workflow_id: workflowId,
        trigger_type: triggerType,
      },
    });

    return { ...created, status: "running" as RunStatus };
  });

  runExecutionInBackground(async () => {
    try {
      await executeStepsFrom({
        workflow,
        steps,
        runId: run.id,
        startIndex: 0,
        initialInput,
      });
    } catch (error) {
      console.error("[executor] startWorkflowRun failed:", error);
      await query(
        `UPDATE workflow_runs
         SET status = 'failed',
             error = $2,
             completed_at = now()
         WHERE id = $1 AND status IN ('pending','running')`,
        [
          run.id,
          error instanceof Error ? error.message : "Execution failed",
        ]
      );
    }
  });

  return run;
}

export async function resumeWorkflowRun(
  runId: string,
  fromStepRunId: string,
  approvedBy: string
): Promise<WorkflowRun> {
  type Prepared =
    | {
        alreadyApproved: true;
        run: WorkflowRun;
      }
    | {
        alreadyApproved: false;
        run: WorkflowRun;
        workflow: Workflow;
        steps: WorkflowStep[];
        nextIndex: number;
        previousOutput: JsonObject;
      };

  const prepared = await withTransaction(async (client): Promise<Prepared> => {
    const access = await client.query<{
      step_run_id: string;
      step_status: string;
      approved_by: string | null;
      step_type: string;
      workflow_step_id: string;
      position: number;
      workflow_id: string;
      org_id: string;
      run_status: string;
      run_triggered_by: string | null;
      run_trigger_type: TriggerType;
      run_started_at: string | null;
      run_completed_at: string | null;
      run_error: string | null;
      run_created_at: string;
      step_output: JsonObject | null;
    }>(
      `SELECT
         sr.id AS step_run_id,
         sr.status AS step_status,
         sr.approved_by,
         sr.output AS step_output,
         ws.id AS workflow_step_id,
         ws.type AS step_type,
         ws.position,
         w.id AS workflow_id,
         w.org_id,
         wr.status AS run_status,
         wr.triggered_by AS run_triggered_by,
         wr.trigger_type AS run_trigger_type,
         wr.started_at::text AS run_started_at,
         wr.completed_at::text AS run_completed_at,
         wr.error AS run_error,
         wr.created_at::text AS run_created_at
       FROM step_runs sr
       INNER JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
       INNER JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
       INNER JOIN workflows w ON w.id = wr.workflow_id
       WHERE sr.id = $1 AND wr.id = $2
       FOR UPDATE OF sr, wr
       LIMIT 1`,
      [fromStepRunId, runId]
    );

    const row = access.rows[0];
    if (!row) {
      throw new AppError(
        "NOT_FOUND",
        "Step run not found for this workflow run",
        404
      );
    }

    const baseRun: WorkflowRun = {
      id: runId,
      workflow_id: row.workflow_id,
      triggered_by: row.run_triggered_by,
      trigger_type: row.run_trigger_type,
      status: row.run_status as RunStatus,
      started_at: row.run_started_at,
      completed_at: row.run_completed_at,
      error: row.run_error,
      created_at: row.run_created_at,
    };

    if (row.step_type !== "approval_gate") {
      throw new AppError("INVALID_STATE", "Step is not an approval_gate", 400);
    }

    const steps = (
      await client.query<WorkflowStep>(
        `SELECT id, workflow_id, position, name, type, config,
                created_at::text, updated_at::text
         FROM workflow_steps
         WHERE workflow_id = $1
         ORDER BY position ASC`,
        [row.workflow_id]
      )
    ).rows;

    // Resume by ordered step index (not raw position) so gaps cannot skip work.
    const gateIndex = steps.findIndex((s) => s.id === row.workflow_step_id);
    if (gateIndex < 0) {
      throw new AppError(
        "INVALID_STATE",
        "Approval step is missing from workflow definition",
        400
      );
    }
    const nextIndex = gateIndex + 1;

    const workflow = (
      await client.query<Workflow>(
        `SELECT id, org_id, name, description, active, created_by,
                created_at::text, updated_at::text
         FROM workflows WHERE id = $1`,
        [row.workflow_id]
      )
    ).rows[0];

    // Idempotent re-kick: if already approved but run never finished, continue.
    if (row.step_status === "completed" && row.approved_by) {
      if (
        row.run_status === "paused" ||
        (row.run_status === "running" && nextIndex < steps.length)
      ) {
        await client.query(
          `UPDATE workflow_runs
           SET status = 'running', error = NULL
           WHERE id = $1 AND status IN ('paused','running')`,
          [runId]
        );
        return {
          alreadyApproved: false,
          run: { ...baseRun, status: "running", error: null },
          workflow,
          steps,
          nextIndex,
          previousOutput: {
            ...(row.step_output || {}),
            approved: true,
            approved_by: row.approved_by,
          },
        };
      }
      return { alreadyApproved: true, run: baseRun };
    }

    if (row.step_status !== "paused") {
      throw new AppError("INVALID_STATE", "Approval step is not paused", 400);
    }

    if (row.run_status !== "paused") {
      throw new AppError("INVALID_STATE", "Workflow run is not paused", 400);
    }

    if (row.approved_by) {
      throw new AppError(
        "ALREADY_APPROVED",
        "Step has already been approved",
        409
      );
    }

    const approvalOutput: JsonObject = {
      ...(row.step_output || {}),
      approved: true,
      approved_by: approvedBy,
    };

    await client.query(
      `UPDATE step_runs
       SET status = 'completed',
           output = $2::jsonb,
           approved_by = $3,
           approved_at = now(),
           error = NULL,
           completed_at = now()
       WHERE id = $1`,
      [fromStepRunId, JSON.stringify(approvalOutput), approvedBy]
    );

    await client.query(
      `UPDATE workflow_runs
       SET status = 'running', error = NULL
       WHERE id = $1`,
      [runId]
    );

    await writeAuditLog(client, {
      orgId: row.org_id,
      userId: approvedBy,
      action: "step_run.approved",
      resourceType: "step_run",
      resourceId: fromStepRunId,
      details: { workflow_run_id: runId },
    });

    return {
      alreadyApproved: false,
      run: { ...baseRun, status: "running", error: null },
      workflow,
      steps,
      nextIndex,
      previousOutput: approvalOutput,
    };
  });

  if (!prepared.alreadyApproved) {
    const { workflow, steps, nextIndex, previousOutput } = prepared;

    runExecutionInBackground(async () => {
      try {
        if (nextIndex >= steps.length) {
          await markRun(runId, "completed");
        } else {
          await executeStepsFrom({
            workflow,
            steps,
            runId,
            startIndex: nextIndex,
            initialInput: previousOutput,
          });
        }
      } catch (error) {
        console.error("[executor] resumeWorkflowRun failed:", error);
        await query(
          `UPDATE workflow_runs
           SET status = 'failed',
               error = $2,
               completed_at = now()
           WHERE id = $1 AND status IN ('pending','running')`,
          [
            runId,
            error instanceof Error ? error.message : "Resume execution failed",
          ]
        );
      }
    });
  }

  return prepared.run;
}
