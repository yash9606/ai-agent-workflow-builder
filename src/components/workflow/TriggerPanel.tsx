"use client";

import { useMemo, useState } from "react";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { gqlRequest } from "@/lib/graphql/client";
import {
  DELETE_TRIGGER,
  INSERT_TRIGGER,
  INSERT_WEBHOOK_ENDPOINT,
  UPDATE_TRIGGER,
} from "@/lib/graphql/operations";
import type { GqlWorkflowTrigger } from "@/lib/graphql/types";
import type { TriggerType } from "@/lib/types";

type Props = {
  workflowId: string;
  triggers: GqlWorkflowTrigger[];
  onChanged: () => Promise<void> | void;
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000")
  );
}

export function TriggerPanel({ workflowId, triggers, onChanged }: Props) {
  const { session } = useAuth();
  const { role } = useOrg();
  const canEdit = role === "owner" || role === "editor";
  const isOwner = role === "owner";
  const [triggerType, setTriggerType] = useState<TriggerType>("manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const creatableTypes = useMemo(() => {
    const types: TriggerType[] = ["manual", "scheduled", "database_event"];
    if (isOwner) types.splice(1, 0, "webhook");
    return types;
  }, [isOwner]);

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Unable to copy to clipboard");
    }
  }

  async function handleAdd() {
    if (!canEdit || !session) return;
    if (triggerType === "webhook" && !isOwner) {
      setError("Only owners can create webhook triggers");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    setCreatedSecret(null);
    try {
      const config =
        triggerType === "scheduled"
          ? {
              cron: "0 * * * *",
              timezone: "UTC",
              interval_minutes: 60,
            }
          : triggerType === "database_event"
            ? { table: "watched_records", event: "insert" }
            : triggerType === "webhook"
              ? { description: "HTTP webhook ingress" }
              : {};

      const created = await gqlRequest<{
        insert_workflow_triggers_one: { id: string };
      }>(
        INSERT_TRIGGER,
        {
          workflow_id: workflowId,
          trigger_type: triggerType,
          config,
          enabled: true,
        },
        session.accessToken
      );

      if (triggerType === "webhook") {
        const pathToken = `wh-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const secret = crypto.randomUUID() + crypto.randomUUID();
        await gqlRequest(
          INSERT_WEBHOOK_ENDPOINT,
          {
            workflow_id: workflowId,
            trigger_id: created.insert_workflow_triggers_one.id,
            secret,
            path_token: pathToken,
          },
          session.accessToken
        );
        setCreatedSecret(secret);
        setMessage(
          "Webhook trigger added. Copy the secret now — it is not shown again."
        );
      } else {
        setMessage("Trigger added");
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add trigger");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(trigger: GqlWorkflowTrigger) {
    if (!canEdit || !session) return;
    setBusy(true);
    setError(null);
    try {
      await gqlRequest(
        UPDATE_TRIGGER,
        {
          id: trigger.id,
          enabled: !trigger.enabled,
          config: trigger.config,
        },
        session.accessToken
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update trigger");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(trigger: GqlWorkflowTrigger) {
    if (!isOwner || !session) return;
    if (!window.confirm(`Delete ${trigger.trigger_type} trigger?`)) return;
    setBusy(true);
    setError(null);
    try {
      await gqlRequest(DELETE_TRIGGER, { id: trigger.id }, session.accessToken);
      setMessage("Trigger deleted");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete trigger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Triggers</h2>
        {canEdit ? (
          <div className="row-actions">
            <label className="sr-only" htmlFor="trigger-type">
              Trigger type
            </label>
            <select
              id="trigger-type"
              value={triggerType}
              disabled={busy}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              {creatableTypes.map((t) => (
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
              Add trigger
            </button>
          </div>
        ) : (
          <span className="muted">View only</span>
        )}
      </div>

      {!isOwner && canEdit ? (
        <p className="muted">
          Webhook triggers are owner-only. Editors can manage manual, scheduled,
          and database-event triggers.
        </p>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-success">{message}</div> : null}
      {createdSecret ? (
        <div className="alert alert-warn">
          <p>
            Webhook secret (shown once): <code>{createdSecret}</code>
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void copyText("secret", createdSecret)}
          >
            {copied === "secret" ? "Copied" : "Copy secret"}
          </button>
        </div>
      ) : null}

      {triggers.length === 0 ? (
        <p className="muted">No triggers configured.</p>
      ) : (
        <ul className="trigger-list">
          {triggers.map((trigger) => {
            const endpoint = trigger.webhook_endpoints?.[0];
            const endpointUrl = endpoint
              ? `${appBaseUrl()}/api/webhooks/${endpoint.path_token}`
              : null;
            return (
              <li key={trigger.id} className="trigger-item">
                <div className="trigger-item-head">
                  <div>
                    <strong>{trigger.trigger_type}</strong>
                    <span
                      className={trigger.enabled ? "pill ok" : "pill muted"}
                    >
                      {trigger.enabled ? "enabled" : "disabled"}
                    </span>
                  </div>
                  <div className="row-actions">
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void toggleEnabled(trigger)}
                      >
                        {trigger.enabled ? "Disable" : "Enable"}
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm danger"
                        disabled={busy}
                        onClick={() => void handleDelete(trigger)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>

                {Object.keys(trigger.config || {}).length > 0 ? (
                  <details>
                    <summary>Configuration</summary>
                    <pre>{JSON.stringify(trigger.config, null, 2)}</pre>
                  </details>
                ) : null}

                {trigger.trigger_type === "webhook" && isOwner ? (
                  <div className="webhook-demo">
                    <p className="muted">
                      Calling this endpoint starts the workflow without clicking
                      Run. The webhook secret is not shown here.
                    </p>
                    {endpointUrl ? (
                      <div className="copy-field">
                        <label htmlFor={`wh-${trigger.id}`}>Endpoint</label>
                        <div className="copy-field-row">
                          <input
                            id={`wh-${trigger.id}`}
                            readOnly
                            value={endpointUrl}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              void copyText(trigger.id, endpointUrl)
                            }
                          >
                            {copied === trigger.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="muted">
                        No path token on this trigger yet. Re-add a webhook
                        trigger to generate an endpoint.
                      </p>
                    )}
                  </div>
                ) : null}

                {trigger.trigger_type === "webhook" && !isOwner ? (
                  <p className="muted">
                    Webhook endpoint details are visible to owners only.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
