# Technical write-up

## Schema reasoning

The schema is org-centric: every workflow hangs off `organizations`, membership is explicit in `org_members`, and execution state is split into `workflow_runs` + `step_runs` so the UI can subscribe to fine-grained progress. Side effects that must stay controlled live in dedicated tables (`workflow_db_writes`, `notifications`, `webhook_endpoints`) instead of allowing arbitrary SQL or untracked HTTP. Quota is stored on the org row and audited in `usage_events`, with `organization_monthly_usage` as a read model for the dashboard.

## Organization isolation

Isolation is membership-based, not “trust the client’s org id.” Hasura filters require a path through `organization.members.user_id = X-Hasura-User-Id` (or the equivalent via `workflow.organization.members`). Actions resolve the workflow/step_run from the database, then verify membership again in Next.js before mutating run state. Seeded Org A/B demos prove that knowing a UUID is not enough without membership.

## Hasura permission model

Role `user` is the only authenticated table role. Select is broad within the caller’s orgs; insert/update/delete are role-gated (`owner` / `editor` / `viewer`). Viewers cannot mutate workflows or create steps. Run and step_run rows are not client-writable for approval fields—those change only through the executor/Actions. `anonymous` is limited (e.g. webhook Action) and does not get table CRUD.

## Step-level authorization

Hasura permission checks encode “restricted steps”: editors may add `llm_call`, `http_request`, `conditional_branch`, `approval_gate`, but `db_write` and `notify` require `owner`. Webhook triggers and `webhook_endpoints` follow the same owner-only pattern. The UI mirrors this for UX, but denial is enforced in GraphQL permissions (covered by security tests).

## Action authorization

`triggerWorkflowRun` and `approveStep` forward client headers; handlers parse Hasura session variables / JWT, load resources from Postgres, and enforce owner/editor (trigger) or `allowed_roles` (approve). Callers cannot supply a trusted role or org id. Optional `ACTION_SHARED_SECRET` can require a shared header from Hasura in production.

## Workflow execution

`startWorkflowRun` (shared by manual Action, webhook, scheduled cron, and database-event handler) atomically consumes org quota, inserts a `workflow_runs` row, then executes ordered `workflow_steps` in a background task. Each step gets a `step_runs` row updated through `pending` → `running` → `completed` / `failed` / `paused` / `skipped`. External steps (`llm_call`, `http_request`) retry once. Conditional branches resolve `true_next` / `false_next` to a forward index (`next`, `end`, step UUID, or position); skipped steps receive `status = skipped`. No workflow logic runs in the browser.

## Approval pause / resume

Reaching `approval_gate` sets both step and run to `paused`, persists state, and **stops** the executor loop so later steps never run until approval. Resume is Action-only (`approveStep`): JWT identity → load step_run → workflow → org → `org_members` → role against frozen `allowed_roles` → verify paused approval_gate → set `approved_by` / `approved_at` → continue from the next ordered step index. Frontend role/org/user IDs are ignored. Duplicate approve after success is idempotent (re-kick if needed).

## GraphQL subscriptions

The live run UI subscribes to `workflow_runs` and `step_runs` over Hasura websockets (`graphql-ws`), using the same JWT permissions as queries. Pause and resume therefore appear without polling when WS is healthy; the UI falls back to short polling if the socket fails.

## Quota enforcement

Quota is checked at run start inside a transaction via `consume_org_quota`: monthly reset if needed, then a single-row conditional increment. One successful consume = one workflow run (any trigger type). Exhaustion fails the Action/API with a quota error; the frontend meter is not authoritative.

## Retry handling

`llm_call` and `http_request` retry once on failure (`attempt_count` tracked). Other steps do not retry. Timeouts bound external calls; HTTP steps also block localhost/private destinations. A failed final attempt marks the step and run `failed`—never `completed`.

## Trigger architecture

Manual runs go through `triggerWorkflowRun`. Webhooks use REST `/api/webhooks/[pathToken]` (secret header) and optionally Action `triggerWorkflowWebhook`. Scheduled work is a Hasura cron hitting `/api/events/scheduled`, which starts due `scheduled` triggers. Database events on `watched_records` call `/api/events/database-event` to start matching `database_event` triggers for that org. All paths converge on `startWorkflowRun` (quota + background execution).
