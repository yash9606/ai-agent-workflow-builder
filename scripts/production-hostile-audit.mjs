/**
 * Hostile production-readiness security audit against live Hasura + Next.js.
 * Exit 0 only if every unauthorized path fails safely.
 */
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const HASURA =
  process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
  "http://localhost:8080/v1/graphql";
const ACTION_SECRET =
  process.env.ACTION_SHARED_SECRET || "local-action-secret";
const DEMO_PASSWORD = process.env.DEMO_AUTH_PASSWORD || "demo-password";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GUESS_RUN = "aaaaaaaa-aaaa-4000-8000-ffffffffffff";

const failures = [];
function ok(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, detail) {
  console.error(`FAIL  ${name}: ${detail}`);
  failures.push(`${name}: ${detail}`);
}

async function demoLogin(email) {
  const res = await fetch(`${APP}/api/auth/demo-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${json.message}`);
  return { token: json.accessToken, userId: json.user.id };
}

async function gql(token, query, variables = {}) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-hasura-role": "user",
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function action(path, token, userId, input) {
  return fetch(`${APP}/api/actions/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Hasura-Action-Secret": ACTION_SECRET,
    },
    body: JSON.stringify({
      action: { name: path },
      input,
      session_variables: {
        "x-hasura-user-id": userId,
        "x-hasura-role": "user",
      },
    }),
  });
}

const alice = await demoLogin("alice@org-a.demo");
const bob = await demoLogin("bob@org-a.demo");
const charlie = await demoLogin("charlie@org-a.demo");
const david = await demoLogin("david@org-b.demo");

// --- Cross-org GraphQL ---
{
  const data = await gql(
    david.token,
    `query ($id: uuid!) {
      workflows_by_pk(id: $id) { id }
      workflows(where: { id: { _eq: $id } }) { id }
      workflow_runs(where: { workflow_id: { _eq: $id } }) { id }
      step_runs(where: { workflow_run: { workflow_id: { _eq: $id } } }) { id }
    }`,
    { id: WORKFLOW_A }
  );
  if (data.errors) fail("orgB graphql", JSON.stringify(data.errors));
  else if (
    data.data?.workflows_by_pk ||
    data.data?.workflows?.length ||
    data.data?.workflow_runs?.length ||
    data.data?.step_runs?.length
  ) {
    fail("orgB graphql", "leaked Org A data");
  } else ok("Org B GraphQL cannot see Org A workflow/runs/step_runs");
}

{
  const data = await gql(
    david.token,
    `query ($id: uuid!) {
      workflow_runs_by_pk(id: $id) { id }
      step_runs(where: { workflow_run_id: { _eq: $id } }) { id status }
    }`,
    { id: GUESS_RUN }
  );
  if (
    data.data?.workflow_runs_by_pk ||
    (data.data?.step_runs && data.data.step_runs.length)
  ) {
    fail("orgB guess run", "guessed UUID leaked data");
  } else ok("Org B guessed run UUID returns empty");
}

{
  const mut = await gql(
    david.token,
    `mutation ($id: uuid!) {
      update_workflows_by_pk(pk_columns: { id: $id }, _set: { name: "hacked" }) { id }
      delete_workflows_by_pk(id: $id) { id }
    }`,
    { id: WORKFLOW_A }
  );
  if (mut.data?.update_workflows_by_pk || mut.data?.delete_workflows_by_pk) {
    fail("orgB mutate", "Org B mutated Org A workflow");
  } else ok("Org B cannot update/delete Org A workflow");
}

// --- Cross-org Actions ---
{
  const res = await action("trigger-workflow", david.token, david.userId, {
    workflow_id: WORKFLOW_A,
  });
  if (res.ok) fail("orgB trigger", `status ${res.status}`);
  else ok(`Org B trigger Org A denied (${res.status})`);
}

{
  // Find a paused Org A approval if any; otherwise start one as Alice and pause.
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/workflow_builder",
  });
  await pool.query(
    `UPDATE organizations SET calls_used = LEAST(calls_used, calls_allowed - 2) WHERE id = $1`,
    [ORG_A]
  );

  let paused = await pool.query(
    `SELECT sr.id
     FROM step_runs sr
     JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
     JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
     JOIN workflows w ON w.id = wr.workflow_id
     WHERE w.org_id = $1 AND wr.status = 'paused' AND sr.status = 'paused'
       AND ws.type = 'approval_gate'
     ORDER BY wr.created_at DESC LIMIT 1`,
    [ORG_A]
  );

  if (!paused.rows[0]) {
    const started = await action(
      "trigger-workflow",
      alice.token,
      alice.userId,
      { workflow_id: WORKFLOW_A }
    );
    const body = await started.json();
    if (!started.ok) {
      fail("setup pause", body.message || started.status);
    } else {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline && !paused.rows[0]) {
        await new Promise((r) => setTimeout(r, 400));
        paused = await pool.query(
          `SELECT sr.id FROM step_runs sr
           JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
           JOIN workflow_steps ws ON ws.id = sr.workflow_step_id
           WHERE wr.id = $1 AND ws.type = 'approval_gate' AND sr.status = 'paused'
           LIMIT 1`,
          [body.id]
        );
      }
    }
  }

  if (!paused.rows[0]) {
    fail("orgB approve", "no paused gate available to test");
  } else {
    const res = await action("approve-step", david.token, david.userId, {
      step_run_id: paused.rows[0].id,
    });
    if (res.ok) fail("orgB approve", "cross-org approve succeeded");
    else ok(`Org B approve Org A denied (${res.status})`);
  }
  await pool.end();
}

// --- Role: editor restricted steps ---
{
  const insertDb = await gql(
    bob.token,
    `mutation ($wf: uuid!) {
      insert_workflow_steps_one(object: {
        workflow_id: $wf, position: 99, name: "bad", type: "db_write", config: { key: "x" }
      }) { id }
    }`,
    { wf: WORKFLOW_A }
  );
  if (insertDb.data?.insert_workflow_steps_one) {
    fail("editor db_write", "editor inserted db_write");
  } else ok("Editor cannot insert db_write");

  const insertNotify = await gql(
    bob.token,
    `mutation ($wf: uuid!) {
      insert_workflow_steps_one(object: {
        workflow_id: $wf, position: 98, name: "badn", type: "notify", config: { message: "x" }
      }) { id }
    }`,
    { wf: WORKFLOW_A }
  );
  if (insertNotify.data?.insert_workflow_steps_one) {
    fail("editor notify", "editor inserted notify");
  } else ok("Editor cannot insert notify");

  const insertWh = await gql(
    bob.token,
    `mutation ($wf: uuid!) {
      insert_workflow_triggers_one(object: {
        workflow_id: $wf, trigger_type: "webhook", config: {}, enabled: true
      }) { id }
    }`,
    { wf: WORKFLOW_A }
  );
  if (insertWh.data?.insert_workflow_triggers_one) {
    fail("editor webhook", "editor created webhook trigger");
  } else ok("Editor cannot create webhook trigger");
}

// --- Role: viewer cannot trigger ---
{
  const res = await action("trigger-workflow", charlie.token, charlie.userId, {
    workflow_id: WORKFLOW_A,
  });
  if (res.ok) fail("viewer trigger", "viewer triggered workflow");
  else ok(`Viewer trigger denied (${res.status})`);
}

// --- Spoof session without matching JWT ---
{
  const res = await fetch(`${APP}/api/actions/trigger-workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hasura-Action-Secret": ACTION_SECRET,
    },
    body: JSON.stringify({
      action: { name: "triggerWorkflowRun" },
      input: { workflow_id: WORKFLOW_A },
      session_variables: {
        "x-hasura-user-id": alice.userId,
        "x-hasura-role": "user",
      },
    }),
  });
  if (res.ok) fail("spoof", "trigger without JWT succeeded");
  else ok(`Session spoof without JWT denied (${res.status})`);
}

// --- Quota ---
{
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/workflow_builder",
  });
  await pool.query(
    `UPDATE organizations SET calls_used = calls_allowed WHERE id = $1`,
    [ORG_A]
  );
  const res = await action("trigger-workflow", alice.token, alice.userId, {
    workflow_id: WORKFLOW_A,
  });
  const body = await res.json();
  if (res.ok) fail("quota", "run succeeded while exhausted");
  else if (!String(body.message || "").toLowerCase().includes("quota")) {
    fail("quota", `unexpected message: ${body.message || res.status}`);
  } else ok("Quota exhaustion rejects Action");

  // Webhook also blocked
  const wh = await fetch(`${APP}/api/webhooks/demo-org-a-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": "demo-webhook-secret",
    },
    body: JSON.stringify({ source: "quota-audit" }),
  });
  if (wh.ok) fail("quota webhook", "webhook ran while exhausted");
  else ok(`Quota exhaustion rejects webhook (${wh.status})`);

  await pool.query(
    `UPDATE organizations SET calls_used = LEAST(calls_used, 30) WHERE id = $1`,
    [ORG_A]
  );
  await pool.end();
}

// --- Webhook invalid secret ---
{
  const bad = await fetch(`${APP}/api/webhooks/demo-org-a-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": "wrong-secret",
    },
    body: "{}",
  });
  if (bad.ok) fail("webhook secret", "invalid secret accepted");
  else ok(`Invalid webhook secret rejected (${bad.status})`);
}

// --- Auth mode still demo locally ---
{
  const mode = await fetch(`${APP}/api/auth/mode`).then((r) => r.json());
  if (mode.mode !== "demo" || !mode.demoEnabled) {
    fail("auth mode", JSON.stringify(mode));
  } else ok("Local AUTH_MODE remains demo (production Nhost path intact in code)");
}

if (failures.length) {
  console.error(`\nHOSTILE AUDIT FAILED (${failures.length})`);
  process.exit(1);
}
console.log("\nHOSTILE AUDIT PASSED");
