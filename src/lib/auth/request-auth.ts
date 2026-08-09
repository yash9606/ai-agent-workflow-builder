import { timingSafeEqual } from "node:crypto";
import { verifyHasuraJwt, type HasuraJwtClaims } from "@/lib/auth/jwt";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { HasuraActionPayload } from "@/lib/types";

export function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Constant-time string compare for secrets (length mismatch → false). */
export function safeEqualSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still perform a compare to reduce trivial timing branches on length.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

function headerSecret(
  req: Request,
  names: string[]
): string | null {
  for (const name of names) {
    const value = req.headers.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * Hasura → Action mutual auth.
 * ACTION_SHARED_SECRET is required (set in .env / docker-compose).
 */
export function verifyHasuraActionSecret(req: Request): void {
  const env = getEnv();
  const expected = env.ACTION_SHARED_SECRET;
  if (!expected) {
    throw new AppError(
      "MISCONFIGURED",
      "ACTION_SHARED_SECRET is not configured",
      500
    );
  }

  const provided = headerSecret(req, [
    "x-hasura-action-secret",
    "X-Hasura-Action-Secret",
  ]);

  if (!provided || !safeEqualSecret(provided, expected)) {
    throw new AppError("UNAUTHORIZED", "Invalid action secret", 401);
  }
}

/**
 * Authenticated user for Actions.
 * ALWAYS verifies Bearer JWT. Never trusts session_variables alone.
 * If session_variables include x-hasura-user-id, it must match the JWT subject.
 */
export async function requireUserFromRequest(
  req: Request,
  sessionVariables?: Record<string, string | undefined>
): Promise<HasuraJwtClaims> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AppError("UNAUTHORIZED", "Authentication required", 401);
  }

  const user = await verifyHasuraJwt(token);

  const sessionUserId =
    sessionVariables?.["x-hasura-user-id"] ||
    sessionVariables?.["X-Hasura-User-Id"];

  if (sessionUserId && sessionUserId !== user.userId) {
    throw new AppError("UNAUTHORIZED", "Session user mismatch", 401);
  }

  return user;
}

export async function parseHasuraAction<TInput>(
  req: Request,
  options?: { requireActionSecret?: boolean }
): Promise<{ payload: HasuraActionPayload<TInput>; user: HasuraJwtClaims }> {
  const requireSecret = options?.requireActionSecret !== false;
  if (requireSecret) {
    verifyHasuraActionSecret(req);
  }

  let payload: HasuraActionPayload<TInput>;
  try {
    payload = (await req.json()) as HasuraActionPayload<TInput>;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const user = await requireUserFromRequest(req, payload.session_variables);
  return { payload, user };
}

/**
 * Hasura Event Trigger auth. HASURA_EVENT_SECRET (or ACTION_SHARED_SECRET) required.
 */
export function verifyEventSecret(req: Request): void {
  const env = getEnv();
  const expected = env.HASURA_EVENT_SECRET || env.ACTION_SHARED_SECRET;
  if (!expected) {
    throw new AppError(
      "MISCONFIGURED",
      "HASURA_EVENT_SECRET is not configured",
      500
    );
  }

  const provided = headerSecret(req, [
    "x-hasura-event-secret",
    "X-Hasura-Event-Secret",
    "x-hasura-action-secret",
    "X-Hasura-Action-Secret",
  ]);

  if (!provided || !safeEqualSecret(provided, expected)) {
    throw new AppError("UNAUTHORIZED", "Invalid event secret", 401);
  }
}

/** Cron tick auth — CRON_SECRET required. */
export function verifyCronSecret(req: Request): void {
  const env = getEnv();
  const expected = env.CRON_SECRET;
  if (!expected) {
    throw new AppError(
      "MISCONFIGURED",
      "CRON_SECRET is not configured",
      500
    );
  }

  const provided =
    headerSecret(req, ["x-cron-secret", "X-Cron-Secret"]) ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;

  if (!provided || !safeEqualSecret(provided, expected)) {
    throw new AppError("UNAUTHORIZED", "Invalid cron secret", 401);
  }
}
