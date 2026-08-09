/**
 * Smoke-test enriched dashboard / workflow list GraphQL used by the UI.
 */
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const HASURA =
  process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
  "http://localhost:8080/v1/graphql";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";
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

async function gql(token, query, variables) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-hasura-role": "user",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

const alice = await demoLogin("alice@org-a.demo");
const david = await demoLogin("david@org-b.demo");

const dash = await gql(
  alice,
  `query ($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      name
      monthly_usage { remaining_calls usage_percentage }
      workflows {
        name
        steps_aggregate { aggregate { count } }
        triggers { trigger_type }
        runs(limit: 1) { status }
      }
    }
    workflow_runs(where: { workflow: { org_id: { _eq: $orgId } } }, limit: 3) {
      id status workflow { name }
    }
  }`,
  { orgId: ORG_A }
);

console.log("Alice org", dash.organizations_by_pk?.name);
console.log(
  "Workflow steps",
  dash.organizations_by_pk?.workflows?.[0]?.steps_aggregate?.aggregate?.count
);
console.log("Recent runs", dash.workflow_runs?.length);

const wf = await gql(
  alice,
  `query ($id: uuid!) {
    workflows_by_pk(id: $id) {
      name
      triggers {
        trigger_type
        webhook_endpoints { path_token }
      }
    }
  }`,
  { id: WORKFLOW_A }
);
const wh = wf.workflows_by_pk?.triggers?.find((t) => t.trigger_type === "webhook");
console.log("Webhook path_token", wh?.webhook_endpoints?.[0]?.path_token);

const denied = await gql(
  david,
  `query ($id: uuid!) { workflows_by_pk(id: $id) { id } }`,
  { id: WORKFLOW_A }
);
if (denied.workflows_by_pk) {
  throw new Error("Org B saw Org A workflow");
}
console.log("Org B denied Org A workflow: ok");
console.log("FRONTEND GQL SMOKE PASSED");
