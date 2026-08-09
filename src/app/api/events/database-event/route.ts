import { verifyEventSecret } from "@/lib/auth/request-auth";
import { query } from "@/lib/db";
import { startWorkflowRun } from "@/lib/executor/engine";
import { AppError, jsonError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";

export const runtime = "nodejs";

interface WatchedRecord {
  id?: string;
  org_id?: string;
  title?: string;
  payload?: JsonObject;
}

interface HasuraEventPayload {
  event?: {
    op?: string;
    data?: {
      new?: WatchedRecord | null;
      old?: WatchedRecord | null;
    };
  };
  table?: { name?: string; schema?: string };
}

export async function POST(req: Request) {
  try {
    verifyEventSecret(req);

    let body: HasuraEventPayload;
    try {
      body = (await req.json()) as HasuraEventPayload;
    } catch {
      throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
    }

    const record = body.event?.data?.new;
    if (!record?.org_id || !record.id) {
      return Response.json({ ok: true, skipped: true });
    }

    const triggers = await query<{
      workflow_id: string;
      trigger_id: string;
    }>(
      `SELECT wt.id AS trigger_id, wt.workflow_id
       FROM workflow_triggers wt
       INNER JOIN workflows w ON w.id = wt.workflow_id
       WHERE w.org_id = $1
         AND w.active = true
         AND wt.enabled = true
         AND wt.trigger_type = 'database_event'`,
      [record.org_id]
    );

    if (triggers.rows.length === 0) {
      return Response.json({ ok: true, started: 0 });
    }

    const initialInput: JsonObject = {
      op: body.event?.op || "UNKNOWN",
      table: body.table?.name || "watched_records",
      record: {
        id: record.id,
        org_id: record.org_id,
        title: record.title ?? null,
        payload: record.payload ?? {},
      },
    };

    const startedIds: string[] = [];

    // Start runs after response-friendly path; still await creation so quota errors surface.
    for (const trigger of triggers.rows) {
      try {
        const run = await startWorkflowRun({
          workflowId: trigger.workflow_id,
          triggeredBy: null,
          triggerType: "database_event",
          initialInput: {
            ...initialInput,
            trigger_id: trigger.trigger_id,
          },
        });
        startedIds.push(run.id);
      } catch (error) {
        console.error(
          "[database-event] Failed to start workflow",
          trigger.workflow_id,
          error
        );
      }
    }

    return Response.json({
      ok: true,
      started: startedIds.length,
      run_ids: startedIds,
    });
  } catch (error) {
    return jsonError(error);
  }
}
