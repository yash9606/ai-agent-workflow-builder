"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrg } from "@/components/providers/AppProviders";

type Props = {
  workflowId: string;
  disabled?: boolean;
  quotaExhausted?: boolean;
};

type RunResponse = {
  id?: string;
  status?: string;
  workflow_id?: string;
  message?: string;
};

export function RunButton({ workflowId, disabled, quotaExhausted }: Props) {
  const { session } = useAuth();
  const { role } = useOrg();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role === "viewer" || !role) {
    return null;
  }

  async function handleRun() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      // Call Vercel directly with the user JWT. Do not go through Hasura Actions
      // for UI runs — Action metadata/env issues surface as misleading "not found".
      const res = await fetch("/api/workflows/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ workflow_id: workflowId }),
      });

      const data = (await res.json().catch(() => ({}))) as RunResponse;
      if (!res.ok) {
        throw new Error(data.message || `Run failed (${res.status})`);
      }
      if (!data.id) {
        throw new Error("Run failed: missing run id");
      }

      router.push(`/workflows/${workflowId}/run/${data.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start run";
      const lower = message.toLowerCase();
      if (lower.includes("quota")) {
        setError("Run failed: quota exhausted");
      } else if (
        lower.includes("forbidden") ||
        lower.includes("not allowed") ||
        lower.includes("unauthorized")
      ) {
        setError("Run failed: unauthorized for this workflow");
      } else if (
        lower.includes("workflow not found") ||
        lower.includes("not a member")
      ) {
        setError("Run failed: workflow not found or inaccessible");
      } else if (lower.includes("active") || lower.includes("invalid")) {
        setError(`Run failed: ${message}`);
      } else {
        setError(`Run failed: ${message}`);
      }
      setBusy(false);
    }
  }

  return (
    <div className="run-button-wrap">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || disabled}
        title={
          quotaExhausted
            ? "Monthly quota exhausted"
            : disabled
              ? "Workflow must be active"
              : "Start a new workflow run"
        }
        aria-label="Run workflow"
        onClick={() => void handleRun()}
      >
        {busy ? "Starting…" : "Run Workflow"}
      </button>
      {quotaExhausted ? (
        <p className="muted">Execution unavailable — quota exhausted.</p>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
    </div>
  );
}
