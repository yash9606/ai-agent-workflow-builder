-- Demo seed with fixed UUIDs for reproducible local JWT demos.

INSERT INTO organizations (id, name, calls_used, calls_allowed)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Organization A', 0, 50),
  ('22222222-2222-2222-2222-222222222222', 'Organization B', 0, 50);

INSERT INTO org_members (id, org_id, user_id, role)
VALUES
  ('aaaaaaaa-1111-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('aaaaaaaa-1111-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'editor'),
  ('aaaaaaaa-1111-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'viewer'),
  ('bbbbbbbb-2222-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner'),
  ('bbbbbbbb-2222-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'editor'),
  ('bbbbbbbb-2222-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'viewer');

INSERT INTO workflows (id, org_id, name, description, active, created_by)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Demo Approval Pipeline',
  'LLM -> conditional -> HTTP -> approval -> db_write -> notify',
  true,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

-- Order: LLM → branch (false skips HTTP) → HTTP → approval → db_write → notify
INSERT INTO workflow_steps (id, workflow_id, position, name, type, config)
VALUES
  (
    'aaaaaaaa-0000-4000-8000-000000000010',
    'aaaaaaaa-0000-4000-8000-000000000001',
    0,
    'Classify sentiment',
    'llm_call',
    '{
      "provider": "auto",
      "model": "llama-3.1-8b-instant",
      "system_prompt": "You are a classifier. Reply with exactly one word: POSITIVE or NEGATIVE.",
      "prompt": "Classify this text: Great product, I love it!",
      "pass_previous_output": false
    }'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000012',
    'aaaaaaaa-0000-4000-8000-000000000001',
    1,
    'Branch on LLM',
    'conditional_branch',
    '{
      "source": "previous_output",
      "field": "text",
      "operator": "contains",
      "value": "POSITIVE",
      "true_label": "positive_path",
      "false_label": "negative_path",
      "true_next": "next",
      "false_next": "aaaaaaaa-0000-4000-8000-000000000013"
    }'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000011',
    'aaaaaaaa-0000-4000-8000-000000000001',
    2,
    'Echo HTTP',
    'http_request',
    '{
      "method": "GET",
      "url": "https://jsonplaceholder.typicode.com/todos/1",
      "headers": {},
      "query": {},
      "timeout_ms": 10000
    }'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000013',
    'aaaaaaaa-0000-4000-8000-000000000001',
    3,
    'Manager approval',
    'approval_gate',
    '{
      "message": "Approve sending notification?",
      "allowed_roles": ["owner", "editor"]
    }'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000015',
    'aaaaaaaa-0000-4000-8000-000000000001',
    4,
    'Persist demo record',
    'db_write',
    '{
      "key": "demo_approval_result"
    }'::jsonb
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000014',
    'aaaaaaaa-0000-4000-8000-000000000001',
    5,
    'Notify webhook',
    'notify',
    '{
      "channel": "webhook",
      "destination_env": "NOTIFY_WEBHOOK_URL",
      "message": "Workflow completed after approval"
    }'::jsonb
  );

INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, enabled)
VALUES
  (
    'aaaaaaaa-0000-4000-8000-000000000020',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'manual',
    '{}'::jsonb,
    true
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000021',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'webhook',
    '{"description": "Demo webhook trigger for Organization A"}'::jsonb,
    true
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000023',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'scheduled',
    '{
      "interval_minutes": 60,
      "description": "Demo scheduled trigger (fires when due via Hasura cron tick)"
    }'::jsonb,
    false
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000024',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'database_event',
    '{
      "table": "watched_records",
      "description": "Starts this workflow when watched_records change in Org A"
    }'::jsonb,
    false
  );

INSERT INTO webhook_endpoints (id, workflow_id, trigger_id, secret, path_token)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000022',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000021',
  'demo-webhook-secret',
  'demo-org-a-webhook'
);

INSERT INTO watched_records (id, org_id, title, payload)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000030',
  '11111111-1111-1111-1111-111111111111',
  'Sample watched record',
  '{"source": "seed", "priority": "normal"}'::jsonb
);
