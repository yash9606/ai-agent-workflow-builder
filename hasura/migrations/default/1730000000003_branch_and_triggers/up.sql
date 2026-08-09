-- Harden demo conditional branch (real jump on false path) and add
-- optional scheduled / database_event triggers + owner-only db_write step.

UPDATE workflows
SET description = 'LLM -> conditional -> HTTP -> approval -> db_write -> notify'
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

UPDATE workflow_steps
SET config = '{
  "source": "previous_output",
  "field": "text",
  "operator": "contains",
  "value": "POSITIVE",
  "true_label": "positive_path",
  "false_label": "negative_path",
  "true_next": "next",
  "false_next": "aaaaaaaa-0000-4000-8000-000000000013"
}'::jsonb
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000012';

-- Shift notify from position 4 → 5 if still at 4 (fresh DBs already have db_write).
UPDATE workflow_steps
SET position = 5
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000014'
  AND position = 4
  AND NOT EXISTS (
    SELECT 1 FROM workflow_steps
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000015'
  );

INSERT INTO workflow_steps (id, workflow_id, position, name, type, config)
SELECT
  'aaaaaaaa-0000-4000-8000-000000000015',
  'aaaaaaaa-0000-4000-8000-000000000001',
  4,
  'Persist demo record',
  'db_write',
  '{"key": "demo_approval_result"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_steps
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000015'
);

INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, enabled)
SELECT
  'aaaaaaaa-0000-4000-8000-000000000023',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'scheduled',
  '{
    "interval_minutes": 60,
    "description": "Demo scheduled trigger (fires when due via Hasura cron tick)"
  }'::jsonb,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_triggers
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000023'
);

INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, enabled)
SELECT
  'aaaaaaaa-0000-4000-8000-000000000024',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'database_event',
  '{
    "table": "watched_records",
    "description": "Starts this workflow when watched_records change in Org A"
  }'::jsonb,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_triggers
  WHERE id = 'aaaaaaaa-0000-4000-8000-000000000024'
);
