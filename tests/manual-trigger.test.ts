import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { OrgMember, Workflow } from "@/lib/types";

const getWorkflowAccess = vi.fn();
const startWorkflowRun = vi.fn();

vi.mock("@/lib/auth/org-access", () => ({
  getWorkflowAccess: (...args: unknown[]) => getWorkflowAccess(...args),
}));

vi.mock("@/lib/executor/engine", () => ({
  startWorkflowRun: (...args: unknown[]) => startWorkflowRun(...args),
}));

import { triggerManualWorkflowRun } from "@/lib/workflows/manual-trigger";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER = "8e7fa91f-58ff-4b09-989c-a116de070018";
const EDITOR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VIEWER = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORG_B_OWNER = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const STRANGER = "99999999-9999-4999-8999-999999999999";

function workflow(orgId = ORG_A): Workflow {
  return {
    id: WORKFLOW_A,
    org_id: orgId,
    name: "Demo Approval Pipeline",
    description: "",
    active: true,
    created_by: OWNER,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  };
}

function member(userId: string, role: OrgMember["role"], orgId = ORG_A): OrgMember {
  return {
    id: "member-1",
    org_id: orgId,
    user_id: userId,
    role,
    created_at: "2020-01-01T00:00:00Z",
  };
}

describe("triggerManualWorkflowRun authorization", () => {
  afterEach(() => {
    getWorkflowAccess.mockReset();
    startWorkflowRun.mockReset();
  });

  it("allows an authenticated owner to run a workflow in their org", async () => {
    getWorkflowAccess.mockResolvedValue({
      workflow: workflow(),
      membership: member(OWNER, "owner"),
    });
    startWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: WORKFLOW_A,
      status: "running",
      triggered_by: OWNER,
      trigger_type: "manual",
      started_at: null,
      completed_at: null,
      error: null,
      created_at: "2020-01-01T00:00:00Z",
    });

    const result = await triggerManualWorkflowRun({
      userId: OWNER,
      workflowId: WORKFLOW_A,
    });

    expect(getWorkflowAccess).toHaveBeenCalledWith(OWNER, WORKFLOW_A);
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_A,
        triggeredBy: OWNER,
        triggerType: "manual",
      })
    );
    expect(result.id).toBe("run-1");
    expect(result.workflow_id).toBe(WORKFLOW_A);
  });

  it("allows an editor to run a workflow in their org", async () => {
    getWorkflowAccess.mockResolvedValue({
      workflow: workflow(),
      membership: member(EDITOR, "editor"),
    });
    startWorkflowRun.mockResolvedValue({
      id: "run-2",
      workflow_id: WORKFLOW_A,
      status: "running",
      triggered_by: EDITOR,
      trigger_type: "manual",
      started_at: null,
      completed_at: null,
      error: null,
      created_at: "2020-01-01T00:00:00Z",
    });

    const result = await triggerManualWorkflowRun({
      userId: EDITOR,
      workflowId: WORKFLOW_A,
    });
    expect(result.id).toBe("run-2");
    expect(startWorkflowRun).toHaveBeenCalled();
  });

  it("denies a viewer from running a workflow", async () => {
    getWorkflowAccess.mockResolvedValue({
      workflow: workflow(),
      membership: member(VIEWER, "viewer"),
    });

    await expect(
      triggerManualWorkflowRun({
        userId: VIEWER,
        workflowId: WORKFLOW_A,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  it("denies a user with no org_members row", async () => {
    getWorkflowAccess.mockRejectedValue(
      new AppError("NOT_FOUND", "Workflow not found", 404)
    );

    await expect(
      triggerManualWorkflowRun({
        userId: STRANGER,
        workflowId: WORKFLOW_A,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  it("denies running a workflow from another organization", async () => {
    // getWorkflowAccess joins org_members for the caller — cross-org looks like not found
    getWorkflowAccess.mockRejectedValue(
      new AppError("NOT_FOUND", "Workflow not found", 404)
    );

    await expect(
      triggerManualWorkflowRun({
        userId: ORG_B_OWNER,
        workflowId: WORKFLOW_A,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(getWorkflowAccess).toHaveBeenCalledWith(ORG_B_OWNER, WORKFLOW_A);
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });
});
