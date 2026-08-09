# Nhost production — migrations & metadata deploy procedure

**Status:** Inspection only. **Do not deploy until you deliberately run the apply commands below.**  
**Project:** `ai-agent-workflow-builder`  
**Region:** `ap-south-1`  
**Subdomain:** `bfwuoawsybivkgdvkyah`

This document prepares the **existing verified** `hasura/migrations` + `hasura/metadata` for this Nhost project. Application code, auth architecture, and the executor are **not** modified here.

---

## 1. Repository inventory

| Kind | Location | Notes |
| --- | --- | --- |
| PostgreSQL migrations | `hasura/migrations/default/` | Hasura CLI v3 layout |
| Init schema | `1730000000000_init/` | Tables, view, functions, indexes |
| Seed / demo | `1730000000001_seed/` | Org A/B, personas, demo workflow, webhook |
| Integrity | `1730000000002_webhook_integrity/` | Webhook↔trigger composite FK |
| Branch/triggers seed update | `1730000000003_branch_and_triggers/` | Branch jump config, db_write step, optional triggers |
| Hasura metadata | `hasura/metadata/` | Tables, relationships, permissions, Actions, events, cron |
| Actions | `hasura/metadata/actions.yaml` | `triggerWorkflowRun`, `approveStep`, `triggerWorkflowWebhook` |
| Event Triggers | on `watched_records`, `notifications` | Webhooks → `{{ACTION_BASE_URL}}/api/events/...` |
| Cron | `hasura/metadata/cron_triggers.yaml` | `scheduled_workflow_tick` |
| DB functions | in init SQL | `consume_org_quota`, `set_updated_at` |
| View | in init SQL | `organization_monthly_usage` |
| Hasura CLI config | `hasura/config.yaml` | Local defaults only (`localhost`) |

### Nhost-native config present?

| File / folder | Present? |
| --- | --- |
| `nhost.toml` | **No** |
| `nhost.yaml` | **No** |
| `nhost/migrations` | **No** |
| `nhost/metadata` | **No** |

This repo uses a **Hasura CLI** project under `hasura/`, not the Nhost CLI scaffold under `nhost/`. GitHub→Nhost automatic deploys expect an `nhost/` tree + `nhost.toml`. For a **safe first apply** to the empty cloud project, use **Path A (Hasura CLI)** below. Path B (Nhost Git sync) is optional later and requires scaffolding/copy — do not do that until migrations are successfully applied once.

---

## 2. Migration contents checklist (production objects)

Applying all four migrations creates:

| Object | Migration |
| --- | --- |
| `organizations` (+ quota columns) | init |
| `org_members` | init |
| `workflows` | init |
| `workflow_steps` | init |
| `workflow_triggers` | init |
| `webhook_endpoints` | init |
| `workflow_runs` | init |
| `step_runs` | init |
| `workflow_db_writes` | init |
| `notifications` | init |
| `audit_logs` | init |
| `watched_records` | init |
| `usage_events` | init |
| `organization_monthly_usage` (view) | init |
| `consume_org_quota(...)` (function) | init |
| Demo Org A/B + members + pipeline + webhook | seed |
| Webhook integrity FK | webhook_integrity |
| Branch/db_write/scheduled/database_event seed updates | branch_and_triggers |

**No migration changes are required** for Nhost compatibility (standard PostgreSQL + Hasura metadata).

**Seed note:** Seed inserts **demo persona UUIDs**, not Nhost Auth user IDs. After apply, map real Nhost users into `org_members` (see verification). The demo workflow remains useful for structure; login for production must use Nhost Auth users.

---

## 3. Metadata checklist

| Item | Status |
| --- | --- |
| All app tables tracked | Yes (`tables.yaml`) |
| Relationships (org → members/workflows, workflow → steps/triggers/runs, run → step_runs, etc.) | Yes |
| Permissions role | **`user` only** on tables (no table grants for `anonymous` / `public`) |
| Isolation filter | `…members.user_id = X-Hasura-User-Id` (JWT → `org_members` → org/resource) |
| View permissions | `organization_monthly_usage` for `user` via membership |
| Actions | 3 Actions; handlers use `{{ACTION_BASE_URL}}` + `ACTION_SHARED_SECRET` |
| Action `anonymous` | **Only** `triggerWorkflowWebhook` (handler still validates webhook secret) |
| Event Triggers | `watched_records_database_event`, `notifications_notify` |
| Cron | `scheduled_workflow_tick` → `/api/events/scheduled` + `CRON_SECRET` |
| Webhook secrets in GraphQL select | **Omitted** (path_token only) |

**Admin / public exposure:** Table CRUD is not granted to `anonymous` or `public`. Hasura admin console access uses the project **admin secret** (dashboard only — never put it in `NEXT_PUBLIC_*` or commit it).

---

## 4. Endpoints for this project (no secrets)

Use these public hostnames (confirm in Nhost Dashboard → Project settings if your UI shows slightly different hosts):

| Service | Typical URL |
| --- | --- |
| GraphQL HTTP | `https://bfwuoawsybivkgdvkyah.hasura.ap-south-1.nhost.run/v1/graphql` |
| GraphQL WSS | `wss://bfwuoawsybivkgdvkyah.hasura.ap-south-1.nhost.run/v1/graphql` |
| Auth | `https://bfwuoawsybivkgdvkyah.auth.ap-south-1.nhost.run/v1` |
| Dashboard | [https://app.nhost.io](https://app.nhost.io) → project `ai-agent-workflow-builder` |

---

## 5. What you must have locally (do **not** paste secrets into chat)

| Identifier | Where you get it | Used for |
| --- | --- | --- |
| Nhost account login | Browser / `nhost login` | CLI auth (optional for Path A) |
| **Hasura Admin Secret** | Nhost Dashboard → Settings / Hasura | `hasura migrate apply` / `metadata apply` |
| **Postgres connection string** (optional) | Nhost Dashboard → Database | Manual SQL verification only |
| Subdomain | `bfwuoawsybivkgdvkyah` (already known) | Endpoints |
| Region | `ap-south-1` | Endpoints |
| Personal Access Token (PAT) | Nhost Dashboard → Account / tokens | Only if using Nhost CLI cloud deploy (`NHOST_PAT` / `nhost login`) — **not required for Path A** |

Store secrets in your password manager or local env files that stay **gitignored**. Never commit them.

---

## 6. Prerequisites

1. Empty or fresh Nhost Postgres for this project (first apply).  
2. **Do not** run `migrate down`, `DROP`, or “reset database” on production.  
3. Install **Hasura CLI** (Path A — recommended for this repo):

```bash
# Option 1 — npm global
npm install -g hasura-cli

# Option 2 — one-off
npx hasura-cli@latest version
```

4. Optional — **Nhost CLI** (Path B / linking later):

```bash
npm install -D @nhost/cli
# or
npx @nhost/cli@latest --version

# Authenticate (opens browser / device flow — do not paste tokens into chat)
npx @nhost/cli@latest login
```

Windows: prefer WSL2 for Nhost CLI local stack; Hasura CLI works in PowerShell for Path A.

5. Before Actions/Events work in production, create matching **Hasura environment variables** in the Nhost project (Dashboard → Settings → Environment variables / Secrets). Names must match metadata:

| Env var | Purpose |
| --- | --- |
| `ACTION_BASE_URL` | Public HTTPS origin of the Next.js app (Vercel), **no trailing slash** |
| `ACTION_SHARED_SECRET` | Shared with Vercel `ACTION_SHARED_SECRET` |
| `HASURA_EVENT_SECRET` | Shared with Vercel |
| `CRON_SECRET` | Shared with Vercel |

You can apply schema/metadata **before** Vercel exists; Action calls will fail until `ACTION_BASE_URL` points at a live deployment.

---

## 7. Recommended Path A — Hasura CLI apply (safe for this repo)

Working directory: repository root.

Set (locally, privately — example names only):

```powershell
# PowerShell — values from Nhost Dashboard (do not commit)
$env:HASURA_GRAPHQL_ENDPOINT = "https://bfwuoawsybivkgdvkyah.hasura.ap-south-1.nhost.run"
$env:HASURA_GRAPHQL_ADMIN_SECRET = "<paste-from-dashboard-locally-only>"
```

### 7.1 Status check (read-only)

```bash
cd hasura
hasura migrate status --endpoint "%HASURA_GRAPHQL_ENDPOINT%" --admin-secret "%HASURA_GRAPHQL_ADMIN_SECRET%" --database-name default
```

On a fresh project you should see migrations as **Not Present** / not applied.

### 7.2 Apply migrations (forward only)

```bash
hasura migrate apply --endpoint "%HASURA_GRAPHQL_ENDPOINT%" --admin-secret "%HASURA_GRAPHQL_ADMIN_SECRET%" --database-name default
```

This applies, in order:

1. `1730000000000_init`  
2. `1730000000001_seed`  
3. `1730000000002_webhook_integrity`  
4. `1730000000003_branch_and_triggers`  

**Do not** run `hasura migrate apply --down` or `hasura migrate delete`.

### 7.3 Apply metadata

```bash
hasura metadata apply --endpoint "%HASURA_GRAPHQL_ENDPOINT%" --admin-secret "%HASURA_GRAPHQL_ADMIN_SECRET%"
```

### 7.4 Reload (optional)

```bash
hasura metadata reload --endpoint "%HASURA_GRAPHQL_ENDPOINT%" --admin-secret "%HASURA_GRAPHQL_ADMIN_SECRET%"
```

---

## 8. Path B — Nhost Git / CLI (later; not required for first apply)

Nhost cloud Git deploys look for something like:

```text
nhost/
  migrations/
  metadata/
  nhost.toml   # often at repo root or under nhost/
```

This repository currently has **`hasura/`** instead. Options when you are ready (separate change set — **not done in this prep**):

1. Scaffold with `nhost init` / `nhost init --remote` and carefully copy `hasura/migrations` → `nhost/migrations` and `hasura/metadata` → `nhost/metadata` (same Hasura v3 shape).  
2. Connect GitHub in Nhost Dashboard; set base directory if needed.  
3. `nhost link` then push, **or** `nhost deployments new --subdomain bfwuoawsybivkgdvkyah --ref <commit-sha> --follow`.

Until that scaffolding exists, **Path A is the correct safe procedure**.

---

## 9. Verification (after you apply)

### 9.1 Tables exist

In Nhost SQL editor / `psql` (use Dashboard connection string locally):

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'organizations','org_members','workflows','workflow_steps',
    'workflow_triggers','workflow_runs','step_runs','webhook_endpoints',
    'usage_events','watched_records','workflow_db_writes','notifications'
  )
ORDER BY 1;

SELECT consume_org_quota IS NOT NULL
FROM (SELECT 1) AS _;  -- better:

SELECT proname FROM pg_proc WHERE proname = 'consume_org_quota';
SELECT table_name FROM information_schema.views WHERE table_name = 'organization_monthly_usage';
```

### 9.2 Seed demo workflow present

```sql
SELECT id, name FROM workflows WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT type, position FROM workflow_steps
WHERE workflow_id = 'aaaaaaaa-0000-4000-8000-000000000001'
ORDER BY position;
```

Expect six step types including `llm_call`, `conditional_branch`, `http_request`, `approval_gate`, `db_write`, `notify`.

### 9.3 Permissions / isolation (GraphQL)

With a **real Nhost JWT** for a user who is **not** in Org A:

- `workflows(where: { id: { _eq: "aaaaaaaa-0000-4000-8000-000000000001" } })` → empty  
- Guessing run/step UUIDs → empty  

With a mapped Org A owner JWT → can see Org A only.

### 9.4 Metadata

In Hasura console (Nhost): confirm Actions, Event Triggers, and cron exist; handler URLs resolve via `ACTION_BASE_URL`.

---

## 10. Map production Auth users (required for Nhost login)

Seed `org_members.user_id` values are demo UUIDs. After a user signs up via Nhost Auth:

```sql
-- Example only — replace with the real Auth user UUID from Nhost
INSERT INTO org_members (org_id, user_id, role)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '<nhost-auth-user-uuid>',
  'owner'
)
ON CONFLICT DO NOTHING;
```

Without this, JWT identity will not match membership and GraphQL returns empty orgs.

---

## 11. Rollback precautions

| Do | Don’t |
| --- | --- |
| Keep migration files in Git | `hasura migrate apply --down …` on production |
| Take a Nhost backup / snapshot before experiments if the project already has data | `DROP SCHEMA public CASCADE` |
| Fix-forward with a **new** migration if something is wrong | Edit applied migration history on the server casually |
| Re-apply metadata only with `metadata apply` after review | `hasura metadata clear` on production |

On a brand-new empty project, the simplest recovery if apply fails mid-way is: inspect error, fix forward, or recreate the Nhost project **only if** you accept losing that empty DB — never reset a project that already has real user data.

---

## 12. Order relative to Vercel

1. **Now (this doc):** Apply migrations + metadata to Nhost (Path A).  
2. Set Hasura env vars (`ACTION_*`, event/cron secrets).  
3. Deploy Next.js to Vercel with `AUTH_MODE=nhost`, `NEXT_PUBLIC_NHOST_SUBDOMAIN=bfwuoawsybivkgdvkyah`, `NEXT_PUBLIC_NHOST_REGION=ap-south-1`, GraphQL HTTPS/WSS URLs, `DATABASE_URL`, JWT secret alignment.  
4. Point `ACTION_BASE_URL` at the Vercel HTTPS origin.  
5. Map `org_members` for real Nhost users.  
6. Run production smoke tests (login, run, approval, webhook, Org B denial).

See also: [`docs/deployment.md`](deployment.md), [`docs/deployment-checklist.md`](deployment-checklist.md).

---

## 13. Explicit non-actions for this preparation step

- No migrations were modified.  
- No application code was modified.  
- Nothing was applied to the Nhost project from this agent session.  
- No secrets were requested to be pasted into chat.
