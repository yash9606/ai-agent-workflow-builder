import { z } from "zod";
import { requireUserFromRequest } from "@/lib/auth/request-auth";
import { AppError, jsonError } from "@/lib/errors";
import { createWorkflowForUser } from "@/lib/workflows/create-workflow";

export const runtime = "nodejs";

/**
 * Browser → Vercel workflow create (JWT only).
 *
 * Prefer this over browser→Hasura GraphQL so creation does not depend on
 * cross-origin GraphQL reachability. Authorization still uses org_members.
 * Never trusts a browser-supplied user_id.
 */
const bodySchema = z.object({
  // Seeded org ids are valid Postgres UUIDs but not always RFC variant bits;
  // Zod 4's uuid() rejects them — guid() accepts the hex form Hasura/Postgres use.
  org_id: z.guid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  active: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUserFromRequest(req);

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new AppError("VALIDATION_ERROR", "Invalid JSON body", 400);
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_ERROR",
        "org_id (uuid) and name are required",
        400
      );
    }

    // Ignore any client-supplied user_id / created_by — subject is JWT only.
    const workflow = await createWorkflowForUser({
      userId: user.userId,
      orgId: parsed.data.org_id,
      name: parsed.data.name,
      description: parsed.data.description,
      active: parsed.data.active,
    });

    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
