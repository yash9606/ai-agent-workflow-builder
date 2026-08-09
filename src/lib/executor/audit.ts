import type { PoolClient } from "pg";
import { query, type DbClient } from "@/lib/db";
import type { JsonObject } from "@/lib/types";

export async function writeAuditLog(
  client: DbClient | PoolClient | undefined,
  options: {
    orgId?: string | null;
    userId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    details?: JsonObject;
  }
): Promise<void> {
  const sql = `INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)`;
  const params = [
    options.orgId ?? null,
    options.userId ?? null,
    options.action,
    options.resourceType ?? null,
    options.resourceId ?? null,
    JSON.stringify(options.details ?? {}),
  ];

  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}
