# Frontend implementation report

## Scope

Built the complete reviewer-facing UI on top of the **already verified** backend. Authentication architecture, executor, Actions, and Hasura RLS were not rewritten.

## Routes

| Route | Purpose |
| --- | --- |
| `/login` | Demo personas (local) / Nhost (production mode) |
| `/dashboard` | User, org, role, quota, workflows, recent runs |
| `/workflows` | Rich workflow list (steps, triggers, latest run) |
| `/workflows/new` | Create workflow |
| `/workflows/[id]` | Builder, meta edit, triggers, webhook panel, runs |
| `/workflows/[id]/run/[runId]` | Live subscription timeline + approval |

## Components created / updated

| Component | Notes |
| --- | --- |
| `AppShell` | Nav, org switcher, role badge, header quota |
| `QuotaBar` / `QuotaIndicator` | Authoritative Hasura usage view |
| `WorkflowBuilder` | Add/edit/delete/reorder/save; role-gated step types |
| `StepEditor` | Forms for all 6 types + `true_next`/`false_next` |
| `TriggerPanel` | Manual/webhook/scheduled/DB event; copyable webhook URL **without secret** |
| `RunButton` | Owner/editor only; quota/unauthorized errors |
| `LiveRunView` | GraphQL subscriptions for run + step_runs; branch/skipped UX; Approve |

## GraphQL operations used

- Queries: `GetOrgDashboard` (enriched), `GetWorkflows` (enriched), `GetWorkflow`, `GetUsage`, `GetRunWithSteps`, `GetMyOrgs`
- Mutations: workflow/step/trigger CRUD, `TriggerWorkflowRun`, `ApproveStep`, webhook endpoint insert
- Subscriptions: `SubWorkflowRun`, `SubStepRuns` (primary live path; no polling replacement)

## Role-based UI

| Role | UI |
| --- | --- |
| Owner | All steps, webhook triggers, delete workflow/trigger, run, approve |
| Editor | Normal steps (no db_write/notify/webhook create), run, approve if allowed |
| Viewer | Read-only; no Run / edit / restricted controls |

Backend remains authoritative (Hasura + Actions).

## Approval UI

- Prominent **PAUSED — AWAITING APPROVAL**
- Message, step name, allowed roles, Approve for permitted roles
- Continue via subscription after `approveStep` (no full page reload)

## Quota UI

- Dashboard card (used / allowed / remaining / %)
- Header compact bar
- Workflow detail warning + Run disabled when remaining ≤ 0 (backend still enforces)

## Webhook demo

- Owner sees copyable `POST /api/webhooks/{pathToken}`
- Secrets removed from Hasura **select** columns (never returned to browser)
- Secret shown once only at creation time in local state

## Hasura metadata touch (frontend safety)

- `workflow_steps` / `workflows`: `allow_aggregations: true` for step counts
- `webhook_endpoints`: `secret` removed from select columns

## Tests

| Suite | Result |
| --- | --- |
| `npm test` | **45/45** (includes `tests/step-editor.test.ts`) |
| Existing security/execution tests | Unchanged, still pass |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run build` | Pass |
| `npm run demo:e2e` | Pass |
| `node scripts/inspect-auth.mjs` | Pass |
| `node scripts/inspect-frontend-gql.mjs` | Pass (dashboard aggregates, webhook token, Org B denial) |

## Verification notes

- Live run UI uses **GraphQL subscriptions** for step/run updates.
- Org B cannot load Org A workflow/run via GraphQL (smoke + security tests).
- Manual run + webhook start remain backend-driven (`demo:e2e`).

## Known UI limitations

1. Multi-org users switch org via selector; queries always use JWT membership (never as auth proof).
2. After creating a webhook, the secret is shown once in-session only — document/store it outside the app.
3. Subscription requires Hasura WS; if WS fails, the UI surfaces an error (does not silently fake progress).
