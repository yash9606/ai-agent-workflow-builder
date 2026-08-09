import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizePem,
  resolveNhostJwksUrl,
  signDemoJwt,
  verifyHasuraJwt,
} from "@/lib/auth/jwt";
import { clearEnvCache, getEnv } from "@/lib/env";
import { DEMO_USERS } from "@/lib/types";

describe("demo JWT (HS256)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearEnvCache();
  });

  it("signs and verifies Hasura claims with user id", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);
    const claims = await verifyHasuraJwt(token);
    expect(claims.userId).toBe(alice.id);
    expect(claims.defaultRole).toBe("user");
  });

  it("rejects a tampered token", async () => {
    const alice = DEMO_USERS["alice@org-a.demo"];
    const token = await signDemoJwt(alice.id, alice.email);
    const bad = `${token.slice(0, -4)}xxxx`;
    await expect(verifyHasuraJwt(bad)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("Nhost JWKS resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearEnvCache();
  });

  it("uses explicit NHOST_JWT_JWKS_URL", () => {
    vi.stubEnv(
      "NHOST_JWT_JWKS_URL",
      "https://example.auth.eu-central-1.nhost.run/v1/.well-known/jwks.json"
    );
    clearEnvCache();
    expect(resolveNhostJwksUrl(getEnv())).toBe(
      "https://example.auth.eu-central-1.nhost.run/v1/.well-known/jwks.json"
    );
  });

  it("auto-derives JWKS in nhost mode from subdomain/region", () => {
    vi.stubEnv("NHOST_JWT_JWKS_URL", "");
    vi.stubEnv("AUTH_MODE", "nhost");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "bfwuoawsybivkgdvkyah");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "ap-south-1");
    clearEnvCache();
    expect(resolveNhostJwksUrl(getEnv())).toBe(
      "https://bfwuoawsybivkgdvkyah.auth.ap-south-1.nhost.run/v1/.well-known/jwks.json"
    );
  });

  it("does not auto-derive JWKS in local demo mode", () => {
    vi.stubEnv("NHOST_JWT_JWKS_URL", "");
    vi.stubEnv("AUTH_MODE", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FORCE_NHOST_AUTH", "");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "bfwuoawsybivkgdvkyah");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "ap-south-1");
    clearEnvCache();
    expect(resolveNhostJwksUrl(getEnv())).toBeNull();
  });

  it("normalizes escaped PEM newlines", () => {
    expect(normalizePem("-----BEGIN PUBLIC KEY-----\\nABC\\n-----END PUBLIC KEY-----")).toBe(
      "-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----"
    );
  });
});
