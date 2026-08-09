import { z } from "zod";
import {
  safeEqualSecret,
  verifyHasuraActionSecret,
} from "@/lib/auth/request-auth";
import { query } from "@/lib/db";
import { startWorkflowRun } from "@/lib/executor/engine";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject, TriggerWorkflowRunOutput } from "@/lib/types";

export const runtime = "nodejs";

const inputSchema = z.object({
  path_token: z.string().min(1),
  payload: z.unknown().optional(),
});

function unauthorized(): never {
  throw new AppError("UNAUTHORIZED", "Unauthorized", 401);
}

async function startFromWebhook(options: {
  pathToken: string;
  secret: string | null;
  payload: JsonObject;
}): Promise<TriggerWorkflowRunOutput> {
  const result = await query<{
    workflow_id: string;
    secret: string;
    active: boolean;
    trigger_enabled: boolean;
  }>(
    `SELECT
       we.workflow_id,
       we.secret,
       w.active,
       wt.enabled AS trigger_enabled
     FROM webhook_endpoints we
     INNER JOIN workflows w ON w.id = we.workflow_id
     INNER JOIN workflow_triggers wt
       ON wt.id = we.trigger_id AND wt.workflow_id = we.workflow_id
     WHERE we.path_token = $1
     LIMIT 1`,
    [options.pathToken]
  );

  const row = result.rows[0];
  if (!row || !options.secret || !safeEqualSecret(options.secret, row.secret)) {
    unauthorized();
  }

  if (!row.active) {
    throw new AppError("INVALID_STATE", "Workflow is not active", 400);
  }

  if (!row.trigger_enabled) {
    throw new AppError("INVALID_STATE", "Webhook trigger is disabled", 400);
  }

  const run = await startWorkflowRun({
    workflowId: row.workflow_id,
    triggeredBy: null,
    triggerType: "webhook",
    initialInput: options.payload,
  });

  return {
    id: run.id,
    status: run.status,
    workflow_id: run.workflow_id,
    message: "Workflow run started from webhook",
  };
}

export async function POST(req: Request) {
  try {
    // Always require Hasura→app shared secret (no optional bypass).
    verifyHasuraActionSecret(req);

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
    }

    const maybeAction = json as {
      action?: { name?: string };
      input?: { path_token?: string; payload?: unknown };
      path_token?: string;
      payload?: unknown;
    };

    const input =
      maybeAction.action && maybeAction.input
        ? maybeAction.input
        : {
            path_token: maybeAction.path_token,
            payload: maybeAction.payload ?? maybeAction,
          };

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "path_token is required", 400);
    }

    const secret =
      req.headers.get("x-webhook-secret") ||
      req.headers.get("X-Webhook-Secret");

    const body = await startFromWebhook({
      pathToken: parsed.data.path_token,
      secret,
      payload: (parsed.data.payload &&
      typeof parsed.data.payload === "object" &&
      !Array.isArray(parsed.data.payload)
        ? parsed.data.payload
        : { payload: parsed.data.payload ?? null }) as JsonObject,
    });

    return Response.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
