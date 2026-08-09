"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { QuotaIndicator } from "@/components/quota/QuotaIndicator";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { gqlRequest } from "@/lib/graphql/client";
import { GET_ORG_DASHBOARD } from "@/lib/graphql/operations";
import type {
  GqlUsage,
  GqlWorkflowListItem,
  GqlWorkflowRun,
} from "@/lib/graphql/types";

type DashboardData = {
  id: string;
  name: string;
  workflows: GqlWorkflowListItem[];
  monthly_usage: GqlUsage | null;
};

type RecentRun = GqlWorkflowRun & {
  workflow?: { id: string; name: string } | null;
};

export default function DashboardPage() {
  return (
    <RequireAuth>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </RequireAuth>
  );
}

function DashboardContent() {
  const { session, user } = useAuth();
  const { orgId, role, loading: orgLoading, error: orgError } = useOrg();
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
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
      const result = await gqlRequest<{
        organizations_by_pk: DashboardData | null;
        workflow_runs: RecentRun[];
      }>(GET_ORG_DASHBOARD, { orgId }, session.accessToken);
      setData(result.organizations_by_pk);
      setRecentRuns(result.workflow_runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [session, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (orgLoading || loading) {
    return <p className="muted">Loading dashboard…</p>;
  }

  if (orgError || error) {
    return <div className="alert alert-error">{orgError || error}</div>;
  }

  if (!orgId || !data) {
    return (
      <div className="panel">
        <h1>No organization</h1>
        <p className="muted">
          This authenticated user has no org_members row. Access is membership-based —
          the UI cannot grant organization access.
        </p>
      </div>
    );
  }

  const usage = data.monthly_usage;
  const exhausted = usage ? usage.remaining_calls <= 0 : false;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">Organization</p>
          <h1>{data.name}</h1>
          <p className="muted">
            {user?.displayName ?? user?.email} · role <strong>{role}</strong>
          </p>
        </div>
        {(role === "owner" || role === "editor") && (
          <Link href="/workflows/new" className="btn btn-primary">
            Create workflow
          </Link>
        )}
      </div>

      <div className="dashboard-grid">
        <div className="stat-card">
          <QuotaIndicator usage={usage} />
          {exhausted ? (
            <p className="alert alert-warn" style={{ marginTop: "0.75rem" }}>
              Quota exhausted — new runs will be rejected by the backend.
            </p>
          ) : null}
        </div>
        <div className="stat-card">
          <strong>{data.workflows.length}</strong>
          <p className="muted">workflows in this organization</p>
          <p className="muted">
            Used {usage?.current_month_calls_used ?? "—"} · allowed{" "}
            {usage?.allowed_calls ?? "—"} · remaining {usage?.remaining_calls ?? "—"}
          </p>
          <Link href="/workflows">View all workflows →</Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Workflows</h2>
        </div>
        {data.workflows.length === 0 ? (
          <p className="muted">No workflows yet. Create one to get started.</p>
        ) : (
          <ul className="workflow-list">
            {data.workflows.map((wf) => {
              const stepCount = wf.steps_aggregate?.aggregate?.count ?? 0;
              const triggers = wf.triggers ?? [];
              const lastRun = wf.runs?.[0];
              return (
                <li key={wf.id}>
                  <Link href={`/workflows/${wf.id}`}>
                    <strong>{wf.name}</strong>
                    <p className="muted">{wf.description || "No description"}</p>
                    <div className="workflow-meta-row">
                      <span className={wf.active ? "pill ok" : "pill muted"}>
                        {wf.active ? "Active" : "Inactive"}
                      </span>
                      <span className="muted">{stepCount} steps</span>
                      <span className="muted">
                        {triggers.length
                          ? triggers.map((t) => t.trigger_type).join(", ")
                          : "no triggers"}
                      </span>
                      {lastRun ? (
                        <span className={`status-pill status-${lastRun.status}`}>
                          {lastRun.status}
                        </span>
                      ) : (
                        <span className="muted">no runs</span>
                      )}
                      <small className="muted">
                        updated {new Date(wf.updated_at).toLocaleString()}
                      </small>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent runs</h2>
        </div>
        {recentRuns.length === 0 ? (
          <p className="muted">No runs in this organization yet.</p>
        ) : (
          <ul className="workflow-list">
            {recentRuns.map((run) => (
              <li key={run.id}>
                <Link href={`/workflows/${run.workflow_id}/run/${run.id}`}>
                  <strong>{run.workflow?.name ?? "Workflow"}</strong>
                  <div className="workflow-meta-row">
                    <span className={`status-pill status-${run.status}`}>
                      {run.status}
                    </span>
                    <span className="muted">{run.trigger_type}</span>
                    <small className="muted">
                      {new Date(run.created_at).toLocaleString()}
                    </small>
                  </div>
                  {run.error ? (
                    <p className="muted">Error: {run.error}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
