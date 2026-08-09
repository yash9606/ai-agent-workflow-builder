/**
 * Executor integration tests against local Postgres.
 * Exercises real start → pause → approve → complete and branching/skip.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  resumeWorkflowRun,
  startWorkflowRun,
} from "@/lib/executor/engine";
import { DEMO_USERS } from "@/lib/types";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/workflow_builder";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ALICE = DEMO_USERS["alice@org-a.demo"].id;
const DAVID = DEMO_USERS["david@org-b.demo"].id;

let available = false;
let pool: Pool;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForRunStatus(
  runId: string,
  wanted: string[],
  timeoutMs = 20_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM workflow_runs WHERE id = $1`,
      [runId]
    );
    const row = res.rows[0];
    if (row && wanted.includes(row.status)) return row;
    await sleep(200);
  }
  throw new Error(
    `Timed out waiting for run ${runId} in ${wanted.join("|")}`
  );
}

async function stepStatuses(runId: string) {
  const res = await pool.query<{
    type: string;
    name: string;
    status: string;
    attempt_count: number;
  }>(
    `SELECT ws.type, ws.name, sr.status, sr.attempt_count
     FROM step_runs sr
     JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
     WHERE sr.workflow_run_id = $1
     ORDER BY sr.created_at ASC`,
    [runId]
  );
  return res.rows;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1 FROM organizations LIMIT 1");
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  await pool?.end();
});

function skipIfDown(ctx: { skip: (reason?: string) => void }) {
  if (!available) {
    ctx.skip("Postgres unavailable — run docker compose up -d");
  }
}

describe("workflow executor", () => {
  it("13-18. manual run: LLM → branch → HTTP → approval pause → resume → complete", async (ctx) => {
    skipIfDown(ctx);

    // Ensure demo branch config supports jumps (migration may not have applied yet).
    await pool.query(
      `UPDATE workflow_steps
       SET config = jsonb_set(
         jsonb_set(COALESCE(config, '{}'::jsonb), '{true_next}', '"next"', true),
         '{false_next}',
         '"aaaaaaaa-0000-4000-8000-000000000013"',
         true
       )
       WHERE id = 'aaaaaaaa-0000-4000-8000-000000000012'`
    );

    // Restore quota so the run can start.
    await pool.query(
      `UPDATE organizations SET calls_used = LEAST(calls_used, calls_allowed - 1)
       WHERE id = $1 AND calls_used >= calls_allowed`,
      [ORG_A]
    );

    const run = await startWorkflowRun({
      workflowId: "aaaaaaaa-0000-4000-8000-000000000001",
      triggeredBy: ALICE,
      triggerType: "manual",
      initialInput: { source: "execution.integration.test" },
    });

    const paused = await waitForRunStatus(run.id, ["paused", "failed"]);
    expect(paused.status).toBe("paused");

    const before = await stepStatuses(run.id);
    expect(before.some((s) => s.type === "llm_call" && s.status === "completed")).toBe(
      true
    );
    expect(
      before.some((s) => s.type === "conditional_branch" && s.status === "completed")
    ).toBe(true);
    expect(
      before.some((s) => s.type === "approval_gate" && s.status === "paused")
    ).toBe(true);
    // Later steps must not have executed yet.
    expect(before.some((s) => s.type === "notify")).toBe(false);

    const gate = await pool.query<{ id: string }>(
      `SELECT sr.id
       FROM step_runs sr
       JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
       WHERE sr.workflow_run_id = $1 AND ws.type = 'approval_gate'
       LIMIT 1`,
      [run.id]
    );

    await resumeWorkflowRun(run.id, gate.rows[0].id, ALICE);
    const done = await waitForRunStatus(run.id, ["completed", "failed"], 30_000);
    expect(done.status).toBe("completed");

    const after = await stepStatuses(run.id);
    expect(after.some((s) => s.type === "notify" && s.status === "completed")).toBe(
      true
    );
  }, 60_000);

  it("16. conditional false path skips HTTP step", async (ctx) => {
    skipIfDown(ctx);

    const wf = await pool.query<{ id: string }>(
      `INSERT INTO workflows (org_id, name, description, active, created_by)
       VALUES ($1, 'Branch skip test', 'temp', true, $2)
       RETURNING id`,
      [ORG_A, ALICE]
    );
    const workflowId = wf.rows[0].id;

    await pool.query(
      `INSERT INTO workflow_steps (workflow_id, position, name, type, config) VALUES
       ($1, 0, 'llm', 'llm_call', $2::jsonb),
       ($1, 1, 'branch', 'conditional_branch', $3::jsonb),
       ($1, 2, 'http', 'http_request', $4::jsonb),
       ($1, 3, 'gate', 'approval_gate', '{"message":"approve","allowed_roles":["owner"]}'::jsonb)`,
      [
        workflowId,
        JSON.stringify({
          provider: "stub",
          prompt: "This is a terrible awful product",
        }),
        JSON.stringify({
          field: "text",
          operator: "contains",
          value: "POSITIVE",
          true_next: "next",
          false_next: "3",
        }),
        JSON.stringify({
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/todos/1",
          timeout_ms: 5000,
        }),
      ]
    );

    await pool.query(
      `UPDATE organizations SET calls_used = LEAST(calls_used, calls_allowed - 1)
       WHERE id = $1 AND calls_used >= calls_allowed`,
      [ORG_A]
    );

    try {
      const run = await startWorkflowRun({
        workflowId,
        triggeredBy: ALICE,
        triggerType: "manual",
      });
      const paused = await waitForRunStatus(run.id, ["paused", "failed"]);
      expect(paused.status).toBe("paused");

      const statuses = await stepStatuses(run.id);
      expect(
        statuses.some((s) => s.type === "http_request" && s.status === "skipped")
      ).toBe(true);
      expect(
        statuses.some((s) => s.type === "approval_gate" && s.status === "paused")
      ).toBe(true);
    } finally {
      await pool.query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);
    }
  }, 45_000);

  it("20-21. retry increments attempt_count then fails the run", async (ctx) => {
    skipIfDown(ctx);

    const wf = await pool.query<{ id: string }>(
      `INSERT INTO workflows (org_id, name, description, active, created_by)
       VALUES ($1, 'Retry fail test', 'temp', true, $2)
       RETURNING id`,
      [ORG_A, ALICE]
    );
    const workflowId = wf.rows[0].id;

    await pool.query(
      `INSERT INTO workflow_steps (workflow_id, position, name, type, config)
       VALUES ($1, 0, 'bad http', 'http_request', $2::jsonb)`,
      [
        workflowId,
        JSON.stringify({
          method: "GET",
          url: "http://127.0.0.1:9/",
          timeout_ms: 1000,
        }),
      ]
    );

    await pool.query(
      `UPDATE organizations SET calls_used = LEAST(calls_used, calls_allowed - 1)
       WHERE id = $1 AND calls_used >= calls_allowed`,
      [ORG_A]
    );

    try {
      const run = await startWorkflowRun({
        workflowId,
        triggeredBy: ALICE,
        triggerType: "manual",
      });
      const failed = await waitForRunStatus(run.id, ["failed"], 15_000);
      expect(failed.status).toBe("failed");

      const statuses = await stepStatuses(run.id);
      expect(statuses[0]?.status).toBe("failed");
      expect(statuses[0]?.attempt_count).toBeGreaterThanOrEqual(2);
    } finally {
      await pool.query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);
    }
  }, 30_000);

  it("19. unauthorized cross-org approval fails via Action", async (ctx) => {
    skipIfDown(ctx);

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const ACTION_SECRET =
      process.env.ACTION_SHARED_SECRET || "local-action-secret";

    const pausedRun = await pool.query<{
      run_id: string;
      step_run_id: string;
    }>(
      `SELECT wr.id AS run_id, sr.id AS step_run_id
       FROM workflow_runs wr
       JOIN step_runs sr ON sr.workflow_run_id = wr.id
       JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE w.org_id = $1
         AND wr.status = 'paused'
         AND sr.status = 'paused'
         AND ws.type = 'approval_gate'
       ORDER BY wr.created_at DESC
       LIMIT 1`,
      [ORG_A]
    );

    if (!pausedRun.rows[0]) {
      ctx.skip("No paused Org A approval gate available");
      return;
    }

    const { signDemoJwt } = await import("@/lib/auth/jwt");
    const davidToken = await signDemoJwt(
      DAVID,
      DEMO_USERS["david@org-b.demo"].email
    );

    let res: Response | null = null;
    try {
      res = await fetch(`${APP_URL}/api/actions/approve-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${davidToken}`,
          "X-Hasura-Action-Secret": ACTION_SECRET,
        },
        body: JSON.stringify({
          action: { name: "approveStep" },
          input: { step_run_id: pausedRun.rows[0].step_run_id },
          session_variables: {
            "x-hasura-user-id": DAVID,
            "x-hasura-role": "user",
          },
        }),
      });
    } catch {
      ctx.skip("Next.js app not running on :3000");
      return;
    }

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

