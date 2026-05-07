import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProviderTest } from "../services/integrations/provider-tests.ts";

describe("runProviderTest", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("substitutes placeholders into the URL for google_tts", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("provider body would not leak", { status: 200 }),
    );
    const result = await runProviderTest("google_tts", { apiKey: "AIza-secret-1234" });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.safeMessage).toBe("Provider accepted the credential.");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("AIza-secret-1234");
    expect(url).toContain("texttospeech.googleapis.com");
  });

  it("sends elevenlabs key in the xi-api-key header, not the URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await runProviderTest("elevenlabs", { apiKey: "el-secret-abcd" });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url as string).not.toContain("el-secret-abcd");
    expect(((init as RequestInit | undefined)?.headers as Record<string, string>)["xi-api-key"]).toBe("el-secret-abcd");
  });

  it("returns a safe message on 401 and never returns the provider body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Provider body — secret leak attempt", { status: 401 }),
    );
    const result = await runProviderTest("google_tts", { apiKey: "bad-key" });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.safeMessage).toBe("Google Cloud TTS rejected the key (HTTP 401).");
    expect(result.safeMessage).not.toContain("Provider body");
  });

  it("returns a safe message when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down — value=secret123"));
    const result = await runProviderTest("elevenlabs", { apiKey: "el-key" });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.safeMessage).toBe("ElevenLabs rejected the key: network error.");
    expect(result.safeMessage).not.toContain("secret123");
  });

  it("rejects unknown providers without firing a request", async () => {
    const result = await runProviderTest("twilio", { authToken: "x" });
    expect(result.ok).toBe(false);
    expect(result.safeMessage).toContain("Unknown provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the registry references a missing field", async () => {
    // We simulate a misconfigured registry entry by passing fields that
    // don't include the placeholder key. Should never fire a request.
    const result = await runProviderTest("google_tts", { wrong: "value" });
    expect(result.ok).toBe(false);
    expect(result.safeMessage).toContain("missing field");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runProviderTest — DTO never includes the plaintext", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("never echoes the plaintext in the result safeMessage", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    const apiKey = "VERY-SECRET-KEY-UNIQUE-TOKEN";
    const result = await runProviderTest("elevenlabs", { apiKey });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(apiKey);
  });
});
