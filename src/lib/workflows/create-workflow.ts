import { requireMembership } from "@/lib/auth/org-access";
import { query } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Workflow } from "@/lib/types";

export type CreateWorkflowInput = {
  /** Verified JWT subject — never a browser-supplied user_id. */
  userId: string;
  orgId: string;
  name: string;
  description?: string;
  active?: boolean;
};

/**
 * Create a workflow for an authenticated org member (owner/editor).
 * Membership is enforced via org_members; created_by is the verified user id.
 */
export async function createWorkflowForUser(
  input: CreateWorkflowInput
): Promise<Workflow> {
  const name = input.name.trim();
  if (!name) {
    throw new AppError("VALIDATION_ERROR", "Workflow name is required", 400);
  }

  await requireMembership(input.userId, input.orgId, ["owner", "editor"]);

  const description = (input.description ?? "").trim();
  const active = input.active ?? true;

  let workflow: Workflow | undefined;
  try {
    const inserted = await query<Workflow>(
      `INSERT INTO workflows (org_id, name, description, active, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, org_id, name, description, active, created_by,
                 created_at::text, updated_at::text`,
      [input.orgId, name, description, active, input.userId]
    );
    workflow = inserted.rows[0];
  } catch (error) {
    console.error("[createWorkflow] insert failed:", error);
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not create workflow. Try again.",
      500
    );
  }

  if (!workflow) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not create workflow. Try again.",
      500
    );
  }

  // Convenience default — same best-effort behavior as the former UI path.
  try {
    await query(
      `INSERT INTO workflow_triggers (workflow_id, trigger_type, config, enabled)
       VALUES ($1, 'manual', '{}'::jsonb, true)`,
      [workflow.id]
    );
  } catch (error) {
    console.error(
      "[createWorkflow] manual trigger insert failed (non-fatal):",
      error
    );
  }

  return workflow;
}
