export type OrgRole = "owner" | "editor" | "viewer";

export type StepType =
  | "llm_call"
  | "http_request"
  | "db_write"
  | "notify"
  | "conditional_branch"
  | "approval_gate";

export type TriggerType = "manual" | "webhook" | "scheduled" | "database_event";

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped";

export type LlmProvider = "groq" | "gemini" | "openrouter" | "stub" | "auto";

export type ConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "lt"
  | "exists";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface LlmCallConfig {
  provider?: LlmProvider;
  model?: string;
  system_prompt?: string;
  prompt?: string;
  pass_previous_output?: boolean;
}

export interface HttpRequestConfig {
  method?: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  timeout_ms?: number;
}

export interface DbWriteConfig {
  key: string;
}

export interface NotifyConfig {
  channel?: string;
  destination?: string;
  destination_env?: string;
  message?: string;
}

export interface ConditionalBranchConfig {
  /** Data source for the condition (default: previous step output). */
  source?: "previous_output" | "input";
  field?: string;
  operator: ConditionOperator;
  value?: unknown;
  true_label?: string;
  false_label?: string;
  /**
   * Where to continue when the condition matches.
   * `"next"` (default), `"end"`, a workflow_step UUID, or a numeric position.
   */
  true_next?: string;
  /**
   * Where to continue when the condition does not match.
   * Same values as true_next. Defaults to `"next"` unless skip_on_false.
   */
  false_next?: string;
  /** Legacy: when false, jump to end (skip remaining steps). */
  skip_on_false?: boolean;
}

export interface ApprovalGateConfig {
  message?: string;
  allowed_roles?: OrgRole[];
}

export type StepConfig =
  | LlmCallConfig
  | HttpRequestConfig
  | DbWriteConfig
  | NotifyConfig
  | ConditionalBranchConfig
  | ApprovalGateConfig
  | Record<string, unknown>;

export interface Organization {
  id: string;
  name: string;
  calls_used: number;
  calls_allowed: number;
  quota_period_start: string;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  position: number;
  name: string;
  type: StepType;
  config: StepConfig;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTrigger {
  id: string;
  workflow_id: string;
  trigger_type: TriggerType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  workflow_id: string;
  trigger_id: string;
  secret: string;
  path_token: string;
  created_at: string;
}

export interface WorkflowRun {
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

export interface StepRun {
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
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface StepExecutionResult {
  output: JsonObject;
  error?: string;
  pause?: boolean;
  /**
   * Absolute next step index after this step completes.
   * Used by conditional_branch to skip forward; engine marks skipped steps.
   */
  nextIndex?: number;
  /** When true, remaining steps are skipped and the run completes. */
  endRun?: boolean;
}

export interface ConditionResult {
  matched: boolean;
  label: string;
  details: JsonObject;
}

export interface HasuraActionPayload<TInput = Record<string, unknown>> {
  action: { name: string };
  input: TInput;
  session_variables: Record<string, string | undefined>;
  request_query?: string;
}

export interface TriggerWorkflowRunOutput {
  id: string;
  status: RunStatus;
  workflow_id: string;
  message: string;
}

export interface ApproveStepOutput {
  id: string;
  status: RunStatus;
  workflow_id: string;
  message: string;
}

export const DEMO_USERS: Record<
  string,
  { id: string; email: string; displayName: string }
> = {
  "alice@org-a.demo": {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "alice@org-a.demo",
    displayName: "Alice",
  },
  "bob@org-a.demo": {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    email: "bob@org-a.demo",
    displayName: "Bob",
  },
  "charlie@org-a.demo": {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    email: "charlie@org-a.demo",
    displayName: "Charlie",
  },
  "david@org-b.demo": {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    email: "david@org-b.demo",
    displayName: "David",
  },
  "eve@org-b.demo": {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    email: "eve@org-b.demo",
    displayName: "Eve",
  },
  "frank@org-b.demo": {
    id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    email: "frank@org-b.demo",
    displayName: "Frank",
  },
};
