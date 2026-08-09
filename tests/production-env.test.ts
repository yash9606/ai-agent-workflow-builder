import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionEnvSafety, clearEnvCache } from "@/lib/env";

describe("assertProductionEnvSafety", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearEnvCache();
  });

  it("does nothing outside deployed production", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("FORCE_PRODUCTION_ENV", "");
    expect(() => assertProductionEnvSafety()).not.toThrow();
  });

  it("rejects localhost DATABASE_URL in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_ENV_DEFAULTS", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL",
      "https://xxx.hasura.app/v1/graphql"
    );
    vi.stubEnv("HASURA_JWT_SECRET", "prod-secret");
    vi.stubEnv("ACTION_SHARED_SECRET", "a");
    vi.stubEnv("HASURA_EVENT_SECRET", "b");
    vi.stubEnv("CRON_SECRET", "c");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    expect(() => assertProductionEnvSafety()).toThrow(/DATABASE_URL/);
  });

  it("accepts fully configured production env", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_ENV_DEFAULTS", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/db");
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL",
      "https://xxx.hasura.app/v1/graphql"
    );
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_WS_URL",
      "wss://xxx.hasura.app/v1/graphql"
    );
    vi.stubEnv("HASURA_JWT_SECRET", "prod-secret");
    vi.stubEnv("ACTION_SHARED_SECRET", "a");
    vi.stubEnv("HASURA_EVENT_SECRET", "b");
    vi.stubEnv("CRON_SECRET", "c");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    expect(() => assertProductionEnvSafety()).not.toThrow();
  });

  it("rejects non-wss explicit WS URL in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_ENV_DEFAULTS", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/db");
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL",
      "https://xxx.hasura.app/v1/graphql"
    );
    vi.stubEnv("NEXT_PUBLIC_HASURA_WS_URL", "ws://xxx.hasura.app/v1/graphql");
    vi.stubEnv("HASURA_JWT_SECRET", "prod-secret");
    vi.stubEnv("ACTION_SHARED_SECRET", "a");
    vi.stubEnv("HASURA_EVENT_SECRET", "b");
    vi.stubEnv("CRON_SECRET", "c");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    expect(() => assertProductionEnvSafety()).toThrow(/HASURA_WS_URL/);
  });

  it("accepts RS256 production without HASURA_JWT_SECRET when subdomain/region set", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_ENV_DEFAULTS", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.example.com:5432/db");
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL",
      "https://xxx.hasura.app/v1/graphql"
    );
    vi.stubEnv("HASURA_JWT_SECRET", "");
    vi.stubEnv("NHOST_JWT_JWKS_URL", "");
    vi.stubEnv("ACTION_SHARED_SECRET", "a");
    vi.stubEnv("HASURA_EVENT_SECRET", "b");
    vi.stubEnv("CRON_SECRET", "c");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_NHOST_SUBDOMAIN", "myapp");
    vi.stubEnv("NEXT_PUBLIC_NHOST_REGION", "eu-central-1");
    expect(() => assertProductionEnvSafety()).not.toThrow();
  });
});

