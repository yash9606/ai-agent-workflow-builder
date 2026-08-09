/**
 * Security integration tests against local Hasura + Postgres.
 * Skips automatically when the stack is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphQLClient, gql } from "graphql-request";
import { signDemoJwt } from "@/lib/auth/jwt";
import { DEMO_USERS } from "@/lib/types";
import { Pool } from "pg";

const HASURA =
  process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
  "http://localhost:8080/v1/graphql";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/workflow_builder";
const ACTION_SECRET =
  process.env.ACTION_SHARED_SECRET || "local-action-secret";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";

let available = false;
let pool: Pool;

async function tokenFor(email: keyof typeof DEMO_USERS) {
  return signDemoJwt(DEMO_USERS[email].id, DEMO_USERS[email].email);
}

function client(token: string) {
  return new GraphQLClient(HASURA, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-hasura-role": "user",
    },
  });
}

function skipIfDown(context: { skip: (reason?: string) => void }) {
  if (!available) {
    context.skip("Hasura/Postgres unavailable — run docker compose up -d");
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1 FROM organizations LIMIT 1");
    const health = await fetch(HASURA.replace("/v1/graphql", "/healthz"));
    available = health.ok;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  await pool?.end();
});

describe("cross-org and role security", () => {
  it("1. owner can create workflow in own org", async (ctx) => {
    skipIfDown(ctx);
    const alice = client(await tokenFor("alice@org-a.demo"));
    const data = await alice.request<{
      insert_workflows_one: { id: string; org_id: string };
    }>(
      gql`
        mutation ($org_id: uuid!) {
          insert_workflows_one(
            object: {
              org_id: $org_id
              name: "Security Test Workflow"
              description: "created by owner"
            }
          ) {
            id
            org_id
          }
        }
      `,
      { org_id: ORG_A }
    );
    expect(data.insert_workflows_one.org_id).toBe(ORG_A);
  });

  it("2. editor can create permitted llm_call step", async (ctx) => {
    skipIfDown(ctx);
    // Use a disposable workflow so we do not pollute the seeded demo pipeline.
    const bob = client(await tokenFor("bob@org-a.demo"));
    const created = await bob.request<{
      insert_workflows_one: { id: string };
    }>(
      gql`
        mutation ($org_id: uuid!) {
          insert_workflows_one(
            object: {
              org_id: $org_id
              name: "Editor content test"
              description: "temp"
              active: true
            }
          ) {
            id
          }
        }
      `,
      { org_id: ORG_A }
    );
    const data = await bob.request<{
      insert_workflow_steps_one: { id: string; type: string };
    }>(
      gql`
        mutation ($workflow_id: uuid!) {
          insert_workflow_steps_one(
            object: {
              workflow_id: $workflow_id
              position: 0
              name: "Editor LLM"
              type: "llm_call"
              config: { prompt: "hi", provider: "stub" }
            }
          ) {
            id
            type
          }
        }
      `,
      { workflow_id: created.insert_workflows_one.id }
    );
    expect(data.insert_workflow_steps_one.type).toBe("llm_call");
  });

  it("3. viewer cannot modify workflow", async (ctx) => {
    skipIfDown(ctx);
    const charlie = client(await tokenFor("charlie@org-a.demo"));
    const data = await charlie.request<{
      update_workflows_by_pk: { id: string } | null;
    }>(
      gql`
        mutation ($id: uuid!) {
          update_workflows_by_pk(
            pk_columns: { id: $id }
            _set: { name: "hacked" }
          ) {
            id
          }
        }
      `,
      { id: WORKFLOW_A }
    );
    // Hasura RLS: update matches zero rows for viewers → null, not an exception.
    expect(data.update_workflows_by_pk).toBeNull();
  });

  it("4. viewer cannot trigger workflow via action", async (ctx) => {
    skipIfDown(ctx);
    const token = await tokenFor("charlie@org-a.demo");
    const res = await fetch(`${APP_URL}/api/actions/trigger-workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Hasura-Action-Secret": ACTION_SECRET,
      },
      body: JSON.stringify({
        action: { name: "triggerWorkflowRun" },
        input: { workflow_id: WORKFLOW_A },
        session_variables: {
          "x-hasura-user-id": DEMO_USERS["charlie@org-a.demo"].id,
          "x-hasura-role": "user",
        },
      }),
    }).catch(() => null);

    if (!res) {
      ctx.skip("Next.js app not running on :3000");
      return;
    }
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { message?: string };
    expect(body.message || "").toMatch(
      /forbidden|role|viewer|not allowed|unauthorized|owners and editors/i
    );
  });

  it("5. editor cannot add db_write", async (ctx) => {
    skipIfDown(ctx);
    const bob = client(await tokenFor("bob@org-a.demo"));
    await expect(
      bob.request(
        gql`
          mutation ($workflow_id: uuid!) {
            insert_workflow_steps_one(
              object: {
                workflow_id: $workflow_id
                position: 91
                name: "Bad write"
                type: "db_write"
                config: { key: "x" }
              }
            ) {
              id
            }
          }
        `,
        { workflow_id: WORKFLOW_A }
      )
    ).rejects.toThrow();
  });

  it("6. editor cannot add notify", async (ctx) => {
    skipIfDown(ctx);
    const bob = client(await tokenFor("bob@org-a.demo"));
    await expect(
      bob.request(
        gql`
          mutation ($workflow_id: uuid!) {
            insert_workflow_steps_one(
              object: {
                workflow_id: $workflow_id
                position: 92
                name: "Bad notify"
                type: "notify"
                config: { message: "nope" }
              }
            ) {
              id
            }
          }
        `,
        { workflow_id: WORKFLOW_A }
      )
    ).rejects.toThrow();
  });

  it("7. editor cannot create webhook trigger", async (ctx) => {
    skipIfDown(ctx);
    const bob = client(await tokenFor("bob@org-a.demo"));
    await expect(
      bob.request(
        gql`
          mutation ($workflow_id: uuid!) {
            insert_workflow_triggers_one(
              object: {
                workflow_id: $workflow_id
                trigger_type: "webhook"
                config: {}
                enabled: true
              }
            ) {
              id
            }
          }
        `,
        { workflow_id: WORKFLOW_A }
      )
    ).rejects.toThrow();
  });

  it("8. Org B cannot query Org A workflow", async (ctx) => {
    skipIfDown(ctx);
    const david = client(await tokenFor("david@org-b.demo"));
    const data = await david.request<{ workflows: { id: string }[] }>(
      gql`
        query ($id: uuid!) {
          workflows(where: { id: { _eq: $id } }) {
            id
          }
        }
      `,
      { id: WORKFLOW_A }
    );
    expect(data.workflows).toEqual([]);
  });

  it("9. Org B cannot query Org A runs", async (ctx) => {
    skipIfDown(ctx);
    const david = client(await tokenFor("david@org-b.demo"));
    const data = await david.request<{ workflow_runs: { id: string }[] }>(
      gql`
        query ($workflow_id: uuid!) {
          workflow_runs(where: { workflow_id: { _eq: $workflow_id } }) {
            id
          }
        }
      `,
      { workflow_id: WORKFLOW_A }
    );
    expect(data.workflow_runs).toEqual([]);
  });

  it("10-12. ID guessing does not leak Org A data to Org B", async (ctx) => {
    skipIfDown(ctx);
    const david = client(await tokenFor("david@org-b.demo"));
    const orgs = await david.request<{ organizations: { id: string }[] }>(
      gql`
        query {
          organizations {
            id
          }
        }
      `
    );
    expect(orgs.organizations.map((o) => o.id)).not.toContain(ORG_A);
    expect(orgs.organizations.map((o) => o.id)).toContain(ORG_B);

    const wf = await david.request<{ workflows_by_pk: { id: string } | null }>(
      gql`
        query ($id: uuid!) {
          workflows_by_pk(id: $id) {
            id
          }
        }
      `,
      { id: WORKFLOW_A }
    );
    expect(wf.workflows_by_pk).toBeNull();

    const runRow = await pool.query<{ id: string }>(
      `SELECT wr.id
       FROM workflow_runs wr
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE w.org_id = $1
       ORDER BY wr.created_at DESC
       LIMIT 1`,
      [ORG_A]
    );
    if (runRow.rows[0]) {
      const runId = runRow.rows[0].id;
      const leaked = await david.request<{
        workflow_runs: { id: string }[];
        step_runs: { id: string }[];
      }>(
        gql`
          query ($runId: uuid!) {
            workflow_runs(where: { id: { _eq: $runId } }) {
              id
            }
            step_runs(where: { workflow_run_id: { _eq: $runId } }) {
              id
            }
          }
        `,
        { runId }
      );
      expect(leaked.workflow_runs).toEqual([]);
      expect(leaked.step_runs).toEqual([]);
    }
  });

  it("11b. Org B cannot read Org A step_runs via subscription-shaped query", async (ctx) => {
    skipIfDown(ctx);
    const alice = client(await tokenFor("alice@org-a.demo"));
    const david = client(await tokenFor("david@org-b.demo"));

    const aliceRuns = await alice.request<{
      workflow_runs: { id: string }[];
    }>(
      gql`
        query ($wf: uuid!) {
          workflow_runs(
            where: { workflow_id: { _eq: $wf } }
            order_by: { created_at: desc }
            limit: 1
          ) {
            id
          }
        }
      `,
      { wf: WORKFLOW_A }
    );

    const runId = aliceRuns.workflow_runs[0]?.id;
    if (!runId) {
      ctx.skip("No Org A runs to probe");
      return;
    }

    const subShaped = await david.request<{
      step_runs: { id: string; status: string }[];
    }>(
      gql`
        query ($workflowRunId: uuid!) {
          step_runs(
            where: { workflow_run_id: { _eq: $workflowRunId } }
            order_by: { created_at: asc }
          ) {
            id
            status
            input
            output
            error
            attempt_count
            approved_by
            approved_at
          }
        }
      `,
      { workflowRunId: runId }
    );
    expect(subShaped.step_runs).toEqual([]);
  });

  it("13. quota exhaustion prevents execution", async (ctx) => {
    skipIfDown(ctx);
    await pool.query(
      `UPDATE organizations SET calls_used = calls_allowed WHERE id = $1`,
      [ORG_A]
    );
    try {
      const token = await tokenFor("alice@org-a.demo");
      const res = await fetch(`${APP_URL}/api/actions/trigger-workflow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Hasura-Action-Secret": ACTION_SECRET,
        },
        body: JSON.stringify({
          action: { name: "triggerWorkflowRun" },
          input: { workflow_id: WORKFLOW_A },
          session_variables: {
            "x-hasura-user-id": DEMO_USERS["alice@org-a.demo"].id,
            "x-hasura-role": "user",
          },
        }),
      }).catch(() => null);

      if (!res) {
        ctx.skip("Next.js app not running on :3000");
        return;
      }
      expect(res.ok).toBe(false);
      const body = (await res.json()) as { message?: string };
      expect(body.message || "").toMatch(/quota/i);
    } finally {
      await pool.query(
        `UPDATE organizations SET calls_used = 0 WHERE id = $1`,
        [ORG_A]
      );
    }
  });

  it("14. editor cannot delete notify step", async (ctx) => {
    skipIfDown(ctx);
    const bob = client(await tokenFor("bob@org-a.demo"));
    const data = await bob.request<{
      delete_workflow_steps: { affected_rows: number };
    }>(
      gql`
        mutation ($id: uuid!) {
          delete_workflow_steps(where: { id: { _eq: $id } }) {
            affected_rows
          }
        }
      `,
      { id: "aaaaaaaa-0000-4000-8000-000000000014" }
    );
    expect(data.delete_workflow_steps.affected_rows).toBe(0);
  });

  it("15. forged session_variables without JWT cannot trigger", async (ctx) => {
    skipIfDown(ctx);
    const res = await fetch(`${APP_URL}/api/actions/trigger-workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hasura-Action-Secret": ACTION_SECRET,
      },
      body: JSON.stringify({
        action: { name: "triggerWorkflowRun" },
        input: { workflow_id: WORKFLOW_A },
        session_variables: {
          "x-hasura-user-id": DEMO_USERS["alice@org-a.demo"].id,
        },
      }),
    }).catch(() => null);
    if (!res) {
      ctx.skip("Next.js app not running on :3000");
      return;
    }
    expect(res.ok).toBe(false);
    expect(((await res.json()) as { message?: string }).message || "").toMatch(
      /auth/i
    );
  });

  it("16. unknown webhook path does not reveal existence", async (ctx) => {
    skipIfDown(ctx);
    const res = await fetch(`${APP_URL}/api/webhooks/does-not-exist-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "wrong",
      },
      body: "{}",
    }).catch(() => null);
    if (!res) {
      ctx.skip("Next.js app not running on :3000");
      return;
    }
    expect(res.status).toBe(401);
  });

  it("17. /api/auth/me binds identity to JWT subject (org_members)", async (ctx) => {
    skipIfDown(ctx);
    const token = await tokenFor("alice@org-a.demo");
    const res = await fetch(`${APP_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res) {
      ctx.skip("Next.js app not running on :3000");
      return;
    }
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      user: { id: string };
      memberships: { org_id: string; role: string }[];
      authorization: { matchedVia: string };
    };
    expect(body.user.id).toBe(DEMO_USERS["alice@org-a.demo"].id);
    expect(body.authorization.matchedVia).toBe("org_members.user_id");
    expect(body.memberships.map((m) => m.org_id)).toContain(ORG_A);
    expect(body.memberships.map((m) => m.org_id)).not.toContain(ORG_B);
  });
});
