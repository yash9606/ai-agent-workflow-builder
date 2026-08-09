import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://postgres:postgres@localhost:5432/workflow_builder"),
  HASURA_GRAPHQL_URL: z.string().optional(),
  NEXT_PUBLIC_HASURA_GRAPHQL_URL: z
    .string()
    .default("http://localhost:8080/v1/graphql"),
  HASURA_ADMIN_SECRET: z.string().default("hasura-admin-secret"),
  HASURA_JWT_SECRET: z
    .string()
    .default("local-jwt-secret-at-least-32-characters-long!!"),
  LLM_PROVIDER: z
    .enum(["groq", "gemini", "openrouter", "stub"])
    .default("stub"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("llama-3.1-8b-instant"),
  // Required for Hasura → Action mutual auth (local defaults for compose)
  ACTION_SHARED_SECRET: z.string().default("local-action-secret"),
  WEBHOOK_HMAC_SECRET: z.string().default("demo-webhook-secret"),
  NOTIFY_WEBHOOK_URL: z.string().optional(),
  AUTH_MODE: z.enum(["nhost", "demo"]).default("demo"),
  NEXT_PUBLIC_NHOST_SUBDOMAIN: z.string().optional(),
  NEXT_PUBLIC_NHOST_REGION: z.string().optional(),
  /** Optional JWKS URL for Nhost/RS256 tokens (overrides HS256 secret verify). */
  NHOST_JWT_JWKS_URL: z.string().optional(),
  DEMO_AUTH_PASSWORD: z.string().default("demo-password"),
  CRON_SECRET: z.string().default("local-cron-secret"),
  HASURA_EVENT_SECRET: z.string().default("local-event-secret"),
  /** Explicitly keep demo login even when VERCEL_ENV=production (local only). */
  ALLOW_DEMO_AUTH: z.string().optional(),
  /** Force Nhost mode when subdomain/region are set. */
  FORCE_NHOST_AUTH: z.string().optional(),
});

export type ServerEnv = z.infer<typeof envSchema> & {
  hasuraGraphqlUrl: string;
  effectiveLlmProvider: "groq" | "gemini" | "openrouter" | "stub";
};

let cached: ServerEnv | null = null;

function parseJwtSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { key?: string };
      if (parsed.key) return parsed.key;
    } catch {
      // treat as plain secret string
    }
  }
  return trimmed;
}

export function clearEnvCache(): void {
  cached = null;
}

/** Vercel production (or FORCE_PRODUCTION_ENV) — refuse localhost secret defaults. */
function isDeployedProductionEnv(): boolean {
  if (process.env.ALLOW_LOCAL_ENV_DEFAULTS === "true") return false;
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.FORCE_PRODUCTION_ENV === "true"
  );
}

function looksLocal(url: string | undefined): boolean {
  if (!url) return true;
  return /localhost|127\.0\.0\.1/i.test(url);
}

/**
 * Fail fast in production if critical server URLs/secrets are missing or still local.
 * Local/dev continues to use documented compose defaults.
 */
export function assertProductionEnvSafety(): void {
  if (!isDeployedProductionEnv()) return;

  const problems: string[] = [];
  if (looksLocal(process.env.DATABASE_URL)) {
    problems.push("DATABASE_URL must be a non-localhost Postgres URL");
  }
  if (
    looksLocal(process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL) &&
    looksLocal(process.env.HASURA_GRAPHQL_URL)
  ) {
    problems.push(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL (or HASURA_GRAPHQL_URL) must be the production Hasura/Nhost GraphQL URL"
    );
  }
  if (!process.env.HASURA_JWT_SECRET?.trim()) {
    problems.push("HASURA_JWT_SECRET must be set to the Nhost/Hasura JWT key");
  }
  if (!process.env.ACTION_SHARED_SECRET?.trim()) {
    problems.push("ACTION_SHARED_SECRET must be set");
  }
  if (!process.env.HASURA_EVENT_SECRET?.trim()) {
    problems.push("HASURA_EVENT_SECRET must be set");
  }
  if (!process.env.CRON_SECRET?.trim()) {
    problems.push("CRON_SECRET must be set");
  }
  if (looksLocal(process.env.NEXT_PUBLIC_APP_URL)) {
    problems.push("NEXT_PUBLIC_APP_URL must be the public HTTPS app origin");
  }
  const wsExplicit = process.env.NEXT_PUBLIC_HASURA_WS_URL?.trim();
  if (wsExplicit) {
    if (!/^wss:\/\//i.test(wsExplicit) && !/^https:\/\//i.test(wsExplicit)) {
      problems.push(
        "NEXT_PUBLIC_HASURA_WS_URL must be wss:// (or https:// which is upgraded to wss://)"
      );
    }
    if (looksLocal(wsExplicit)) {
      problems.push("NEXT_PUBLIC_HASURA_WS_URL must not point at localhost");
    }
  } else if (
    process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL &&
    !/^https:\/\//i.test(process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL)
  ) {
    problems.push(
      "NEXT_PUBLIC_HASURA_GRAPHQL_URL must be https:// in production so subscriptions use wss://"
    );
  }
  if (
    !process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN?.trim() ||
    !process.env.NEXT_PUBLIC_NHOST_REGION?.trim()
  ) {
    problems.push(
      "NEXT_PUBLIC_NHOST_SUBDOMAIN and NEXT_PUBLIC_NHOST_REGION are required in production"
    );
  }

  if (problems.length) {
    throw new Error(
      `Production environment misconfigured:\n- ${problems.join("\n- ")}`
    );
  }
}

export function getEnv(): ServerEnv {
  if (cached) return cached;

  assertProductionEnvSafety();

  const parsed = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    HASURA_GRAPHQL_URL: process.env.HASURA_GRAPHQL_URL,
    NEXT_PUBLIC_HASURA_GRAPHQL_URL: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL,
    HASURA_ADMIN_SECRET: process.env.HASURA_ADMIN_SECRET,
    HASURA_JWT_SECRET: process.env.HASURA_JWT_SECRET,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY || undefined,
    LLM_MODEL: process.env.LLM_MODEL,
    ACTION_SHARED_SECRET: process.env.ACTION_SHARED_SECRET,
    WEBHOOK_HMAC_SECRET: process.env.WEBHOOK_HMAC_SECRET,
    NOTIFY_WEBHOOK_URL: process.env.NOTIFY_WEBHOOK_URL || undefined,
    AUTH_MODE: process.env.AUTH_MODE,
    NEXT_PUBLIC_NHOST_SUBDOMAIN: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN,
    NEXT_PUBLIC_NHOST_REGION: process.env.NEXT_PUBLIC_NHOST_REGION,
    NHOST_JWT_JWKS_URL: process.env.NHOST_JWT_JWKS_URL || undefined,
    DEMO_AUTH_PASSWORD: process.env.DEMO_AUTH_PASSWORD,
    CRON_SECRET: process.env.CRON_SECRET,
    HASURA_EVENT_SECRET: process.env.HASURA_EVENT_SECRET,
    ALLOW_DEMO_AUTH: process.env.ALLOW_DEMO_AUTH || undefined,
    FORCE_NHOST_AUTH: process.env.FORCE_NHOST_AUTH || undefined,
  });

  const hasuraGraphqlUrl =
    parsed.HASURA_GRAPHQL_URL || parsed.NEXT_PUBLIC_HASURA_GRAPHQL_URL;

  const effectiveLlmProvider =
    !parsed.LLM_API_KEY || parsed.LLM_PROVIDER === "stub"
      ? "stub"
      : parsed.LLM_PROVIDER;

  cached = {
    ...parsed,
    HASURA_JWT_SECRET: parseJwtSecret(parsed.HASURA_JWT_SECRET),
    hasuraGraphqlUrl,
    effectiveLlmProvider,
  };

  return cached;
}
