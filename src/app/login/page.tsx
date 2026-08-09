"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AppProviders";
import { DEMO_PERSONAS, type DemoPersona } from "@/lib/auth/session";
import {
  ACCOUNT_EXISTS_MESSAGE,
  EVALUATOR_VERIFY_EMAIL_MESSAGE,
  formatBrowserNetworkError,
} from "@/lib/nhost/auth-messages";

type AuthModeResponse = {
  mode: "demo" | "nhost";
  demoEnabled: boolean;
  nhostConfigured: boolean;
  productionNhostForced: boolean;
};

type NhostAuthJson = {
  ok?: boolean;
  needsEmailVerification?: boolean;
  accessToken?: string;
  message?: string;
  user?: { id: string; email: string; displayName: string };
};

export default function LoginPage() {
  const { session, ready, login } = useAuth();
  const router = useRouter();
  const [modeInfo, setModeInfo] = useState<AuthModeResponse | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [nhostEmail, setNhostEmail] = useState("");
  const [nhostPassword, setNhostPassword] = useState("");
  const [nhostBusy, setNhostBusy] = useState(false);
  const [nhostMode, setNhostMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    void fetch("/api/auth/mode")
      .then((r) => r.json())
      .then((json: AuthModeResponse) => setModeInfo(json))
      .catch(() =>
        setModeInfo({
          mode: "demo",
          demoEnabled: true,
          nhostConfigured: false,
          productionNhostForced: false,
        })
      );
  }, []);

  useEffect(() => {
    if (ready && session) {
      router.replace("/dashboard");
    }
  }, [ready, session, router]);

  async function handleDemoLogin(persona: DemoPersona) {
    if (!modeInfo?.demoEnabled) {
      setError("Demo personas are disabled in this environment.");
      return;
    }
    setBusyEmail(persona.email);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: persona.email,
          password: "demo-password",
        }),
      });
      const json = (await res.json()) as {
        accessToken?: string;
        user?: { id: string; email: string; displayName: string };
        message?: string;
      };

      if (!res.ok || !json.accessToken || !json.user) {
        throw new Error(json.message || "Demo login failed");
      }

      // Identity in jwt.user.id comes from the server-signed JWT claims,
      // not from the button label. Backend auth ignores persona names.
      login({
        accessToken: json.accessToken,
        user: json.user,
        authProvider: "demo",
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(formatBrowserNetworkError(err, "Demo login failed"));
    } finally {
      setBusyEmail(null);
    }
  }

  async function handleNhostAuth(e: React.FormEvent) {
    e.preventDefault();
    if (modeInfo && modeInfo.mode !== "nhost" && !modeInfo.nhostConfigured) {
      setError("Nhost is not configured.");
      return;
    }
    setNhostBusy(true);
    setError(null);
    setInfo(null);
    try {
      // Same-origin proxy — avoids browser→Nhost cross-origin "Failed to fetch".
      const endpoint =
        nhostMode === "signup"
          ? "/api/auth/nhost/signup"
          : "/api/auth/nhost/signin";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: nhostEmail.trim(),
          password: nhostPassword,
        }),
      });

      let json: NhostAuthJson = {};
      try {
        json = (await res.json()) as NhostAuthJson;
      } catch {
        json = {};
      }

      // Case B: signup OK, email verification required — do not treat as auth.
      if (
        nhostMode === "signup" &&
        res.ok &&
        json.needsEmailVerification
      ) {
        setInfo(json.message || EVALUATOR_VERIFY_EMAIL_MESSAGE);
        setNhostMode("signin");
        return;
      }

      if (!res.ok) {
        if (res.status === 409) {
          setError(json.message || ACCOUNT_EXISTS_MESSAGE);
          setNhostMode("signin");
          return;
        }
        if (res.status === 503) {
          setError(
            json.message ||
              "Signed in, but organization membership could not be provisioned. Try again or contact the project owner."
          );
          return;
        }
        if (res.status === 401) {
          setError(json.message || "Invalid email or password.");
          return;
        }
        setError(
          json.message ||
            (nhostMode === "signup"
              ? "Nhost sign-up failed"
              : "Nhost sign-in failed")
        );
        return;
      }

      if (!json.accessToken || !json.user?.id) {
        setError(
          nhostMode === "signup"
            ? EVALUATOR_VERIFY_EMAIL_MESSAGE
            : "Sign-in failed — no authenticated session was returned."
        );
        if (nhostMode === "signup") {
          setInfo(EVALUATOR_VERIFY_EMAIL_MESSAGE);
          setError(null);
          setNhostMode("signin");
        }
        return;
      }

      // Server already verified JWT + provisioned membership (when needed).
      login({
        accessToken: json.accessToken,
        authProvider: "nhost",
        user: {
          id: json.user.id,
          email: json.user.email || nhostEmail,
          displayName:
            json.user.displayName || json.user.email || nhostEmail || "Nhost user",
        },
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(
        formatBrowserNetworkError(
          err,
          nhostMode === "signup" ? "Nhost sign-up failed" : "Nhost login failed"
        )
      );
    } finally {
      setNhostBusy(false);
    }
  }

  const showDemo = modeInfo?.demoEnabled === true;
  const showNhost =
    modeInfo?.mode === "nhost" || modeInfo?.nhostConfigured === true;

  return (
    <div className="login-page">
      <div className="login-card">
        <p className="eyebrow">AI Agent Workflow Builder</p>
        <h1>Sign in</h1>
        <p className="muted">
          Authorization always uses the JWT <code>x-hasura-user-id</code> matched
          to <code>org_members.user_id</code>. The UI cannot pick another user&apos;s
          identity.
        </p>

        {modeInfo ? (
          <p className="note">
            Active mode: <strong>{modeInfo.mode}</strong>
            {modeInfo.productionNhostForced
              ? " (production forces Nhost)"
              : null}
          </p>
        ) : (
          <p className="muted">Resolving auth mode…</p>
        )}

        {error ? <div className="alert alert-error">{error}</div> : null}
        {info ? <div className="alert alert-success">{info}</div> : null}

        {showDemo ? (
          <>
            <h2 className="section-title">Local demo personas</h2>
            <p className="muted">
              Development only (<code>AUTH_MODE=demo</code>). Each button mints a
              server-signed JWT for that seed user — not a client-side role switch.
            </p>
            <div className="login-grid">
              {DEMO_PERSONAS.map((persona) => (
                <button
                  key={persona.email}
                  type="button"
                  className="persona-btn"
                  disabled={busyEmail !== null}
                  onClick={() => void handleDemoLogin(persona)}
                >
                  <strong>
                    {persona.displayName}
                    {busyEmail === persona.email ? "…" : ""}
                  </strong>
                  <small>
                    {persona.role} · {persona.orgLabel}
                  </small>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {showNhost ? (
          <form
            className="nhost-form"
            onSubmit={(e) => void handleNhostAuth(e)}
          >
            <h2 className="section-title">Nhost email / password</h2>
            <p className="muted">
              Production path: create an account or sign in. After Nhost issues a
              JWT, the server verifies it and provisions Organization A membership
              (role <code>owner</code>) on first authenticated session only.
            </p>
            <div className="login-grid" style={{ marginBottom: "0.75rem" }}>
              <button
                type="button"
                className={
                  nhostMode === "signin" ? "btn btn-primary" : "btn btn-ghost"
                }
                onClick={() => {
                  setNhostMode("signin");
                  setError(null);
                }}
                disabled={nhostBusy}
              >
                Sign in
              </button>
              <button
                type="button"
                className={
                  nhostMode === "signup" ? "btn btn-primary" : "btn btn-ghost"
                }
                onClick={() => {
                  setNhostMode("signup");
                  setError(null);
                }}
                disabled={nhostBusy}
              >
                Sign up
              </button>
            </div>
            <label>
              Email
              <input
                type="email"
                value={nhostEmail}
                onChange={(e) => setNhostEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={nhostPassword}
                onChange={(e) => setNhostPassword(e.target.value)}
                required
                minLength={nhostMode === "signup" ? 8 : 1}
                autoComplete={
                  nhostMode === "signup" ? "new-password" : "current-password"
                }
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={nhostBusy}
            >
              {nhostBusy
                ? nhostMode === "signup"
                  ? "Creating account…"
                  : "Signing in…"
                : nhostMode === "signup"
                  ? "Create evaluator account"
                  : "Sign in with Nhost"}
            </button>
          </form>
        ) : null}

        {!showDemo && !showNhost && modeInfo ? (
          <div className="alert alert-error">
            No authentication method available. Set <code>AUTH_MODE=demo</code>{" "}
            for local development, or configure{" "}
            <code>NEXT_PUBLIC_NHOST_SUBDOMAIN</code> /{" "}
            <code>NEXT_PUBLIC_NHOST_REGION</code> with <code>AUTH_MODE=nhost</code>.
          </div>
        ) : null}
      </div>
    </div>
  );
}
