"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { QuotaBar } from "@/components/quota/QuotaBar";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { RunButton } from "@/components/workflow/RunButton";
import { TriggerPanel } from "@/components/workflow/TriggerPanel";
import { WorkflowBuilder } from "@/components/workflow/WorkflowBuilder";
import { gqlRequest } from "@/lib/graphql/client";
import {
  DELETE_WORKFLOW,
  GET_USAGE,
  GET_WORKFLOW,
  UPDATE_WORKFLOW,
} from "@/lib/graphql/operations";
import type { GqlUsage, GqlWorkflowDetail } from "@/lib/graphql/types";

export default function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <RequireAuth>
      <AppShell>
        <WorkflowDetailContent id={id} />
      </AppShell>
    </RequireAuth>
  );
}

function WorkflowDetailContent({ id }: { id: string }) {
  const { session } = useAuth();
  const { orgId, role } = useOrg();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<GqlWorkflowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [usage, setUsage] = useState<GqlUsage | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const data = await gqlRequest<{ workflows_by_pk: GqlWorkflowDetail | null }>(
        GET_WORKFLOW,
        { id },
        session.accessToken
      );
      if (!data.workflows_by_pk) {
        throw new Error(
          "Workflow not found — you may not be a member of its organization."
        );
      }
      setWorkflow(data.workflows_by_pk);
      setName(data.workflows_by_pk.name);
      setDescription(data.workflows_by_pk.description || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow");
      setWorkflow(null);
    } finally {
      setLoading(false);
    }
  }, [session, id]);

  const loadUsage = useCallback(async () => {
    if (!session || !orgId) return;
    try {
      const data = await gqlRequest<{
        organization_monthly_usage: GqlUsage[];
      }>(GET_USAGE, { orgId }, session.accessToken);
      setUsage(data.organization_monthly_usage?.[0] ?? null);
    } catch {
      setUsage(null);
    }
  }, [session, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function saveMeta() {
    if (!session || !workflow) return;
    if (role !== "owner" && role !== "editor") return;
    setSavingMeta(true);
    setError(null);
    try {
      await gqlRequest(
        UPDATE_WORKFLOW,
        {
          id: workflow.id,
          name: name.trim() || workflow.name,
          description,
          active: workflow.active,
        },
        session.accessToken
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update workflow");
    } finally {
      setSavingMeta(false);
    }
  }

  async function toggleActive() {
    if (!session || !workflow) return;
    if (role !== "owner" && role !== "editor") return;
    setSavingMeta(true);
    setError(null);
    try {
      await gqlRequest(
        UPDATE_WORKFLOW,
        {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          active: !workflow.active,
        },
        session.accessToken
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update workflow");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleDelete() {
    if (!session || !workflow || role !== "owner") return;
    if (!window.confirm(`Delete workflow “${workflow.name}”? This cannot be undone.`)) {
      return;
    }
    setSavingMeta(true);
    setError(null);
    try {
      await gqlRequest(DELETE_WORKFLOW, { id: workflow.id }, session.accessToken);
      router.replace("/workflows");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workflow");
      setSavingMeta(false);
    }
  }

  if (loading) return <p className="muted">Loading workflow…</p>;
  if (error && !workflow) {
    return (
      <div>
        <p className="eyebrow">
          <Link href="/workflows">← Workflows</Link>
        </p>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }
  if (!workflow) {
    return <div className="alert alert-error">Workflow not found</div>;
  }

  const canEdit = role === "owner" || role === "editor";
  const quotaExhausted = usage ? usage.remaining_calls <= 0 : false;

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">
            <Link href="/workflows">← Workflows</Link>
          </p>
          <h1>{workflow.name}</h1>
          <p className="muted">
            Status: {workflow.active ? "Active" : "Inactive"} ·{" "}
            {workflow.steps.length} steps · {workflow.triggers.length} triggers
          </p>
        </div>
        <div className="row-actions">
          <QuotaBar />
          {canEdit && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={savingMeta}
              onClick={() => void toggleActive()}
            >
              {workflow.active ? "Deactivate" : "Activate"}
            </button>
          )}
          <RunButton
            workflowId={workflow.id}
            disabled={!workflow.active || quotaExhausted}
            quotaExhausted={quotaExhausted}
          />
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {quotaExhausted ? (
        <div className="alert alert-warn">
          Monthly quota exhausted — Run is blocked until the period resets
          (backend still enforces this).
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Workflow details</h2>
          {role === "viewer" ? <span className="muted">View only</span> : null}
        </div>
        {canEdit ? (
          <div className="form-stack">
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                disabled={savingMeta}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                rows={3}
                value={description}
                disabled={savingMeta}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingMeta}
                onClick={() => void saveMeta()}
              >
                Save details
              </button>
              {role === "owner" ? (
                <button
                  type="button"
                  className="btn btn-ghost danger"
                  disabled={savingMeta}
                  onClick={() => void handleDelete()}
                >
                  Delete workflow
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="muted">{workflow.description || "No description"}</p>
        )}
      </section>

      <WorkflowBuilder
        workflowId={workflow.id}
        steps={workflow.steps}
        onChanged={load}
      />

      <TriggerPanel
        workflowId={workflow.id}
        triggers={workflow.triggers}
        onChanged={load}
      />

      <section className="panel">
        <div className="panel-header">
          <h2>Recent runs</h2>
        </div>
        {workflow.runs.length === 0 ? (
          <p className="muted">No runs yet. Use Run or a webhook to start one.</p>
        ) : (
          <ul className="workflow-list">
            {workflow.runs.map((run) => (
              <li key={run.id}>
                <Link href={`/workflows/${workflow.id}/run/${run.id}`}>
                  <strong className={`status-pill status-${run.status}`}>
                    {run.status}
                  </strong>
                  <p className="muted">
                    {run.trigger_type} ·{" "}
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                  {run.error ? <small className="muted">{run.error}</small> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
