import { safeEqualSecret } from "@/lib/auth/request-auth";
import { query } from "@/lib/db";
import { startWorkflowRun } from "@/lib/executor/engine";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ pathToken: string }>;
};

/** Uniform unauthorized response — avoids path-token existence oracle. */
function unauthorized(): never {
  throw new AppError("UNAUTHORIZED", "Unauthorized", 401);
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { pathToken } = await context.params;
    const secret =
      req.headers.get("x-webhook-secret") ||
      req.headers.get("X-Webhook-Secret");

    if (!secret) {
      unauthorized();
    }

    let payload: JsonObject = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const json = await req.json();
        payload =
          json && typeof json === "object" && !Array.isArray(json)
            ? (json as JsonObject)
            : { payload: json as JsonObject["payload"] };
      } catch {
        throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
      }
    }

    const result = await query<{
      workflow_id: string;
      secret: string;
      active: boolean;
      enabled: boolean;
    }>(
      `SELECT
         we.workflow_id,
         we.secret,
         w.active,
         wt.enabled
       FROM webhook_endpoints we
       INNER JOIN workflows w ON w.id = we.workflow_id
       INNER JOIN workflow_triggers wt
         ON wt.id = we.trigger_id AND wt.workflow_id = we.workflow_id
       WHERE we.path_token = $1
       LIMIT 1`,
      [pathToken]
    );

    const row = result.rows[0];
    // Same response for missing path and bad secret (no enumeration).
    if (!row || !safeEqualSecret(secret!, row.secret)) {
      unauthorized();
    }

    if (!row.active) {
      throw new AppError("INVALID_STATE", "Workflow is not active", 400);
    }

    if (!row.enabled) {
      throw new AppError("INVALID_STATE", "Webhook trigger is disabled", 400);
    }

    const run = await startWorkflowRun({
      workflowId: row.workflow_id,
      triggeredBy: null,
      triggerType: "webhook",
      initialInput: payload,
    });

    return Response.json({
      id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
      message: "Workflow run started from webhook",
    });
  } catch (error) {
    return jsonError(error);
  }
}
