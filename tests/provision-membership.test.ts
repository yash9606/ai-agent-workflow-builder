import { afterEach, describe, expect, it, vi } from "vitest";
const query = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  DEFAULT_EVALUATOR_ORG_ID,
  ensureDefaultOrgMembership,
} from "@/lib/auth/provision-membership";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { signDemoJwt } from "@/lib/auth/jwt";
import { clearEnvCache } from "@/lib/env";
import { DEMO_USERS } from "@/lib/types";

const NEW_USER = "8e7fa91f-58ff-4b09-989c-a116de070018";

describe("ensureDefaultOrgMembership", () => {
  afterEach(() => {
    query.mockReset();
  });

  it("provisions Organization A owner for a new authenticated user", async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // no existing memberships
      .mockResolvedValueOnce({
        rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
      });

    const result = await ensureDefaultOrgMembership(NEW_USER);

    expect(result.created).toBe(true);
    expect(result.alreadyMember).toBe(false);
    expect(result.orgId).toBe(DEFAULT_EVALUATOR_ORG_ID);
    expect(result.role).toBe("owner");
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO org_members"),
      [DEFAULT_EVALUATOR_ORG_ID, NEW_USER]
    );
  });

  it("is idempotent when the user already has a membership", async () => {
    query.mockResolvedValueOnce({
      rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "editor" }],
    });

    const result = await ensureDefaultOrgMembership(NEW_USER);

    expect(result.created).toBe(false);
    expect(result.alreadyMember).toBe(true);
    expect(result.role).toBe("editor");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/SELECT org_id, role/i);
  });

  it("does not duplicate membership on conflict (concurrent insert)", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // INSERT ... DO NOTHING, no returning
      .mockResolvedValueOnce({
        rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
      });

    const result = await ensureDefaultOrgMembership(NEW_USER);
    expect(result.created).toBe(false);
    expect(result.alreadyMember).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("uses the provided verified user id (not a browser-supplied id)", async () => {
    const verifiedId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
      });

    await ensureDefaultOrgMembership(verifiedId);
    expect(query.mock.calls[1][1]).toEqual([
      DEFAULT_EVALUATOR_ORG_ID,
      verifiedId,
    ]);
  });
});

describe("GET /api/auth/me provisioning", () => {
  afterEach(() => {
    query.mockReset();
    clearEnvCache();
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated provisioning", async () => {
    const res = await meRoute(
      new Request("http://localhost/api/auth/me", { method: "GET" })
    );
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("provisions from verified JWT subject on /api/auth/me", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);

    // ensureDefaultOrgMembership: already member
    query
      .mockResolvedValueOnce({
        rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
      })
      // memberships list for response
      .mockResolvedValueOnce({
        rows: [
          {
            org_id: DEFAULT_EVALUATOR_ORG_ID,
            role: "owner",
            org_name: "Organization A",
          },
        ],
      });

    const res = await meRoute(
      new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string };
      memberships: { org_id: string; role: string }[];
      provisioning: { alreadyMember: boolean };
    };
    expect(body.user.id).toBe(alice.id);
    expect(body.memberships[0]?.org_id).toBe(DEFAULT_EVALUATOR_ORG_ID);
    expect(body.provisioning.alreadyMember).toBe(true);
    // First query uses JWT subject, never a body user_id
    expect(query.mock.calls[0][1]).toEqual([alice.id]);
  });

  it("surfaces provisioning failure instead of empty success", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);

    query
      .mockResolvedValueOnce({ rows: [] }) // no memberships
      .mockRejectedValueOnce(new Error("db down")); // insert fails

    const res = await meRoute(
      new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message?: string };
    expect(body.message || "").toMatch(/provision/i);
  });
});
