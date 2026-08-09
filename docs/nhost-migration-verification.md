# Nhost migration verification (Auth compatibility)

**Project:** `ai-agent-workflow-builder` (`bfwuoawsybivkgdvkyah`, `ap-south-1`)  
**Confirmed state:** all four migrations **Not Present** (fresh apply).  
**This document:** inspection only — migrations were **not** modified and **not** applied.

---

## Migration order and dependencies

```
1730000000000_init
        │
        ▼
1730000000001_seed          (needs organizations, workflows, … from init)
        │
        ▼
1730000000002_webhook_integrity  (needs workflow_triggers + webhook_endpoints)
        │
        ▼
1730000000003_branch_and_triggers  (needs seeded workflow/steps/triggers; idempotent)
```

| Version | Depends on | Safe to skip? |
| --- | --- | --- |
| init | empty `public` app tables | No — required |
| seed | init | No — required for demo pipeline data |
| webhook_integrity | init (+ seed data optional for FK data) | No — integrity constraint |
| branch_and_triggers | seed (updates/inserts by fixed IDs) | Should apply; idempotent if seed already complete |

---

## Per-migration matrix

| Migration | Purpose | Objects created/changed | Demo data | Nhost Auth dependency | Production safety | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `1730000000000_init` | Core schema + quota | **Tables:** `organizations`, `org_members`, `workflows`, `workflow_steps`, `workflow_triggers`, `webhook_endpoints`, `workflow_runs`, `step_runs`, `workflow_db_writes`, `notifications`, `audit_logs`, `watched_records`, `usage_events`. **View:** `organization_monthly_usage`. **Functions:** `consume_org_quota`, `set_updated_at`. **Triggers:** updated_at on orgs/workflows/steps/watched_records. **Extension:** `pgcrypto`. FKs only within these app tables. | None | **None.** `org_members.user_id` and `workflows.created_by` are bare `UUID` — **no** `REFERENCES auth.users`. No `auth.*` objects touched. | Creates new objects only. No `DROP`/`TRUNCATE`/`DELETE` in `up.sql`. Does not write Nhost-managed `auth` schema. | **OK** |
| `1730000000001_seed` | Demo orgs, members, six-step pipeline, webhook, watched row | Inserts into app tables listed above (orgs, members, workflow, steps, triggers, webhook endpoint, watched_records). | **Org A/B**; members with fixed user UUIDs (below); demo workflow `aaaaaaaa-0000-4000-8000-000000000001`; webhook `demo-org-a-webhook` / `demo-webhook-secret`. | **None at apply time.** Does **not** insert into `auth.users` or any Nhost Auth table. Does **not** require those users to exist in Auth for SQL to succeed. | Insert-only into application tables. Will fail only on re-apply (PK conflicts) — fine on fresh DB. Does not overwrite Auth data. | **OK** |
| `1730000000002_webhook_integrity` | Composite FK so webhook endpoint matches trigger’s workflow | Adds unique `(id, workflow_id)` on `workflow_triggers`; FK `(trigger_id, workflow_id)` → that unique key. Wrapped in `IF NOT EXISTS` DO block. | None | None | Additive constraints only. Non-destructive. | **OK** |
| `1730000000003_branch_and_triggers` | Align branch config + ensure db_write / scheduled / database_event rows | `UPDATE` demo workflow description + conditional step config; conditional `UPDATE` notify position; idempotent `INSERT … WHERE NOT EXISTS` for db_write step and two triggers. | Touches only fixed demo workflow IDs from seed. | None | Updates/inserts demo app rows only. Idempotent. No Auth schema. | **OK** |

---

## Demo `org_members.user_id` values (seed)

| Persona (local demo) | `user_id` | Org | Role |
| --- | --- | --- | --- |
| Alice | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | Org A | owner |
| Bob | `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` | Org A | editor |
| Charlie | `cccccccc-cccc-cccc-cccc-cccccccccccc` | Org A | viewer |
| David | `dddddddd-dddd-dddd-dddd-dddddddddddd` | Org B | owner |
| Eve | `eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee` | Org B | editor |
| Frank | `ffffffff-ffff-ffff-ffff-ffffffffffff` | Org B | viewer |

These UUIDs are **application membership markers**, not Nhost Auth accounts.

---

## Answers to Auth compatibility questions

| Question | Finding |
| --- | --- |
| Which tables are created? | See init row above (13 tables + view + 2 functions). |
| Which demo user UUIDs in `org_members`? | Six fixed UUIDs listed above. |
| Seed creates `auth.users` / Nhost Auth rows? | **No.** Zero references to `auth.` schema in any `up.sql`. |
| Seed depends on users existing in Nhost Auth? | **No** for SQL apply. **Yes** for *logging in as those personas via Nhost* — Auth will not have those UUIDs unless you create matching users (impractical). Production users get **new** Auth UUIDs. |
| FK from `org_members` → `auth.users`? | **No.** Only `org_members.org_id → organizations(id)`. |
| Will seed succeed on fresh Nhost project? | **Yes**, assuming `public` can create these tables and `pgcrypto` is allowed (standard on Nhost). |
| Must demo users be created via Nhost Auth? | **Not for migration apply.** For **Nhost login** to see Org A/B data, insert `org_members` rows for **real** Auth user UUIDs after signup (or use SQL). Local `AUTH_MODE=demo` JWT minting is separate and not used in production Nhost mode. |
| Can demo UUIDs coexist with Nhost Auth users? | **Yes.** Different UUID values in `org_members`. No collision with Auth tables. Real users simply get additional membership rows. |
| Any migration overwrite Nhost-managed data? | **No.** No writes to `auth`, storage, or Nhost system catalogs. |
| Any migration destructive? | **`up.sql` files are not destructive** (create/insert/alter-add only). **`down.sql` files are destructive** — **do not run downs** on production. |

---

## Minor operational notes (not blockers)

1. **Seed webhook secret** `demo-webhook-secret` is a known demo value — rotate for a long-lived public deployment if desired (data change after apply; not a migration edit).  
2. **PostgreSQL trigger syntax** uses `EXECUTE FUNCTION set_updated_at()` (PG14+). Nhost Postgres versions in current use support this; local stack is PG15.  
3. **`pgcrypto`** via `CREATE EXTENSION IF NOT EXISTS` — normally permitted on Nhost; if the project already has it, this is a no-op.  
4. After apply, **map production Auth users** into `org_members` before expecting Nhost login to authorize Org A/B workflows.

---

## Recommendation

### SAFE TO APPLY

All four migrations are compatible with a fresh Nhost database and with Nhost Auth:

- No foreign keys into `auth.users`
- No inserts into Auth-managed tables
- Seed does not require Auth users to exist
- Demo UUID memberships do not conflict with future real Auth user UUIDs
- Forward (`up`) migrations are non-destructive to Nhost-managed data

**Apply order:** init → seed → webhook_integrity → branch_and_triggers (Hasura CLI `migrate apply`), then metadata apply — as documented in [`docs/nhost-production-deploy.md`](nhost-production-deploy.md).

**Do not** apply `down` migrations.  
**Do not** reset/drop the Nhost project after real user data exists.

Post-apply (separate from this verification): set Hasura Action/event env vars, deploy Vercel with `AUTH_MODE=nhost`, and insert `org_members` for real Nhost Auth user IDs.
