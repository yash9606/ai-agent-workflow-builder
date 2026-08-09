import { getEnv } from "@/lib/env";

export type AuthMode = "demo" | "nhost";

export interface AuthModeInfo {
  mode: AuthMode;
  demoEnabled: boolean;
  nhostConfigured: boolean;
  /** True when deployed production forces Nhost over demo. */
  productionNhostForced: boolean;
}

export function isNhostEnvConfigured(
  subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN,
  region = process.env.NEXT_PUBLIC_NHOST_REGION
): boolean {
  return Boolean(subdomain?.trim() && region?.trim());
}

/**
 * Deployed production (Vercel production / FORCE_NHOST_AUTH).
 * Local `next start` with AUTH_MODE=demo stays demo unless Nhost is forced.
 */
export function isDeployedProduction(): boolean {
  if (process.env.ALLOW_DEMO_AUTH === "true") return false;
  if (process.env.FORCE_NHOST_AUTH === "true") return true;
  return process.env.VERCEL_ENV === "production";
}

/**
 * Effective authentication mode.
 *
 * - Local / non-production: AUTH_MODE=demo keeps seeded-persona login.
 * - When Nhost env is configured AND (AUTH_MODE=nhost OR deployed production):
 *   Nhost Auth is required; demo personas are disabled.
 * - Backend authorization always uses the JWT's x-hasura-user-id / sub,
 *   never a frontend-selected persona id.
 */
export function resolveAuthMode(): AuthModeInfo {
  const env = getEnv();
  const nhostConfigured = isNhostEnvConfigured(
    env.NEXT_PUBLIC_NHOST_SUBDOMAIN,
    env.NEXT_PUBLIC_NHOST_REGION
  );
  const productionNhostForced =
    nhostConfigured && isDeployedProduction();

  const requested = env.AUTH_MODE;

  if (productionNhostForced || (requested === "nhost" && nhostConfigured)) {
    return {
      mode: "nhost",
      demoEnabled: false,
      nhostConfigured,
      productionNhostForced,
    };
  }

  if (requested === "demo") {
    return {
      mode: "demo",
      demoEnabled: true,
      nhostConfigured,
      productionNhostForced: false,
    };
  }

  // AUTH_MODE=nhost but missing env → fall back to demo only outside production force
  if (nhostConfigured) {
    return {
      mode: "nhost",
      demoEnabled: false,
      nhostConfigured,
      productionNhostForced,
    };
  }

  return {
    mode: "demo",
    demoEnabled: true,
    nhostConfigured: false,
    productionNhostForced: false,
  };
}

export function assertDemoAuthEnabled(): void {
  const info = resolveAuthMode();
  if (!info.demoEnabled) {
    throw new Error(
      "Demo authentication is disabled. Use Nhost Auth in this environment."
    );
  }
}
