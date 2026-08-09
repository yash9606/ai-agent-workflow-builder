import { z } from "zod";
import { resolveAuthMode } from "@/lib/auth/mode";
import { signDemoJwt } from "@/lib/auth/jwt";
import { getEnv } from "@/lib/env";
import { AppError, jsonError } from "@/lib/errors";
import { DEMO_USERS } from "@/lib/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const mode = resolveAuthMode();
    if (!mode.demoEnabled) {
      throw new AppError(
        "AUTH_DISABLED",
        "Demo login is disabled. Use Nhost authentication in this environment.",
        403
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

    const env = getEnv();
    const email = parsed.data.email.trim().toLowerCase();

    if (parsed.data.password !== env.DEMO_AUTH_PASSWORD) {
      throw new AppError("UNAUTHORIZED", "Invalid demo credentials", 401);
    }

    const user = DEMO_USERS[email];
    if (!user) {
      throw new AppError(
        "UNAUTHORIZED",
        "Unknown demo user. Use alice@org-a.demo, bob@org-a.demo, etc.",
        401
      );
    }

    // JWT carries the seeded user UUID as x-hasura-user-id.
    // Hasura + Actions authorize via org_members.user_id = that claim.
    // Choosing a persona in the UI cannot override this after issuance.
    const accessToken = await signDemoJwt(user.id, user.email);

    return Response.json({
      accessToken,
      authProvider: "demo",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
