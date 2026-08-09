import { afterEach, describe, expect, it, vi } from "vitest";
import { hasuraWsUrl } from "@/lib/graphql/client";

describe("hasuraWsUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives wss:// from https GraphQL HTTP URL", () => {
    vi.stubEnv("NEXT_PUBLIC_HASURA_WS_URL", "");
    expect(
      hasuraWsUrl("https://xxx.hasura.app/v1/graphql")
    ).toBe("wss://xxx.hasura.app/v1/graphql");
  });

  it("derives ws:// from http GraphQL HTTP URL (local)", () => {
    vi.stubEnv("NEXT_PUBLIC_HASURA_WS_URL", "");
    expect(
      hasuraWsUrl("http://localhost:8080/v1/graphql")
    ).toBe("ws://localhost:8080/v1/graphql");
  });

  it("uses independent NEXT_PUBLIC_HASURA_WS_URL when set", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_WS_URL",
      "wss://subscriptions.example.com/v1/graphql"
    );
    expect(hasuraWsUrl("https://api.example.com/v1/graphql")).toBe(
      "wss://subscriptions.example.com/v1/graphql"
    );
  });

  it("upgrades https explicit WS URL to wss://", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_HASURA_WS_URL",
      "https://subscriptions.example.com/v1/graphql"
    );
    expect(hasuraWsUrl()).toBe(
      "wss://subscriptions.example.com/v1/graphql"
    );
  });
});
