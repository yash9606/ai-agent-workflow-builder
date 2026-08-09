import { verifyHasuraJwt } from "@/lib/auth/jwt";
import {
  ensureDefaultOrgMembership,
  type ProvisionResult,
} from "@/lib/auth/provision-membership";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ACCOUNT_EXISTS_MESSAGE,
  EVALUATOR_VERIFY_EMAIL_MESSAGE,
} from "@/lib/nhost/auth-messages";

export {
  ACCOUNT_EXISTS_MESSAGE,
  EVALUATOR_VERIFY_EMAIL_MESSAGE,
  formatBrowserNetworkError,
} from "@/lib/nhost/auth-messages";

type NhostSessionUser = {
  id?: string;
  email?: string | null;
  displayName?: string | null;
};

type NhostSessionBody = {
  session?: {
    accessToken?: string;
    user?: NhostSessionUser;
  } | null;
  error?: string;
  message?: string;
};

export type AuthenticatedNhostLogin = {
  kind: "authenticated";
  accessToken: string;
  user: { id: string; email: string; displayName: string };
  provisioning: ProvisionResult;
};

export type SignupNeedsVerification = {
  kind: "needs_email_verification";
  message: string;
};

export type SignupResult = AuthenticatedNhostLogin | SignupNeedsVerification;

function nhostAuthBaseUrl(): string {
  const env = getEnv();
  const subdomain = env.NEXT_PUBLIC_NHOST_SUBDOMAIN?.trim();
  const region = env.NEXT_PUBLIC_NHOST_REGION?.trim();
  if (!subdomain || !region) {
    throw new AppError(
      "MISCONFIGURED",
      "Nhost is not configured (missing subdomain/region).",
      503
    );
  }
  return `https://${subdomain}.auth.${region}.nhost.run/v1`;
}

/** Map Nhost Auth error payloads to safe, actionable messages. */
export function mapNhostAuthError(
  status: number,
  body: NhostSessionBody | null,
  action: "signup" | "signin"
): AppError {
  const code = (body?.error || "").toLowerCase();
  const message = (body?.message || "").toLowerCase();

  if (
    status === 409 ||
    code.includes("email-already-in-use") ||
    message.includes("already in use") ||
    message.includes("already exists")
  ) {
    return new AppError("VALIDATION_ERROR", ACCOUNT_EXISTS_MESSAGE, 409);
  }

  if (
    status === 401 ||
    code.includes("invalid-email-password") ||
    message.includes("incorrect") ||
    message.includes("invalid email or password")
  ) {
    return new AppError(
      "UNAUTHORIZED",
      "Invalid email or password.",
      401
    );
  }

  if (
    code.includes("unverified") ||
    message.includes("email not verified") ||
    message.includes("verify your email")
  ) {
    return new AppError(
      "UNAUTHORIZED",
      "Please verify your email, then sign in.",
      401
    );
  }

  const safe =
    body?.message &&
    typeof body.message === "string" &&
    body.message.length < 200 &&
    !/token|bearer|jwt|secret/i.test(body.message)
      ? body.message
      : action === "signup"
        ? "Sign-up failed. Check your email and password and try again."
        : "Sign-in failed. Check your email and password and try again.";

  return new AppError(
    status >= 500 ? "EXTERNAL_ERROR" : "VALIDATION_ERROR",
    safe,
    status >= 400 && status < 600 ? status : 400
  );
}

async function callNhostAuth(
  path: "/signup/email-password" | "/signin/email-password",
  email: string,
  password: string
): Promise<{ status: number; body: NhostSessionBody }> {
  const url = `${nhostAuthBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message && error.message !== "Failed to fetch"
        ? error.message
        : "network error";
    throw new AppError(
      "EXTERNAL_ERROR",
      `Could not reach Nhost Auth (${detail}). Try again shortly.`,
      503
    );
  }

  let body: NhostSessionBody = {};
  try {
    body = (await res.json()) as NhostSessionBody;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/**
 * After Nhost returns a session: verify JWT server-side, provision membership
 * from the verified subject only, never from a browser-supplied user_id.
 */
export async function finalizeAuthenticatedNhostSession(
  accessToken: string,
  nhostUser?: NhostSessionUser | null
): Promise<AuthenticatedNhostLogin> {
  const claims = await verifyHasuraJwt(accessToken);

  if (nhostUser?.id && nhostUser.id !== claims.userId) {
    throw new AppError(
      "UNAUTHORIZED",
      "Token subject does not match Nhost user id",
      401
    );
  }

  const provisioning = await ensureDefaultOrgMembership(claims.userId);
  if (!provisioning.orgId) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Signed in, but organization membership could not be provisioned. Try again or contact the project owner.",
      503
    );
  }

  const email =
    claims.email ||
    nhostUser?.email ||
    "";
  const displayName =
    nhostUser?.displayName ||
    email ||
    "Nhost user";

  return {
    kind: "authenticated",
    accessToken,
    user: {
      id: claims.userId,
      email,
      displayName,
    },
    provisioning,
  };
}

export async function nhostEmailPasswordSignup(
  email: string,
  password: string
): Promise<SignupResult> {
  const { status, body } = await callNhostAuth(
    "/signup/email-password",
    email,
    password
  );

  if (!status || status < 200 || status >= 300) {
    throw mapNhostAuthError(status, body, "signup");
  }

  const accessToken = body.session?.accessToken;
  const user = body.session?.user;

  // Case B: Nhost accepted signup but requires email verification (often `{}`).
  if (!accessToken || !user?.id) {
    return {
      kind: "needs_email_verification",
      message: EVALUATOR_VERIFY_EMAIL_MESSAGE,
    };
  }

  // Case A: authenticated session returned — provision then hand token to client.
  return finalizeAuthenticatedNhostSession(accessToken, user);
}

export async function nhostEmailPasswordSignin(
  email: string,
  password: string
): Promise<AuthenticatedNhostLogin> {
  const { status, body } = await callNhostAuth(
    "/signin/email-password",
    email,
    password
  );

  if (!status || status < 200 || status >= 300) {
    throw mapNhostAuthError(status, body, "signin");
  }

  const accessToken = body.session?.accessToken;
  const user = body.session?.user;
  if (!accessToken || !user?.id) {
    throw new AppError(
      "UNAUTHORIZED",
      "Sign-in failed — no authenticated session was returned. If you just signed up, verify your email first.",
      401
    );
  }

  return finalizeAuthenticatedNhostSession(accessToken, user);
}
