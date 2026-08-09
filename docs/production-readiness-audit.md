# Production readiness audit

**Date:** 2026-08-09  
**Scope:** Pre-deploy audit for Nhost + Vercel. No feature work; only genuine hardening found → production env fail-fast.

## Quality gates (this audit)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **48/48 PASS** |
| `npm run build` | PASS |
| `npm run demo:e2e` | PASS |
| `node scripts/inspect-auth.mjs` | PASS |
| `node scripts/inspect-frontend-gql.mjs` | PASS |
| `node scripts/production-hostile-audit.mjs` | PASS |

---

## Requirement matrix

| Requirement | Result | Evidence | Status |
| --- | --- | --- | --- |
| Authentication (demo local) | Demo JWT login; password required; `/api/auth/me` binds JWT → `org_members` | `inspect-auth.mjs`; security test 17 | PASS |
| Authentication (Nhost production path) | `AUTH_MODE=nhost` or Vercel production + Nhost env forces Nhost; demo disabled | `src/lib/auth/mode.ts`; `tests/auth-mode.test.ts` | PASS |
| Hasura permissions | Role `user` only on tables; filters via `org_members.user_id = X-Hasura-User-Id` | `hasura/metadata/databases/**/*.yaml` | PASS |
| Anonymous table access | No table permissions for `anonymous`/`public`. Only Action `triggerWorkflowWebhook` allows anonymous (secret-validated handler) | `actions.yaml` + table metadata grep | PASS |
| Cross-org isolation | Org B cannot query/mutate Org A workflow, runs, step_runs; guessed UUIDs empty | `production-hostile-audit.mjs`; security tests 8–12 | PASS |
| Role permissions | Editor blocked db_write/notify/webhook; viewer cannot trigger; owner full | Hostile audit + security tests 1–7 | PASS |
| Step-level permissions | Owner-only privileged steps enforced in Hasura checks | `public_workflow_steps.yaml`; security tests 5–6, 14 | PASS |
| Actions auth | JWT required; session user must match JWT; Action secret required; membership from DB | `parseHasuraAction`; hostile spoof → 401; Org B trigger/approve → 404 | PASS |
| Quota | Atomic `consume_org_quota` (`UPDATE … WHERE calls_used < calls_allowed`); Action + webhook reject when exhausted | SQL migration; hostile quota tests → Action fail + webhook 429 | PASS |
| Workflow executor | LLM→branch→HTTP→approval→db_write→notify; pause/resume; skip on false path | `demo:e2e`; execution integration tests | PASS |
| Retry | llm/http max 2 attempts; failed run status `failed` | `engine.ts` RETRYABLE_TYPES; execution test 20–21 | PASS |
| Approval | Pause persists; resume via Action; cross-org denied; idempotent path | `demo:e2e`; approve-step route; hostile Org B approve | PASS |
| Subscriptions | Browser WSS to Hasura (`https`→`wss`); same JWT RLS; Org B empty step_runs | `client.ts` `hasuraWsUrl`; security 11b; LiveRunView | PASS |
| Webhook | Secret header; invalid → 401; starts real run; quota enforced; secrets not in GraphQL select | Hostile audit; `demo:e2e` webhook; webhook_endpoints select omits `secret` | PASS |
| Frontend | Real GraphQL; role UX; live subscription; no mock execution | Prior frontend report + GraphQL smoke | PASS |
| Environment variables | `.env.example` classifies PUBLIC vs SERVER-ONLY; `.env.local` gitignored | `.env.example`; `git check-ignore .env.local` | PASS |
| Secrets not in browser | No `NEXT_PUBLIC_` for LLM/DB/admin/action/event/cron/JWT secrets; admin secret unused by UI | Grep `src/`; GraphQL client Bearer-only | PASS |
| Production localhost guard | `assertProductionEnvSafety()` fails Vercel production if DB/GraphQL/App URL still localhost or Nhost env missing | `src/lib/env.ts`; `tests/production-env.test.ts` | PASS |
| Docker / local Hasura health | Postgres + graphql-engine **healthy**, `RestartCount=0`. Prior “Restarting” was intentional `docker compose restart` after metadata apply — **not** a crash loop | `docker inspect`; `/healthz` → OK; `/api/health` → `{"ok":true}` | PASS |
| Vercel readiness | Next.js App Router build succeeds; API routes as Actions targets; subscriptions require **Nhost Hasura WSS** (documented) | `npm run build`; `docs/deployment.md` | PASS |
| Migrations/metadata VCS | All under `hasura/migrations` + `hasura/metadata` | Repo tree | PASS |

---

## Secrets / localhost search (summary)

| Finding | Assessment |
| --- | --- |
| `localhost` / `127.0.0.1` in `.env.example`, compose, tests, scripts | Expected for local/dev only |
| Seeded `demo-webhook-secret` / demo passwords | Local demo only; document rotation for prod |
| `LLM_API_KEY` server-only | PASS |
| Webhook `secret` column not selectable via GraphQL | PASS (metadata) |
| `HASURA_ADMIN_SECRET` not used by browser | PASS |
| Hardcoded production credentials in repo | None found; `.env.local` ignored |

**Fix applied this audit:** production env fail-fast + `.env.example` classification + `docs/deployment.md`.

---

## Docker restart conclusion

| Check | Value |
| --- | --- |
| graphql-engine status | running / healthy |
| RestartCount | **0** |
| postgres | running / healthy |
| Cause of earlier “Restarting” | Manual restart to reload metadata after aggregation/`secret` select changes |

**Not a recurring crash loop.**

---

## Subscription production note

Live runs open a WebSocket to **Hasura**, not Vercel:

`NEXT_PUBLIC_HASURA_GRAPHQL_URL` (`https://…`) → `wss://…/v1/graphql`

Vercel hosts UI + Action/webhook HTTP handlers only. This is required configuration, not optional.

---

## Hostile audit results (API/GraphQL)

All passed:

- Org B GraphQL isolation (workflow / runs / step_runs / mutate)
- Org B Action trigger + approve denied
- Editor db_write / notify / webhook denied
- Viewer trigger denied
- JWT spoof denied
- Quota blocks Action + webhook
- Invalid webhook secret rejected

---

## Demo walkthrough (backend-verified)

`npm run demo:e2e` executed successfully:

1. Org A owner trigger → pause at approval (LLM, conditional, HTTP completed)  
2. Approve → db_write + notify → **completed**  
3. Webhook starts second run  
4. Org B trigger denied  
5. Session spoof denied  

UI subscription behavior matches the same backend state machine (prior frontend verification + LiveRunView WSS).

---

## Deployment docs

- `docs/deployment.md` — GitHub, Nhost, migrations, Actions, events, Vercel env, testing  
- `.env.example` — PUBLIC vs SERVER-ONLY  

---

## FINAL STATUS

**READY FOR DEPLOYMENT**

Critical security, quota, execution, auth, container health, and quality gates passed. Deploy by following `docs/deployment.md` (manual Nhost/Vercel wiring required).
