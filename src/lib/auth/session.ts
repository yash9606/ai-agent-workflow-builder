import type { OrgRole } from "@/lib/types";

export const SESSION_STORAGE_KEY = "workflow-builder.session";
export const SELECTED_ORG_STORAGE_KEY = "workflow-builder.selectedOrgId";

export type AuthProvider = "demo" | "nhost";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  accessToken: string;
  user: SessionUser;
  /** Where the access token came from — never used for authorization. */
  authProvider?: AuthProvider;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.accessToken || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getSelectedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SELECTED_ORG_STORAGE_KEY);
}

export function setSelectedOrgId(orgId: string): void {
  localStorage.setItem(SELECTED_ORG_STORAGE_KEY, orgId);
}

export function clearSelectedOrgId(): void {
  localStorage.removeItem(SELECTED_ORG_STORAGE_KEY);
}

export type DemoPersona = {
  email: string;
  displayName: string;
  role: OrgRole;
  orgLabel: string;
};

/** Known demo memberships from seed data (for login quick-select UI). */
export const DEMO_PERSONAS: DemoPersona[] = [
  {
    email: "alice@org-a.demo",
    displayName: "Alice",
    role: "owner",
    orgLabel: "Organization A",
  },
  {
    email: "bob@org-a.demo",
    displayName: "Bob",
    role: "editor",
    orgLabel: "Organization A",
  },
  {
    email: "charlie@org-a.demo",
    displayName: "Charlie",
    role: "viewer",
    orgLabel: "Organization A",
  },
  {
    email: "david@org-b.demo",
    displayName: "David",
    role: "owner",
    orgLabel: "Organization B",
  },
  {
    email: "eve@org-b.demo",
    displayName: "Eve",
    role: "editor",
    orgLabel: "Organization B",
  },
  {
    email: "frank@org-b.demo",
    displayName: "Frank",
    role: "viewer",
    orgLabel: "Organization B",
  },
];
