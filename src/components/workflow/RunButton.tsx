"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { gqlRequest } from "@/lib/graphql/client";
import { TRIGGER_WORKFLOW_RUN } from "@/lib/graphql/operations";

type Props = {
  workflowId: string;
  disabled?: boolean;
  quotaExhausted?: boolean;
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
      const data = await gqlRequest<{
        triggerWorkflowRun: {
          id: string;
          status: string;
          workflow_id: string;
          message: string;
        };
      }>(
        TRIGGER_WORKFLOW_RUN,
        { workflow_id: workflowId },
        session.accessToken
      );
      router.push(
        `/workflows/${workflowId}/run/${data.triggerWorkflowRun.id}`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start run";
      const lower = message.toLowerCase();
      if (lower.includes("quota")) {
        setError("Run failed: quota exhausted");
      } else if (lower.includes("forbidden") || lower.includes("not allowed")) {
        setError("Run failed: unauthorized for this workflow");
      } else if (lower.includes("not found")) {
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
