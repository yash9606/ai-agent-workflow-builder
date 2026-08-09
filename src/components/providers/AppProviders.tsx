"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSelectedOrgId,
  clearSession,
  getSelectedOrgId,
  getSession,
  setSelectedOrgId,
  setSession,
  type Session,
  type SessionUser,
} from "@/lib/auth/session";
import { gqlRequest } from "@/lib/graphql/client";
import { GET_MY_ORGS } from "@/lib/graphql/operations";
import type { GqlOrganization } from "@/lib/graphql/types";
import type { OrgRole } from "@/lib/types";
import {
  getNhostClient,
  isNhostConfigured,
  signOutNhost,
} from "@/lib/nhost/client";

interface AuthContextValue {
  session: Session | null;
  user: SessionUser | null;
  ready: boolean;
  login: (session: Session) => void;
  logout: () => void;
}

interface OrgContextValue {
  orgs: GqlOrganization[];
  orgId: string | null;
  currentOrg: GqlOrganization | null;
  role: OrgRole | null;
  loading: boolean;
  error: string | null;
  setOrgId: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const OrgContext = createContext<OrgContextValue | null>(null);

async function sessionFromAccessToken(
  accessToken: string,
  fallback?: Partial<SessionUser>,
  authProvider?: Session["authProvider"]
): Promise<Session | null> {
  const me = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!me.ok) return null;
  const meJson = (await me.json()) as {
    user: { id: string; email?: string | null };
  };
  return {
    accessToken,
    authProvider,
    user: {
      id: meJson.user.id,
      email: meJson.user.email || fallback?.email || "",
      displayName:
        fallback?.displayName ||
        meJson.user.email ||
        fallback?.email ||
        "User",
    },
  };
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (isNhostConfigured()) {
        try {
          const nhost = getNhostClient();
          const nhostSession = nhost.getUserSession();
          const accessToken = nhostSession?.accessToken;
          const user = nhostSession?.user;
          if (accessToken && user?.id) {
            const next = await sessionFromAccessToken(
              accessToken,
              {
                email: user.email || "",
                displayName: user.displayName || user.email || "User",
              },
              "nhost"
            );
            if (next && !cancelled) {
              setSession(next);
              setSessionState(next);
              setReady(true);
              return;
            }
          }
        } catch {
          // fall through
        }
      }

      const stored = getSession();
      if (stored?.accessToken) {
        try {
          const next = await sessionFromAccessToken(
            stored.accessToken,
            stored.user,
            stored.authProvider
          );
          if (!cancelled) {
            if (next) {
              setSession(next);
              setSessionState(next);
            } else {
              clearSession();
              setSessionState(null);
            }
          }
        } catch {
          if (!cancelled) setSessionState(stored);
        }
      }

      if (!cancelled) setReady(true);
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((next: Session) => {
    setSession(next);
    setSessionState(next);
  }, []);

  const logout = useCallback(() => {
    void signOutNhost();
    clearSession();
    clearSelectedOrgId();
    setSessionState(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      ready,
      login,
      logout,
    }),
    [session, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function OrgProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const [orgs, setOrgs] = useState<GqlOrganization[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOrgs = useCallback(async () => {
    if (!session?.accessToken) {
      setOrgs([]);
      setOrgIdState(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // RLS: only orgs where org_members.user_id = JWT x-hasura-user-id.
      const data = await gqlRequest<{ organizations: GqlOrganization[] }>(
        GET_MY_ORGS,
        undefined,
        session.accessToken
      );
      const list = data.organizations ?? [];
      setOrgs(list);

      const stored = getSelectedOrgId();
      const preferred =
        (stored && list.find((o) => o.id === stored)?.id) ||
        list[0]?.id ||
        null;
      if (preferred) {
        setSelectedOrgId(preferred);
        setOrgIdState(preferred);
      } else {
        clearSelectedOrgId();
        setOrgIdState(null);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load organizations"
      );
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (!ready) return;
    void refreshOrgs();
  }, [ready, refreshOrgs]);

  const setOrgId = useCallback(
    (id: string) => {
      // UI preference only — never an authorization claim.
      if (!orgs.some((o) => o.id === id)) {
        setError("Organization not available for this user");
        return;
      }
      setSelectedOrgId(id);
      setOrgIdState(id);
    },
    [orgs]
  );

  const currentOrg = useMemo(
    () => orgs.find((o) => o.id === orgId) ?? null,
    [orgs, orgId]
  );

  const role = useMemo(() => {
    if (!session?.user || !currentOrg) return null;
    const membership = currentOrg.members.find(
      (m) => m.user_id === session.user.id
    );
    return membership?.role ?? null;
  }, [currentOrg, session?.user]);

  const value = useMemo(
    () => ({
      orgs,
      orgId,
      currentOrg,
      role,
      loading,
      error,
      setOrgId,
      refreshOrgs,
    }),
    [orgs, orgId, currentOrg, role, loading, error, setOrgId, refreshOrgs]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <OrgProvider>{children}</OrgProvider>
    </AuthProvider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AppProviders");
  return ctx;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within AppProviders");
  return ctx;
}
