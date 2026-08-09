import { z } from "zod";
import { requireUserFromRequest } from "@/lib/auth/request-auth";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";
import { triggerManualWorkflowRun } from "@/lib/workflows/manual-trigger";

export const runtime = "nodejs";

/**
 * Browser → Vercel manual run (JWT only).
 *
 * Prefer this over the Hasura Action path for the UI so runs do not depend on
 * Action metadata consistency or Authorization header forwarding from Hasura.
 * Membership is still enforced via org_members in Postgres.
 */
const bodySchema = z.object({
  workflow_id: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUserFromRequest(req);

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "workflow_id must be a UUID", 400);
    }

    const body = await triggerManualWorkflowRun({
      userId: user.userId,
      workflowId: parsed.data.workflow_id,
      initialInput: (parsed.data.input || {}) as JsonObject,
    });

    return Response.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
