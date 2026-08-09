import type { PoolClient } from "pg";
import { AppError } from "@/lib/errors";

export async function consumeQuota(
  client: PoolClient,
  orgId: string,
  runId: string,
  reason: string
): Promise<void> {
  const result = await client.query<{ consume_org_quota: boolean }>(
    `SELECT consume_org_quota($1::uuid, $2::uuid, $3::text) AS consume_org_quota`,
    [orgId, runId, reason]
  );

  const ok = result.rows[0]?.consume_org_quota === true;
  if (!ok) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      "Organization monthly call quota exceeded",
      429
    );
  }
}
