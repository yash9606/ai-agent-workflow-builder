import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import { clearEnvCache } from "@/lib/env";
import { signDemoJwt } from "@/lib/auth/jwt";
import { DEFAULT_EVALUATOR_ORG_ID } from "@/lib/auth/provision-membership";
import { DEMO_USERS } from "@/lib/types";
import {
  ACCOUNT_EXISTS_MESSAGE,
  EVALUATOR_VERIFY_EMAIL_MESSAGE,
  formatBrowserNetworkError,
  mapNhostAuthError,
  nhostEmailPasswordSignin,
  nhostEmailPasswordSignup,
} from "@/lib/nhost/server-auth";
import { POST as signupRoute } from "@/app/api/auth/nhost/signup/route";
import { POST as signinRoute } from "@/app/api/auth/nhost/signin/route";

function stubNhostEnv() {
  vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "testsub");
  vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
  vi.stubEnv("HASURA_JWT_SECRET", "test-jwt-secret-at-least-32-chars-long!!");
  vi.stubEnv("DATABASE_URL", "postgres://local/test");
  clearEnvCache();
}

describe("mapNhostAuthError / browser network copy", () => {
  it("maps email-already-in-use to a sign-in hint", () => {
    const err = mapNhostAuthError(
      409,
      { error: "email-already-in-use", message: "Email already in use" },
      "signup"
    );
    expect(err.status).toBe(409);
    expect(err.publicMessage).toBe(ACCOUNT_EXISTS_MESSAGE);
  });

  it("rewrites Failed to fetch for the UI", () => {
    expect(
      formatBrowserNetworkError(new TypeError("Failed to fetch"), "fallback")
    ).toMatch(/Network error talking to this app/i);
  });
});

describe("nhostEmailPasswordSignup", () => {
  afterEach(() => {
    query.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearEnvCache();
  });

  it("Case B: signup with empty session does not provision membership", async () => {
    stubNhostEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await nhostEmailPasswordSignup(
      "eval@example.com",
      "password123"
    );

    expect(result.kind).toBe("needs_email_verification");
    if (result.kind === "needs_email_verification") {
      expect(result.message).toBe(EVALUATOR_VERIFY_EMAIL_MESSAGE);
    }
    expect(query).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://testsub.auth.eu-central-1.nhost.run/v1/signup/email-password",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("Case C: email already in use", async () => {
    stubNhostEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "email-already-in-use",
            message: "Email already in use",
          }),
          { status: 409 }
        )
      )
    );

    await expect(
      nhostEmailPasswordSignup("eval@example.com", "password123")
    ).rejects.toMatchObject({
      status: 409,
      publicMessage: ACCOUNT_EXISTS_MESSAGE,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("Case A: session returned → verify JWT subject and provision", async () => {
    stubNhostEnv();
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: {
              accessToken: token,
              user: {
                id: alice.id,
                email: alice.email,
                displayName: "Alice",
              },
            },
          }),
          { status: 200 }
        )
      )
    );

    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
      });

    const result = await nhostEmailPasswordSignup(
      alice.email,
      "password123"
    );

    expect(result.kind).toBe("authenticated");
    if (result.kind === "authenticated") {
      expect(result.user.id).toBe(alice.id);
      expect(result.provisioning.created).toBe(true);
      expect(result.accessToken).toBe(token);
    }
    expect(query.mock.calls[1][1]).toEqual([
      DEFAULT_EVALUATOR_ORG_ID,
      alice.id,
    ]);
  });

  it("Case D: network failure to Nhost becomes a clear 503", async () => {
    stubNhostEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(
      nhostEmailPasswordSignup("eval@example.com", "password123")
    ).rejects.toMatchObject({
      status: 503,
      publicMessage: expect.stringMatching(/Could not reach Nhost Auth/i),
    });
  });
});

describe("nhostEmailPasswordSignin", () => {
  afterEach(() => {
    query.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearEnvCache();
  });

  it("provisions for new members and preserves existing memberships", async () => {
    stubNhostEnv();
    const bob = DEMO_USERS["bob@org-a.demo"];
    const token = await signDemoJwt(bob.id, bob.email);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: {
              accessToken: token,
              user: { id: bob.id, email: bob.email, displayName: "Bob" },
            },
          }),
          { status: 200 }
        )
      )
    );

    query.mockResolvedValueOnce({
      rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "editor" }],
    });

    const result = await nhostEmailPasswordSignin(bob.email, "password123");
    expect(result.provisioning.alreadyMember).toBe(true);
    expect(result.provisioning.role).toBe("editor");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated sign-in without a session", async () => {
    stubNhostEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    );

    await expect(
      nhostEmailPasswordSignin("eval@example.com", "password123")
    ).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/nhost/signup|signin routes", () => {
  afterEach(() => {
    query.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearEnvCache();
  });

  it("signup route returns needsEmailVerification without accessToken", async () => {
    stubNhostEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    );

    const res = await signupRoute(
      new Request("http://localhost/api/auth/nhost/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          password: "password123",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      needsEmailVerification?: boolean;
      accessToken?: string;
      message?: string;
    };
    expect(body.needsEmailVerification).toBe(true);
    expect(body.accessToken).toBeUndefined();
    expect(body.message).toBe(EVALUATOR_VERIFY_EMAIL_MESSAGE);
    expect(query).not.toHaveBeenCalled();
  });

  it("signup route surfaces account-exists without provisioning", async () => {
    stubNhostEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "email-already-in-use",
            message: "Email already in use",
          }),
          { status: 409 }
        )
      )
    );

    const res = await signupRoute(
      new Request("http://localhost/api/auth/nhost/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dup@example.com",
          password: "password123",
        }),
      })
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe(ACCOUNT_EXISTS_MESSAGE);
    expect(query).not.toHaveBeenCalled();
  });

  it("signin route returns 503 when provisioning fails", async () => {
    stubNhostEnv();
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: {
              accessToken: token,
              user: { id: alice.id, email: alice.email },
            },
          }),
          { status: 200 }
        )
      )
    );

    query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("db down"));

    const res = await signinRoute(
      new Request("http://localhost/api/auth/nhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: alice.email,
          password: "password123",
        }),
      })
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { message?: string };
    expect(body.message || "").toMatch(/provision/i);
  });

  it("does not accept a browser-supplied user_id for provisioning", async () => {
    stubNhostEnv();
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);
    const spoofed = "99999999-9999-4999-8999-999999999999";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: {
              accessToken: token,
              user: { id: alice.id, email: alice.email },
            },
          }),
          { status: 200 }
        )
      )
    );

    query.mockResolvedValueOnce({
      rows: [{ org_id: DEFAULT_EVALUATOR_ORG_ID, role: "owner" }],
    });

    const res = await signinRoute(
      new Request("http://localhost/api/auth/nhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: alice.email,
          password: "password123",
          user_id: spoofed,
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(alice.id);
    expect(query.mock.calls[0][1]).toEqual([alice.id]);
    expect(JSON.stringify(query.mock.calls)).not.toContain(spoofed);
  });
});
