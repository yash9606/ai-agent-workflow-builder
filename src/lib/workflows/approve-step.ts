import { getStepRunAccess } from "@/lib/auth/org-access";
import { resumeWorkflowRun } from "@/lib/executor/engine";
import { AppError } from "@/lib/errors";
import type {
  ApproveStepOutput,
  ApprovalGateConfig,
  JsonObject,
  OrgRole,
} from "@/lib/types";

export function resolveApprovalAllowedRoles(
  stepConfig: ApprovalGateConfig,
  stepOutput: JsonObject | null | undefined
): OrgRole[] {
  // Prefer roles frozen at pause time so editors cannot widen mid-pause.
  const frozen = stepOutput?.allowed_roles;
  if (Array.isArray(frozen) && frozen.length > 0) {
    return frozen.filter(
      (r): r is OrgRole => r === "owner" || r === "editor" || r === "viewer"
    );
  }
  if (stepConfig.allowed_roles?.length) return stepConfig.allowed_roles;
  return ["owner", "editor"];
}

/**
 * Approve a paused approval_gate step and resume execution.
 * Authorization: JWT user id → org_members → workflow org + frozen allowed_roles.
 */
export async function approvePausedStep(options: {
  userId: string;
  stepRunId: string;
}): Promise<ApproveStepOutput> {
  const { userId, stepRunId } = options;

  const access = await getStepRunAccess(userId, stepRunId);

  if (access.step.type !== "approval_gate") {
    throw new AppError("INVALID_STATE", "Step is not an approval_gate", 400);
  }

  const config = (access.step.config || {}) as ApprovalGateConfig;
  const allowedRoles = resolveApprovalAllowedRoles(
    config,
    access.stepRun.output as JsonObject | null
  );

  if (!allowedRoles.includes(access.membership.role)) {
    throw new AppError(
      "FORBIDDEN",
      "Your role is not allowed to approve this step",
      403
    );
  }

  // Default product rule: only owner/editor may approve (viewers blocked even if
  // a misconfigured allowed_roles list includes them).
  if (!["owner", "editor"].includes(access.membership.role)) {
    throw new AppError(
      "FORBIDDEN",
      "Only owners and editors can approve workflow steps",
      403
    );
  }

  // Idempotent / re-kick through resumeWorkflowRun
  if (access.stepRun.status === "completed" && access.stepRun.approved_by) {
    const run = await resumeWorkflowRun(
      access.stepRun.workflow_run_id,
      access.stepRun.id,
      userId
    );
    return {
      id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
      message: "Step already approved",
    };
  }

  if (access.runStatus !== "paused") {
    throw new AppError("INVALID_STATE", "Workflow run is not paused", 400);
  }

  if (access.stepRun.status !== "paused") {
    throw new AppError(
      "INVALID_STATE",
      "Approval step is not awaiting approval",
      400
    );
  }

  if (access.stepRun.approved_by) {
    throw new AppError("ALREADY_APPROVED", "Step has already been approved", 409);
  }

  const run = await resumeWorkflowRun(
    access.stepRun.workflow_run_id,
    access.stepRun.id,
    userId
  );

  return {
    id: run.id,
    status: run.status,
    workflow_id: run.workflow_id,
    message: "Step approved; workflow resumed",
  };
}
