"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { formatBrowserNetworkError } from "@/lib/nhost/auth-messages";

export default function NewWorkflowPage() {
  return (
    <RequireAuth>
      <AppShell>
        <NewWorkflowContent />
      </AppShell>
    </RequireAuth>
  );
}

function NewWorkflowContent() {
  const { session } = useAuth();
  const { orgId, role } = useOrg();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role === "viewer") {
    return (
      <div className="panel">
        <h1>Create workflow</h1>
        <p className="muted">Viewers cannot create workflows.</p>
        <Link href="/workflows">Back to workflows</Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          org_id: orgId,
          name: name.trim(),
          description: description.trim(),
          active,
        }),
      });

      let json: {
        workflow?: { id: string };
        message?: string;
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = {};
      }

      if (!res.ok || !json.workflow?.id) {
        if (res.status === 401) {
          throw new Error(json.message || "Authentication required");
        }
        if (res.status === 403) {
          throw new Error(
            json.message ||
              "You do not have permission to create workflows in this organization."
          );
        }
        if (res.status === 404) {
          throw new Error(json.message || "Organization not found");
        }
        throw new Error(json.message || "Failed to create workflow");
      }

      router.push(`/workflows/${json.workflow.id}`);
    } catch (err) {
      setError(
        formatBrowserNetworkError(err, "Failed to create workflow")
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="eyebrow">
            <Link href="/workflows">← Workflows</Link>
          </p>
          <h1>Create workflow</h1>
        </div>
      </div>

      <section className="panel">
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form className="form-stack" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            <span>Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support triage pipeline"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this workflow does"
            />
          </label>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>Active (required to run)</span>
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !orgId}>
              {busy ? "Creating…" : "Create"}
            </button>
            <Link href="/workflows" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
