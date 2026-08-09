import { afterEach, describe, expect, it, vi } from "vitest";
import { clearEnvCache } from "@/lib/env";
import {
  requireUserFromRequest,
  resolveHasuraActionUser,
  safeEqualSecret,
  verifyHasuraActionSecret,
  verifyCronSecret,
  verifyEventSecret,
} from "@/lib/auth/request-auth";
import { signDemoJwt } from "@/lib/auth/jwt";
import { validateHttpUrl } from "@/lib/executor/http-step";
import { DEMO_USERS } from "@/lib/types";

function req(init: {
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe("auth hardening", () => {
  afterEach(() => {
    clearEnvCache();
    vi.unstubAllEnvs();
  });

  it("rejects session_variables spoofing without a matching JWT", async () => {
    vi.stubEnv("ACTION_SHARED_SECRET", "local-action-secret");
    clearEnvCache();
    const alice = DEMO_USERS["alice@org-a.demo"].id;
    await expect(
      requireUserFromRequest(req({}), {
        "x-hasura-user-id": alice,
      })
    ).rejects.toThrow(/Authentication required/i);
  });

  it("rejects Action session_variables fallback without verified action secret", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"].id;
    await expect(
      resolveHasuraActionUser(
        req({}),
        { "x-hasura-user-id": alice },
        { actionSecretVerified: false }
      )
    ).rejects.toThrow(/Authentication required/i);
  });

  it("allows Action session_variables only after action secret is verified", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"].id;
    const user = await resolveHasuraActionUser(
      req({}),
      {
        "x-hasura-user-id": alice,
        "x-hasura-default-role": "user",
        "x-hasura-allowed-roles": "user",
      },
      { actionSecretVerified: true }
    );
    expect(user.userId).toBe(alice);
  });

  it("rejects JWT / session_variables user mismatch", async () => {
    vi.stubEnv("ACTION_SHARED_SECRET", "local-action-secret");
    clearEnvCache();
    const alice = DEMO_USERS["alice@org-a.demo"];
    const david = DEMO_USERS["david@org-b.demo"];
    const token = await signDemoJwt(alice.id, alice.email);
    await expect(
      requireUserFromRequest(
        req({ headers: { Authorization: `Bearer ${token}` } }),
        { "x-hasura-user-id": david.id }
      )
    ).rejects.toThrow(/mismatch/i);
  });

  it("requires action secret header", () => {
    vi.stubEnv("ACTION_SHARED_SECRET", "local-action-secret");
    clearEnvCache();
    expect(() => verifyHasuraActionSecret(req({}))).toThrow(/action secret/i);
    expect(() =>
      verifyHasuraActionSecret(
        req({ headers: { "X-Hasura-Action-Secret": "wrong" } })
      )
    ).toThrow(/action secret/i);
    expect(() =>
      verifyHasuraActionSecret(
        req({ headers: { "X-Hasura-Action-Secret": "local-action-secret" } })
      )
    ).not.toThrow();
  });

  it("requires event and cron secrets", () => {
    vi.stubEnv("HASURA_EVENT_SECRET", "local-event-secret");
    vi.stubEnv("CRON_SECRET", "local-cron-secret");
    clearEnvCache();
    expect(() => verifyEventSecret(req({}))).toThrow(/event secret/i);
    expect(() => verifyCronSecret(req({}))).toThrow(/cron secret/i);
  });

  it("compares secrets in constant-time helper", () => {
    expect(safeEqualSecret("abc", "abc")).toBe(true);
    expect(safeEqualSecret("abc", "abd")).toBe(false);
    expect(safeEqualSecret("abc", "abcd")).toBe(false);
  });

  it("blocks private HTTP destinations used for SSRF", () => {
    expect(() => validateHttpUrl("http://127.0.0.1/")).toThrow(/private|localhost/i);
    expect(() => validateHttpUrl("http://169.254.169.254/latest")).toThrow(
      /private|localhost/i
    );
    expect(() => validateHttpUrl("http://192.168.0.1/")).toThrow(/private|localhost/i);
    expect(() => validateHttpUrl("https://example.com/ok")).not.toThrow();
  });
});
