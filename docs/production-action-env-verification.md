# Production Action / handler environment verification (read-only)

**Scope:** Exact env requirements for Hasura Actions, Event Triggers, cron, executor, LLM, HTTP, and notify — derived from repository handlers and metadata.  
**Constraints:** No production changes, no metadata apply, no application code changes, no secret values disclosed.

**Handlers (Next.js API routes, `runtime = "nodejs"`):**

| Surface | Route |
| --- | --- |
| `triggerWorkflowRun` | `POST /api/actions/trigger-workflow` |
| `approveStep` | `POST /api/actions/approve-step` |
| Webhook Action | `POST /api/actions/trigger-webhook` |
| HTTP webhook (direct) | `POST /api/webhooks/[pathToken]` |
| Notify event | `POST /api/events/notify` |
| Database-event | `POST /api/events/database-event` |
| Scheduled cron | `POST /api/events/scheduled` |

**Executor:** in-process via `startWorkflowRun` / `resumeWorkflowRun` → `next/server` `after()` background continuation. No separate worker process.

---

## Answers to required questions

### `ACTION_BASE_URL` form and target

| Question | Answer |
| --- | --- |
| Exact form | Public **HTTPS origin** of the Next.js app, **no path**, **no trailing slash**. Example shape: `https://<vercel-project>.vercel.app` or custom domain `https://app.example.com`. |
| Resolved handlers | `{ACTION_BASE_URL}/api/actions/trigger-workflow`, `.../approve-step`, `.../trigger-webhook`, `{ACTION_BASE_URL}/api/events/notify`, `.../database-event`, `.../scheduled` |
| Must be | **Vercel production URL** (the app that hosts those API routes) |
| Must **not** be | Hasura/Nhost GraphQL URL, Auth URL, Postgres URL, or `localhost` / `127.0.0.1` / `host.docker.internal` |
| Where set | **Nhost/Hasura environment only** (metadata templates `{{ACTION_BASE_URL}}`). Next.js does **not** read `ACTION_BASE_URL` via `getEnv()`. |
| Localhost in production? | **Forbidden.** Local compose uses `http://host.docker.internal:3000` only for Docker→host. Production Hasura cannot reach your laptop. |

### Action secret validation (`X-Hasura-Action-Secret`)

From `src/lib/auth/request-auth.ts`:

1. Hasura metadata sends header `X-Hasura-Action-Secret` with value from Hasura env `ACTION_SHARED_SECRET`.
2. Handler calls `verifyHasuraActionSecret(req)` (always for Actions; webhook Action too).
3. Compares provided header to Vercel `ACTION_SHARED_SECRET` with **constant-time** `safeEqualSecret`.
4. Mismatch / missing → `401 Invalid action secret`.
5. For `triggerWorkflowRun` / `approveStep`, after secret check: **Bearer JWT is verified** (`requireUserFromRequest`); `session_variables` alone are never trusted; if present, `x-hasura-user-id` must match JWT subject.
6. Webhook Action additionally requires `X-Webhook-Secret` matching the **per-endpoint** `webhook_endpoints.secret` in Postgres (not an env “notification secret”).

Event handlers: `X-Hasura-Event-Secret` (fallback also accepts action-secret header name) vs `HASURA_EVENT_SECRET` (fallback to `ACTION_SHARED_SECRET` only if event secret unset — production should set both explicitly and **match** Hasura↔Vercel).  
Cron: `X-Cron-Secret` (or Bearer token) vs `CRON_SECRET`.

### Notification secret

There is **no** separate `NOTIFY_*_SECRET` env var. Outbound notify delivery uses destination URL (`NOTIFY_WEBHOOK_URL` or step config). Inbound Hasura notify Event Trigger uses **`HASURA_EVENT_SECRET`**.

### Vercel serverless sufficiency

| Concern | Finding |
| --- | --- |
| Persistent process required? | **No.** All handlers are Next.js Route Handlers. |
| Long-running executor | Run row is created synchronously; step loop continues via `after()` so the Action HTTP response returns quickly within Hasura’s 60s Action timeout. |
| Vercel functions OK? | **Yes**, for this architecture: Node runtime routes + Postgres (`DATABASE_URL`) + outbound `fetch` for LLM/HTTP/notify. |
| Caveat | Ensure Vercel plan function duration covers typical workflow length when using `after()`; very long multi-step LLM/HTTP chains need adequate max duration. No code change in this investigation. |

Configure Hasura `ACTION_BASE_URL` **after** the Vercel production URL is known and the deployment responds (e.g. `/api/health`).

---

## Environment variable matrix

| Variable | Where configured | Public/Secret | Required | Purpose | Expected format | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `ACTION_BASE_URL` | **Nhost/Hasura** only | Secret (server config; not browser) | **Yes** (Hasura Actions/events/cron) | Base URL Hasura uses for Action + Event + cron webhooks | `https://<vercel-or-custom-domain>` — no `/`, no `/v1/graphql`, not localhost | **Missing on prod Hasura (blocker)** — set after Vercel URL exists |
| `ACTION_SHARED_SECRET` | **Nhost/Hasura** + **Vercel** (identical value) | Server-only secret | **Yes** | Hasura → app Action mutual auth (`X-Hasura-Action-Secret`) | Long random string; same on both sides | Required before Actions work; confirm both sides |
| `HASURA_EVENT_SECRET` | **Nhost/Hasura** + **Vercel** (identical) | Server-only secret | **Yes** (production assert + events) | Auth for `/api/events/notify` and `/api/events/database-event` (`X-Hasura-Event-Secret`) | Long random; match both sides | Required; confirm both sides |
| `CRON_SECRET` | **Nhost/Hasura** + **Vercel** (identical) | Server-only secret | **Yes** | Auth for `/api/events/scheduled` (`X-Cron-Secret`) | Long random; match both sides | Required; confirm both sides |
| `DATABASE_URL` | **Vercel** | Server-only secret | **Yes** (executor + all handlers) | Postgres pool for quota, runs, steps, webhook lookup | Nhost Postgres URL (`postgres://…` / `postgresql://…`); **not** localhost | Required on Vercel |
| `NHOST_JWT_JWKS_URL` | **Vercel** | Server-only (URL) | **Yes for RS256** (or omit if subdomain/region auto-derive) | Verify Nhost RS256 Bearer JWTs | `https://<subdomain>.auth.<region>.nhost.run/v1/.well-known/jwks.json` | Preferred for current Nhost RS256 |
| `NHOST_JWT_PUBLIC_KEY` | **Vercel** | Server-only (public PEM) | Optional RS256 fallback | Verify with SPKI public key | PEM `BEGIN PUBLIC KEY` only — never private key | Optional |
| `HASURA_JWT_SECRET` | **Vercel** | Server-only secret | Yes for HS256/demo only | Local demo signing + symmetric verify | Plain HS256 key or Hasura JSON `{"type":"HS256","key":"…"}` | Do **not** use for RS256 |
| `NEXT_PUBLIC_HASURA_GRAPHQL_URL` | **Vercel** | Browser-public | **Yes** | Browser GraphQL HTTP | `https://bfwuoawsybivkgdvkyah.hasura.ap-south-1.nhost.run/v1/graphql` | App/UI; not Action handler URL |
| `NEXT_PUBLIC_HASURA_WS_URL` | **Vercel** | Browser-public | Recommended if WS host differs; else derived from HTTPS HTTP URL | Subscriptions | `wss://…/v1/graphql` | UI live updates |
| `HASURA_GRAPHQL_URL` | **Vercel** (optional) | Server-only | Optional | Server GraphQL override | Same HTTPS GraphQL URL as public if set | Optional |
| `NEXT_PUBLIC_APP_URL` | **Vercel** | Browser-public | **Yes** in production assert | Public app origin (UI webhook display, etc.) | Same origin as Vercel HTTPS app (may match `ACTION_BASE_URL`) | Required on Vercel; **not** a substitute for Hasura `ACTION_BASE_URL` |
| `NEXT_PUBLIC_NHOST_SUBDOMAIN` | **Vercel** | Browser-public | **Yes** in production | Nhost Auth client | `bfwuoawsybivkgdvkyah` | Required |
| `NEXT_PUBLIC_NHOST_REGION` | **Vercel** | Browser-public | **Yes** in production | Nhost Auth client | `ap-south-1` | Required |
| `AUTH_MODE` | **Vercel** | Server-only | Recommended `nhost` | Auth mode selection | `nhost` (Vercel production also forces Nhost unless explicitly overridden) | Set `nhost` for clarity |
| `LLM_PROVIDER` | **Vercel** | Server-only | Optional (default stub behavior) | LLM step provider | `stub` \| `groq` \| `gemini` \| `openrouter` | Optional |
| `LLM_API_KEY` | **Vercel** | Server-only secret | Optional — **unset ⇒ stub LLM** | Real LLM provider auth | Provider API key; never `NEXT_PUBLIC_*` | Optional for stub demos; required for real LLM |
| `LLM_MODEL` | **Vercel** | Server-only | Optional (has default) | Model id for provider | e.g. `llama-3.1-8b-instant` | Optional |
| `NOTIFY_WEBHOOK_URL` | **Vercel** | Server-only secret (destination URL) | Optional | Default outbound destination for `notify` steps / seed `destination_env` | Public `https://…` webhook (Slack-compatible POST); empty ⇒ notify step **stubs** | Optional; no separate notify auth secret |
| `WEBHOOK_HMAC_SECRET` | **Vercel** (schema only) | Server-only | **No** for Actions/executor | Present in env schema / seed docs; **not used** by runtime webhook auth | N/A for production Actions | **Not required** — webhook auth uses DB `webhook_endpoints.secret` + header `X-Webhook-Secret` |
| Per-endpoint webhook secret | **Postgres** (`webhook_endpoints.secret`) | Secret (never exposed via GraphQL select) | Per webhook endpoint | Validates `X-Webhook-Secret` on Action webhook + `/api/webhooks/[pathToken]` | Opaque string stored per row | Operational data, not Hasura env |
| `HASURA_ADMIN_SECRET` | Nhost dashboard (+ optional Vercel) | Server-only secret | For CLI/console only; **not** used by Action handler code paths | Admin API / migrations | From Nhost | Not required on Vercel for Actions |
| `DEMO_AUTH_PASSWORD` / `ALLOW_DEMO_AUTH` | Local only | Server-only | **No** in production | Demo login | — | Must not enable demo auth on Vercel prod |
| `HASURA_GRAPHQL_DATABASE_URL` | Nhost-managed | Server-only | Nhost internal | Hasura→Postgres | Managed by Nhost | Do not put in Vercel as Action config |

---

## Mapping by feature

### `triggerWorkflowRun` / `approveStep`

| Need | Variables |
| --- | --- |
| Hasura can call handler | Hasura: `ACTION_BASE_URL`, `ACTION_SHARED_SECRET` |
| Handler accepts call | Vercel: `ACTION_SHARED_SECRET` (match), RS256 JWKS/public key or HS256 secret, `DATABASE_URL` |
| JWT forwarded | Metadata `forward_client_headers: true` (already in metadata) |

### Webhook handler (`triggerWorkflowWebhook` + `/api/webhooks/[pathToken]`)

| Need | Variables |
| --- | --- |
| Hasura Action path | Hasura: `ACTION_BASE_URL`, `ACTION_SHARED_SECRET` |
| App validates Action | Vercel: `ACTION_SHARED_SECRET`, `DATABASE_URL` |
| App validates webhook | Request header `X-Webhook-Secret` vs DB secret (not env) |
| Direct HTTP path | Only Vercel URL + DB secret — no Hasura Action env beyond deploy |

### Workflow executor (all triggers)

| Need | Variables |
| --- | --- |
| DB + quota + steps | Vercel: `DATABASE_URL` |
| Background continue | Vercel Node + `after()` — no worker env |

### LLM integration

| Need | Variables |
| --- | --- |
| Stub (default) | Leave `LLM_API_KEY` unset and/or `LLM_PROVIDER=stub` |
| Real provider | Vercel: `LLM_PROVIDER`, `LLM_API_KEY`, optional `LLM_MODEL` |

### HTTP execution (`http_request` step)

| Need | Variables |
| --- | --- |
| Outbound HTTP | No dedicated env — URL/headers from step config; SSRF guards block localhost/private IPs |
| Timeouts | Config `timeout_ms` clamped 1s–30s (code default 10s) |

### Notify

| Need | Variables |
| --- | --- |
| Step insert + optional inline delivery | Vercel: optional `NOTIFY_WEBHOOK_URL` |
| Hasura Event Trigger delivery path | Hasura: `ACTION_BASE_URL` + `HASURA_EVENT_SECRET`; Vercel: matching `HASURA_EVENT_SECRET`, `DATABASE_URL` |
| Separate notify secret? | **None** |

### Scheduled / database-event handlers

| Need | Variables |
| --- | --- |
| Cron tick | Hasura: `ACTION_BASE_URL`, `CRON_SECRET`; Vercel: `CRON_SECRET`, `DATABASE_URL` |
| DB event | Hasura: `ACTION_BASE_URL`, `HASURA_EVENT_SECRET`; Vercel: `HASURA_EVENT_SECRET`, `DATABASE_URL` |

---

## Recommended configure order (when you act — not now)

1. Deploy Next.js to Vercel with all **Vercel** rows above (public + server secrets). Confirm `https://<vercel>/api/health`.
2. Set **identical** `ACTION_SHARED_SECRET`, `HASURA_EVENT_SECRET`, `CRON_SECRET` on Vercel and Nhost Hasura.
3. Set Hasura `ACTION_BASE_URL=https://<that-vercel-origin>` (no trailing slash).
4. `hasura metadata reload` (preferred) and confirm `is_consistent: true`.
5. Confirm GraphQL exposes `triggerWorkflowRun` / `approveStep`, then smoke-test.

Do **not** point `ACTION_BASE_URL` at the Hasura URL. Do **not** use localhost.

---

## Verdict

**SAFE TO CONFIGURE AFTER VERCEL DEPLOYMENT**
