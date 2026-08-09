const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const HASURA =
  process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
  "http://localhost:8080/v1/graphql";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";

async function gql(token, query) {
  const res = await fetch(HASURA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-hasura-role": "user",
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function demoLogin(email) {
  const res = await fetch(`${APP}/api/auth/demo-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "demo-password" }),
  });
  return { status: res.status, body: await res.json() };
}

const mode = await fetch(`${APP}/api/auth/mode`).then((r) => r.json());
console.log("AUTH MODE", mode);

const noPass = await fetch(`${APP}/api/auth/demo-login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "alice@org-a.demo" }),
});
console.log("demo without password", noPass.status, await noPass.json());

const alice = await demoLogin("alice@org-a.demo");
console.log("alice login", alice.status, alice.body.user?.id);

const me = await fetch(`${APP}/api/auth/me`, {
  headers: { Authorization: `Bearer ${alice.body.accessToken}` },
}).then((r) => r.json());
console.log(
  "me",
  me.user?.id,
  me.memberships?.map((m) => `${m.org_id}:${m.role}`),
  me.authorization
);

const aliceGql = await gql(
  alice.body.accessToken,
  `query {
    organizations { id name }
    workflows(where: { id: { _eq: "${WORKFLOW_A}" } }) { id }
  }`
);
console.log("alice orgs", aliceGql.data?.organizations);
console.log("alice workflow A", aliceGql.data?.workflows);

const david = await demoLogin("david@org-b.demo");
const davidGql = await gql(
  david.body.accessToken,
  `query {
    organizations { id }
    workflows(where: { id: { _eq: "${WORKFLOW_A}" } }) { id }
    workflow_runs(where: { workflow_id: { _eq: "${WORKFLOW_A}" } }) { id }
    step_runs(where: { workflow_run: { workflow_id: { _eq: "${WORKFLOW_A}" } } }) { id }
  }`
);
console.log("david orgs", davidGql.data?.organizations);
console.log("david sees Org A workflow", davidGql.data?.workflows);
console.log("david sees Org A runs", davidGql.data?.workflow_runs);
console.log("david sees Org A step_runs", davidGql.data?.step_runs);

if (mode.mode !== "demo" || !mode.demoEnabled) {
  throw new Error("Expected local demo mode for this inspection");
}
if (me.user?.id !== alice.body.user?.id) {
  throw new Error("JWT subject mismatch");
}
if (davidGql.data?.workflows?.length) {
  throw new Error("Org B leaked Org A workflow");
}
console.log("AUTH INSPECTION PASSED");
