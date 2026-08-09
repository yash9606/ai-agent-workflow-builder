"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { QuotaBar } from "@/components/quota/QuotaBar";
import { useAuth, useOrg } from "@/components/providers/AppProviders";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { orgs, orgId, role, setOrgId, loading } = useOrg();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <Link href="/dashboard" className="brand">
            Workflow Builder
          </Link>
          <nav className="app-nav" aria-label="Primary">
            <Link
              href="/dashboard"
              className={pathname === "/dashboard" ? "nav-link active" : "nav-link"}
            >
              Dashboard
            </Link>
            <Link
              href="/workflows"
              className={
                pathname.startsWith("/workflows") ? "nav-link active" : "nav-link"
              }
            >
              Workflows
            </Link>
          </nav>
        </div>

        <div className="app-header-right">
          <div className="header-quota">
            <QuotaBar compact />
          </div>

          {orgs.length > 1 ? (
            <label className="org-switcher">
              <span className="muted">Organization</span>
              <select
                value={orgId ?? ""}
                disabled={loading}
                aria-label="Select organization"
                onChange={(e) => setOrgId(e.target.value)}
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : orgs[0] ? (
            <span className="org-badge">{orgs[0].name}</span>
          ) : null}

          {role ? (
            <span className="role-badge" title="Role from org_members">
              {role}
            </span>
          ) : null}

          <div className="user-menu">
            <span className="user-name">{user?.displayName ?? user?.email}</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleLogout}
              aria-label="Log out"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
