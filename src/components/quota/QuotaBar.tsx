"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useOrg } from "@/components/providers/AppProviders";
import { QuotaIndicator } from "@/components/quota/QuotaIndicator";
import { gqlRequest } from "@/lib/graphql/client";
import { GET_USAGE } from "@/lib/graphql/operations";
import type { GqlUsage } from "@/lib/graphql/types";

/** Loads authoritative org quota from Hasura for shell / page chrome. */
export function QuotaBar({ compact = true }: { compact?: boolean }) {
  const { session } = useAuth();
  const { orgId } = useOrg();
  const [usage, setUsage] = useState<GqlUsage | null>(null);

  const load = useCallback(async () => {
    if (!session || !orgId) {
      setUsage(null);
      return;
    }
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

  if (!orgId) return null;
  return <QuotaIndicator usage={usage} compact={compact} />;
}
