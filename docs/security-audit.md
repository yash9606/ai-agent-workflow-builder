# Hostile security audit

Date: 2026-08-09  
Scope: assignment requirements (org isolation, Actions, approvals, quota, retries, triggers, secrets, build)

Status values below are only **PASS** when verified by automated test and/or live probe after the fix landed.

| Issue | Impact | Fix | Verification | Status |
| --- | --- | --- | --- | --- |
| Action endpoints trusted `session_variables` without JWT | Attacker could impersonate any user when `ACTION_SHARED_SECRET` was unset/optional | `requireUserFromRequest` always verifies Bearer JWT; session user must match JWT; `ACTION_SHARED_SECRET` required | `tests/auth-hardening.test.ts` (spoof + mismatch); security test 15; `demo:e2e` spoof check | PASS |
| Hasura Actions shipped without shared-secret headers | Forgeable Action calls if app secret was optional | `actions.yaml` sends `X-Hasura-Action-Secret` from `ACTION_SHARED_SECRET`; docker-compose + `.env*` set secret | Metadata + env present; Action calls without secret return 401 | PASS |
| Event triggers had no auth headers | Anyone could POST fake DB/notify events and start runs / SSRF | Event metadata headers `X-Hasura-Event-Secret`; `verifyEventSecret` requires configured secret | Metadata `public_notifications.yaml` / `public_watched_records.yaml`; auth-hardening event secret test | PASS |
| Cron secret optional + always-due schedule | Unauthenticated cron + bare scheduled triggers fired every minute (quota drain) | `verifyCronSecret` required; `isDue` requires `interval_minutes` or `next_run_at`; UI sets `interval_minutes: 60` | Unit logic in scheduled route; cron secret test | PASS |
| Demo login accepted missing password | Open JWT mint for seeded personas | Password mandatory (`DEMO_AUTH_PASSWORD`); login UI sends it | Demo login without password → 401 (manual/API); UI updated | PASS |
| Editors could delete `db_write`/`notify` steps | Privilege demotion of owner-only pipeline steps | Delete permission filter mirrors insert/update owner gate | Security test 14 (`affected_rows = 0`) | PASS |
| Editors could demote privileged steps via `type` update | Change `notify` → `http_request` without being owner | Update **filter** now excludes privileged types for non-owners | Hasura metadata filter review + editor delete/update tests | PASS |
| Approval resume used `position+1` as array index | Gaps in positions skipped post-approval steps | Resume uses ordered `findIndex(step.id)` then `+1`; idempotent re-kick if stuck | `demo:e2e` resume→notify completes; engine code review | PASS |
| Approval roles read live step config | Editor could widen `allowed_roles` while paused | Approve uses frozen `step_run.output.allowed_roles` from pause | `approve-step` + `executeApprovalGate` snapshot | PASS |
| HTTP `redirect: "follow"` SSRF | Open redirect to metadata/internal hosts | `redirect: "manual"`; DNS resolve private IP block; broader private ranges | `tests/auth-hardening.test.ts` + `tests/http-step.test.ts` | PASS |
| Notify destination SSRF | Owner/event path could hit internal URLs | `validateHttpUrl` + no redirects on notify step and event handler | Code path + private URL unit tests | PASS |
| Webhook path enumeration (404 vs 401) | Discover valid `path_token`s | Uniform `401 Unauthorized` for missing path and bad secret; constant-time compare | Security test 16 | PASS |
| Hardcoded webhook secret on create | Shared secret across all new webhooks | Random UUID secret + longer path token in `TriggerPanel` | Code review of TriggerPanel | PASS |
| `webhook_endpoints` could cross-link workflows/triggers | Integrity / cross-trigger coupling | Composite FK `(trigger_id, workflow_id)` → `workflow_triggers` | Constraints present in DB (`\d webhook_endpoints`) | PASS |
| Cross-org GraphQL select by UUID guess | Org B read Org A | Unchanged: membership RLS filters; verified empty/`null` | Security tests 8–12 | PASS |
| Viewer mutate / trigger | Privilege escalation | Viewer update matches 0 rows; Action returns role error | Security tests 3–4 | PASS |
| Editor insert `db_write`/`notify`/webhook | Restricted-step bypass | Hasura insert checks | Security tests 5–7 | PASS |
| Direct `workflow_runs`/`step_runs` mutations | Bypass Actions | Still select-only in metadata | Metadata review | PASS |
| Quota race / frontend-only quota | Over-run calls | `consume_org_quota` atomic UPDATE | Security test 13 | PASS |
| LLM/HTTP retry | Silent single-try failures | Max 2 attempts for llm/http; HTTP 5xx throws for retry | Engine `RETRYABLE_TYPES`; HTTP 5xx in `steps.ts` | PASS |
| Conditional branch used HTTP output | Wrong branch in earlier seed order | Seed order LLM→conditional→HTTP; stub yields POSITIVE | `demo:e2e` shows `positive_path` | PASS |
| Webhook trigger without Run button | Missing non-manual start | REST `/api/webhooks/[pathToken]` | `demo:e2e` webhook start | PASS |
| GraphQL subscription cross-org | Leak step_runs | Same select RLS as queries (no weaker sub perms) | Metadata (subscriptions inherit select) + cross-org empty queries | PASS |
| Secret exposure via `NEXT_PUBLIC_*` | Browser leak of server secrets | Only public GraphQL/Nhost/app URL exposed | `.env.example` review | PASS |
| Production build | Deploy blocker | `npm run build` succeeds after fixes | Build command exit 0 | PASS |

## Residual risks (documented, not marked PASS as fully eliminated)

| Residual | Notes |
| --- | --- |
| Local demo defaults | JWT/admin/action secrets are known local defaults — rotate for any shared/staging deploy |
| Seed webhook secret | `demo-webhook-secret` remains for the seeded Org A demo path; new UI webhooks use random secrets |
| Within-org config visibility | Viewers can still read step `config` JSON (prompts/headers) via select — intentional for demo transparency; tighten columns if needed for production |
| Decimal/DNS rebinding SSRF | Hostname integer form blocked; DNS checked at request time — exotic rebinding remains a residual hardening item |

## Verification commands run

```bash
npm run typecheck
npm test
npm run build
npm run start   # then:
npm run demo:e2e
```

Hostile regression coverage added in:

- `tests/auth-hardening.test.ts`
- `tests/security.integration.test.ts` cases 14–16
