import { afterEach, describe, expect, it, vi } from "vitest";
import { clearEnvCache } from "@/lib/env";

describe("resolveAuthMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearEnvCache();
    vi.resetModules();
  });

  it("keeps demo mode for local AUTH_MODE=demo without Nhost", async () => {
    vi.stubEnv("AUTH_MODE", "demo");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FORCE_NHOST_AUTH", "");
    clearEnvCache();
    const { resolveAuthMode } = await import("@/lib/auth/mode");
    const mode = resolveAuthMode();
    expect(mode.mode).toBe("demo");
    expect(mode.demoEnabled).toBe(true);
  });

  it("uses nhost when AUTH_MODE=nhost and subdomain/region are set", async () => {
    vi.stubEnv("AUTH_MODE", "nhost");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    vi.stubEnv("VERCEL_ENV", "");
    clearEnvCache();
    const { resolveAuthMode } = await import("@/lib/auth/mode");
    const mode = resolveAuthMode();
    expect(mode.mode).toBe("nhost");
    expect(mode.demoEnabled).toBe(false);
  });

  it("forces nhost in Vercel production when Nhost env is present even if AUTH_MODE=demo", async () => {
    vi.stubEnv("AUTH_MODE", "demo");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_DEMO_AUTH", "");
    // Mode unit test only — do not require full production secret matrix here.
    vi.stubEnv("ALLOW_LOCAL_ENV_DEFAULTS", "true");
    clearEnvCache();
    const { resolveAuthMode } = await import("@/lib/auth/mode");
    const mode = resolveAuthMode();
    expect(mode.mode).toBe("nhost");
    expect(mode.demoEnabled).toBe(false);
    expect(mode.productionNhostForced).toBe(true);
  });
});

