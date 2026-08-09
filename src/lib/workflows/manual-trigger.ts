import { getWorkflowAccess } from "@/lib/auth/org-access";
import { startWorkflowRun } from "@/lib/executor/engine";
import { AppError } from "@/lib/errors";
import type { JsonObject, TriggerWorkflowRunOutput } from "@/lib/types";

/**
 * Start a manual workflow run for an authenticated org member.
 * Authorization: JWT user id → org_members → workflow.org_id (owner/editor).
 */
export async function triggerManualWorkflowRun(options: {
  userId: string;
  workflowId: string;
  initialInput?: JsonObject;
}): Promise<TriggerWorkflowRunOutput> {
  const { userId, workflowId, initialInput = {} } = options;

  const { workflow, membership } = await getWorkflowAccess(userId, workflowId);

  if (!["owner", "editor"].includes(membership.role)) {
    throw new AppError(
      "FORBIDDEN",
      "Only owners and editors can trigger workflows",
      403
    );
  }

  if (!workflow.active) {
    throw new AppError("INVALID_STATE", "Workflow is not active", 400);
  }

  const run = await startWorkflowRun({
    workflowId: workflow.id,
    triggeredBy: userId,
    triggerType: "manual",
    initialInput,
  });

  return {
    id: run.id,
    status: run.status,
    workflow_id: run.workflow_id,
    message: "Workflow run started",
  };
}
