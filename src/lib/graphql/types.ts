import type {
  OrgRole,
  RunStatus,
  StepStatus,
  StepType,
  TriggerType,
  JsonValue,
  JsonObject,
} from "@/lib/types";

export interface GqlOrgMember {
  id: string;
  user_id: string;
  role: OrgRole;
}

export interface GqlOrganization {
  id: string;
  name: string;
  members: GqlOrgMember[];
}

export interface GqlUsage {
  organization_id: string;
  organization_name: string;
  current_month_calls_used: number;
  allowed_calls: number;
  remaining_calls: number;
  usage_percentage: number;
  quota_period_start: string;
}

export interface GqlWorkflowSummary {
  id: string;
  org_id?: string;
  name: string;
  description: string;
  active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface GqlWorkflowStep {
  id: string;
  workflow_id: string;
  position: number;
  name: string;
  type: StepType;
  config: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface GqlWebhookEndpoint {
  id: string;
  workflow_id: string;
  trigger_id: string;
  /** Never selected from Hasura — kept optional for local create-only display. */
  secret?: string;
  path_token: string;
  created_at: string;
}

export interface GqlWorkflowListItem extends GqlWorkflowSummary {
  steps_aggregate?: { aggregate?: { count?: number | null } | null } | null;
  triggers?: Array<{
    id: string;
    trigger_type: TriggerType;
    enabled: boolean;
  }>;
  runs?: GqlWorkflowRun[];
}

export interface GqlWorkflowTrigger {
  id: string;
  workflow_id: string;
  trigger_type: TriggerType;
  config: JsonObject;
  enabled: boolean;
  created_at: string;
  webhook_endpoints?: GqlWebhookEndpoint[];
}

export interface GqlWorkflowRun {
  id: string;
  workflow_id: string;
  triggered_by: string | null;
  trigger_type: TriggerType;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface GqlStepRun {
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  status: StepStatus;
  input: JsonObject;
  output: JsonValue | null;
  error: string | null;
  attempt_count: number;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  workflow_step?: {
    id: string;
    name: string;
    type: StepType;
    position: number;
    config: JsonObject;
  } | null;
}

export interface GqlWorkflowDetail extends GqlWorkflowSummary {
  org_id: string;
  steps: GqlWorkflowStep[];
  triggers: GqlWorkflowTrigger[];
  runs: GqlWorkflowRun[];
}
