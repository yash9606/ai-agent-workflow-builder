"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { StepEditor, defaultConfigForType } from "@/components/workflow/StepEditor";
import { gqlRequest } from "@/lib/graphql/client";
import {
  DELETE_STEP,
  INSERT_STEP,
  UPDATE_STEP,
} from "@/lib/graphql/operations";
import type { GqlWorkflowStep } from "@/lib/graphql/types";
import type { JsonObject, OrgRole, StepType } from "@/lib/types";

const ALL_STEP_TYPES: StepType[] = [
  "llm_call",
  "http_request",
  "conditional_branch",
  "approval_gate",
  "db_write",
  "notify",
];

const OWNER_ONLY_TYPES: StepType[] = ["db_write", "notify"];

type EditableStep = {
  id: string;
  position: number;
  name: string;
  type: StepType;
  config: JsonObject;
  dirty?: boolean;
  isNew?: boolean;
};

function configSummary(type: StepType, config: JsonObject): string {
  switch (type) {
    case "llm_call":
      return String(config.model || config.provider || "llm");
    case "http_request":
      return `${String(config.method || "GET")} ${String(config.url || "").slice(0, 48)}`;
    case "conditional_branch":
      return `${String(config.operator || "?")} ${String(config.value ?? "")}`.trim();
    case "approval_gate":
      return String(config.message || "approval").slice(0, 48);
    case "db_write":
      return `key=${String(config.key || "")}`;
    case "notify":
      return String(config.channel || "notify");
    default:
      return type;
  }
}

type Props = {
  workflowId: string;
  steps: GqlWorkflowStep[];
  onChanged: () => Promise<void> | void;
};

function allowedStepTypes(role: OrgRole | null): StepType[] {
  if (role === "owner") return ALL_STEP_TYPES;
  return ALL_STEP_TYPES.filter((t) => !OWNER_ONLY_TYPES.includes(t));
}

export function WorkflowBuilder({ workflowId, steps, onChanged }: Props) {
  const { session } = useAuth();
  const { role } = useOrg();
  const readOnly = role === "viewer" || !role;
  const canEdit = role === "owner" || role === "editor";
  const [localSteps, setLocalSteps] = useState<EditableStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newType, setNewType] = useState<StepType>("llm_call");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const mapped = [...steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        position: s.position,
        name: s.name,
        type: s.type,
        config: (s.config || {}) as JsonObject,
      }));
    setLocalSteps(mapped);
    setSelectedId((prev) => prev ?? mapped[0]?.id ?? null);
  }, [steps]);

  const selectableTypes = useMemo(() => allowedStepTypes(role), [role]);

  useEffect(() => {
    if (!selectableTypes.includes(newType)) {
      setNewType(selectableTypes[0] ?? "llm_call");
    }
  }, [selectableTypes, newType]);

  const selected = localSteps.find((s) => s.id === selectedId) ?? null;

  function reorder(from: number, to: number) {
    if (to < 0 || to >= localSteps.length) return;
    const next = [...localSteps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setLocalSteps(
      next.map((s, idx) => ({ ...s, position: idx, dirty: true }))
    );
  }

  async function handleAdd() {
    if (!canEdit || !session) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const position = localSteps.length;
      const data = await gqlRequest<{
        insert_workflow_steps_one: GqlWorkflowStep;
      }>(
        INSERT_STEP,
        {
          workflow_id: workflowId,
          position,
          name: `New ${newType.replace(/_/g, " ")}`,
          type: newType,
          config: defaultConfigForType(newType),
        },
        session.accessToken
      );
      setSelectedId(data.insert_workflow_steps_one.id);
      setMessage("Step added");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(stepId: string) {
    if (!canEdit || !session) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await gqlRequest(DELETE_STEP, { id: stepId }, session.accessToken);
      const remaining = localSteps
        .filter((s) => s.id !== stepId)
        .map((s, idx) => ({ ...s, position: idx }));
      for (const step of remaining) {
        await gqlRequest(
          UPDATE_STEP,
          {
            id: step.id,
            position: step.position,
            name: step.name,
            type: step.type,
            config: step.config,
          },
          session.accessToken
        );
      }
      setSelectedId(remaining[0]?.id ?? null);
      setMessage("Step deleted");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete step");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!canEdit || !session) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      for (const step of localSteps) {
        await gqlRequest(
          UPDATE_STEP,
          {
            id: step.id,
            position: step.position,
            name: step.name,
            type: step.type,
            config: step.config,
          },
          session.accessToken
        );
      }
      setMessage("Steps saved");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save steps");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Steps</h2>
        {canEdit ? (
          <div className="row-actions">
            <select
              value={newType}
              disabled={busy}
              onChange={(e) => setNewType(e.target.value as StepType)}
            >
              {selectableTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void handleAdd()}
            >
              Add step
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || localSteps.length === 0}
              onClick={() => void handleSave()}
            >
              Save steps
            </button>
          </div>
        ) : (
          <span className="muted">View only</span>
        )}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}

      <div className="builder-grid">
        <ul className="step-list">
          {localSteps.length === 0 ? (
            <li className="muted">No steps yet.</li>
          ) : (
            localSteps.map((step, index) => (
              <li key={step.id}>
                <button
                  type="button"
                  className={
                    step.id === selectedId
                      ? "step-list-item active"
                      : "step-list-item"
                  }
                  onClick={() => setSelectedId(step.id)}
                >
                  <span className="step-pos">{index + 1}</span>
                  <span>
                    <strong>{step.name}</strong>
                    <small>{step.type}</small>
                    <span className="step-summary">
                      {configSummary(step.type, step.config)}
                    </span>
                  </span>
                </button>
                {canEdit ? (
                  <div className="step-reorder">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || index === 0}
                      onClick={() => reorder(index, index - 1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || index === localSteps.length - 1}
                      onClick={() => reorder(index, index + 1)}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm danger"
                      disabled={busy}
                      onClick={() => void handleDelete(step.id)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>

        <div className="step-detail">
          {selected ? (
            <StepEditor
              name={selected.name}
              type={selected.type}
              config={selected.config}
              readOnly={readOnly}
              onChange={(next) => {
                setLocalSteps((prev) =>
                  prev.map((s) =>
                    s.id === selected.id
                      ? { ...s, ...next, dirty: true }
                      : s
                  )
                );
              }}
            />
          ) : (
            <p className="muted">Select a step to edit.</p>
          )}
        </div>
      </div>
    </section>
  );
}
