# Deployment guide (GitHub → Nhost/Hasura → Vercel)

This project is **not fully one-click automated**. Migrations/metadata are version-controlled and applied via Hasura CLI or Nhost’s migration tooling; Vercel deploys the Next.js app. You must wire Actions/Event Triggers to the Vercel URL and align JWT secrets manually.

## Architecture (production)

```
Browser ──HTTPS──► Vercel (Next.js UI + API routes / Actions / webhooks)
              │
              ├── GraphQL HTTP + WSS ──► Nhost Hasura
              └── Nhost Auth (email/password) ──► JWT with Hasura claims
Nhost Postgres ◄── Hasura + Next.js executor (DATABASE_URL)
Hasura cron/events ──HTTPS──► Vercel /api/events/*  (shared secrets)
```

Subscriptions use **Hasura’s WebSocket endpoint**. They do **not** go through Vercel.

| Variable | Role |
| --- | --- |
| `NEXT_PUBLIC_HASURA_GRAPHQL_URL` | GraphQL **HTTP** (`https://…/v1/graphql`) |
| `NEXT_PUBLIC_HASURA_WS_URL` | Optional GraphQL **WebSocket** (`wss://…/v1/graphql`). If unset, derived from the HTTP URL (`https` → `wss`, `http` → `ws`). |

Production must use `https` HTTP so derived subscriptions are `wss://`, or set `NEXT_PUBLIC_HASURA_WS_URL` to an explicit `wss://` URL when HTTP and WS hosts differ.

## 1. GitHub

1. Push this repository to GitHub.
2. Ensure `.env.local` / production secrets are **not** committed (`.gitignore` already ignores `.env*`).
3. Prefer a protected `main` branch; deploy Vercel from `main`.

## 2. Nhost project

1. Create a Nhost project (region of your choice).
2. Note:
   - subdomain / region → `NEXT_PUBLIC_NHOST_*`
   - Postgres connection string → `DATABASE_URL`
   - GraphQL endpoint → `NEXT_PUBLIC_HASURA_GRAPHQL_URL`
   - JWT secret (Hasura config) → `HASURA_JWT_SECRET` (or configure `NHOST_JWT_JWKS_URL` for RS256)
3. Enable email/password Auth as required by your demo.

## 3. Hasura migrations & metadata

Source of truth in-repo:

- `hasura/migrations/`
- `hasura/metadata/`

Apply against Nhost Hasura (example with Hasura CLI):

```bash
# Point at Nhost GraphQL endpoint + admin secret from Nhost console
hasura migrate apply --project hasura --endpoint https://<nhost-graphql-host> --admin-secret <ADMIN_SECRET>
hasura metadata apply --project hasura --endpoint https://<nhost-graphql-host> --admin-secret <ADMIN_SECRET>
```

Alternatively use Nhost’s documented migration workflow if you sync the same folders.

**Manual after apply:**

1. Set Hasura env for Actions:
   - `ACTION_BASE_URL=https://<your-vercel-domain>`
   - `ACTION_SHARED_SECRET=<long random>`
   - `HASURA_EVENT_SECRET=<long random>`
   - `CRON_SECRET=<long random>`
2. Confirm JWT config matches Nhost Auth tokens (`x-hasura-user-id`, role `user`).

## 4. Actions

Metadata already defines:

| Action | Handler path | Roles |
| --- | --- | --- |
| `triggerWorkflowRun` | `/api/actions/trigger-workflow` | `user` |
| `approveStep` | `/api/actions/approve-step` | `user` |
| `triggerWorkflowWebhook` | `/api/actions/trigger-webhook` | `anonymous`, `user` |

Handlers are Next.js routes on Vercel. Hasura must send `X-Hasura-Action-Secret` from `ACTION_SHARED_SECRET` (already in `actions.yaml`).

## 5. Event Triggers & cron

| Name | Target |
| --- | --- |
| `watched_records_database_event` | `/api/events/database-event` |
| `notifications_notify` | `/api/events/notify` |
| `scheduled_workflow_tick` (cron `*/1 * * * *`) | `/api/events/scheduled` |

Ensure event/cron requests include the configured shared secrets (`HASURA_EVENT_SECRET` / `CRON_SECRET`). After changing Vercel domain, re-apply metadata or update webhook URLs in the Nhost/Hasura console.

## 6. Seed / org membership for real users

Demo personas (Alice/Bob/…) are **local only**. In production:

1. Users sign up via Nhost Auth.
2. Insert `org_members` rows with **their Nhost user UUIDs**.
3. Do not rely on seeded demo UUIDs.

## 7. Vercel

1. Import the GitHub repo into Vercel.
2. Framework preset: Next.js (default build `next build`, output managed by Next).
3. Set environment variables (Production):

### PUBLIC (browser-visible)

| Variable | Example |
| --- | --- |
| `NEXT_PUBLIC_HASURA_GRAPHQL_URL` | `https://…nhost.run/v1/graphql` |
| `NEXT_PUBLIC_HASURA_WS_URL` | Optional `wss://…nhost.run/v1/graphql` (independent of HTTP) |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` |
| `NEXT_PUBLIC_NHOST_SUBDOMAIN` | Nhost subdomain |
| `NEXT_PUBLIC_NHOST_REGION` | e.g. `eu-central-1` |

### SERVER-ONLY

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Nhost Postgres |
| `HASURA_JWT_SECRET` | Must verify Nhost JWTs |
| `HASURA_ADMIN_SECRET` | Optional; never expose to client |
| `ACTION_SHARED_SECRET` | Same as Hasura |
| `HASURA_EVENT_SECRET` | Same as Hasura |
| `CRON_SECRET` | Same as Hasura |
| `AUTH_MODE` | `nhost` |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | Real provider or leave stub |
| `NOTIFY_WEBHOOK_URL` | Optional Slack/webhook URL |
| `NHOST_JWT_JWKS_URL` | If using RS256 |

`VERCEL_ENV=production` + Nhost public env vars force Nhost auth (demo personas disabled) via `resolveAuthMode()`.

4. Deploy. Confirm `https://<vercel>/api/health` returns `{ ok: true }`.

## 8. Production testing checklist

1. Login with a real Nhost user (no Alice/Bob buttons).
2. Confirm `/api/auth/me` returns that user’s id + `org_members`.
3. Run a workflow; watch live subscription on the run page (WSS to Hasura).
4. Pause at approval → Approve → completion.
5. Webhook: `POST https://<vercel>/api/webhooks/<path_token>` with `X-Webhook-Secret` (secret never returned by GraphQL select).
6. Second org user must not see first org’s workflows/runs.
7. Exhaust quota → Action + webhook reject.

## 9. What is NOT automated

- Creating the Nhost project
- Pasting env vars into Vercel / Hasura
- Mapping real Nhost user UUIDs into `org_members`
- Rotating seeded `demo-webhook-secret` for production endpoints
- DNS / custom domains

## 10. Local Docker health note

Local stack is Docker Compose (`postgres` + `graphql-engine`), not a full Nhost Cloud stack. A one-time `docker compose restart graphql-engine` after metadata edits is expected and is **not** a crash loop (`RestartCount=0` when healthy).
