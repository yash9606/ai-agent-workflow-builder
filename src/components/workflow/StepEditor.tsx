"use client";

import type { JsonObject, JsonValue, StepType } from "@/lib/types";

type Props = {
  name: string;
  type: StepType;
  config: JsonObject;
  onChange: (next: { name: string; type: StepType; config: JsonObject }) => void;
  readOnly?: boolean;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function updateConfig(
  config: JsonObject,
  patch: JsonObject
): JsonObject {
  return { ...config, ...patch };
}

export function StepEditor({ name, type, config, onChange, readOnly }: Props) {
  const setName = (next: string) => onChange({ name: next, type, config });
  const setConfig = (patch: JsonObject) =>
    onChange({ name, type, config: updateConfig(config, patch) });

  return (
    <div className="step-editor">
      <label className="field">
        <span>Step name</span>
        <input
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Type</span>
        <input value={type} disabled readOnly />
      </label>

      {type === "llm_call" && (
        <>
          <label className="field">
            <span>Provider</span>
            <select
              value={asString(config.provider, "auto")}
              disabled={readOnly}
              onChange={(e) => setConfig({ provider: e.target.value })}
            >
              <option value="auto">auto</option>
              <option value="stub">stub</option>
              <option value="groq">groq</option>
              <option value="gemini">gemini</option>
              <option value="openrouter">openrouter</option>
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={asString(config.model)}
              disabled={readOnly}
              onChange={(e) => setConfig({ model: e.target.value })}
            />
          </label>
          <label className="field">
            <span>System prompt</span>
            <textarea
              rows={3}
              value={asString(config.system_prompt)}
              disabled={readOnly}
              onChange={(e) => setConfig({ system_prompt: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Prompt</span>
            <textarea
              rows={4}
              value={asString(config.prompt)}
              disabled={readOnly}
              onChange={(e) => setConfig({ prompt: e.target.value })}
            />
          </label>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={asBool(config.pass_previous_output)}
              disabled={readOnly}
              onChange={(e) =>
                setConfig({ pass_previous_output: e.target.checked })
              }
            />
            <span>Pass previous output</span>
          </label>
        </>
      )}

      {type === "http_request" && (
        <>
          <label className="field">
            <span>Method</span>
            <select
              value={asString(config.method, "GET")}
              disabled={readOnly}
              onChange={(e) => setConfig({ method: e.target.value })}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>URL</span>
            <input
              value={asString(config.url)}
              disabled={readOnly}
              onChange={(e) => setConfig({ url: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Headers (JSON)</span>
            <textarea
              rows={3}
              value={JSON.stringify(config.headers ?? {}, null, 2)}
              disabled={readOnly}
              onChange={(e) => {
                try {
                  setConfig({ headers: JSON.parse(e.target.value || "{}") });
                } catch {
                  /* keep typing */
                }
              }}
            />
          </label>
          <label className="field">
            <span>Query params (JSON)</span>
            <textarea
              rows={2}
              value={JSON.stringify(config.query ?? {}, null, 2)}
              disabled={readOnly}
              onChange={(e) => {
                try {
                  setConfig({ query: JSON.parse(e.target.value || "{}") });
                } catch {
                  /* keep typing */
                }
              }}
            />
          </label>
          <label className="field">
            <span>Body (JSON)</span>
            <textarea
              rows={4}
              value={
                config.body === undefined
                  ? ""
                  : JSON.stringify(config.body, null, 2)
              }
              disabled={readOnly}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  setConfig({ body: null });
                  return;
                }
                try {
                  setConfig({ body: JSON.parse(raw) as JsonValue });
                } catch {
                  /* keep typing */
                }
              }}
            />
          </label>
          <label className="field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              value={asNumber(config.timeout_ms, 10000)}
              disabled={readOnly}
              onChange={(e) =>
                setConfig({ timeout_ms: Number(e.target.value) || 10000 })
              }
            />
          </label>
        </>
      )}

      {type === "db_write" && (
        <>
          <label className="field">
            <span>Key</span>
            <input
              value={asString(config.key)}
              disabled={readOnly}
              onChange={(e) => setConfig({ key: e.target.value })}
            />
          </label>
          <p className="muted">
            Controlled write only: inserts previous step output into{" "}
            <code>workflow_db_writes</code> under this key. Arbitrary SQL is not
            supported.
          </p>
        </>
      )}

      {type === "notify" && (
        <>
          <label className="field">
            <span>Channel</span>
            <input
              value={asString(config.channel, "webhook")}
              disabled={readOnly}
              onChange={(e) => setConfig({ channel: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Destination</span>
            <input
              value={asString(config.destination)}
              disabled={readOnly}
              onChange={(e) => setConfig({ destination: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Destination env</span>
            <input
              value={asString(config.destination_env, "NOTIFY_WEBHOOK_URL")}
              disabled={readOnly}
              onChange={(e) => setConfig({ destination_env: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Message</span>
            <textarea
              rows={3}
              value={asString(config.message)}
              disabled={readOnly}
              onChange={(e) => setConfig({ message: e.target.value })}
            />
          </label>
        </>
      )}

      {type === "conditional_branch" && (
        <>
          <label className="field">
            <span>Source</span>
            <select
              value={asString(config.source, "previous_output")}
              disabled={readOnly}
              onChange={(e) => setConfig({ source: e.target.value })}
            >
              <option value="previous_output">previous_output</option>
              <option value="input">input</option>
            </select>
          </label>
          <label className="field">
            <span>Field</span>
            <input
              value={asString(config.field)}
              disabled={readOnly}
              onChange={(e) => setConfig({ field: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Operator</span>
            <select
              value={asString(config.operator, "eq")}
              disabled={readOnly}
              onChange={(e) => setConfig({ operator: e.target.value })}
            >
              {[
                "eq",
                "neq",
                "contains",
                "not_contains",
                "gt",
                "lt",
                "exists",
              ].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Value</span>
            <input
              value={
                typeof config.value === "string" ||
                typeof config.value === "number"
                  ? String(config.value)
                  : config.value === undefined || config.value === null
                    ? ""
                    : JSON.stringify(config.value)
              }
              disabled={readOnly}
              onChange={(e) => setConfig({ value: e.target.value })}
            />
          </label>
          <label className="field">
            <span>True label</span>
            <input
              value={asString(config.true_label, "true_path")}
              disabled={readOnly}
              onChange={(e) => setConfig({ true_label: e.target.value })}
            />
          </label>
          <label className="field">
            <span>False label</span>
            <input
              value={asString(config.false_label, "false_path")}
              disabled={readOnly}
              onChange={(e) => setConfig({ false_label: e.target.value })}
            />
          </label>
          <label className="field">
            <span>True path (next | end | step UUID | position)</span>
            <input
              value={asString(config.true_next, "next")}
              disabled={readOnly}
              onChange={(e) => setConfig({ true_next: e.target.value })}
              placeholder="next"
            />
          </label>
          <label className="field">
            <span>False path (next | end | step UUID | position)</span>
            <input
              value={asString(config.false_next, "next")}
              disabled={readOnly}
              onChange={(e) => setConfig({ false_next: e.target.value })}
              placeholder="next"
            />
          </label>
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={asBool(config.skip_on_false)}
              disabled={readOnly}
              onChange={(e) => setConfig({ skip_on_false: e.target.checked })}
            />
            <span>Skip remaining on false (legacy end jump)</span>
          </label>
          <p className="muted">
            Safe operators only — no arbitrary code. Paths control which later
            steps run; skipped steps are marked SKIPPED.
          </p>
        </>
      )}

      {type === "approval_gate" && (
        <>
          <label className="field">
            <span>Message</span>
            <textarea
              rows={3}
              value={asString(config.message, "Approve to continue?")}
              disabled={readOnly}
              onChange={(e) => setConfig({ message: e.target.value })}
            />
          </label>
          <fieldset className="field-group">
            <legend>Allowed roles</legend>
            {(["owner", "editor", "viewer"] as const).map((role) => {
              const roles = Array.isArray(config.allowed_roles)
                ? (config.allowed_roles as string[])
                : ["owner", "editor"];
              const checked = roles.includes(role);
              return (
                <label key={role} className="field checkbox">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...roles, role]))
                        : roles.filter((r) => r !== role);
                      setConfig({
                        allowed_roles: next.length ? next : ["owner"],
                      });
                    }}
                  />
                  <span>{role}</span>
                </label>
              );
            })}
          </fieldset>
        </>
      )}
    </div>
  );
}

export function defaultConfigForType(type: StepType): JsonObject {
  switch (type) {
    case "llm_call":
      return {
        provider: "auto",
        model: "llama-3.1-8b-instant",
        system_prompt: "",
        prompt: "",
        pass_previous_output: false,
      };
    case "http_request":
      return {
        method: "GET",
        url: "https://httpbin.org/get",
        headers: {},
        timeout_ms: 10000,
      };
    case "db_write":
      return { key: "result" };
    case "notify":
      return {
        channel: "webhook",
        destination_env: "NOTIFY_WEBHOOK_URL",
        message: "Workflow notification",
      };
    case "conditional_branch":
      return {
        source: "previous_output",
        field: "",
        operator: "eq",
        value: "",
        true_label: "true_path",
        false_label: "false_path",
        true_next: "next",
        false_next: "next",
        skip_on_false: false,
      };
    case "approval_gate":
      return {
        message: "Approve to continue?",
        allowed_roles: ["owner", "editor"],
      };
    default:
      return {};
  }
}
