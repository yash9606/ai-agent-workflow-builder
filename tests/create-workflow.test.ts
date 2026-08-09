import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { OrgMember, Workflow } from "@/lib/types";

const requireMembership = vi.fn();
const query = vi.fn();

vi.mock("@/lib/auth/org-access", () => ({
  requireMembership: (...args: unknown[]) => requireMembership(...args),
}));

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import { createWorkflowForUser } from "@/lib/workflows/create-workflow";
import { POST as createRoute } from "@/app/api/workflows/route";
import { signDemoJwt } from "@/lib/auth/jwt";
import { clearEnvCache } from "@/lib/env";
import { DEMO_USERS } from "@/lib/types";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const OWNER = DEMO_USERS["alice@org-a.demo"].id;
const EDITOR = DEMO_USERS["bob@org-a.demo"].id;
const VIEWER = DEMO_USERS["charlie@org-a.demo"].id;
const WORKFLOW_ID = "aaaaaaaa-0000-4000-8000-000000000099";

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

function createdWorkflow(createdBy: string): Workflow {
  return {
    id: WORKFLOW_ID,
    org_id: ORG_A,
    name: "New pipeline",
    description: "desc",
    active: true,
    created_by: createdBy,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
  };
}

describe("createWorkflowForUser", () => {
  afterEach(() => {
    requireMembership.mockReset();
    query.mockReset();
  });

  it("allows an owner to create a workflow", async () => {
    requireMembership.mockResolvedValue(membership(OWNER, "owner"));
    query
      .mockResolvedValueOnce({ rows: [createdWorkflow(OWNER)] })
      .mockResolvedValueOnce({ rows: [{ id: "trigger-1" }] });

    const workflow = await createWorkflowForUser({
      userId: OWNER,
      orgId: ORG_A,
      name: "New pipeline",
      description: "desc",
      active: true,
    });

    expect(requireMembership).toHaveBeenCalledWith(OWNER, ORG_A, [
      "owner",
      "editor",
    ]);
    expect(workflow.id).toBe(WORKFLOW_ID);
    expect(workflow.created_by).toBe(OWNER);
    expect(query.mock.calls[0][1]).toEqual([
      ORG_A,
      "New pipeline",
      "desc",
      true,
      OWNER,
    ]);
  });

  it("allows an editor to create a workflow", async () => {
    requireMembership.mockResolvedValue(membership(EDITOR, "editor"));
    query
      .mockResolvedValueOnce({ rows: [createdWorkflow(EDITOR)] })
      .mockResolvedValueOnce({ rows: [] });

    const workflow = await createWorkflowForUser({
      userId: EDITOR,
      orgId: ORG_A,
      name: "Editor flow",
    });

    expect(workflow.created_by).toBe(EDITOR);
    expect(requireMembership).toHaveBeenCalledWith(EDITOR, ORG_A, [
      "owner",
      "editor",
    ]);
  });

  it("rejects a viewer", async () => {
    requireMembership.mockRejectedValue(
      new AppError("FORBIDDEN", "Insufficient role for this operation", 403)
    );

    await expect(
      createWorkflowForUser({
        userId: VIEWER,
        orgId: ORG_A,
        name: "Nope",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects users without membership", async () => {
    requireMembership.mockRejectedValue(
      new AppError(
        "FORBIDDEN",
        "You are not a member of this organization",
        403
      )
    );

    await expect(
      createWorkflowForUser({
        userId: OWNER,
        orgId: ORG_B,
        name: "Cross",
      })
    ).rejects.toMatchObject({
      status: 403,
      publicMessage: expect.stringMatching(/not a member/i),
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects empty names", async () => {
    await expect(
      createWorkflowForUser({
        userId: OWNER,
        orgId: ORG_A,
        name: "   ",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(requireMembership).not.toHaveBeenCalled();
  });
});

describe("POST /api/workflows", () => {
  afterEach(() => {
    requireMembership.mockReset();
    query.mockReset();
    clearEnvCache();
    vi.unstubAllEnvs();
  });

  async function authedRequest(
    userId: string,
    email: string,
    body: unknown
  ): Promise<Response> {
    const token = await signDemoJwt(userId, email);
    return createRoute(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
    );
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await createRoute(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: ORG_A, name: "X" }),
      })
    );
    expect(res.status).toBe(401);
    expect(requireMembership).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid request bodies", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const res = await authedRequest(alice.id, alice.email, {
      org_id: "not-a-uuid",
      name: "",
    });
    expect(res.status).toBe(400);
    expect(requireMembership).not.toHaveBeenCalled();
  });

  it("creates with JWT subject and ignores browser-supplied user_id", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const spoofed = "99999999-9999-4999-8999-999999999999";
    requireMembership.mockResolvedValue(membership(alice.id, "owner"));
    query
      .mockResolvedValueOnce({ rows: [createdWorkflow(alice.id)] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await authedRequest(alice.id, alice.email, {
      org_id: ORG_A,
      name: "New pipeline",
      description: "desc",
      active: true,
      user_id: spoofed,
      created_by: spoofed,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { workflow: Workflow };
    expect(body.workflow.id).toBe(WORKFLOW_ID);
    expect(body.workflow.created_by).toBe(alice.id);
    expect(requireMembership).toHaveBeenCalledWith(alice.id, ORG_A, [
      "owner",
      "editor",
    ]);
    expect(query.mock.calls[0][1]).toEqual([
      ORG_A,
      "New pipeline",
      "desc",
      true,
      alice.id,
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain(spoofed);
  });

  it("rejects viewer via route", async () => {
    const charlie = DEMO_USERS["charlie@org-a.demo"];
    requireMembership.mockRejectedValue(
      new AppError("FORBIDDEN", "Insufficient role for this operation", 403)
    );

    const res = await authedRequest(charlie.id, charlie.email, {
      org_id: ORG_A,
      name: "Viewer attempt",
    });
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects cross-organization create attempts", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    requireMembership.mockRejectedValue(
      new AppError(
        "FORBIDDEN",
        "You are not a member of this organization",
        403
      )
    );

    const res = await authedRequest(alice.id, alice.email, {
      org_id: ORG_B,
      name: "Into org B",
    });
    expect(res.status).toBe(403);
    expect(requireMembership).toHaveBeenCalledWith(alice.id, ORG_B, [
      "owner",
      "editor",
    ]);
    expect(query).not.toHaveBeenCalled();
  });
});
