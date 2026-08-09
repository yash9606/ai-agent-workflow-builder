# Backend implementation report

## Baseline (before this phase)

- Auth checkpoint already passed (demo JWT + Nhost mode switching, `org_members` RLS).
- Existing suite: **33** tests passing.
- Core schema, Actions, executor, webhook/event/cron handlers already present.

## What this phase completed / hardened

| Area | Status |
| --- | --- |
| Schema (orgs, members, workflows, steps, triggers, runs, step_runs, quota) | Present + migration `1730000000003_branch_and_triggers` |
| Atomic quota (`consume_org_quota`) | Present; enforced at run start |
| Workflow CRUD via Hasura (role-gated) | Present; added `DELETE_WORKFLOW` / `DELETE_TRIGGER` GraphQL ops + `GET_ORG_WORKFLOW_TREE` |
| Step-level security (editor ≠ db_write/notify/webhook) | Present (Hasura + security tests) |
| Executor all 6 step types | Present |
| **Conditional jump + skipped steps** | **Implemented** (`true_next` / `false_next`, engine skip) |
| Approval pause/resume | Present; verified by integration tests |
| LLM real providers + stub | Present |
| HTTP with retry / SSRF guards | Present |
| db_write controlled table | Present; seeded on demo workflow |
| Notify real webhook + **stub** | Stub mode added when destination unset |
| Webhook / DB event / scheduled triggers | Present; scheduled + database_event seeded disabled |
| GraphQL subscriptions + org isolation | Present; security probe for step_runs by run id |
| Auth architecture | **Unchanged** (no regression) |

## Files created / modified

### Created
- `src/lib/executor/branch.ts` — safe branch target resolution
- `hasura/migrations/default/1730000000003_branch_and_triggers/{up,down}.sql`
- `tests/branch.test.ts`
- `tests/execution.integration.test.ts`
- `docs/backend-implementation-report.md`

### Modified
- `src/lib/executor/engine.ts` — skip steps / endRun after conditional
- `src/lib/executor/steps.ts` — branch jumps; notify stub
- `src/lib/types.ts` — `true_next` / `false_next`, `nextIndex` / `endRun`
- `src/lib/graphql/operations.ts` — org workflow tree, delete mutations
- `hasura/migrations/default/1730000000001_seed/up.sql` — demo steps/triggers
- `tests/security.integration.test.ts` — step_run / subscription-shaped isolation
- `README.md`, `docs/technical-writeup.md`

## Migrations

| Version | Purpose |
| --- | --- |
| `1730000000000_init` | Core tables, view, `consume_org_quota` |
| `1730000000001_seed` | Orgs A/B, personas, demo pipeline, webhook |
| `1730000000002_webhook_integrity` | Composite FK webhook ↔ trigger |
| `1730000000003_branch_and_triggers` | Branch jump config, db_write step, scheduled/DB-event triggers |

## Hasura metadata (existing)

- Actions: `triggerWorkflowRun`, `approveStep`, `triggerWorkflowWebhook`
- Event triggers: `watched_records_database_event`, `notifications_notify`
- Cron: `scheduled_workflow_tick` → `/api/events/scheduled`

## Executor architecture

```
trigger (Action | webhook | cron | DB event)
  → authorize (JWT + org_members where applicable)
  → consume_org_quota (atomic)
  → insert workflow_run (running)
  → background executeStepsFrom
       → per step: step_run + executeStep
       → approval_gate → pause (stop)
       → conditional → jump / skip / end
       → retry llm/http once
  → approveStep → membership + role → resumeWorkflowRun
```

## Tests added

- Branch resolver unit tests
- Executor integration: pause → resume → complete; false-path skip; retry → failed; cross-org approve Action denial
- Security: Org B cannot read Org A `step_runs` by guessed `workflow_run_id`

## Commands executed

```bash
npm test                 # baseline 33/33; after changes 43/43
# apply migration 1730000000003 via psql
npm run typecheck
npm run lint
npm run build
npm run demo:e2e         # (with Next.js running)
node scripts/inspect-auth.mjs
```

## Test results (post-change)

- Typecheck: pass
- Lint: pass
- Vitest: **43 passed**
- Production build: pass

## Known limitations

1. Scheduled / database_event demo triggers are **seeded disabled** so cron ticks do not drain quota unexpectedly; enable explicitly to test.
2. Notify stub completes the step successfully (logs only); it does not fail the run when destination is missing.
3. Conditional targets are forward-only (`next` / `end` / UUID / position) — no DAG / parallel branches.
4. Subscription security is enforced by the same Hasura select permissions as queries (tested via equivalent filtered query).
5. Fresh Docker volumes pick up seed changes automatically; existing volumes need migration `1730000000003` applied (or `docker compose down -v` + up).
