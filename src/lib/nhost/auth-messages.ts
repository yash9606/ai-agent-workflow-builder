/** Shared safe copy for evaluator signup / sign-in UX (client + server). */

export const EVALUATOR_VERIFY_EMAIL_MESSAGE =
  "Account created. Please verify your email, then sign in.";

export const ACCOUNT_EXISTS_MESSAGE =
  "Account already exists. Please sign in.";

/** Safe client-facing copy when the browser cannot reach our same-origin API. */
export function formatBrowserNetworkError(
  err: unknown,
  fallback: string
): string {
  if (
    err instanceof TypeError ||
    (err instanceof Error && /failed to fetch/i.test(err.message))
  ) {
    return "Network error talking to this app. Check your connection and try again.";
  }
  if (err instanceof Error && err.message.trim()) {
    // Never echo tokens if somehow present in an Error message.
    if (
      /bearer\s+[a-z0-9._-]+/i.test(err.message) ||
      /eyJ[A-Za-z0-9_-]+\./.test(err.message)
    ) {
      return fallback;
    }
    return err.message;
  }
  return fallback;
}
