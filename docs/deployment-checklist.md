# Deployment checklist

Use this after code is on GitHub. Do **not** commit real secrets — set them only in Nhost/Vercel dashboards.

## Nhost project

- [ ] Create Nhost project
- [ ] Note subdomain → `NEXT_PUBLIC_NHOST_SUBDOMAIN`
- [ ] Note region → `NEXT_PUBLIC_NHOST_REGION`
- [ ] Enable email/password Auth
- [ ] Confirm Auth JWT includes Hasura claims (`x-hasura-user-id`, role `user`)

## Database

- [ ] Copy Nhost Postgres URL → `DATABASE_URL` (SERVER-ONLY, not localhost)
- [ ] Confirm app can connect from Vercel (SSL if required by Nhost)

## Hasura

- [ ] GraphQL HTTP URL → `NEXT_PUBLIC_HASURA_GRAPHQL_URL` (`https://…/v1/graphql`)
- [ ] Optional independent WSS URL → `NEXT_PUBLIC_HASURA_WS_URL` (`wss://…/v1/graphql`)
- [ ] If WS unset: confirm HTTP is `https://` so client derives `wss://`
- [ ] JWT secret aligned → `HASURA_JWT_SECRET` (or `NHOST_JWT_JWKS_URL` for RS256)
- [ ] Admin secret kept SERVER-ONLY (console only; never `NEXT_PUBLIC_*`)

## Migrations

- [ ] Apply `hasura/migrations` to Nhost Postgres/Hasura
- [ ] Confirm tables, `consume_org_quota`, and `organization_monthly_usage` exist

## Metadata

- [ ] Apply `hasura/metadata` (permissions, relationships, Actions, events, cron)
- [ ] Confirm no accidental unrestricted table roles for anonymous data access

## Actions

- [ ] Set Hasura `ACTION_BASE_URL=https://<vercel-domain>`
- [ ] Set matching `ACTION_SHARED_SECRET` on Hasura + Vercel
- [ ] Verify Actions: `triggerWorkflowRun`, `approveStep`, `triggerWorkflowWebhook`

## Event Triggers

- [ ] `watched_records` → `https://<vercel-domain>/api/events/database-event`
- [ ] `notifications` → `https://<vercel-domain>/api/events/notify`
- [ ] Cron `scheduled_workflow_tick` → `/api/events/scheduled` with `CRON_SECRET`
- [ ] Set `HASURA_EVENT_SECRET` on Hasura + Vercel

## Environment variables

### PUBLIC (Vercel)

- [ ] `NEXT_PUBLIC_HASURA_GRAPHQL_URL`
- [ ] `NEXT_PUBLIC_HASURA_WS_URL` (optional but recommended if hosts differ)
- [ ] `NEXT_PUBLIC_APP_URL` (`https://…`)
- [ ] `NEXT_PUBLIC_NHOST_SUBDOMAIN`
- [ ] `NEXT_PUBLIC_NHOST_REGION`

### SERVER-ONLY (Vercel)

- [ ] `AUTH_MODE=nhost`
- [ ] `DATABASE_URL`
- [ ] `HASURA_JWT_SECRET` (and/or `NHOST_JWT_JWKS_URL`)
- [ ] `ACTION_SHARED_SECRET`
- [ ] `HASURA_EVENT_SECRET`
- [ ] `CRON_SECRET`
- [ ] `HASURA_ADMIN_SECRET` (if used server-side; never public)
- [ ] `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` (or leave stub)
- [ ] `NOTIFY_WEBHOOK_URL` (optional)
- [ ] `WEBHOOK_HMAC_SECRET` only if you still use it as a documented seed reference (prefer new secrets per endpoint)

## GitHub

- [ ] Repo pushed; `.env.local` not committed
- [ ] `.gitignore` covers `.env*`, `.vercel`, `node_modules`, `secrets/`, `credentials/`

## Vercel

- [ ] Project imported from GitHub
- [ ] Production env vars set (tables above)
- [ ] Deploy succeeds (`npm run build` equivalent)
- [ ] `https://<vercel>/api/health` returns `{ "ok": true }`
- [ ] Hasura `ACTION_BASE_URL` points at this deployment

## Production authentication

- [ ] Login page shows **Nhost** form only (no Alice/Bob/Charlie persona buttons)
- [ ] `/api/auth/mode` → `mode: "nhost"`, `demoEnabled: false`
- [ ] Real Nhost user can sign in; `/api/auth/me` returns that user id
- [ ] `org_members` row exists for that Nhost UUID
- [ ] Logout clears session

## GraphQL HTTP

- [ ] Browser queries hit production Hasura over `https://`
- [ ] Unauthorized cross-org queries return empty / not found

## GraphQL WSS

- [ ] Run detail page connects with `wss://` (DevTools → Network → WS)
- [ ] Step statuses update without full page refresh
- [ ] Org B cannot subscribe to Org A `step_runs`

## Webhook

- [ ] Owner creates/uses webhook with path token
- [ ] Secret is **not** returned by GraphQL select
- [ ] `POST https://<vercel>/api/webhooks/<path_token>` with `X-Webhook-Secret` starts a real run
- [ ] Invalid secret → 401; exhausted quota → 429

## LLM API

- [ ] Production: set `LLM_API_KEY` + provider **or** accept stub mode knowingly
- [ ] Confirm key is SERVER-ONLY (never `NEXT_PUBLIC_LLM_*`)

## Final security test

- [ ] Org B cannot see / trigger / approve Org A resources (GraphQL + Actions)
- [ ] Editor cannot add `db_write` / `notify` / webhook trigger
- [ ] Viewer cannot trigger runs
- [ ] Session spoof without JWT fails

## Final six-step demonstration

- [ ] Login as Org A owner (Nhost user mapped in `org_members`)
- [ ] Open workflow showing: LLM → HTTP → conditional → approval → db_write → notify  
  *(seed order is LLM → conditional → HTTP → approval → db_write → notify — confirm all six types present)*
- [ ] Click **Run Workflow**
- [ ] Live subscription: progress through steps → **PAUSED — AWAITING APPROVAL**
- [ ] Approve → remaining steps complete → run **completed**
- [ ] Trigger via webhook → second run appears without clicking Run
- [ ] Org B login: Org A workflows/runs inaccessible

---

See also: [`docs/deployment.md`](deployment.md), [`.env.example`](../.env.example).
