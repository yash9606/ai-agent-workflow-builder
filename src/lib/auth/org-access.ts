import { query } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type {
  OrgMember,
  OrgRole,
  StepRun,
  Workflow,
  WorkflowStep,
} from "@/lib/types";

export async function getMembership(
  userId: string,
  orgId: string
): Promise<OrgMember | null> {
  const result = await query<OrgMember>(
    `SELECT id, org_id, user_id, role, created_at::text
     FROM org_members
     WHERE user_id = $1 AND org_id = $2
     LIMIT 1`,
    [userId, orgId]
  );
  return result.rows[0] ?? null;
}

export async function requireMembership(
  userId: string,
  orgId: string,
  allowedRoles?: OrgRole[]
): Promise<OrgMember> {
  const membership = await getMembership(userId, orgId);
  if (!membership) {
    throw new AppError(
      "FORBIDDEN",
      "You are not a member of this organization",
      403
    );
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new AppError(
      "FORBIDDEN",
      "Insufficient role for this operation",
      403
    );
  }

  return membership;
}

export async function getWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ workflow: Workflow; membership: OrgMember }> {
  const result = await query<Workflow & { member_id: string; role: OrgRole; member_created_at: string }>(
    `SELECT w.id, w.org_id, w.name, w.description, w.active, w.created_by,
            w.created_at::text, w.updated_at::text,
            m.id AS member_id, m.role, m.created_at::text AS member_created_at
     FROM workflows w
     INNER JOIN org_members m ON m.org_id = w.org_id AND m.user_id = $1
     WHERE w.id = $2
     LIMIT 1`,
    [userId, workflowId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError("NOT_FOUND", "Workflow not found", 404);
  }

  return {
    workflow: {
      id: row.id,
      org_id: row.org_id,
      name: row.name,
      description: row.description,
      active: row.active,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    membership: {
      id: row.member_id,
      org_id: row.org_id,
      user_id: userId,
      role: row.role,
      created_at: row.member_created_at,
    },
  };
}

export async function getStepRunAccess(
  userId: string,
  stepRunId: string
): Promise<{
  stepRun: StepRun;
  step: WorkflowStep;
  workflow: Workflow;
  membership: OrgMember;
  runStatus: string;
}> {
  const result = await query<{
    step_run_id: string;
    workflow_run_id: string;
    workflow_step_id: string;
    step_status: StepRun["status"];
    input: StepRun["input"];
    output: StepRun["output"];
    step_error: string | null;
    attempt_count: number;
    approved_by: string | null;
    approved_at: string | null;
    step_started_at: string | null;
    step_completed_at: string | null;
    step_created_at: string;
    step_id: string;
    step_workflow_id: string;
    position: number;
    step_name: string;
    step_type: WorkflowStep["type"];
    config: WorkflowStep["config"];
    step_created: string;
    step_updated: string;
    workflow_id: string;
    org_id: string;
    workflow_name: string;
    description: string;
    active: boolean;
    created_by: string;
    workflow_created_at: string;
    workflow_updated_at: string;
    member_id: string;
    role: OrgRole;
    member_created_at: string;
    run_status: string;
  }>(
    `SELECT
       sr.id AS step_run_id,
       sr.workflow_run_id,
       sr.workflow_step_id,
       sr.status AS step_status,
       sr.input,
       sr.output,
       sr.error AS step_error,
       sr.attempt_count,
       sr.approved_by,
       sr.approved_at::text,
       sr.started_at::text AS step_started_at,
       sr.completed_at::text AS step_completed_at,
       sr.created_at::text AS step_created_at,
       ws.id AS step_id,
       ws.workflow_id AS step_workflow_id,
       ws.position,
       ws.name AS step_name,
       ws.type AS step_type,
       ws.config,
       ws.created_at::text AS step_created,
       ws.updated_at::text AS step_updated,
       w.id AS workflow_id,
       w.org_id,
       w.name AS workflow_name,
       w.description,
       w.active,
       w.created_by,
       w.created_at::text AS workflow_created_at,
       w.updated_at::text AS workflow_updated_at,
       m.id AS member_id,
       m.role,
       m.created_at::text AS member_created_at,
       wr.status AS run_status
     FROM step_runs sr
     INNER JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
     INNER JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
     INNER JOIN workflows w ON w.id = wr.workflow_id
     INNER JOIN org_members m ON m.org_id = w.org_id AND m.user_id = $1
     WHERE sr.id = $2
     LIMIT 1`,
    [userId, stepRunId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError("NOT_FOUND", "Step run not found", 404);
  }

  return {
    stepRun: {
      id: row.step_run_id,
      workflow_run_id: row.workflow_run_id,
      workflow_step_id: row.workflow_step_id,
      status: row.step_status,
      input: row.input,
      output: row.output,
      error: row.step_error,
      attempt_count: row.attempt_count,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      started_at: row.step_started_at,
      completed_at: row.step_completed_at,
      created_at: row.step_created_at,
    },
    step: {
      id: row.step_id,
      workflow_id: row.step_workflow_id,
      position: row.position,
      name: row.step_name,
      type: row.step_type,
      config: row.config,
      created_at: row.step_created,
      updated_at: row.step_updated,
    },
    workflow: {
      id: row.workflow_id,
      org_id: row.org_id,
      name: row.workflow_name,
      description: row.description,
      active: row.active,
      created_by: row.created_by,
      created_at: row.workflow_created_at,
      updated_at: row.workflow_updated_at,
    },
    membership: {
      id: row.member_id,
      org_id: row.org_id,
      user_id: userId,
      role: row.role,
      created_at: row.member_created_at,
    },
    runStatus: row.run_status,
  };
}
