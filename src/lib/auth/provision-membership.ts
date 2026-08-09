import { query } from "@/lib/db";
import { AppError } from "@/lib/errors";

/** Seeded Organization A — default tenant for new Nhost evaluator accounts. */
export const DEFAULT_EVALUATOR_ORG_ID =
  "11111111-1111-1111-1111-111111111111";

export type ProvisionResult = {
  /** True when a new org_members row was inserted. */
  created: boolean;
  /** User already had at least one membership (any org). */
  alreadyMember: boolean;
  orgId: string | null;
  role: string | null;
};

/**
 * Ensure a verified authenticated user has at least one org_members row.
 * New users (zero memberships) receive Organization A as owner.
 * Existing memberships are never updated or duplicated.
 */
export async function ensureDefaultOrgMembership(
  userId: string
): Promise<ProvisionResult> {
  if (!userId || typeof userId !== "string") {
    throw new AppError("VALIDATION_ERROR", "Invalid user id", 400);
  }

  const existing = await query<{ org_id: string; role: string }>(
    `SELECT org_id, role
     FROM org_members
     WHERE user_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId]
  );

  if (existing.rows[0]) {
    return {
      created: false,
      alreadyMember: true,
      orgId: existing.rows[0].org_id,
      role: existing.rows[0].role,
    };
  }

  try {
    const inserted = await query<{ org_id: string; role: string }>(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, user_id) DO NOTHING
       RETURNING org_id, role`,
      [DEFAULT_EVALUATOR_ORG_ID, userId]
    );

    if (inserted.rows[0]) {
      return {
        created: true,
        alreadyMember: false,
        orgId: inserted.rows[0].org_id,
        role: inserted.rows[0].role,
      };
    }

    // Concurrent insert won the race — load the row without changing role.
    const raced = await query<{ org_id: string; role: string }>(
      `SELECT org_id, role
       FROM org_members
       WHERE user_id = $1 AND org_id = $2
       LIMIT 1`,
      [userId, DEFAULT_EVALUATOR_ORG_ID]
    );

    if (raced.rows[0]) {
      return {
        created: false,
        alreadyMember: true,
        orgId: raced.rows[0].org_id,
        role: raced.rows[0].role,
      };
    }

    throw new AppError(
      "INTERNAL_ERROR",
      "Could not provision organization membership. Organization A may be missing — contact the project owner.",
      503
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[provision] ensureDefaultOrgMembership failed:", error);
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not provision organization membership. Try again or contact the project owner.",
      503
    );
  }
}
