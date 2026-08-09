/**
 * End-to-end demo of the seeded Org A workflow:
 * trigger → wait for pause → approve → wait for complete → webhook trigger
 */
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ACTION_SECRET =
  process.env.ACTION_SHARED_SECRET || "local-action-secret";
const DEMO_PASSWORD = process.env.DEMO_AUTH_PASSWORD || "demo-password";

async function demoLogin(email) {
  const res = await fetch(`${APP}/api/auth/demo-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `login failed for ${email}`);
  return json.accessToken;
}

async function trigger(token, userId) {
  const res = await fetch(`${APP}/api/actions/trigger-workflow`, {
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
        "x-hasura-user-id": userId,
        "x-hasura-role": "user",
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "trigger failed");
  return json;
}

async function approve(token, userId, stepRunId) {
  const res = await fetch(`${APP}/api/actions/approve-step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Hasura-Action-Secret": ACTION_SECRET,
    },
    body: JSON.stringify({
      action: { name: "approveStep" },
      input: { step_run_id: stepRunId },
      session_variables: {
        "x-hasura-user-id": userId,
        "x-hasura-role": "user",
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "approve failed");
  return json;
}

async function getRun(pool, runId) {
  const run = await pool.query(
    `SELECT id, status, error FROM workflow_runs WHERE id = $1`,
    [runId]
  );
  const steps = await pool.query(
    `SELECT sr.id, sr.status, sr.attempt_count, sr.error, ws.name, ws.type, sr.output
     FROM step_runs sr
     JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
     WHERE sr.workflow_run_id = $1
     ORDER BY sr.created_at ASC`,
    [runId]
  );
  return { run: run.rows[0], steps: steps.rows };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/workflow_builder",
  });

  const aliceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const aliceToken = await demoLogin("alice@org-a.demo");
  console.log("Logged in as Alice");

  const started = await trigger(aliceToken, aliceId);
  console.log("Started run", started.id, started.status);

  let pausedStep = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await getRun(pool, started.id);
    console.log(
      `  status=${snapshot.run.status} steps=${snapshot.steps
        .map((s) => `${s.type}:${s.status}`)
        .join(", ")}`
    );
    pausedStep = snapshot.steps.find(
      (s) => s.type === "approval_gate" && s.status === "paused"
    );
    if (pausedStep) break;
    if (["failed", "cancelled"].includes(snapshot.run.status)) {
      throw new Error(`Run failed early: ${snapshot.run.error}`);
    }
  }

  if (!pausedStep) throw new Error("Did not reach approval_gate pause");
  console.log("Paused at approval_gate", pausedStep.id);

  const branch = (await getRun(pool, started.id)).steps.find(
    (s) => s.type === "conditional_branch"
  );
  console.log("Conditional branch output:", JSON.stringify(branch?.output));

  const approved = await approve(aliceToken, aliceId, pausedStep.id);
  console.log("Approved:", approved.status, approved.message);

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const snapshot = await getRun(pool, started.id);
    console.log(
      `  status=${snapshot.run.status} steps=${snapshot.steps
        .map((s) => `${s.type}:${s.status}`)
        .join(", ")}`
    );
    if (snapshot.run.status === "completed") break;
    if (snapshot.run.status === "failed") {
      throw new Error(`Run failed after approval: ${snapshot.run.error}`);
    }
  }

  const finalSnap = await getRun(pool, started.id);
  if (finalSnap.run.status !== "completed") {
    throw new Error(`Expected completed, got ${finalSnap.run.status}`);
  }
  console.log("Manual run completed");

  const webhook = await fetch(
    `${APP}/api/webhooks/demo-org-a-webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "demo-webhook-secret",
      },
      body: JSON.stringify({ source: "demo-e2e" }),
    }
  );
  const webhookJson = await webhook.json();
  if (!webhook.ok) throw new Error(webhookJson.message || "webhook failed");
  console.log("Webhook started run", webhookJson.id || webhookJson.run_id || webhookJson);

  // Cross-org denial
  const davidToken = await demoLogin("david@org-b.demo");
  const davidId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const denied = await fetch(`${APP}/api/actions/trigger-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${davidToken}`,
      "X-Hasura-Action-Secret": ACTION_SECRET,
    },
    body: JSON.stringify({
      action: { name: "triggerWorkflowRun" },
      input: { workflow_id: WORKFLOW_A },
      session_variables: {
        "x-hasura-user-id": davidId,
        "x-hasura-role": "user",
      },
    }),
  });
  if (denied.ok) throw new Error("Org B should not trigger Org A workflow");
  console.log("Org B correctly denied:", (await denied.json()).message);

  // Session spoof without JWT must fail
  const spoof = await fetch(`${APP}/api/actions/trigger-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hasura-Action-Secret": ACTION_SECRET,
    },
    body: JSON.stringify({
      action: { name: "triggerWorkflowRun" },
      input: { workflow_id: WORKFLOW_A },
      session_variables: { "x-hasura-user-id": aliceId },
    }),
  });
  if (spoof.ok) throw new Error("Session spoof without JWT should fail");
  console.log("Session spoof correctly denied");

  await pool.end();
  console.log("E2E demo PASSED");
}

main().catch((err) => {
  console.error("E2E demo FAILED:", err);
  process.exit(1);
});
