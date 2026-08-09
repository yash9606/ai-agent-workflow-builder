DELETE FROM workflow_triggers
WHERE id IN (
  'aaaaaaaa-0000-4000-8000-000000000023',
  'aaaaaaaa-0000-4000-8000-000000000024'
);

DELETE FROM workflow_steps
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000015';

UPDATE workflow_steps
SET position = 4
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000014'
  AND position = 5;

UPDATE workflow_steps
SET config = '{
  "source": "previous_output",
  "field": "text",
  "operator": "contains",
  "value": "POSITIVE",
  "true_label": "positive_path",
  "false_label": "negative_path"
}'::jsonb
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000012';

UPDATE workflows
SET description = 'LLM -> conditional -> HTTP -> approval -> notify'
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
