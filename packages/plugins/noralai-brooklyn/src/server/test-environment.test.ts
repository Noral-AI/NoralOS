import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdapterEnvironmentTestContext } from "@noralos/adapter-utils";

import { testEnvironment } from "./test-environment.js";

function ctx(configOverrides: Record<string, unknown> = {}): AdapterEnvironmentTestContext {
  return {
    companyId: "company-1",
    adapterType: "noralai_brooklyn",
    config: {
      baseUrl: "https://api.runpod.example/v2/abc/openai/v1",
      upstreamModel: "Qwen/Qwen3-32B-FP8",
      apiKey: "rp_test_key_aaaaaaaaaaaaaaaaaaaa",
      timeoutSec: 5,
      ...configOverrides,
    },
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

describe("testEnvironment static checks", () => {
  it("fails on missing baseUrl", async () => {
    const r = await testEnvironment(ctx({ baseUrl: "" }));
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "missing_base_url")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails on missing upstreamModel", async () => {
    const r = await testEnvironment(ctx({ upstreamModel: "" }));
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "missing_upstream_model")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails on missing API key", async () => {
    const r = await testEnvironment(ctx({ apiKey: "" }));
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "missing_api_key")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails on unresolved secret-ref", async () => {
    const r = await testEnvironment(
      ctx({ apiKey: "", apiKeyRef: "company-secret:abc" }),
    );
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "unresolved_secret_ref")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("testEnvironment live probe", () => {
  it("returns pass on a 200 from the live probe", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok", role: "assistant" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = await testEnvironment(ctx());
    expect(r.status).toBe("pass");
    expect(r.checks.find((c) => c.code === "probe_ok")).toBeDefined();
  });

  it("returns fail on 401 with a probe_auth check", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const r = await testEnvironment(ctx());
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "probe_auth")).toBeDefined();
  });

  it("returns fail on 503 with a probe_server check", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const r = await testEnvironment(ctx());
    expect(r.status).toBe("fail");
    expect(r.checks.find((c) => c.code === "probe_server")).toBeDefined();
  });

  it("never echoes the api key in any check field", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("auth fail rp_test_key_aaaaaaaaaaaaaaaaaaaa", { status: 401 }),
    );
    const r = await testEnvironment(ctx());
    expect(JSON.stringify(r)).not.toContain("rp_test_key");
  });
});
