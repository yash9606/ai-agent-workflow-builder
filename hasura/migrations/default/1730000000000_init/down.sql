DROP TRIGGER IF EXISTS watched_records_updated_at ON watched_records;
DROP TRIGGER IF EXISTS workflow_steps_updated_at ON workflow_steps;
DROP TRIGGER IF EXISTS workflows_updated_at ON workflows;
DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;

DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS consume_org_quota(UUID, UUID, TEXT);

DROP VIEW IF EXISTS organization_monthly_usage;

DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS watched_records CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS workflow_db_writes CASCADE;
DROP TABLE IF EXISTS step_runs CASCADE;
DROP TABLE IF EXISTS workflow_runs CASCADE;
DROP TABLE IF EXISTS webhook_endpoints CASCADE;
DROP TABLE IF EXISTS workflow_triggers CASCADE;
DROP TABLE IF EXISTS workflow_steps CASCADE;
DROP TABLE IF EXISTS workflows CASCADE;
DROP TABLE IF EXISTS org_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
