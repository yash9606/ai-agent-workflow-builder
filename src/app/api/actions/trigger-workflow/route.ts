import { z } from "zod";
import { getWorkflowAccess } from "@/lib/auth/org-access";
import { parseHasuraAction } from "@/lib/auth/request-auth";
import { startWorkflowRun } from "@/lib/executor/engine";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject, TriggerWorkflowRunOutput } from "@/lib/types";

export const runtime = "nodejs";

const inputSchema = z.object({
  workflow_id: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  try {
    const { payload, user } = await parseHasuraAction<{
      workflow_id: string;
      input?: Record<string, unknown>;
    }>(req);

    const parsed = inputSchema.safeParse(payload.input);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "workflow_id must be a UUID", 400);
    }

    const { workflow, membership } = await getWorkflowAccess(
      user.userId,
      parsed.data.workflow_id
    );

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
      triggeredBy: user.userId,
      triggerType: "manual",
      initialInput: (parsed.data.input || {}) as JsonObject,
    });

    const body: TriggerWorkflowRunOutput = {
      id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
      message: "Workflow run started",
    };

    return Response.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
