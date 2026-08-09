import { verifyCronSecret } from "@/lib/auth/request-auth";
import { query } from "@/lib/db";
import { startWorkflowRun } from "@/lib/executor/engine";
import { jsonError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";

export const runtime = "nodejs";

/**
 * A scheduled trigger is due only when it has explicit schedule metadata.
 * Bare `{ cron: "..." }` without interval/next_run_at does NOT fire every minute.
 */
function isDue(config: JsonObject, now: Date): boolean {
  const nextRunAt = config.next_run_at;
  if (typeof nextRunAt === "string") {
    const next = new Date(nextRunAt);
    if (!Number.isNaN(next.getTime())) {
      return next.getTime() <= now.getTime();
    }
  }

  const intervalMinutes = config.interval_minutes;
  if (typeof intervalMinutes === "number" && intervalMinutes > 0) {
    const lastRunAt = config.last_run_at;
    if (typeof lastRunAt !== "string") return true;
    const last = new Date(lastRunAt);
    if (Number.isNaN(last.getTime())) return true;
    return now.getTime() - last.getTime() >= intervalMinutes * 60_000;
  }

  // Refuse to fire when schedule config is incomplete (prevents quota drain).
  return false;
}

export async function POST(req: Request) {
  try {
    verifyCronSecret(req);

    const now = new Date();
    const triggers = await query<{
      id: string;
      workflow_id: string;
      config: JsonObject;
    }>(
      `SELECT wt.id, wt.workflow_id, wt.config
       FROM workflow_triggers wt
       INNER JOIN workflows w ON w.id = wt.workflow_id
       WHERE wt.trigger_type = 'scheduled'
         AND wt.enabled = true
         AND w.active = true`
    );

    const startedIds: string[] = [];

    for (const trigger of triggers.rows) {
      if (!isDue(trigger.config || {}, now)) continue;

      try {
        const run = await startWorkflowRun({
          workflowId: trigger.workflow_id,
          triggeredBy: null,
          triggerType: "scheduled",
          initialInput: {
            trigger_id: trigger.id,
            scheduled_at: now.toISOString(),
          },
        });
        startedIds.push(run.id);

        await query(
          `UPDATE workflow_triggers
           SET config = jsonb_set(
             COALESCE(config, '{}'::jsonb),
             '{last_run_at}',
             to_jsonb($2::text),
             true
           )
           WHERE id = $1`,
          [trigger.id, now.toISOString()]
        );
      } catch (error) {
        console.error(
          "[scheduled] Failed to start workflow",
          trigger.workflow_id,
          error
        );
      }
    }

    return Response.json({
      ok: true,
      checked: triggers.rows.length,
      started: startedIds.length,
      run_ids: startedIds,
    });
  } catch (error) {
    return jsonError(error);
  }
}
