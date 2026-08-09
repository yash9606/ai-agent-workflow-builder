import { z } from "zod";
import { resolveAuthMode } from "@/lib/auth/mode";
import { AppError, jsonError } from "@/lib/errors";
import { nhostEmailPasswordSignup } from "@/lib/nhost/server-auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * Same-origin evaluator signup proxy.
 * Browser never calls Nhost Auth directly (avoids cross-origin "Failed to fetch").
 * Does not call membership provisioning unless Nhost returns an authenticated session.
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
        "Valid email and password (min 8 characters) are required",
        400
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const result = await nhostEmailPasswordSignup(
      email,
      parsed.data.password
    );

    if (result.kind === "needs_email_verification") {
      return Response.json({
        ok: true,
        needsEmailVerification: true,
        message: result.message,
      });
    }

    return Response.json({
      ok: true,
      needsEmailVerification: false,
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
