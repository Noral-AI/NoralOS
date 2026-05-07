import { afterEach, describe, expect, it, vi } from "vitest";
import { testGoogleTts } from "../services/integrations/providers/google-tts.ts";
import { testElevenLabs } from "../services/integrations/providers/elevenlabs.ts";

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  } as unknown as Response;
}

describe("provider tests — Google Cloud TTS", () => {
  it("returns ok on 200 with non-empty voices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(200, { voices: [{ name: "en-US-Standard-A" }] }),
    ) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "fake-google-key", metadata: {} });
    expect(result).toEqual({ status: "ok", statusCode: 200 });
  });

  it("maps 401 to unauthorized with sanitised message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { error: { message: "raw provider message" } }),
    ) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "bad", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") {
      expect(result.error).toBe("unauthorized");
      // Provider response body must never leak through the message.
      expect(result.message).not.toMatch(/raw provider message/i);
    }
  });

  it("maps 403 to forbidden", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(403, {})) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "bad", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") expect(result.error).toBe("forbidden");
  });

  it("maps 429 to rate_limited", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(429, {})) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "x", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") expect(result.error).toBe("rate_limited");
  });

  it("treats 200 with empty voices as a generic failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(200, { voices: [] })) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "x", metadata: {} });
    expect(result.status).toBe("fail");
  });

  it("maps fetch exceptions to network", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED")) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "x", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") {
      expect(result.error).toBe("network");
      // Underlying exception text must not leak.
      expect(result.message).not.toMatch(/ECONNREFUSED/);
    }
  });

  it("maps AbortError to timeout", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), {
      name: "AbortError",
    })) as unknown as typeof fetch;
    const result = await testGoogleTts({ secretValue: "x", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") expect(result.error).toBe("timeout");
  });
});

describe("provider tests — ElevenLabs", () => {
  it("returns ok on 200 with non-empty voices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(200, { voices: [{ voice_id: "abc" }] }),
    ) as unknown as typeof fetch;
    const result = await testElevenLabs({ secretValue: "key", metadata: {} });
    expect(result).toEqual({ status: "ok", statusCode: 200 });
  });

  it("uses xi-api-key header (not the URL)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { voices: [{ voice_id: "x" }] }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await testElevenLabs({ secretValue: "secret-value", metadata: {} });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).not.toMatch(/secret-value/);
    expect(init?.headers).toMatchObject({ "xi-api-key": "secret-value" });
  });

  it("maps 401 to unauthorized without leaking the response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { detail: "raw provider message containing PII" }),
    ) as unknown as typeof fetch;
    const result = await testElevenLabs({ secretValue: "bad", metadata: {} });
    expect(result.status).toBe("fail");
    if (result.status === "fail") {
      expect(result.error).toBe("unauthorized");
      expect(result.message).not.toMatch(/PII/);
    }
  });
});
