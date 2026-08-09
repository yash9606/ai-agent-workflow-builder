import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { DbClient } from "@/lib/db";
import { resolveBranchNextIndex } from "@/lib/executor/branch";
import { evaluateCondition } from "@/lib/executor/condition";
import {
  executeHttpRequest,
  validateHttpUrl,
} from "@/lib/executor/http-step";
import { callLlm } from "@/lib/llm/provider";
import type {
  ApprovalGateConfig,
  ConditionalBranchConfig,
  DbWriteConfig,
  HttpRequestConfig,
  JsonObject,
  LlmCallConfig,
  NotifyConfig,
  StepExecutionResult,
  WorkflowStep,
} from "@/lib/types";

export interface StepContext {
  client: DbClient;
  orgId: string;
  workflowRunId: string;
  stepRunId: string;
  previousOutput: JsonObject;
  step: WorkflowStep;
  /** Ordered workflow steps — required for conditional_branch jumps. */
  steps: WorkflowStep[];
  currentIndex: number;
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return { value: value as JsonObject["value"] };
}

async function executeLlmCall(
  config: LlmCallConfig,
  previousOutput: JsonObject
): Promise<StepExecutionResult> {
  let prompt = config.prompt || "";
  if (config.pass_previous_output) {
    prompt = `${prompt}\n\nPrevious output:\n${JSON.stringify(previousOutput)}`;
  }

  if (!prompt.trim()) {
    throw new AppError("VALIDATION_ERROR", "LLM step requires a prompt", 400);
  }

  const result = await callLlm({
    provider: config.provider,
    model: config.model,
    systemPrompt: config.system_prompt,
    prompt,
  });

  return {
    output: {
      text: result.text,
      provider: result.provider,
      model: result.model,
      stub: result.stub,
      previous: previousOutput,
    },
  };
}

async function executeHttpStep(
  config: HttpRequestConfig
): Promise<StepExecutionResult> {
  const output = await executeHttpRequest(config);
  const status = typeof output.status === "number" ? output.status : 0;
  // Transient upstream failures should surface so the engine can retry once.
  if (status >= 500) {
    throw new AppError(
      "EXTERNAL_ERROR",
      `HTTP upstream error (${status})`,
      502
    );
  }
  return { output };
}

async function executeDbWrite(
  ctx: StepContext,
  config: DbWriteConfig
): Promise<StepExecutionResult> {
  if (!config.key || typeof config.key !== "string") {
    throw new AppError("VALIDATION_ERROR", "db_write requires a key", 400);
  }

  const insert = await ctx.client.query<{ id: string }>(
    `INSERT INTO workflow_db_writes (org_id, workflow_run_id, step_run_id, key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [
      ctx.orgId,
      ctx.workflowRunId,
      ctx.stepRunId,
      config.key,
      JSON.stringify(ctx.previousOutput),
    ]
  );

  return {
    output: {
      write_id: insert.rows[0].id,
      key: config.key,
      payload: ctx.previousOutput,
    },
  };
}

async function executeNotify(
  ctx: StepContext,
  config: NotifyConfig
): Promise<StepExecutionResult> {
  const env = getEnv();
  const channel = config.channel || "webhook";
  const destination =
    config.destination ||
    (config.destination_env
      ? (process.env[config.destination_env] as string | undefined)
      : undefined) ||
    env.NOTIFY_WEBHOOK_URL ||
    "";

  const payload: JsonObject = {
    message: config.message || "Workflow notification",
    previous_output: ctx.previousOutput,
    workflow_run_id: ctx.workflowRunId,
    step_run_id: ctx.stepRunId,
    org_id: ctx.orgId,
  };

  const inserted = await ctx.client.query<{ id: string }>(
    `INSERT INTO notifications (org_id, workflow_run_id, step_run_id, channel, destination, payload, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
     RETURNING id`,
    [
      ctx.orgId,
      ctx.workflowRunId,
      ctx.stepRunId,
      channel,
      destination || "unset",
      JSON.stringify(payload),
    ]
  );

  const notificationId = inserted.rows[0].id;
  let deliveryStatus = "pending";
  let deliveryError: string | null = null;
  let stub = false;

  if (!destination) {
    // Documented local stub: persist the notification row without calling an external API.
    deliveryStatus = "stub";
    stub = true;
    await ctx.client.query(
      `UPDATE notifications SET status = $2, error = NULL WHERE id = $1`,
      [notificationId, deliveryStatus]
    );
  } else {
    try {
      // Block SSRF: only public http(s) destinations, no redirects.
      validateHttpUrl(destination);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(destination, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "manual",
      });
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Notification redirect blocked (${response.status})`);
      }

      deliveryStatus = response.ok ? "delivered" : "failed";
      if (!response.ok) {
        deliveryError = `Webhook responded with ${response.status}`;
      }
    } catch (error) {
      deliveryStatus = "failed";
      deliveryError =
        error instanceof Error ? error.message : "Notification delivery failed";
    }

    await ctx.client.query(
      `UPDATE notifications SET status = $2, error = $3 WHERE id = $1`,
      [notificationId, deliveryStatus, deliveryError]
    );
  }

  return {
    output: {
      notification_id: notificationId,
      channel,
      destination: destination || null,
      status: deliveryStatus,
      stub,
      error: deliveryError,
      payload,
      note: stub
        ? "NOTIFY stub mode: no destination configured; row logged only"
        : null,
    },
  };
}

function executeConditionalBranch(
  config: ConditionalBranchConfig,
  previousOutput: JsonObject,
  steps: WorkflowStep[],
  currentIndex: number
): StepExecutionResult {
  if (!config.operator) {
    throw new AppError(
      "VALIDATION_ERROR",
      "conditional_branch requires an operator",
      400
    );
  }

  const data =
    config.source === "input" ? previousOutput : previousOutput;

  const result = evaluateCondition({
    data,
    field: config.field,
    operator: config.operator,
    value: config.value,
    trueLabel: config.true_label || "true_path",
    falseLabel: config.false_label || "false_path",
  });

  let branch;
  try {
    branch = resolveBranchNextIndex({
      steps,
      currentIndex,
      matched: result.matched,
      trueNext: config.true_next,
      falseNext: config.false_next,
      skipOnFalse: config.skip_on_false,
    });
  } catch (error) {
    throw new AppError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid branch target",
      400
    );
  }

  return {
    output: {
      matched: result.matched,
      path: result.label,
      label: result.label,
      details: result.details,
      previous: previousOutput,
      true_next: config.true_next ?? "next",
      false_next: config.false_next ?? (config.skip_on_false ? "end" : "next"),
      jumped_to: branch.target,
      skip_on_false: Boolean(config.skip_on_false),
    },
    nextIndex: branch.nextIndex,
    endRun: branch.endRun,
  };
}

function executeApprovalGate(config: ApprovalGateConfig): StepExecutionResult {
  return {
    pause: true,
    output: {
      message: config.message || "Awaiting approval",
      allowed_roles: config.allowed_roles || ["owner", "editor"],
    },
  };
}

export async function executeStep(ctx: StepContext): Promise<StepExecutionResult> {
  const config = asObject(ctx.step.config);

  switch (ctx.step.type) {
    case "llm_call":
      return executeLlmCall(config as unknown as LlmCallConfig, ctx.previousOutput);
    case "http_request":
      return executeHttpStep(config as unknown as HttpRequestConfig);
    case "db_write":
      return executeDbWrite(ctx, config as unknown as DbWriteConfig);
    case "notify":
      return executeNotify(ctx, config as unknown as NotifyConfig);
    case "conditional_branch":
      return executeConditionalBranch(
        config as unknown as ConditionalBranchConfig,
        ctx.previousOutput,
        ctx.steps,
        ctx.currentIndex
      );
    case "approval_gate":
      return executeApprovalGate(config as unknown as ApprovalGateConfig);
    default:
      throw new AppError(
        "VALIDATION_ERROR",
        `Unsupported step type: ${ctx.step.type}`,
        400
      );
  }
}
