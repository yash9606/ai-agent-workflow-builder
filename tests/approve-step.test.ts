import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { OrgMember, StepRun, Workflow, WorkflowStep } from "@/lib/types";

const getStepRunAccess = vi.fn();
const resumeWorkflowRun = vi.fn();

vi.mock("@/lib/auth/org-access", () => ({
  getStepRunAccess: (...args: unknown[]) => getStepRunAccess(...args),
}));

vi.mock("@/lib/executor/engine", () => ({
  resumeWorkflowRun: (...args: unknown[]) => resumeWorkflowRun(...args),
}));

import { approvePausedStep } from "@/lib/workflows/approve-step";
import { requireUserFromRequest } from "@/lib/auth/request-auth";
import { signDemoJwt } from "@/lib/auth/jwt";
import { clearEnvCache } from "@/lib/env";
import { DEMO_USERS } from "@/lib/types";
import { POST as approveRoute } from "@/app/api/workflows/approve/route";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const WORKFLOW_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RUN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const STEP_RUN_A = "aaaaaaaa-0000-4000-8000-0000000000bb";
const STEP_A = "aaaaaaaa-0000-4000-8000-000000000010";
const OWNER = DEMO_USERS["alice@org-a.demo"].id;
const EDITOR = DEMO_USERS["bob@org-a.demo"].id;
const VIEWER = DEMO_USERS["charlie@org-a.demo"].id;
const ORG_B_OWNER = DEMO_USERS["david@org-b.demo"].id;

function membership(
  userId: string,
  role: OrgMember["role"],
  orgId = ORG_A
): OrgMember {
  return {
    id: "member-1",
    org_id: orgId,
    user_id: userId,
    role,
    created_at: "2020-01-01T00:00:00Z",
  };
}

function access(options: {
  userId: string;
  role: OrgMember["role"];
  runStatus?: string;
  stepStatus?: StepRun["status"];
  stepType?: WorkflowStep["type"];
  approvedBy?: string | null;
  allowedRoles?: string[];
}) {
  const workflow: Workflow = {
    id: WORKFLOW_A,
    org_id: ORG_A,
    name: "Demo",
    description: "",
    active: true,
    created_by: OWNER,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  };
  const step: WorkflowStep = {
    id: STEP_A,
    workflow_id: WORKFLOW_A,
    position: 3,
    name: "Approval",
    type: options.stepType ?? "approval_gate",
    config: { message: "Please approve", allowed_roles: ["owner", "editor"] },
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  };
  const stepRun: StepRun = {
    id: STEP_RUN_A,
    workflow_run_id: RUN_A,
    workflow_step_id: STEP_A,
    status: options.stepStatus ?? "paused",
    input: {},
    output: {
      message: "Please approve",
      allowed_roles: options.allowedRoles ?? ["owner", "editor"],
    },
    error: null,
    attempt_count: 1,
    approved_by: options.approvedBy ?? null,
    approved_at: null,
    started_at: "2020-01-01T00:00:00Z",
    completed_at: null,
    created_at: "2020-01-01T00:00:00Z",
  };
  return {
    stepRun,
    step,
    workflow,
    membership: membership(options.userId, options.role),
    runStatus: options.runStatus ?? "paused",
  };
}

describe("approvePausedStep authorization", () => {
  afterEach(() => {
    getStepRunAccess.mockReset();
    resumeWorkflowRun.mockReset();
  });

  it("allows an owner to approve and resumes the run", async () => {
    getStepRunAccess.mockResolvedValue(access({ userId: OWNER, role: "owner" }));
    resumeWorkflowRun.mockResolvedValue({
      id: RUN_A,
      workflow_id: WORKFLOW_A,
      status: "running",
      triggered_by: OWNER,
      trigger_type: "manual",
      started_at: "2020-01-01T00:00:00Z",
      completed_at: null,
      error: null,
      created_at: "2020-01-01T00:00:00Z",
    });

    const result = await approvePausedStep({
      userId: OWNER,
      stepRunId: STEP_RUN_A,
    });

    expect(getStepRunAccess).toHaveBeenCalledWith(OWNER, STEP_RUN_A);
    expect(resumeWorkflowRun).toHaveBeenCalledWith(RUN_A, STEP_RUN_A, OWNER);
    expect(result.status).toBe("running");
    expect(result.message).toMatch(/resumed/i);
  });

  it("allows an editor to approve", async () => {
    getStepRunAccess.mockResolvedValue(
      access({ userId: EDITOR, role: "editor" })
    );
    resumeWorkflowRun.mockResolvedValue({
      id: RUN_A,
      workflow_id: WORKFLOW_A,
      status: "running",
      triggered_by: OWNER,
      trigger_type: "manual",
      started_at: null,
      completed_at: null,
      error: null,
      created_at: "2020-01-01T00:00:00Z",
    });

    const result = await approvePausedStep({
      userId: EDITOR,
      stepRunId: STEP_RUN_A,
    });
    expect(result.message).toMatch(/resumed/i);
    expect(resumeWorkflowRun).toHaveBeenCalled();
  });

  it("denies a viewer from approving", async () => {
    getStepRunAccess.mockResolvedValue(
      access({
        userId: VIEWER,
        role: "viewer",
        allowedRoles: ["owner", "editor", "viewer"],
      })
    );

    await expect(
      approvePausedStep({ userId: VIEWER, stepRunId: STEP_RUN_A })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(resumeWorkflowRun).not.toHaveBeenCalled();
  });

  it("rejects cross-organization approval as not found", async () => {
    getStepRunAccess.mockRejectedValue(
      new AppError("NOT_FOUND", "Step run not found", 404)
    );

    await expect(
      approvePausedStep({ userId: ORG_B_OWNER, stepRunId: STEP_RUN_A })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(resumeWorkflowRun).not.toHaveBeenCalled();
  });

  it("rejects approving a non-paused run", async () => {
    getStepRunAccess.mockResolvedValue(
      access({
        userId: OWNER,
        role: "owner",
        runStatus: "running",
        stepStatus: "running",
      })
    );

    await expect(
      approvePausedStep({ userId: OWNER, stepRunId: STEP_RUN_A })
    ).rejects.toMatchObject({ code: "INVALID_STATE", status: 400 });
    expect(resumeWorkflowRun).not.toHaveBeenCalled();
  });

  it("rejects approving a non-approval_gate step", async () => {
    getStepRunAccess.mockResolvedValue(
      access({
        userId: OWNER,
        role: "owner",
        stepType: "http_request",
      })
    );

    await expect(
      approvePausedStep({ userId: OWNER, stepRunId: STEP_RUN_A })
    ).rejects.toMatchObject({ code: "INVALID_STATE", status: 400 });
  });
});

describe("POST /api/workflows/approve auth", () => {
  afterEach(() => {
    clearEnvCache();
    vi.unstubAllEnvs();
    getStepRunAccess.mockReset();
    resumeWorkflowRun.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await approveRoute(
      new Request("http://localhost/api/workflows/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_run_id: STEP_RUN_A }),
      })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message || "").toMatch(/auth/i);
  });

  it("accepts a valid owner JWT and resumes", async () => {
    const token = await signDemoJwt(
      DEMO_USERS["alice@org-a.demo"].id,
      DEMO_USERS["alice@org-a.demo"].email
    );
    // sanity: JWT helper still works
    await expect(
      requireUserFromRequest(
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    ).resolves.toMatchObject({ userId: OWNER });

    getStepRunAccess.mockResolvedValue(access({ userId: OWNER, role: "owner" }));
    resumeWorkflowRun.mockResolvedValue({
      id: RUN_A,
      workflow_id: WORKFLOW_A,
      status: "running",
      triggered_by: OWNER,
      trigger_type: "manual",
      started_at: null,
      completed_at: null,
      error: null,
      created_at: "2020-01-01T00:00:00Z",
    });

    const res = await approveRoute(
      new Request("http://localhost/api/workflows/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ step_run_id: STEP_RUN_A }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message?: string; status?: string };
    expect(body.status).toBe("running");
    expect(body.message).toMatch(/resumed/i);
  });
});
