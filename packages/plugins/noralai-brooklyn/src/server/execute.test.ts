import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@noralos/adapter-utils";

import { DEFAULT_UPSTREAM_MODEL_ID, execute } from "./execute.js";

function ctx(
  overrides: Partial<AdapterExecutionContext> = {},
  configOverrides: Record<string, unknown> = {},
): AdapterExecutionContext {
  const baseConfig: Record<string, unknown> = {
    baseUrl: "https://api.runpod.example/v2/abc/openai/v1",
    upstreamModel: "Qwen/Qwen3-32B-FP8",
    model: "brooklyn-core",
    apiKey: "rp_test_key_aaaaaaaaaaaaaaaaaaaa",
    timeoutSec: 5,
    maxRetries: 0,
    ...configOverrides,
  };
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Test Agent",
      adapterType: "noralai_brooklyn",
      adapterConfig: baseConfig,
    },
    runtime: {} as AdapterExecutionContext["runtime"],
    config: baseConfig,
    context: {
      noralosWakePrompt: "Hello Brooklyn, what is the capital of France?",
    },
    onLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.spyOn(global, "setTimeout").mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fn: any) => {
      Promise.resolve().then(() => fn());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
});

afterEach(() => vi.restoreAllMocks());

function chatOk(text = "Paris."): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text, role: "assistant" } }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ── Config validation at execute time ─────────────────────────────

describe("execute() config validation", () => {
  it("returns a config error when baseUrl is missing", async () => {
    const r = await execute(ctx({}, { baseUrl: "" }));
    expect(r.exitCode).toBe(1);
    expect(r.errorCode).toBe("brooklyn_config_missing");
    expect(r.errorMessage).toContain("baseUrl");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to DEFAULT_UPSTREAM_MODEL_ID when adapterConfig.upstreamModel is unset", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    const r = await execute(ctx({}, { upstreamModel: "" }));
    expect(r.exitCode).toBe(0);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe(DEFAULT_UPSTREAM_MODEL_ID);
  });

  it("respects a per-agent adapterConfig.upstreamModel override", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await execute(ctx({}, { upstreamModel: "some-backend/some-model-v2" }));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe("some-backend/some-model-v2");
    expect(body.model).not.toBe(DEFAULT_UPSTREAM_MODEL_ID);
  });

  it("returns a config error when apiKey is missing", async () => {
    const r = await execute(ctx({}, { apiKey: "", apiKeyRef: "" }));
    expect(r.errorCode).toBe("brooklyn_config_missing");
    expect(r.errorMessage).toContain("apiKey");
  });

  it("refuses an unresolved secret-ref string", async () => {
    const r = await execute(
      ctx({}, { apiKey: "", apiKeyRef: "company-secret:abc-123" }),
    );
    expect(r.errorCode).toBe("brooklyn_secret_ref_unresolved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns no_prompt when wake prompt is empty", async () => {
    const c = ctx({ context: {} });
    const r = await execute(c);
    expect(r.errorCode).toBe("brooklyn_no_prompt");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Happy path ────────────────────────────────────────────────────

describe("execute() happy path", () => {
  it("calls Brooklyn endpoint and returns a populated AdapterExecutionResult", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk("Paris."));
    const c = ctx();
    const r = await execute(c);

    expect(r.exitCode).toBe(0);
    expect(r.errorMessage).toBeFalsy();
    expect(r.provider).toBe("noralai_brooklyn");
    expect(r.biller).toBe("noralai_brooklyn");
    expect(r.model).toBe("brooklyn-core");
    expect(r.billingType).toBe("metered_api");
    expect(r.costUsd).toBeNull();
    expect(r.usage?.inputTokens).toBe(20);
    expect(r.usage?.outputTokens).toBe(4);
    expect(r.summary).toContain("Paris");
    expect((c.onLog as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
      "stdout",
      "Paris.",
    ]);
  });

  it("sends the wake prompt as a user message and uses Bearer auth", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await execute(ctx());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/chat\/completions$/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer rp_test_key_aaaaaaaaaaaaaaaaaaaa");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "Hello Brooklyn, what is the capital of France?" },
    ]);
    expect(body.model).toBe("Qwen/Qwen3-32B-FP8");
  });

  it("passes temperature and maxTokens through when set", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    await execute(ctx({}, { temperature: 0.5, maxTokens: 128 }));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(128);
  });
});

// ── Error paths ───────────────────────────────────────────────────

describe("execute() error paths", () => {
  async function assertExecuteError(
    status: number,
    expectedFamily: AdapterExecutionResult["errorFamily"],
    expectedCode: string,
  ): Promise<void> {
    fetchSpy.mockResolvedValueOnce(new Response("body", { status }));
    const c = ctx();
    const r = await execute(c);
    expect(r.exitCode).toBe(1);
    expect(r.errorCode).toBe(expectedCode);
    expect(r.errorFamily).toBe(expectedFamily);
  }

  it("401 → auth error, family null (no retry)", async () => {
    await assertExecuteError(401, null, "brooklyn_auth");
  });

  it("403 → auth error, family null (no retry)", async () => {
    await assertExecuteError(403, null, "brooklyn_auth");
  });

  it("429 → rate_limit, family transient_upstream", async () => {
    await assertExecuteError(429, "transient_upstream", "brooklyn_rate_limit");
  });

  it("503 → server, family transient_upstream", async () => {
    await assertExecuteError(503, "transient_upstream", "brooklyn_server");
  });

  it("404 → not_found, family null", async () => {
    await assertExecuteError(404, null, "brooklyn_not_found");
  });
});

// ── Secret hygiene ────────────────────────────────────────────────

describe("execute() secret hygiene", () => {
  it("never echoes the API key in the AdapterExecutionResult", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    const r = await execute(ctx());
    expect(JSON.stringify(r)).not.toContain("rp_test_key");
  });

  it("never echoes the API key in onLog output on success", async () => {
    fetchSpy.mockResolvedValueOnce(chatOk());
    const c = ctx();
    await execute(c);
    const logCalls = (c.onLog as ReturnType<typeof vi.fn>).mock.calls.map((x) => x.join(" "));
    for (const line of logCalls) {
      expect(line).not.toContain("rp_test_key");
    }
  });

  it("never echoes the API key in onLog output on failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "auth fail rp_test_key_aaaaaaaaaaaaaaaaaaaa" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    const c = ctx();
    const r = await execute(c);
    expect(r.errorCode).toBe("brooklyn_auth");
    const logCalls = (c.onLog as ReturnType<typeof vi.fn>).mock.calls.map((x) => x.join(" "));
    for (const line of logCalls) {
      expect(line).not.toContain("rp_test_key");
    }
    expect(JSON.stringify(r)).not.toContain("rp_test_key");
  });

  it("never echoes the upstream model id in errorMessage", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const r = await execute(ctx());
    expect(r.errorMessage ?? "").not.toContain("Qwen");
  });
});
