import { GraphQLClient, ClientError } from "graphql-request";
import { createClient, type Client as WsClient } from "graphql-ws";
import { getSession } from "@/lib/auth/session";

function httpUrl(): string {
  const url = process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_HASURA_GRAPHQL_URL is not set");
  }
  return url;
}

/**
 * GraphQL WebSocket URL for subscriptions.
 *
 * Prefer explicit `NEXT_PUBLIC_HASURA_WS_URL` when HTTP and WS hosts differ.
 * Otherwise derive from `NEXT_PUBLIC_HASURA_GRAPHQL_URL`:
 *   https:// → wss://
 *   http://  → ws://  (local only)
 */
export function hasuraWsUrl(httpGraphqlUrl?: string): string {
  const explicit = process.env.NEXT_PUBLIC_HASURA_WS_URL?.trim();
  if (explicit) {
    const u = new URL(explicit);
    if (u.protocol === "https:") u.protocol = "wss:";
    else if (u.protocol === "http:") u.protocol = "ws:";
    else if (u.protocol !== "wss:" && u.protocol !== "ws:") {
      throw new Error(
        "NEXT_PUBLIC_HASURA_WS_URL must use wss:// (production) or ws:// (local)"
      );
    }
    return u.toString();
  }

  const base = httpGraphqlUrl || httpUrl();
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/**
 * Hasura auth headers: ONLY the Bearer JWT.
 * Never send x-hasura-user-id / role from the client — Hasura must derive
 * session variables from the verified JWT claims.
 */
export function createGraphqlClient(accessToken?: string): GraphQLClient {
  const token = accessToken ?? getSession()?.accessToken;
  return new GraphQLClient(httpUrl(), {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : {},
  });
}

export async function gqlRequest<T>(
  document: string,
  variables?: Record<string, unknown>,
  accessToken?: string
): Promise<T> {
  const client = createGraphqlClient(accessToken);
  try {
    return await client.request<T>(document, variables);
  } catch (error) {
    throw toGraphqlError(error);
  }
}

export function toGraphqlError(error: unknown): Error {
  if (error instanceof ClientError) {
    const messages = error.response.errors?.map((e) => e.message).filter(Boolean);
    if (messages?.length) {
      return new Error(messages.join("; "));
    }
    return new Error(error.message || "GraphQL request failed");
  }
  if (error instanceof Error) return error;
  return new Error("GraphQL request failed");
}

export type SubscriptionHandlers<T> = {
  next: (data: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
};

export function createSubscriptionClient(accessToken?: string): WsClient {
  const token = accessToken ?? getSession()?.accessToken;
  return createClient({
    url: hasuraWsUrl(),
    connectionParams: {
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},
    },
    lazy: true,
    retryAttempts: 3,
  });
}

export function subscribeGraphql<T>(
  document: string,
  variables: Record<string, unknown>,
  handlers: SubscriptionHandlers<T>,
  accessToken?: string
): () => void {
  const client = createSubscriptionClient(accessToken);
  const unsubscribe = client.subscribe(
    { query: document, variables },
    {
      next: (result) => {
        if (result.errors?.length) {
          handlers.error?.(
            new Error(result.errors.map((e) => e.message).join("; "))
          );
          return;
        }
        if (result.data) {
          handlers.next(result.data as T);
        }
      },
      error: (err) => {
        handlers.error?.(
          err instanceof Error ? err : new Error(String(err))
        );
      },
      complete: () => {
        handlers.complete?.();
        void client.dispose();
      },
    }
  );

  return () => {
    unsubscribe();
    void client.dispose();
  };
}
