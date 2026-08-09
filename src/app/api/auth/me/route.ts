import { extractBearerToken } from "@/lib/auth/request-auth";
import { verifyHasuraJwt } from "@/lib/auth/jwt";
import { ensureDefaultOrgMembership } from "@/lib/auth/provision-membership";
import { query } from "@/lib/db";
import { AppError, jsonError } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Returns identity from the verified JWT — never from the request body.
 * Also lists org memberships for that user_id (authorization source of truth).
 *
 * For Nhost evaluators with zero memberships, provisions Organization A as owner
 * using the verified JWT subject (idempotent; never overwrites existing roles).
 */
export async function GET(req: Request) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }

    const claims = await verifyHasuraJwt(token);

    const provision = await ensureDefaultOrgMembership(claims.userId);

    const memberships = await query<{
      org_id: string;
      role: string;
      org_name: string;
    }>(
      `SELECT m.org_id, m.role, o.name AS org_name
       FROM org_members m
       INNER JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1
       ORDER BY o.name ASC`,
      [claims.userId]
    );

    if (memberships.rows.length === 0) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Authenticated but no organization membership is available. Provisioning failed.",
        503
      );
    }

    return Response.json({
      user: {
        id: claims.userId,
        email: claims.email ?? null,
        defaultRole: claims.defaultRole,
      },
      memberships: memberships.rows,
      provisioning: {
        created: provision.created,
        alreadyMember: provision.alreadyMember,
        defaultOrgId: provision.orgId,
        role: provision.role,
      },
      /**
       * Hasura RLS and Actions resolve access via org_members.user_id =
       * JWT x-hasura-user-id (this id). Frontend persona/org selection cannot
       * change that binding.
       */
      authorization: {
        subjectClaim: "x-hasura-user-id",
        matchedVia: "org_members.user_id",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
