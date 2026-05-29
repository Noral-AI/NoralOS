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

  it("substitutes apiDomain into the URL and uses Zoho-oauthtoken header (not Bearer)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await runProviderTest("zoho", {
      apiDomain: "https://www.zohoapis.com",
      accessToken: "1000.ACCESS",
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url as string).toBe("https://www.zohoapis.com/crm/v7/users?type=CurrentUser");
    // Zoho's auth header is product-specific. Pin the scheme so a sloppy
    // refactor to standard `Bearer ` doesn't silently break the probe.
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Zoho-oauthtoken 1000.ACCESS");
    expect(url as string).not.toContain("ACCESS");
  });

  it("rejects unknown providers without firing a request", async () => {
    const result = await runProviderTest("not_a_real_provider", { authToken: "x" });
    expect(result.ok).toBe(false);
    expect(result.safeMessage).toContain("Unknown provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives Authorization: Basic <base64(sid:secret)> for twilio without leaking either half into the URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await runProviderTest("twilio", {
      accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      apiKeySid: "SKyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
      apiKeySecret: "TOP-SECRET-twilio-value",
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url as string).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.json",
    );
    expect(url as string).not.toContain("TOP-SECRET");
    expect(url as string).not.toContain("SKyyy");
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from(
      "SKyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy:TOP-SECRET-twilio-value",
      "utf8",
    ).toString("base64")}`;
    expect(headers.Authorization).toBe(expected);
  });

  it("fails fast (no fetch) when twilio is called without the basic-auth pair", async () => {
    const result = await runProviderTest("twilio", {
      accountSid: "AC123",
      // apiKeySid + apiKeySecret deliberately missing
    });
    expect(result.ok).toBe(false);
    expect(result.safeMessage).toContain("missing field");
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

describe("runProviderTest — noralai_brooklyn multi-probe (DeepSeek fallback)", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes on the primary RunPod probe without firing the DeepSeek fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await runProviderTest("noralai_brooklyn", { apiKey: "runpod-key" });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.safeMessage).toBe("Provider accepted the credential.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0] as string).toBe(
      "https://rest.runpod.io/v1/endpoints",
    );
  });

  it("falls back to DeepSeek when the primary probe rejects the key", async () => {
    // Primary (RunPod) 401, fallback (DeepSeek) 200 → overall pass.
    fetchMock
      .mockResolvedValueOnce(new Response("runpod says no", { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const apiKey = "sk-deepseek-UNIQUE-TOKEN";
    const result = await runProviderTest("noralai_brooklyn", { apiKey });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.safeMessage).toBe("Provider accepted the credential.");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The DeepSeek probe carries the key in the Authorization header, never the URL.
    const [dsUrl, dsInit] = fetchMock.mock.calls[1] ?? [];
    expect(dsUrl as string).toBe("https://api.deepseek.com/user/balance");
    expect(dsUrl as string).not.toContain(apiKey);
    const headers = (dsInit as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${apiKey}`);
  });

  it("reports the PRIMARY failure (no DeepSeek mention, no key leak) when both probes reject", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("runpod body", { status: 401 }))
      .mockResolvedValueOnce(new Response("deepseek body", { status: 401 }));
    const apiKey = "TOTALLY-INVALID-SECRET";
    const result = await runProviderTest("noralai_brooklyn", { apiKey });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.safeMessage).toBe("Brooklyn LLM provider rejected the key (HTTP 401).");
    expect(result.safeMessage).not.toMatch(/deepseek/i);
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
