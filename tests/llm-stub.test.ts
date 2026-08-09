import { afterEach, describe, expect, it, vi } from "vitest";

describe("callLlm stub mode", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns POSITIVE for positive-sentiment prompts without API key", async () => {
    vi.stubEnv("LLM_PROVIDER", "stub");
    vi.stubEnv("LLM_API_KEY", "");
    const { callLlm } = await import("@/lib/llm/provider");
    const result = await callLlm({
      prompt: "Classify this text: Great product, I love it!",
    });
    expect(result.stub).toBe(true);
    expect(result.text).toBe("POSITIVE");
  });

  it("returns NEGATIVE for negative-sentiment prompts", async () => {
    vi.stubEnv("LLM_PROVIDER", "stub");
    vi.stubEnv("LLM_API_KEY", "");
    const { callLlm } = await import("@/lib/llm/provider");
    const result = await callLlm({
      prompt: "Classify this text: Terrible and broken",
    });
    expect(result.text).toBe("NEGATIVE");
  });
});
