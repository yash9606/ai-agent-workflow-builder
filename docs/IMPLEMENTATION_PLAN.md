# Implementation Plan — AI Agent Workflow Builder

## Repository status

Empty directory. Building the full stack from scratch with a local git repository.

## Architecture

```
Next.js (App Router)
├── Frontend (Nhost Auth + GraphQL subscriptions)
└── API routes (Hasura Actions / Event Triggers / Webhooks)
        │
        ▼
Nhost / Hasura / PostgreSQL
        │
        ▼
Workflow Executor (server-only)
├── LLM provider (Gemini/Groq/OpenRouter or stub)
├── HTTP client (timeout + retry)
├── Controlled db_write
├── Notify (webhook / Slack)
└── Condition evaluator (deterministic, no eval)
```

## Phases

1. **Scaffold** — Next.js, deps, env, docker-compose for local Hasura/Postgres
2. **Schema** — migrations for orgs, members, workflows, steps, triggers, runs, step_runs, webhooks, notifications, audit, usage view
3. **Hasura** — track tables, relationships, RLS via org_members, Actions, Event Triggers, scheduled events
4. **Executor + Actions** — triggerWorkflowRun, approveStep, webhook, DB event handler, quota, retries
5. **Frontend** — login, org dashboard, builder, live run subscription UI, quota, role-gated controls
6. **Seed + tests + docs + audit + production build**

## Security model (two layers)

1. Org membership RLS on every resource (`org_members.user_id = X-Hasura-User-Id`)
2. Step-level: only owner may create `db_write`, `notify`, `webhook` triggers — enforced in Actions / CHECK / permission filters

Approval is Action-only (not pure Hasura update permissions).

## Usage accounting

One quota call = one workflow run start (manual / webhook / schedule / DB event). Atomic increment with `WHERE calls_used < calls_allowed`.
