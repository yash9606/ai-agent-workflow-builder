DELETE FROM step_runs
WHERE workflow_step_id IN (
  SELECT id FROM workflow_steps
  WHERE workflow_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    AND position >= 90
);

DELETE FROM workflow_steps
WHERE workflow_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  AND position >= 90;

UPDATE workflows
SET description = 'LLM -> conditional -> HTTP -> approval -> notify'
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Temporarily move HTTP out of the way to avoid unique (workflow_id, position) clashes
UPDATE workflow_steps
SET position = 100
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000011';

UPDATE workflow_steps
SET position = 1
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000012';

UPDATE workflow_steps
SET
  position = 2,
  config = jsonb_build_object(
    'method', 'GET',
    'url', 'https://jsonplaceholder.typicode.com/todos/1',
    'headers', '{}'::jsonb,
    'query', '{}'::jsonb,
    'timeout_ms', 10000
  )
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000011';

UPDATE workflow_steps
SET position = 3
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000013';

UPDATE workflow_steps
SET position = 4
WHERE id = 'aaaaaaaa-0000-4000-8000-000000000014';

UPDATE organizations SET calls_used = 0;

SELECT position, name, type
FROM workflow_steps
WHERE workflow_id = 'aaaaaaaa-0000-4000-8000-000000000001'
ORDER BY position;
