"use client";

import type { GqlUsage } from "@/lib/graphql/types";

type Props = {
  usage: GqlUsage | null | undefined;
  compact?: boolean;
};

export function QuotaIndicator({ usage, compact }: Props) {
  if (!usage) {
    return (
      <div className="quota-indicator empty">
        <span className="muted">Quota unavailable</span>
      </div>
    );
  }

  const used = usage.current_month_calls_used;
  const allowed = usage.allowed_calls;
  const remaining = usage.remaining_calls;
  const pct = Math.min(100, Math.max(0, Number(usage.usage_percentage) || 0));
  const tone = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";

  if (compact) {
    return (
      <div
        className={`quota-indicator compact tone-${tone}`}
        title={`Monthly usage ${used}/${allowed} (${remaining} remaining)`}
      >
        <span className="quota-compact-label">
          {used}/{allowed}
        </span>
        <div
          className="quota-bar"
          role="progressbar"
          aria-label="Monthly organization quota"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={`quota-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="quota-indicator">
      <div className="quota-meta">
        <strong>Monthly usage</strong>
        <span>
          {used} used · {allowed} allowed · {remaining} remaining ({pct}%)
        </span>
      </div>
      <div
        className="quota-bar"
        role="progressbar"
        aria-label="Monthly organization quota"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`quota-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
