import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getEnv } from "@/lib/env";

declare global {
  var __workflowBuilderPool: Pool | undefined;
}

function createPool(): Pool {
  const env = getEnv();
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export function getPool(): Pool {
  if (!globalThis.__workflowBuilderPool) {
    globalThis.__workflowBuilderPool = createPool();
  }
  return globalThis.__workflowBuilderPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export type DbClient = Pool | PoolClient;
