import {
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
  importSPKI,
  type JWTPayload,
} from "jose";
import { getEnv, type ServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

const HASURA_CLAIMS = "https://hasura.io/jwt/claims";

export interface HasuraJwtClaims {
  userId: string;
  defaultRole: string;
  allowedRoles: string[];
  email?: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().HASURA_JWT_SECRET);
}

/** Nhost dashboard env vars often store PEM with literal `\n`. */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim();
}

/**
 * Resolve JWKS URL for Nhost RS256 projects.
 * Explicit `NHOST_JWT_JWKS_URL` wins; otherwise derive from subdomain/region
 * when Nhost auth is the active path (not local demo HS256).
 */
export function resolveNhostJwksUrl(env: ServerEnv = getEnv()): string | null {
  const explicit = env.NHOST_JWT_JWKS_URL?.trim();
  if (explicit) return explicit;

  const subdomain = env.NEXT_PUBLIC_NHOST_SUBDOMAIN?.trim();
  const region = env.NEXT_PUBLIC_NHOST_REGION?.trim();
  if (!subdomain || !region) return null;

  const nhostActive =
    env.AUTH_MODE === "nhost" ||
    process.env.FORCE_NHOST_AUTH === "true" ||
    (process.env.VERCEL_ENV === "production" &&
      process.env.ALLOW_DEMO_AUTH !== "true");

  if (!nhostActive) return null;

  // Nhost Auth OpenAPI: GET /v1/.well-known/jwks.json
  return `https://${subdomain}.auth.${region}.nhost.run/v1/.well-known/jwks.json`;
}

function extractClaims(payload: JWTPayload): HasuraJwtClaims {
  const claims = payload[HASURA_CLAIMS] as
    | Record<string, string | string[] | undefined>
    | undefined;

  const userId =
    (claims?.["x-hasura-user-id"] as string | undefined) ||
    (typeof payload.sub === "string" ? payload.sub : undefined);

  if (!userId) {
    throw new AppError("UNAUTHORIZED", "Invalid token: missing user id", 401);
  }

  const defaultRole =
    (claims?.["x-hasura-default-role"] as string | undefined) || "user";
  const allowedRolesRaw = claims?.["x-hasura-allowed-roles"];
  const allowedRoles = Array.isArray(allowedRolesRaw)
    ? allowedRolesRaw.map(String)
    : [defaultRole];

  return {
    userId,
    defaultRole,
    allowedRoles,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

/**
 * Verify an access token for Hasura / Actions.
 *
 * Preference order (Nhost RS256 production first when configured):
 * 1. Nhost JWKS (`NHOST_JWT_JWKS_URL` or auto from subdomain/region)
 * 2. `NHOST_JWT_PUBLIC_KEY` (PEM / SPKI)
 * 3. HS256 `HASURA_JWT_SECRET` (local demo / symmetric Nhost)
 */
export async function verifyHasuraJwt(token: string): Promise<HasuraJwtClaims> {
  try {
    const env = getEnv();
    const jwksUrl = resolveNhostJwksUrl(env);

    if (jwksUrl) {
      const jwks = createRemoteJWKSet(new URL(jwksUrl));
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256", "RS384", "RS512"],
      });
      return extractClaims(payload);
    }

    const publicKeyPem = env.NHOST_JWT_PUBLIC_KEY?.trim();
    if (publicKeyPem) {
      const key = await importSPKI(normalizePem(publicKeyPem), "RS256");
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["RS256", "RS384", "RS512"],
      });
      return extractClaims(payload);
    }

    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    return extractClaims(payload);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNAUTHORIZED", "Invalid or expired token", 401);
  }
}

export async function signDemoJwt(
  userId: string,
  email: string
): Promise<string> {
  return new SignJWT({
    sub: userId,
    email,
    [HASURA_CLAIMS]: {
      "x-hasura-default-role": "user",
      "x-hasura-allowed-roles": ["user"],
      "x-hasura-user-id": userId,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey());
}
