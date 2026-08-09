# Final audit

Assessment against the assignment requirements, based on the current repository (not aspirational features).

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| PostgreSQL schema (orgs, members, workflows, steps, triggers, runs, step_runs, statuses) | `hasura/migrations/default/1730000000000_init/up.sql` | Inspect migration; Docker cli-migrations applies on `compose up` | Pass |
| Extra tables (webhooks, usage, watched_records, notifications, audit) | Same init migration + `usage_events`, view, `consume_org_quota` | Schema present in migration | Pass |
| Indexes / FKs / unique membership | Defined in init migration | SQL review | Pass |
| Aggregation / monthly usage | `organization_monthly_usage` view + org counters | GraphQL select + dashboard quota UI | Pass |
| Hasura relationships | `hasura/metadata/databases/default/tables/*.yaml` | Metadata applied with cli-migrations-v3 | Pass |
| Hasura org isolation permissions | Filters via `org_members` / `X-Hasura-User-Id` | `tests/security.integration.test.ts` cases 8–12 | Pass |
| Role permissions (owner/editor/viewer) | Table permissions + Action checks | Security tests 1–4, 5–7 | Pass |
| Editor blocked from `db_write` / `notify` / webhook trigger | Step & trigger permission checks | Security tests 5–7 | Pass |
| Approval not client-writable | No user update perms on approval fields; Action-only resume | Metadata + `approve-step` route | Pass |
| Workflow executor | `src/lib/executor/engine.ts` + `steps.ts` | Manual/webhook run; unit tests for helpers | Pass |
| `llm_call` (real + stub) | `src/lib/llm/provider.ts`; stub when no `LLM_API_KEY` | `tests/llm-stub.test.ts`; env effective provider | Pass |
| `http_request` (timeout, SSRF-ish blocks) | `src/lib/executor/http-step.ts` | `tests/http-step.test.ts` | Pass |
| `db_write` controlled table | Writes only to `workflow_db_writes` | Code review of `executeDbWrite` | Pass |
| `notify` | Inserts `notifications` + optional webhook POST | Seeded notify step; event metadata present | Pass |
| `conditional_branch` deterministic | `src/lib/executor/condition.ts` | `tests/condition.test.ts`; seeded POSITIVE path | Pass |
| `approval_gate` pause/resume | Engine pause + `approveStep` Action | Live run UI + Action handler | Pass |
| Retry for LLM/HTTP | Max 2 attempts for those types | Engine `RETRYABLE_TYPES` | Pass |
| Quota: 1 run = 1 call, atomic | `consume_org_quota` + `consumeQuota` | Security test 13; SQL function | Pass |
| Action `triggerWorkflowRun` | Metadata + `/api/actions/trigger-workflow` | Hasura Action; viewer denied in tests | Pass |
| Action `approveStep` | Metadata + `/api/actions/approve-step` | Server-side role/`allowed_roles` checks | Pass |
| Webhook trigger (non-manual) | REST `/api/webhooks/[pathToken]` + seeded endpoint | Documented curl; TriggerPanel copy | Pass |
| Action `triggerWorkflowWebhook` | Metadata + `/api/actions/trigger-webhook` | Metadata permissions include anonymous/user | Pass |
| Database event trigger | Event on `watched_records` → `/api/events/database-event` | Metadata + route present | Pass |
| Scheduled trigger | Cron `scheduled_workflow_tick` → `/api/events/scheduled` | Metadata + route with optional `CRON_SECRET` | Pass |
| GraphQL ops + subscriptions | `src/lib/graphql/operations.ts`, `client.ts` | LiveRunView subscriptions + polling fallback | Pass |
| Frontend pages (login, dashboard, builder, run) | `src/app/**`, workflow components | Manual UI walkthrough | Pass |
| Org switching / security demo | Org selector + seeded A/B personas | Login personas; cross-org tests | Pass |
| Seed data Alice–Frank / Org A&B | `1730000000001_seed` + `DEMO_USERS` | Login UI lists personas | Pass |
| Final demo workflow (LLM→HTTP→branch→approval→notify) | Seeded “Demo Approval Pipeline” | Walkthrough §22 README | Pass |
| Security test suite | `tests/security.integration.test.ts` (+ unit tests) | `npm test` (integration skips if stack down) | Pass |
| Env documentation | `.env.example`, README §7 | File review | Pass |
| README sections 1–22 | `README.md` | File review | Pass |
| Technical write-up | `docs/technical-writeup.md` | File review | Pass |
| Security review notes | `docs/SECURITY.md` | File review | Pass |
| Local demo without Nhost Cloud | `AUTH_MODE=demo` default; Docker Hasura/Postgres | `.env.example` + demo-login route | Pass |
| Nhost integration path | `@nhost/nhost-js` client + email/password form when subdomain/region set; demo JWT remains default | Login page shows Nhost form when configured | Pass |
| Vercel-compatible deploy | Standard Next.js App Router; no hardcoded-only URLs in server env loader | `npm run build` expected; no `vercel.json` (not required) | Pass |
| Production secrets on Actions/events | Optional `ACTION_SHARED_SECRET` / `HASURA_EVENT_SECRET` | Skipped when unset (local convenience) | Partial |
| `WEBHOOK_HMAC_SECRET` env | Present in env schema / `.env.example` | Webhook auth uses DB `webhook_endpoints.secret`, not HMAC of this var | Partial |

## Suggested verification commands

```bash
npm install
docker compose up -d
npm run typecheck
npm run lint
npm test
npm run build
```

## Honest gaps

1. **Action/event shared secrets**: Optional locally; enable `ACTION_SHARED_SECRET` / `HASURA_EVENT_SECRET` / cron header for production hardening.
2. **Integration Action tests**: Cases that hit Next.js Actions require `npm run start` (or `dev`) in addition to Docker Compose.
3. **Nhost cloud project**: Local demo uses Hasura JWT personas; a real Nhost project must map users into `org_members` after signup.
