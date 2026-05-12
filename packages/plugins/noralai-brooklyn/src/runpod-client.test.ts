import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrooklynProviderError,
  brooklynChatComplete,
  isRetryable,
  type BrooklynClientConfig,
} from "./runpod-client.js";

const cfg: BrooklynClientConfig = {
  baseUrl: "https://api.runpod.example/v2/abc/openai/v1",
  apiKey: "rp_test_key_aaaaaaaaaaaaaaaaaaaa",
  upstreamModel: "Qwen/Qwen3-32B-FP8",
  timeoutMs: 5_000,
  maxRetries: 0,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // Make retry sleeps resolve immediately so retry tests don't hang.
  vi.spyOn(global, "setTimeout").mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fn: any) => {
      Promise.resolve().then(() => fn());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
});

afterEach(() => vi.restoreAllMocks());

function chatOk(text = "hi"): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text, role: "assistant" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ── isRetryable ───────────────────────────────────────────────────

describe("isRetryable", () => {
  it("retries transient categories", () => {
    for (const cat of ["network", "timeout", "rate_limit", "server"] as const) {
      expect(isRetryable(new BrooklynProviderError(cat, "x"))).toBe(true);
    }
  });

  it("retries 408/429/500/502/503/504 by status", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryable(new BrooklynProviderError("unknown", "x", s))).toBe(true);
    }
  });

  it("does NOT retry auth/not_found/malformed/400", () => {
    for (const cat of ["auth", "not_found", "malformed"] as const) {
      expect(isRetryable(new BrooklynProviderError(cat, "x"))).toBe(false);
    }
    expect(isRetryable(new BrooklynProviderError("unknown", "x", 400))).toBe(false);
    expect(isRetryable(new BrooklynProviderError("unknown", "x", 401))).toBe(false);
    expect(isRetryable(new BrooklynProviderError("unknown", "x", 404))).toBe(false);
  });
});

// ── Configuration guards ──────────────────────────────────────────

describe("brooklynChatComplete config guards", () => {
  it("throws misconfigured when baseUrl is missing", async () => {
    await expect(
      brooklynChatComplete(
        { ...cfg, baseUrl: "" },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "misconfigured" });
  });

  it("throws misconfigured when apiKey is missing", async () => {
    await expect(
      brooklynChatComplete(
        { ...cfg, apiKey: "" },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "misconfigured" });
  });

  it("throws misconfigured when upstreamModel is missing", async () => {
    await expect(
      brooklynChatComplete(
        { ...cfg, upstreamModel: "" },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "misconfigured" });
  });
});

// ── Happy path / request shape ────────────────────────────────────

describe("brooklynChatComplete request shape", () => {
  it("POSTs to /chat/completions with Bearer auth + the upstream model id", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk("hello"));
    const r = await brooklynChatComplete(cfg, {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(r.text).toBe("hello");
    expect(r.attempts).toBe(1);
    expect(r.usage?.promptTokens).toBe(12);
    expect(r.usage?.completionTokens).toBe(3);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.runpod.example/v2/abc/openai/v1/chat/completions");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer rp_test_key_aaaaaaaaaaaaaaaaaaaa");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("Qwen/Qwen3-32B-FP8");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("trims trailing slash from baseUrl", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await brooklynChatComplete(
      { ...cfg, baseUrl: "https://api.runpod.example/v1///" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.runpod.example/v1/chat/completions");
  });

  it("passes maxTokens and temperature when provided", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await brooklynChatComplete(cfg, {
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 256,
      temperature: 0.4,
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.4);
  });

  it("sets response_format when jsonMode is true", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await brooklynChatComplete(cfg, {
      messages: [{ role: "user", content: "hi" }],
      jsonMode: true,
    });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

// ── Error classification ──────────────────────────────────────────

describe("brooklynChatComplete error classification", () => {
  it("classifies 401 as auth", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "auth", status: 401 });
  });

  it("classifies 403 as auth", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "auth", status: 403 });
  });

  it("classifies 404 as not_found", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "not_found", status: 404 });
  });

  it("classifies 429 as rate_limit", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("slow", { status: 429 }));
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "rate_limit", status: 429 });
  });

  it("classifies 5xx as server", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "server", status: 503 });
  });

  it("classifies non-JSON 200 body as malformed", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ category: "malformed" });
  });

  it("classifies missing-choices 200 body as malformed", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(BrooklynProviderError);
  });
});

// ── Retry behavior ────────────────────────────────────────────────

describe("brooklynChatComplete retry behavior", () => {
  it("retries 503 up to maxRetries times, then succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(chatOk("eventually ok"));
    const r = await brooklynChatComplete(
      { ...cfg, maxRetries: 2 },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(r.text).toBe("eventually ok");
    expect(r.attempts).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry 401 (auth)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(
      brooklynChatComplete(
        { ...cfg, maxRetries: 3 },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "auth" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry malformed body", async () => {
    fetchSpy.mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      brooklynChatComplete(
        { ...cfg, maxRetries: 3 },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "malformed" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting retries on persistent 503", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }));
    await expect(
      brooklynChatComplete(
        { ...cfg, maxRetries: 1 },
        { messages: [{ role: "user", content: "hi" }] },
      ),
    ).rejects.toMatchObject({ category: "server" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ── Secret hygiene ────────────────────────────────────────────────

describe("brooklynChatComplete secret hygiene", () => {
  it("never includes the api key in thrown error messages", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "oh hello rp_test_key_aaaaaaaaaaaaaaaaaaaa" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    try {
      await brooklynChatComplete(cfg, { messages: [{ role: "user", content: "hi" }] });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BrooklynProviderError);
      expect((err as Error).message).not.toContain("rp_test_key");
    }
  });

  it("never includes the api key in the resolved result body", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    const r = await brooklynChatComplete(cfg, {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(JSON.stringify(r)).not.toContain("rp_test_key");
  });
});
