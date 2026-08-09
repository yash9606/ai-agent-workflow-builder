"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QuotaBar } from "@/components/quota/QuotaBar";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { gqlRequest, subscribeGraphql } from "@/lib/graphql/client";
import {
  APPROVE_STEP,
  GET_RUN_WITH_STEPS,
  GET_WORKFLOW,
  SUB_STEP_RUNS,
  SUB_WORKFLOW_RUN,
} from "@/lib/graphql/operations";
import type {
  GqlStepRun,
  GqlWorkflowDetail,
  GqlWorkflowRun,
  GqlWorkflowStep,
} from "@/lib/graphql/types";
import type { ApprovalGateConfig, JsonObject, OrgRole, RunStatus } from "@/lib/types";

type Props = {
  runId: string;
  workflowId: string;
};

type RunBundle = {
  run: GqlWorkflowRun & {
    workflow?: { id: string; name: string; org_id: string } | null;
  };
  stepRuns: GqlStepRun[];
};

type TimelineItem = {
  key: string;
  position: number;
  name: string;
  type: string;
  status: string;
  stepRun?: GqlStepRun;
  pending: boolean;
};

const TERMINAL: RunStatus[] = ["completed", "failed", "cancelled"];

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "●";
    case "paused":
      return "⏸";
    case "failed":
      return "✗";
    case "skipped":
      return "↷";
    default:
      return "○";
  }
}

function asObject(value: unknown): JsonObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function BranchOutcome({ output }: { output: unknown }) {
  const obj = asObject(output);
  if (!obj) return null;
  const matched = obj.matched === true;
  const path = typeof obj.path === "string" ? obj.path : matched ? "true" : "false";
  const jumped =
    typeof obj.jumped_to === "string" ? obj.jumped_to : undefined;
  const details = asObject(obj.details);
  const actual = details?.actual;
  const expected = details?.expected;
  const operator = details?.operator;

  return (
    <div className={`branch-outcome ${matched ? "true" : "false"}`}>
      <p>
        {matched ? (
          <strong>✓ TRUE PATH selected</strong>
        ) : (
          <strong>✗ FALSE PATH selected</strong>
        )}
      </p>
      <p className="muted">
        Path: <code>{path}</code>
        {jumped ? (
          <>
            {" "}
            · jump → <code>{jumped}</code>
          </>
        ) : null}
      </p>
      {operator !== undefined ? (
        <p className="muted">
          Condition:{" "}
          <code>
            {String(actual ?? "")} {String(operator)} {String(expected ?? "")}
          </code>
        </p>
      ) : null}
    </div>
  );
}

export function LiveRunView({ runId, workflowId }: Props) {
  const { session } = useAuth();
  const { role } = useOrg();
  const [bundle, setBundle] = useState<RunBundle | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<GqlWorkflowStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [approveMsg, setApproveMsg] = useState<string | null>(null);

  async function fetchOnce(token: string) {
    const data = await gqlRequest<{
      workflow_runs_by_pk: (GqlWorkflowRun & {
        step_runs: GqlStepRun[];
        workflow?: { id: string; name: string; org_id: string } | null;
      }) | null;
    }>(GET_RUN_WITH_STEPS, { id: runId }, token);

    if (!data.workflow_runs_by_pk) {
      throw new Error(
        "Run not found — it may belong to another organization or the ID is invalid."
      );
    }

    setBundle({
      run: data.workflow_runs_by_pk,
      stepRuns: data.workflow_runs_by_pk.step_runs ?? [],
    });
  }

  useEffect(() => {
    if (!session) return;
    let disposed = false;

    void (async () => {
      try {
        const wf = await gqlRequest<{
          workflows_by_pk: GqlWorkflowDetail | null;
        }>(GET_WORKFLOW, { id: workflowId }, session.accessToken);
        if (!disposed) {
          setWorkflowSteps(wf.workflows_by_pk?.steps ?? []);
        }
      } catch {
        /* timeline still works from step_runs alone */
      }

      try {
        await fetchOnce(session.accessToken);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "Failed to load run");
        }
      }
    })();

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, workflowId, session?.accessToken]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let unsubRun: (() => void) | undefined;
    let unsubSteps: (() => void) | undefined;

    try {
      unsubRun = subscribeGraphql<{
        workflow_runs_by_pk: GqlWorkflowRun | null;
      }>(
        SUB_WORKFLOW_RUN,
        { id: runId },
        {
          next: (data) => {
            if (disposed || !data.workflow_runs_by_pk) return;
            setLive(true);
            setBundle((prev) =>
              prev
                ? {
                    ...prev,
                    run: { ...prev.run, ...data.workflow_runs_by_pk! },
                  }
                : {
                    run: data.workflow_runs_by_pk!,
                    stepRuns: [],
                  }
            );
          },
          error: (err) => {
            setLive(false);
            setError(
              `Live subscription error: ${err.message}. Refresh to reload.`
            );
          },
        },
        session.accessToken
      );

      unsubSteps = subscribeGraphql<{ step_runs: GqlStepRun[] }>(
        SUB_STEP_RUNS,
        { workflowRunId: runId },
        {
          next: (data) => {
            if (disposed) return;
            setLive(true);
            setBundle((prev) =>
              prev ? { ...prev, stepRuns: data.step_runs ?? [] } : prev
            );
          },
          error: () => {
            setLive(false);
          },
        },
        session.accessToken
      );
    } catch {
      setLive(false);
      setError("Unable to open GraphQL subscription. Refresh the page.");
    }

    return () => {
      disposed = true;
      unsubRun?.();
      unsubSteps?.();
    };
  }, [runId, session]);

  const pausedApproval = useMemo(() => {
    if (!bundle || bundle.run.status !== "paused") return null;
    return (
      bundle.stepRuns.find(
        (sr) =>
          sr.status === "paused" &&
          sr.workflow_step?.type === "approval_gate"
      ) ?? null
    );
  }, [bundle]);

  const canApprove = useMemo(() => {
    if (!pausedApproval || !role) return false;
    const out = asObject(pausedApproval.output);
    const frozen = Array.isArray(out?.allowed_roles)
      ? (out!.allowed_roles as string[])
      : null;
    const config = (pausedApproval.workflow_step?.config ||
      {}) as ApprovalGateConfig;
    const allowed: OrgRole[] = (
      frozen?.length
        ? frozen
        : config.allowed_roles?.length
          ? config.allowed_roles
          : ["owner", "editor"]
    ).filter(
      (r): r is OrgRole => r === "owner" || r === "editor" || r === "viewer"
    );
    return allowed.includes(role);
  }, [pausedApproval, role]);

  const allowedRolesLabel = useMemo(() => {
    if (!pausedApproval) return "";
    const out = asObject(pausedApproval.output);
    const frozen = Array.isArray(out?.allowed_roles)
      ? (out!.allowed_roles as string[])
      : null;
    const config = (pausedApproval.workflow_step?.config ||
      {}) as ApprovalGateConfig;
    const roles =
      frozen?.length ? frozen : config.allowed_roles ?? ["owner", "editor"];
    return roles.join(", ");
  }, [pausedApproval]);

  const timeline: TimelineItem[] = useMemo(() => {
    if (!bundle) return [];
    const byStepId = new Map(
      bundle.stepRuns.map((sr) => [sr.workflow_step_id, sr])
    );

    if (workflowSteps.length > 0) {
      return [...workflowSteps]
        .sort((a, b) => a.position - b.position)
        .map((step) => {
          const sr = byStepId.get(step.id);
          return {
            key: step.id,
            position: step.position,
            name: step.name,
            type: step.type,
            status: sr?.status ?? "pending",
            stepRun: sr,
            pending: !sr,
          };
        });
    }

    return bundle.stepRuns.map((sr) => ({
      key: sr.id,
      position: sr.workflow_step?.position ?? 0,
      name: sr.workflow_step?.name ?? sr.workflow_step_id,
      type: sr.workflow_step?.type ?? "step",
      status: sr.status,
      stepRun: sr,
      pending: false,
    }));
  }, [bundle, workflowSteps]);

  async function handleApprove(stepRunId: string) {
    if (!session) return;
    setApproving(stepRunId);
    setApproveMsg(null);
    setError(null);
    try {
      const data = await gqlRequest<{
        approveStep: { id: string; status: string; message: string };
      }>(APPROVE_STEP, { step_run_id: stepRunId }, session.accessToken);
      setApproveMsg(data.approveStep.message);
      await fetchOnce(session.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproving(null);
    }
  }

  if (!bundle && !error) {
    return (
      <div className="app-loading">
        <p>Connecting to live run…</p>
      </div>
    );
  }

  if (!bundle) {
    return <div className="alert alert-error">{error}</div>;
  }

  const { run } = bundle;
  const terminal = TERMINAL.includes(run.status);
  const approvalMessage =
    (asObject(pausedApproval?.output)?.message as string | undefined) ||
    (asObject(pausedApproval?.workflow_step?.config)?.message as
      | string
      | undefined) ||
    "Awaiting approval";

  return (
    <div className="live-run">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            <Link href={`/workflows/${workflowId}`}>← Back to workflow</Link>
          </p>
          <h1>{run.workflow?.name ?? "Workflow run"}</h1>
          <p className="muted">
            Run <code>{run.id}</code> · {run.trigger_type}
            {live ? " · live GraphQL subscription" : " · connecting…"}
          </p>
        </div>
        <div className="row-actions">
          <QuotaBar />
          <span className={`status-pill status-${run.status}`} aria-live="polite">
            {run.status}
          </span>
        </div>
      </div>

      {run.status === "paused" ? (
        <div className="alert alert-warn banner-paused" role="status">
          PAUSED — AWAITING APPROVAL
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}
      {approveMsg ? (
        <div className="alert alert-success">{approveMsg}</div>
      ) : null}

      {run.error ? (
        <div className="alert alert-error">Run error: {run.error}</div>
      ) : null}

      {pausedApproval ? (
        <section className="panel approval-panel">
          <div className="panel-header">
            <h2>Approval required</h2>
          </div>
          <p>
            <strong>{pausedApproval.workflow_step?.name}</strong>
          </p>
          <p className="muted">{approvalMessage}</p>
          <p className="muted">
            Who can approve: <strong>{allowedRolesLabel}</strong>
          </p>
          <p className="muted">
            Current run: <code>{run.id}</code>
          </p>
          {canApprove ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={approving === pausedApproval.id}
              onClick={() => void handleApprove(pausedApproval.id)}
            >
              {approving === pausedApproval.id ? "Approving…" : "Approve"}
            </button>
          ) : (
            <p className="muted">
              Your role ({role ?? "none"}) cannot approve this gate.
            </p>
          )}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Execution timeline</h2>
          {!terminal ? (
            <span className="muted" aria-live="polite">
              Updating via subscription…
            </span>
          ) : null}
        </div>

        {timeline.length === 0 ? (
          <p className="muted">No steps yet.</p>
        ) : (
          <ol className="run-timeline">
            {timeline.map((item) => {
              const sr = item.stepRun;
              const isBranch = item.type === "conditional_branch";
              const isSkipped = item.status === "skipped";
              return (
                <li
                  key={item.key}
                  className={`timeline-item status-${item.status}`}
                >
                  <div className="timeline-marker" aria-hidden="true">
                    {statusIcon(item.status)}
                  </div>
                  <div className="timeline-body">
                    <div className="step-run-head">
                      <div>
                        <strong>
                          {item.position + 1}. {item.name}
                        </strong>
                        <small>{item.type}</small>
                      </div>
                      <span className={`status-pill status-${item.status}`}>
                        {item.status}
                      </span>
                    </div>

                    {isBranch && sr?.output ? (
                      <BranchOutcome output={sr.output} />
                    ) : null}

                    {isSkipped ? (
                      <div className="skipped-callout">
                        <strong>SKIPPED</strong>
                        <p className="muted">
                          {asObject(sr?.output)?.reason
                            ? String(asObject(sr?.output)?.reason)
                            : "Skipped by conditional branch"}
                        </p>
                      </div>
                    ) : null}

                    {sr ? (
                      <div className="step-run-meta">
                        <span>Attempts: {sr.attempt_count}</span>
                        {sr.approved_by ? (
                          <span>Approved by {sr.approved_by}</span>
                        ) : null}
                        {sr.started_at ? (
                          <span>
                            Started {new Date(sr.started_at).toLocaleTimeString()}
                          </span>
                        ) : null}
                        {sr.completed_at ? (
                          <span>
                            Finished{" "}
                            {new Date(sr.completed_at).toLocaleTimeString()}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="muted">Waiting for executor…</p>
                    )}

                    {sr?.error ? (
                      <pre className="error-block">{sr.error}</pre>
                    ) : null}

                    {sr?.output !== null &&
                    sr?.output !== undefined &&
                    !isBranch ? (
                      <details>
                        <summary>Output</summary>
                        <pre>{JSON.stringify(sr.output, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
