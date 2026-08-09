-- Idempotent integrity constraints for webhook_endpoints ↔ workflow_triggers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_triggers_id_workflow_unique'
  ) THEN
    ALTER TABLE workflow_triggers
      ADD CONSTRAINT workflow_triggers_id_workflow_unique UNIQUE (id, workflow_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_trigger_same_workflow'
  ) THEN
    ALTER TABLE webhook_endpoints
      ADD CONSTRAINT webhook_endpoints_trigger_same_workflow
      FOREIGN KEY (trigger_id, workflow_id)
      REFERENCES workflow_triggers (id, workflow_id)
      ON DELETE CASCADE;
  END IF;
END $$;
