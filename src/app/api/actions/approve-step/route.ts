import { z } from "zod";
import { getStepRunAccess } from "@/lib/auth/org-access";
import { parseHasuraAction } from "@/lib/auth/request-auth";
import { resumeWorkflowRun } from "@/lib/executor/engine";
import { AppError, jsonError } from "@/lib/errors";
import type {
  ApproveStepOutput,
  ApprovalGateConfig,
  JsonObject,
  OrgRole,
} from "@/lib/types";

export const runtime = "nodejs";

const inputSchema = z.object({
  step_run_id: z.string().uuid(),
});

function resolveAllowedRoles(
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

export async function POST(req: Request) {
  try {
    // 1. Authenticate via JWT (+ action secret); never trust session_variables alone
    const { payload, user } = await parseHasuraAction<{ step_run_id: string }>(
      req
    );

    const parsed = inputSchema.safeParse(payload.input);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "step_run_id must be a UUID", 400);
    }

    // 2-5. Retrieve step_run → workflow → org; verify membership
    const access = await getStepRunAccess(user.userId, parsed.data.step_run_id);

    // 7. Verify the step is actually an approval_gate (before role messaging)
    if (access.step.type !== "approval_gate") {
      throw new AppError("INVALID_STATE", "Step is not an approval_gate", 400);
    }

    // 6. Role check against frozen pause-time roles
    const config = (access.step.config || {}) as ApprovalGateConfig;
    const allowedRoles = resolveAllowedRoles(
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

    // Idempotent / re-kick through resumeWorkflowRun
    if (
      access.stepRun.status === "completed" &&
      access.stepRun.approved_by
    ) {
      const run = await resumeWorkflowRun(
        access.stepRun.workflow_run_id,
        access.stepRun.id,
        user.userId
      );
      const body: ApproveStepOutput = {
        id: run.id,
        status: run.status,
        workflow_id: run.workflow_id,
        message: "Step already approved",
      };
      return Response.json(body);
    }

    // 8. Verify the workflow run is currently paused
    if (access.runStatus !== "paused") {
      throw new AppError(
        "INVALID_STATE",
        "Workflow run is not paused",
        400
      );
    }

    // 9. Verify the step has not already been approved / is paused
    if (access.stepRun.status !== "paused") {
      throw new AppError(
        "INVALID_STATE",
        "Approval step is not awaiting approval",
        400
      );
    }

    if (access.stepRun.approved_by) {
      throw new AppError(
        "ALREADY_APPROVED",
        "Step has already been approved",
        409
      );
    }

    // 10-11. Record approval and resume execution
    const run = await resumeWorkflowRun(
      access.stepRun.workflow_run_id,
      access.stepRun.id,
      user.userId
    );

    // 12. Return the updated run status
    const body: ApproveStepOutput = {
      id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
      message: "Step approved; workflow resumed",
    };

    return Response.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
