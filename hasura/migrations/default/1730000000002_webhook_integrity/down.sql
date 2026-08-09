ALTER TABLE webhook_endpoints
  DROP CONSTRAINT IF EXISTS webhook_endpoints_trigger_same_workflow;

ALTER TABLE workflow_triggers
  DROP CONSTRAINT IF EXISTS workflow_triggers_id_workflow_unique;
