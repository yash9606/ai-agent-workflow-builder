CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  calls_allowed INTEGER NOT NULL DEFAULT 100 CHECK (calls_allowed > 0),
  quota_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- org_members
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_org_members_org_user ON org_members(org_id, user_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);

-- workflows
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflows_org ON workflows(org_id);

-- workflow_steps
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_call','http_request','db_write','notify','conditional_branch','approval_gate')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, position)
);
CREATE INDEX idx_workflow_steps_workflow_pos ON workflow_steps(workflow_id, position);

-- workflow_triggers
CREATE TABLE workflow_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','webhook','scheduled','database_event')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_triggers_workflow ON workflow_triggers(workflow_id);

-- webhook_endpoints (for webhook trigger secrets)
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_id UUID NOT NULL REFERENCES workflow_triggers(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  path_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- workflow_runs
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  triggered_by UUID,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','webhook','scheduled','database_event')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_runs_workflow_created ON workflow_runs(workflow_id, created_at DESC);

-- step_runs
CREATE TABLE step_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','skipped')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_step_runs_run ON step_runs(workflow_run_id);

-- db_write results (controlled write target — NO arbitrary SQL)
CREATE TABLE workflow_db_writes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_run_id UUID NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_db_writes_org ON workflow_db_writes(org_id);

-- notifications log
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  step_run_id UUID REFERENCES step_runs(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  destination TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org ON audit_logs(org_id, created_at DESC);

-- example table for database_event triggers
CREATE TABLE watched_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- usage events for accurate tracking
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_events_org_created ON usage_events(org_id, created_at DESC);

-- aggregation view
CREATE OR REPLACE VIEW organization_monthly_usage AS
SELECT
  o.id AS organization_id,
  o.name AS organization_name,
  o.calls_used AS current_month_calls_used,
  o.calls_allowed AS allowed_calls,
  GREATEST(o.calls_allowed - o.calls_used, 0) AS remaining_calls,
  ROUND((o.calls_used::numeric / NULLIF(o.calls_allowed, 0)) * 100, 2) AS usage_percentage,
  o.quota_period_start
FROM organizations o;

-- helper: atomic quota consume
CREATE OR REPLACE FUNCTION consume_org_quota(p_org_id UUID, p_run_id UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  updated_rows INTEGER;
BEGIN
  -- reset period if needed
  UPDATE organizations
  SET calls_used = 0,
      quota_period_start = date_trunc('month', now()),
      updated_at = now()
  WHERE id = p_org_id
    AND quota_period_start < date_trunc('month', now());

  UPDATE organizations
  SET calls_used = calls_used + 1,
      updated_at = now()
  WHERE id = p_org_id
    AND calls_used < calls_allowed;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 1 THEN
    INSERT INTO usage_events (org_id, workflow_run_id, reason)
    VALUES (p_org_id, p_run_id, p_reason);
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER watched_records_updated_at BEFORE UPDATE ON watched_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
