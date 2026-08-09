"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AppProviders";
import { DEMO_PERSONAS, type DemoPersona } from "@/lib/auth/session";
import { getNhostClient } from "@/lib/nhost/client";

type AuthModeResponse = {
  mode: "demo" | "nhost";
  demoEnabled: boolean;
  nhostConfigured: boolean;
  productionNhostForced: boolean;
};

export default function LoginPage() {
  const { session, ready, login } = useAuth();
  const router = useRouter();
  const [modeInfo, setModeInfo] = useState<AuthModeResponse | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nhostEmail, setNhostEmail] = useState("");
  const [nhostPassword, setNhostPassword] = useState("");
  const [nhostBusy, setNhostBusy] = useState(false);

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
      setError(err instanceof Error ? err.message : "Demo login failed");
    } finally {
      setBusyEmail(null);
    }
  }

  async function handleNhostLogin(e: React.FormEvent) {
    e.preventDefault();
    if (modeInfo && modeInfo.mode !== "nhost" && !modeInfo.nhostConfigured) {
      setError("Nhost is not configured.");
      return;
    }
    setNhostBusy(true);
    setError(null);
    try {
      const nhost = getNhostClient();
      const response = await nhost.auth.signInEmailPassword({
        email: nhostEmail,
        password: nhostPassword,
      });
      const accessToken = response.body?.session?.accessToken;
      const user = response.body?.session?.user;
      if (!accessToken || !user?.id) {
        throw new Error(
          response.body
            ? "Nhost sign-in failed — check email/password"
            : "Nhost sign-in failed"
        );
      }

      // Confirm Hasura will see the same user id from the JWT claims.
      const me = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!me.ok) {
        throw new Error(
          "Nhost token was issued but is not accepted by this app/Hasura JWT config. Set HASURA_JWT_SECRET to the Nhost JWT key."
        );
      }
      const meJson = (await me.json()) as { user?: { id?: string } };
      if (meJson.user?.id && meJson.user.id !== user.id) {
        throw new Error("Token subject does not match Nhost user id");
      }

      login({
        accessToken,
        authProvider: "nhost",
        user: {
          id: user.id,
          email: user.email || nhostEmail,
          displayName: user.displayName || user.email || "Nhost user",
        },
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nhost login failed");
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
            onSubmit={(e) => void handleNhostLogin(e)}
          >
            <h2 className="section-title">Nhost email / password</h2>
            <p className="muted">
              Production path: Nhost Auth issues the JWT; Hasura and Actions
              authorize with that user id.
            </p>
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
                autoComplete="current-password"
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={nhostBusy}
            >
              {nhostBusy ? "Signing in…" : "Sign in with Nhost"}
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
