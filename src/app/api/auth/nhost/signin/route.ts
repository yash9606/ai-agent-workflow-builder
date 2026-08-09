import { z } from "zod";
import { resolveAuthMode } from "@/lib/auth/mode";
import { AppError, jsonError } from "@/lib/errors";
import { nhostEmailPasswordSignin } from "@/lib/nhost/server-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Same-origin evaluator sign-in proxy.
 * Verifies JWT + provisions Organization A membership when the user has none.
 */
export async function POST(req: Request) {
  try {
    const mode = resolveAuthMode();
    if (!mode.nhostConfigured) {
      throw new AppError(
        "MISCONFIGURED",
        "Nhost is not configured in this environment.",
        503
      );
    }

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
        "email and password are required",
        400
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const result = await nhostEmailPasswordSignin(
      email,
      parsed.data.password
    );

    return Response.json({
      ok: true,
      accessToken: result.accessToken,
      authProvider: "nhost",
      user: result.user,
      provisioning: {
        created: result.provisioning.created,
        alreadyMember: result.provisioning.alreadyMember,
        defaultOrgId: result.provisioning.orgId,
        role: result.provisioning.role,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
