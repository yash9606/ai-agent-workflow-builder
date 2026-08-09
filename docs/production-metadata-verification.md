# Production Hasura metadata verification (read-only)

**Project:** `ai-agent-workflow-builder` (`bfwuoawsybivkgdvkyah`, `ap-south-1`)  
**GraphQL:** `https://bfwuoawsybivkgdvkyah.hasura.ap-south-1.nhost.run/v1/graphql`  
**Source of intended config:** repository `hasura/metadata/`  
**Method:** Compared local metadata files to live production via `export_metadata`, `get_inconsistent_metadata`, GraphQL introspection, and role-scoped probe queries.  
**Constraints honored:** No metadata apply, no production metadata edits, no migration changes, no application code changes.

**Migrations:** All four present on production (confirmed earlier).  
**Metadata apply:** Previously returned `Metadata applied` **and** `WARN Metadata is inconsistent`. Apply success alone does **not** mean Actions are executable.

---

## Executive finding

Production **does** store the intended Action / Event Trigger / cron **definitions** (including both `triggerWorkflowRun` and `approveStep`).  

They are **not** live on the GraphQL API because metadata is **inconsistent**: Hasura cannot resolve `{{ACTION_BASE_URL}}` — environment variable **`ACTION_BASE_URL` is not set** on the Nhost Hasura runtime.

Table relationships and JWT → `org_members` → organization permission filters **are** applied and behave correctly for queries.

Most `hasura metadata diff` noise (`network.yaml`, `opentelemetry.yaml`, `api_limits.yaml`, `metrics_config.yaml`, `insertion_order`, `functions.yaml`, Action custom-type / `actions.graphql` formatting) is **not** the functional failure. Forcing those files to match blindly would be the wrong fix.

---

## Verification matrix

| Item | Local configuration | Production configuration | Difference | Impact | Required action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Metadata consistency (`get_inconsistent_metadata`) | N/A (local Docker env supplies vars) | `is_consistent=false`; 6 inconsistent objects | Server missing env resolution for `ACTION_BASE_URL` | Actions, Event Triggers, and cron are dropped from the live schema / inactive | Set Hasura env vars on Nhost (see below), then `metadata reload` — **do not** re-apply only to clear the cosmetic diff | **BLOCKING** |
| Action `triggerWorkflowRun` present in metadata | Yes — `actions.yaml` | Yes — exported metadata | None in definition | Definition OK; not exposed while inconsistent | Fix env + reload | **Present, not executable** |
| Action `approveStep` present in metadata | Yes — `actions.yaml` | Yes — exported metadata | None in definition | Definition OK; not exposed while inconsistent | Fix env + reload | **Present, not executable** |
| Action `triggerWorkflowWebhook` present in metadata | Yes | Yes | None in definition | Same as above | Fix env + reload | **Present, not executable** |
| `triggerWorkflowRun` name / args / output | `workflow_id: uuid!` → `TriggerWorkflowRunOutput` | Same in export | None | — | None for shape | **OK (metadata)** |
| `approveStep` name / args / output | `step_run_id: uuid!` → `ApproveStepOutput` | Same in export | None | — | None for shape | **OK (metadata)** |
| Action handlers | `{{ACTION_BASE_URL}}/api/actions/trigger-workflow` and `.../approve-step` (also webhook) | Identical templates; **not** `localhost` | Template cannot resolve | Handlers never called until env set | Set `ACTION_BASE_URL` to public HTTPS app origin (no trailing slash) | **BLOCKING** |
| `forward_client_headers` | `true` on all three Actions | `true` | None | JWT/session headers can reach Next.js | None | **OK** |
| Action kind / timeout | `synchronous`, `timeout: 60` | Same | None | — | None | **OK** |
| Action shared-secret header | `X-Hasura-Action-Secret` ← `value_from_env: ACTION_SHARED_SECRET` | Same header config in export | Inconsistency API only reported missing `ACTION_BASE_URL` (not `ACTION_SHARED_SECRET`) | Secret wiring looks present in metadata; runtime must still have the env var | Confirm `ACTION_SHARED_SECRET` is set on Hasura **and** matches Vercel; not proven missing by current inconsistency reason | **Verify on dashboard** |
| Action permissions | `user` for trigger/approve; `anonymous`+`user` for webhook | Same | None | — | None | **OK (metadata)** |
| Custom types `TriggerWorkflowRunOutput` / `ApproveStepOutput` | Fields: `id`, `status`, `workflow_id`, `message` (all non-null as in `actions.graphql`) | Same fields in export | CLI `metadata diff` shows field blocks / GraphQL reordering | Cosmetic CLI serialize/diff; types exist in metadata | Do **not** rewrite custom types to “fix” the diff | **Harmless diff** |
| `actions.graphql` / `approveStep` in diff | Local SDL has both mutations in one `Mutation` type | Live GraphQL schema has **neither** Action (types `ApproveStepOutput` / `TriggerWorkflowRunOutput` are `null` in introspection) | Diff reflects CLI project↔server SDL normalization; functional gap is inconsistency | Clients cannot call Actions | Fix `ACTION_BASE_URL` + reload; then re-check schema | **BLOCKING (runtime)** |
| GraphQL executability `approveStep` | Intended mutation for role `user` | Unauthenticated: `no mutations exist` (role default); as `user` (admin secret + role/user-id): `field 'approveStep' not found in type: 'mutation_root'` | Action absent from live schema | **Not executable** | Set env vars → reload → confirm field appears → then functional test | **FAIL** |
| GraphQL executability `triggerWorkflowRun` | Intended mutation for role `user` | Same: field not on `mutation_root` for role `user` | Action absent from live schema | **Not executable** | Same as above | **FAIL** |
| Admin introspection of Action mutations | Would list Action fields when consistent | Admin `mutation_root` lists only table insert/update/delete helpers — **no** `approveStep` / `triggerWorkflowRun` / `triggerWorkflowWebhook` | Inconsistent Actions omitted from schema | Confirms apply ≠ executable | Env + reload | **FAIL** |
| Handler URL localhost check | Templates use `{{ACTION_BASE_URL}}` | Same; no hardcoded `localhost` / `127.0.0.1` in exported Action/event/cron URLs | None | Safe template form | Point `ACTION_BASE_URL` at production app URL when ready | **OK** |
| Event Trigger `watched_records_database_event` | On `watched_records` insert/update → `{{ACTION_BASE_URL}}/api/events/database-event`; header `X-Hasura-Event-Secret` ← `HASURA_EVENT_SECRET` | Same definition; inconsistent: missing `ACTION_BASE_URL` | Present but inactive | DB events will not call backend | Set env + reload; confirm `HASURA_EVENT_SECRET` | **BLOCKING** |
| Event Trigger `notifications_notify` | On `notifications` insert → `.../api/events/notify`; same secret header | Same; inconsistent for `ACTION_BASE_URL` | Present but inactive | Notify webhook inactive | Set env + reload | **BLOCKING** |
| Cron `scheduled_workflow_tick` | `*/1 * * * *` → `{{ACTION_BASE_URL}}/api/events/scheduled`; `X-Cron-Secret` ← `CRON_SECRET` | Same; inconsistent for `ACTION_BASE_URL` | Present but inactive | Scheduled triggers will not fire to app | Set env + reload; confirm `CRON_SECRET` | **BLOCKING** |
| Webhook Action (HTTP path token) | `triggerWorkflowWebhook` Action (not a DB Event Trigger) | Present in metadata; inconsistent | Not on schema | Public webhook GraphQL path broken until consistent | Env + reload | **BLOCKING** |
| `databases.yaml` `functions` include | `functions: "!include default/functions/functions.yaml"` with file `[]` | Export `sources.default.functions` empty / absent as a populated list; CLI diff: `+ functions: "!include ..."` | Empty tracked-functions list / include bookkeeping | No app SQL functions are exposed as Hasura GraphQL functions (quota function is used via Action/SQL, not tracked) | Do **not** delete the include to silence diff unless intentionally changing CLI layout | **Harmless** |
| `organization_monthly_usage` ↔ `organizations` `insertion_order` | Manual relationships **omit** `insertion_order` in YAML | Export includes `insertion_order: null` on both manual configs | Server normalization of null key | No behavioral change | Ignore; do not force-null into local just for empty diff | **Harmless** |
| `network.yaml` | Local: `tls_allowlist: []` | Diff shows server default `tls_allowlist: []`; not in compact export payload used here | Nhost/Hasura managed / default config surface | No app functional impact | Do **not** strip Nhost defaults to empty the diff | **Harmless / managed default** |
| `opentelemetry.yaml` | Local disabled defaults (`status: disabled`, empty exporter, batch size 512) | Diff shows same class of defaults | Managed / default telemetry config | No app functional impact | Leave alone | **Harmless / managed default** |
| `api_limits.yaml` | Local null limits / `disabled: false` | Diff shows same defaults | Managed API limit defaults | No app functional impact | Leave alone | **Harmless / managed default** |
| `metrics_config.yaml` | Local `analyze_query_variables/response_body: false` | Diff shows same | Managed metrics defaults | No app functional impact | Leave alone | **Harmless / managed default** |
| `organizations` relationships | `monthly_usage`; arrays: members, workflows, watched_records, notifications, audit_logs, usage_events, workflow_db_writes | Same names present | Ordering only | None | None | **OK** |
| `organizations` permissions | `user` select via `members.user_id = X-Hasura-User-Id`; update name for owner | Same filters | None | Isolation OK | None | **OK** |
| `org_members` relationships / permissions | Rel: `organization`; CRUD with membership / owner checks | Same pattern on production | None | Isolation OK | None | **OK** |
| `workflows` relationships / permissions | Rel: organization, steps, triggers, runs, webhook_endpoints; membership filters + editor/owner roles | Same | None | Isolation OK | None | **OK** |
| `workflow_steps` permissions | Via `workflow.organization.members`; privileged `db_write`/`notify` owner-gated | Same | None | Isolation OK | None | **OK** |
| `workflow_triggers` permissions | Via workflow→org→members; webhook create owner-gated | Same | None | Isolation OK | None | **OK** |
| `workflow_runs` permissions | Select-only via workflow→org→members | Same | None | Isolation OK | None | **OK** |
| `step_runs` permissions | Select-only via run→workflow→org→members | Same | None | Isolation OK | None | **OK** |
| `organization_monthly_usage` permissions | Select via `organization.members.user_id` | Same | None | Usage view scoped by membership | None | **OK** |
| JWT → org_members → org → resource chain | Filters use `X-Hasura-User-Id` through `members` / nested org | Live probe: seed user Alice sees only Org A; random UUID sees empty orgs/members; Org B viewer UUID sees Org B only | None material | Table RLS model is live and correct | Keep; map real Nhost Auth UUIDs into `org_members` for real users | **OK** |

---

## Action detail (production export vs local)

| Field | `triggerWorkflowRun` | `approveStep` |
| --- | --- | --- |
| name | `triggerWorkflowRun` | `approveStep` |
| arguments | `workflow_id: uuid!` | `step_run_id: uuid!` |
| output type | `TriggerWorkflowRunOutput` | `ApproveStepOutput` |
| handler | `{{ACTION_BASE_URL}}/api/actions/trigger-workflow` | `{{ACTION_BASE_URL}}/api/actions/approve-step` |
| forward_client_headers | `true` | `true` |
| headers | `X-Hasura-Action-Secret` ← `ACTION_SHARED_SECRET` | same |
| permissions | role `user` | role `user` |
| custom type fields | `id uuid!`, `status String!`, `workflow_id uuid!`, `message String!` | same shape |

Third Action (also inconsistent for the same reason): `triggerWorkflowWebhook` → `{{ACTION_BASE_URL}}/api/actions/trigger-webhook`, roles `anonymous` + `user`.

---

## Why `metadata diff` still shows Action / type noise

1. **Authoritative runtime state** is inconsistency: Actions are in the metadata catalog but **excluded from `mutation_root`**.  
2. CLI diff still compares YAML/SDL shapes (field blocks, Mutation ordering). That can look like “missing fields” even when `export_metadata` already has the correct custom types.  
3. **Do not** treat another blind `metadata apply` as the fix while `ACTION_BASE_URL` is unset — apply already succeeded and left the same inconsistency.

---

## Why `functions.yaml` appears

Local `databases/databases.yaml` tracks Postgres functions via an include whose content is an empty list (`[]`). Production has **zero** tracked Hasura functions. The CLI reports the include / empty functions bookkeeping as a diff. Application SQL helpers (e.g. `consume_org_quota`) live in migrations and are **not** required to be tracked GraphQL functions. Harmless.

---

## Exact safe correction (when you choose to act — not done in this investigation)

1. In Nhost Dashboard → project settings / Hasura **environment variables**, set at least:
   - `ACTION_BASE_URL` = public HTTPS origin of the Next.js deployment (**no** trailing slash) — **this is the proven missing variable**
   - Confirm also present and aligned with Vercel: `ACTION_SHARED_SECRET`, `HASURA_EVENT_SECRET`, `CRON_SECRET`
2. Reload metadata (preferred first step after env change):  
   `hasura metadata reload --endpoint "<hasura-endpoint>" --admin-secret "<secret>"`
3. Re-check: `get_inconsistent_metadata` → `is_consistent: true`
4. Re-check GraphQL: `approveStep` and `triggerWorkflowRun` appear on `mutation_root` for role `user`
5. Only then run a real authenticated Action call against a known workflow / step_run
6. **Do not** delete or “normalize away” `network.yaml` / `opentelemetry.yaml` / `api_limits.yaml` / `metrics_config.yaml` solely to clear the diff
7. **Do not** re-apply metadata as the primary fix for this inconsistency

---

## Security note (ops)

An admin secret was typed into a local terminal session that was captured in IDE terminal logs. **Rotate the Hasura admin secret** in the Nhost dashboard after this investigation window, and avoid pasting secrets into shared transcripts.

---

## Verdict

**BLOCKED**
