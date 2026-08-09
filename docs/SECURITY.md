# Security review notes

Short notes from reviewing authorization, isolation, and abuse surfaces in this codebase.

## Cross-org data leakage

Hasura select permissions scope all tenant tables through `org_members`. Org B cannot list Org A workflows, runs, or organizations. Actions re-check membership in Postgres before starting or approving runs, so GraphQL permission mistakes alone are not the only gate for execution.

## ID guessing

Resources use UUIDs. Guessing Org A’s workflow/run IDs as Org B returns empty arrays or null `*_by_pk` results under role `user` (see security tests 10–12). Do not grant admin-secret access to browsers.

## Actions

`triggerWorkflowRun` and `approveStep` require an authenticated Hasura user (session variables / Bearer JWT). Role and membership are loaded server-side; clients cannot assert “I am owner.” Optional `ACTION_SHARED_SECRET` should be enabled in production so only Hasura can invoke Action handlers.

## Viewers

Viewers can read org-scoped data but cannot update workflows or call `triggerWorkflowRun` (Action returns forbidden; Hasura mutations denied). Approve UI should not appear for unauthorized roles; even if invoked, Action checks `allowed_roles`.

## Editors and restricted steps

Editors may build most steps but cannot insert/update `db_write` or `notify`, and cannot create `webhook` triggers / manage webhook endpoints. Enforcement is in Hasura permission `check` filters, not only the UI.

## Approval

Approval is Action-only. Pausing is executor-controlled; resume verifies paused state, step type, membership, and configured `allowed_roles`. Idempotent success avoids double-continue races after a completed approve.

## Quota races

`consume_org_quota` increments with `WHERE calls_used < calls_allowed` in a single update and records `usage_events` only on success. Concurrent starts cannot both succeed past the cap for the same remaining slot. Frontend quota is informational.

## Secrets

Admin secret, JWT signing key, LLM keys, cron/action/event secrets stay server-side. Demo webhook secret is intentional for local demos (`demo-webhook-secret`) and is visible in seed/UI helpers—rotate for any shared environment. Do not commit real `.env.local` values.

## Webhook abuse

Webhook routes require the correct `X-Webhook-Secret` for the `path_token`. Unknown tokens 404; wrong secrets 401. Still treat path tokens as capabilities: use unguessable tokens and strong secrets outside local demo. Quota still applies per started run. Prefer network controls and shared Action secrets on Hasura-originated traffic in production.

## Related residual risks

- Local mode skips Action/event shared-secret checks when env vars are unset.
- HTTP steps block obvious private hosts; DNS rebinding / advanced SSRF is out of scope for this mini platform—keep allowlists tight if exposed publicly.
- Demo auth is for local review only; disable with `AUTH_MODE=nhost` (or remove demo login) before production.
