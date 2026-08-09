"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { QuotaBar } from "@/components/quota/QuotaBar";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { gqlRequest } from "@/lib/graphql/client";
import { GET_WORKFLOWS } from "@/lib/graphql/operations";
import type { GqlWorkflowListItem } from "@/lib/graphql/types";

export default function WorkflowsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <WorkflowsContent />
      </AppShell>
    </RequireAuth>
  );
}

function WorkflowsContent() {
  const { session } = useAuth();
  const { orgId, currentOrg, role, loading: orgLoading } = useOrg();
  const [workflows, setWorkflows] = useState<GqlWorkflowListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session || !orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await gqlRequest<{ workflows: GqlWorkflowListItem[] }>(
        GET_WORKFLOWS,
        { orgId },
        session.accessToken
      );
      setWorkflows(data.workflows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workflows");
    } finally {
      setLoading(false);
    }
  }, [session, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">{currentOrg?.name ?? "Organization"}</p>
          <h1>Workflows</h1>
          <p className="muted">
            {role === "viewer"
              ? "Read-only access — you can open workflows and inspect runs."
              : "Create and edit workflows. Run is available for owners and editors."}
          </p>
        </div>
        <div className="row-actions">
          <QuotaBar />
          {(role === "owner" || role === "editor") && (
            <Link href="/workflows/new" className="btn btn-primary">
              New workflow
            </Link>
          )}
        </div>
      </div>

      {orgLoading || loading ? <p className="muted">Loading workflows…</p> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {!loading && !error ? (
        <section className="panel">
          {workflows.length === 0 ? (
            <p className="muted">No workflows yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table" aria-label="Workflows">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">Steps</th>
                    <th scope="col">Triggers</th>
                    <th scope="col">Latest run</th>
                    <th scope="col">Updated</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((wf) => {
                    const stepCount = wf.steps_aggregate?.aggregate?.count ?? 0;
                    const triggers = wf.triggers ?? [];
                    const lastRun = wf.runs?.[0];
                    return (
                      <tr key={wf.id}>
                        <td>
                          <Link href={`/workflows/${wf.id}`}>
                            <strong>{wf.name}</strong>
                          </Link>
                          <p className="muted table-desc">
                            {wf.description || "No description"}
                          </p>
                        </td>
                        <td>
                          <span className={wf.active ? "pill ok" : "pill muted"}>
                            {wf.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>{stepCount}</td>
                        <td>
                          {triggers.length === 0
                            ? "—"
                            : triggers
                                .map(
                                  (t) =>
                                    `${t.trigger_type}${t.enabled ? "" : " (off)"}`
                                )
                                .join(", ")}
                        </td>
                        <td>
                          {lastRun ? (
                            <Link
                              href={`/workflows/${wf.id}/run/${lastRun.id}`}
                              className={`status-pill status-${lastRun.status}`}
                            >
                              {lastRun.status}
                            </Link>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted">
                          {new Date(wf.updated_at).toLocaleString()}
                        </td>
                        <td>
                          <Link
                            href={`/workflows/${wf.id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            {role === "viewer" ? "View" : "Edit"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
