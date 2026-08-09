export const GET_MY_ORGS = /* GraphQL */ `
  query GetMyOrgs {
    organizations(order_by: { name: asc }) {
      id
      name
      members {
        id
        user_id
        role
      }
    }
  }
`;

export const GET_ORG_DASHBOARD = /* GraphQL */ `
  query GetOrgDashboard($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      members {
        id
        user_id
        role
      }
      workflows(order_by: { updated_at: desc }) {
        id
        name
        description
        active
        updated_at
        created_at
        steps_aggregate {
          aggregate {
            count
          }
        }
        triggers {
          id
          trigger_type
          enabled
        }
        runs(order_by: { created_at: desc }, limit: 1) {
          id
          status
          trigger_type
          created_at
          error
        }
      }
      monthly_usage {
        organization_id
        organization_name
        current_month_calls_used
        allowed_calls
        remaining_calls
        usage_percentage
        quota_period_start
      }
    }
    workflow_runs(
      where: { workflow: { org_id: { _eq: $orgId } } }
      order_by: { created_at: desc }
      limit: 8
    ) {
      id
      workflow_id
      status
      trigger_type
      created_at
      error
      workflow {
        id
        name
      }
    }
  }
`;

export const GET_WORKFLOWS = /* GraphQL */ `
  query GetWorkflows($orgId: uuid!) {
    workflows(
      where: { org_id: { _eq: $orgId } }
      order_by: { updated_at: desc }
    ) {
      id
      org_id
      name
      description
      active
      created_by
      created_at
      updated_at
      steps_aggregate {
        aggregate {
          count
        }
      }
      triggers {
        id
        trigger_type
        enabled
      }
      runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
        trigger_type
        created_at
        error
      }
    }
  }
`;

/** Organization-scoped tree: workflows → steps, triggers, most recent run. */
export const GET_ORG_WORKFLOW_TREE = /* GraphQL */ `
  query GetOrgWorkflowTree($orgId: uuid!) {
    organizations(where: { id: { _eq: $orgId } }) {
      id
      name
      workflows(order_by: { updated_at: desc }) {
        id
        name
        description
        active
        updated_at
        steps(order_by: { position: asc }) {
          id
          position
          name
          type
          config
        }
        triggers(order_by: { created_at: asc }) {
          id
          trigger_type
          config
          enabled
        }
        runs(order_by: { created_at: desc }, limit: 1) {
          id
          status
          trigger_type
          started_at
          completed_at
          error
          created_at
        }
      }
    }
  }
`;

export const GET_WORKFLOW = /* GraphQL */ `
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      active
      created_by
      created_at
      updated_at
      steps(order_by: { position: asc }) {
        id
        workflow_id
        position
        name
        type
        config
        created_at
        updated_at
      }
      triggers(order_by: { created_at: asc }) {
        id
        workflow_id
        trigger_type
        config
        enabled
        created_at
        webhook_endpoints {
          id
          workflow_id
          trigger_id
          path_token
          created_at
        }
      }
      runs(order_by: { created_at: desc }, limit: 5) {
        id
        workflow_id
        triggered_by
        trigger_type
        status
        started_at
        completed_at
        error
        created_at
      }
    }
  }
`;

export const GET_USAGE = /* GraphQL */ `
  query GetUsage($orgId: uuid!) {
    organization_monthly_usage(
      where: { organization_id: { _eq: $orgId } }
    ) {
      organization_id
      organization_name
      current_month_calls_used
      allowed_calls
      remaining_calls
      usage_percentage
      quota_period_start
    }
  }
`;

export const CREATE_WORKFLOW = /* GraphQL */ `
  mutation CreateWorkflow(
    $org_id: uuid!
    $name: String!
    $description: String!
    $active: Boolean!
  ) {
    insert_workflows_one(
      object: {
        org_id: $org_id
        name: $name
        description: $description
        active: $active
      }
    ) {
      id
      org_id
      name
      description
      active
      created_by
      created_at
      updated_at
    }
  }
`;

export const UPDATE_WORKFLOW = /* GraphQL */ `
  mutation UpdateWorkflow(
    $id: uuid!
    $name: String
    $description: String
    $active: Boolean
  ) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, active: $active }
    ) {
      id
      name
      description
      active
      updated_at
    }
  }
`;

export const DELETE_WORKFLOW = /* GraphQL */ `
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_STEP = /* GraphQL */ `
  mutation InsertStep(
    $workflow_id: uuid!
    $position: Int!
    $name: String!
    $type: String!
    $config: jsonb!
  ) {
    insert_workflow_steps_one(
      object: {
        workflow_id: $workflow_id
        position: $position
        name: $name
        type: $type
        config: $config
      }
    ) {
      id
      workflow_id
      position
      name
      type
      config
      created_at
      updated_at
    }
  }
`;

export const UPDATE_STEP = /* GraphQL */ `
  mutation UpdateStep(
    $id: uuid!
    $position: Int
    $name: String
    $type: String
    $config: jsonb
  ) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: {
        position: $position
        name: $name
        type: $type
        config: $config
      }
    ) {
      id
      workflow_id
      position
      name
      type
      config
      updated_at
    }
  }
`;

export const DELETE_STEP = /* GraphQL */ `
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_TRIGGER = /* GraphQL */ `
  mutation InsertTrigger(
    $workflow_id: uuid!
    $trigger_type: String!
    $config: jsonb!
    $enabled: Boolean!
  ) {
    insert_workflow_triggers_one(
      object: {
        workflow_id: $workflow_id
        trigger_type: $trigger_type
        config: $config
        enabled: $enabled
      }
    ) {
      id
      workflow_id
      trigger_type
      config
      enabled
      created_at
    }
  }
`;

export const UPDATE_TRIGGER = /* GraphQL */ `
  mutation UpdateTrigger(
    $id: uuid!
    $config: jsonb
    $enabled: Boolean
  ) {
    update_workflow_triggers_by_pk(
      pk_columns: { id: $id }
      _set: { config: $config, enabled: $enabled }
    ) {
      id
      trigger_type
      config
      enabled
    }
  }
`;

export const DELETE_TRIGGER = /* GraphQL */ `
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WEBHOOK_ENDPOINT = /* GraphQL */ `
  mutation InsertWebhookEndpoint(
    $workflow_id: uuid!
    $trigger_id: uuid!
    $secret: String!
    $path_token: String!
  ) {
    insert_webhook_endpoints_one(
      object: {
        workflow_id: $workflow_id
        trigger_id: $trigger_id
        secret: $secret
        path_token: $path_token
      }
    ) {
      id
      workflow_id
      trigger_id
      path_token
      created_at
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = /* GraphQL */ `
  mutation TriggerWorkflowRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      id
      status
      workflow_id
      message
    }
  }
`;

export const APPROVE_STEP = /* GraphQL */ `
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      id
      status
      workflow_id
      message
    }
  }
`;

export const SUB_STEP_RUNS = /* GraphQL */ `
  subscription SubStepRuns($workflowRunId: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $workflowRunId } }
      order_by: { created_at: asc }
    ) {
      id
      workflow_run_id
      workflow_step_id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
      created_at
      workflow_step {
        id
        name
        type
        position
        config
      }
    }
  }
`;

export const SUB_WORKFLOW_RUN = /* GraphQL */ `
  subscription SubWorkflowRun($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      workflow_id
      triggered_by
      trigger_type
      status
      started_at
      completed_at
      error
      created_at
    }
  }
`;

export const GET_RUN_WITH_STEPS = /* GraphQL */ `
  query GetRunWithSteps($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      workflow_id
      triggered_by
      trigger_type
      status
      started_at
      completed_at
      error
      created_at
      step_runs(order_by: { created_at: asc }) {
        id
        workflow_run_id
        workflow_step_id
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
        started_at
        completed_at
        created_at
        workflow_step {
          id
          name
          type
          position
          config
        }
      }
      workflow {
        id
        name
        org_id
      }
    }
  }
`;
