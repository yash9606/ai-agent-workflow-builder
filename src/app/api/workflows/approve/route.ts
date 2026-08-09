import { z } from "zod";
import { requireUserFromRequest } from "@/lib/auth/request-auth";
import { AppError, jsonError } from "@/lib/errors";
import { approvePausedStep } from "@/lib/workflows/approve-step";

export const runtime = "nodejs";

/**
 * Browser → Vercel approval (JWT only).
 * Avoids the Hasura `approveStep` Action, which is not present on production
 * mutation_root when Action metadata is inconsistent.
 */
const bodySchema = z.object({
  step_run_id: z.string().uuid(),
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
      throw new AppError("VALIDATION_ERROR", "step_run_id must be a UUID", 400);
    }

    const body = await approvePausedStep({
      userId: user.userId,
      stepRunId: parsed.data.step_run_id,
    });

    return Response.json(body);
  } catch (error) {
    return jsonError(error);
  }
}
