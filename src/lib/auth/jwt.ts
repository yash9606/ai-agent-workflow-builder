import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { getEnv } from "@/lib/env";
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
 * - Local demo + typical Nhost HS256: HASURA_JWT_SECRET
 * - Optional NHOST_JWT_JWKS_URL for RS256/JWKS projects
 */
export async function verifyHasuraJwt(token: string): Promise<HasuraJwtClaims> {
  try {
    const env = getEnv();
    if (env.NHOST_JWT_JWKS_URL) {
      const jwks = createRemoteJWKSet(new URL(env.NHOST_JWT_JWKS_URL));
      const { payload } = await jwtVerify(token, jwks);
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
