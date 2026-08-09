import { describe, expect, it, vi } from "vitest";
import { executeHttpRequest, validateHttpUrl } from "@/lib/executor/http-step";

describe("executeHttpRequest", () => {
  it("rejects non-http protocols", () => {
    expect(() => validateHttpUrl("file:///etc/passwd")).toThrow(/protocol/i);
    expect(() => validateHttpUrl("javascript:alert(1)")).toThrow(/protocol/i);
  });

  it("blocks localhost and private addresses", () => {
    expect(() => validateHttpUrl("http://localhost/admin")).toThrow(/private|localhost/i);
    expect(() => validateHttpUrl("http://127.0.0.1/")).toThrow(/private|localhost/i);
    expect(() => validateHttpUrl("http://192.168.1.1/")).toThrow(/private|localhost/i);
  });

  it("returns response payload for public URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeHttpRequest({
      method: "GET",
      url: "https://example.com/ok",
      timeout_ms: 5000,
    });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
