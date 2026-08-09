"use client";

import { use } from "react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { LiveRunView } from "@/components/run/LiveRunView";

export default function WorkflowRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = use(params);

  return (
    <RequireAuth>
      <AppShell>
        <LiveRunView workflowId={id} runId={runId} />
      </AppShell>
    </RequireAuth>
  );
}
