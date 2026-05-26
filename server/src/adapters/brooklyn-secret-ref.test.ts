import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdapterAgent,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@noralos/adapter-utils";

import type { ServerAdapterModule } from "./types.js";
import {
  BROOKLYN_ADAPTER_TYPE,
  getBrooklynCredentialResolver,
  setBrooklynCredentialResolver,
  wrapBrooklynAdapter,
} from "./brooklyn-secret-ref.js";

const COMPANY_ID = "company-1";
const PLAINTEXT = "rp_plaintext_key_VERY_secret_value";
const CREDENTIAL_ID = "abc-123";
const REF = `company-secret:${CREDENTIAL_ID}`;

function agent(): AdapterAgent {
  return {
    id: "agent-1",
    companyId: COMPANY_ID,
    name: "Brooklyn-Test",
    adapterType: BROOKLYN_ADAPTER_TYPE,
    adapterConfig: {},
  };
}

function executionCtx(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: agent(),
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: { noralosWakePrompt: "hello" },
    onLog: async () => {},
  };
}

function envTestCtx(config: Record<string, unknown>): AdapterEnvironmentTestContext {
  return {
    companyId: COMPANY_ID,
    adapterType: BROOKLYN_ADAPTER_TYPE,
    config,
  };
}

function fakePassResult(): AdapterExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    provider: BROOKLYN_ADAPTER_TYPE,
    biller: BROOKLYN_ADAPTER_TYPE,
    model: "brooklyn-core",
    costUsd: null,
    billingType: "metered_api",
  };
}

function fakeAdapter(
  executeFn: (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>,
  testEnvFn?: (ctx: AdapterEnvironmentTestContext) => Promise<AdapterEnvironmentTestResult>,
): ServerAdapterModule {
  return {
    type: BROOKLYN_ADAPTER_TYPE,
    execute: executeFn,
    testEnvironment:
      testEnvFn ??
      (async (ctx) => ({
        adapterType: ctx.adapterType,
        status: "pass",
        checks: [],
        testedAt: new Date().toISOString(),
      })),
    models: [{ id: "brooklyn-core", label: "Brooklyn Core" }],
    supportsInstructionsBundle: false,
    requiresMaterializedRuntimeSkills: false,
  };
}

beforeEach(() => {
  setBrooklynCredentialResolver(null);
});

afterEach(() => {
  setBrooklynCredentialResolver(null);
  vi.restoreAllMocks();
});

describe("wrapBrooklynAdapter — execute()", () => {
  it("refuses when an apiKeyRef is present but no resolver is registered", async () => {
    const innerExecute = vi.fn(async (_ctx: AdapterExecutionContext) => fakePassResult());
    const wrapped = wrapBrooklynAdapter(fakeAdapter(innerExecute));

    const result = await wrapped.execute(executionCtx({ apiKeyRef: REF, baseUrl: "https://x" }));

    expect(innerExecute).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("brooklyn_no_resolver");
    expect(JSON.stringify(result)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL_ID);
  });

  it("refuses and surfaces a safe error when the resolver throws", async () => {
    setBrooklynCredentialResolver(async () => {
      throw new Error(`db lookup failed for ${CREDENTIAL_ID}`);
    });

    const innerExecute = vi.fn(async (_ctx: AdapterExecutionContext) => fakePassResult());
    const wrapped = wrapBrooklynAdapter(fakeAdapter(innerExecute));

    const result = await wrapped.execute(executionCtx({ apiKeyRef: REF }));

    expect(innerExecute).not.toHaveBeenCalled();
    expect(result.errorCode).toBe("brooklyn_resolve_failed");
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL_ID);
    expect(result.errorMessage).not.toContain("db lookup");
  });

  it("treats an empty resolved value as a resolve failure", async () => {
    setBrooklynCredentialResolver(async () => "");

    const innerExecute = vi.fn(async (_ctx: AdapterExecutionContext) => fakePassResult());
    const wrapped = wrapBrooklynAdapter(fakeAdapter(innerExecute));

    const result = await wrapped.execute(executionCtx({ apiKeyRef: REF }));

    expect(innerExecute).not.toHaveBeenCalled();
    expect(result.errorCode).toBe("brooklyn_resolve_failed");
  });

  it("passes the resolved plaintext as apiKey and strips apiKeyRef before invoking the adapter", async () => {
    const seenConfigs: Record<string, unknown>[] = [];
    setBrooklynCredentialResolver(async (companyId, credentialId) => {
      expect(companyId).toBe(COMPANY_ID);
      expect(credentialId).toBe(CREDENTIAL_ID);
      return PLAINTEXT;
    });

    const innerExecute = vi.fn(async (ctx: AdapterExecutionContext) => {
      seenConfigs.push(ctx.config);
      return fakePassResult();
    });
    const wrapped = wrapBrooklynAdapter(fakeAdapter(innerExecute));

    const originalConfig = { apiKeyRef: REF, baseUrl: "https://x", upstreamModel: "m" };
    const result = await wrapped.execute(executionCtx(originalConfig));

    expect(innerExecute).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);

    const innerConfig = seenConfigs[0];
    expect(innerConfig.apiKey).toBe(PLAINTEXT);
    expect(innerConfig.apiKeyRef).toBeUndefined();
    expect(innerConfig.baseUrl).toBe("https://x");

    // The caller's original config object is untouched — the heartbeat
    // layer keeps the ref for audit while the adapter sees plaintext.
    expect(originalConfig.apiKeyRef).toBe(REF);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((originalConfig as any).apiKey).toBeUndefined();
  });

  it("does not invoke the resolver when apiKey is already plaintext", async () => {
    const resolver = vi.fn(async () => PLAINTEXT);
    setBrooklynCredentialResolver(resolver);

    const innerExecute = vi.fn(async (_ctx: AdapterExecutionContext) => fakePassResult());
    const wrapped = wrapBrooklynAdapter(fakeAdapter(innerExecute));

    await wrapped.execute(executionCtx({ apiKey: "literal_key_value" }));

    expect(resolver).not.toHaveBeenCalled();
    expect(innerExecute).toHaveBeenCalledTimes(1);
  });

  it("never echoes plaintext or credential id in error fields produced by the wrapper", async () => {
    setBrooklynCredentialResolver(async () => {
      throw new Error("connection refused");
    });

    const wrapped = wrapBrooklynAdapter(
      fakeAdapter(async () => fakePassResult()),
    );

    const result = await wrapped.execute(executionCtx({ apiKeyRef: REF }));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(PLAINTEXT);
    expect(serialized).not.toContain(CREDENTIAL_ID);
    expect(serialized).not.toContain("company-secret:");
  });
});

describe("wrapBrooklynAdapter — testEnvironment()", () => {
  it("resolves apiKeyRef to apiKey before delegating to the inner probe", async () => {
    setBrooklynCredentialResolver(async () => PLAINTEXT);

    const seen: Record<string, unknown>[] = [];
    const wrapped = wrapBrooklynAdapter(
      fakeAdapter(
        async () => fakePassResult(),
        async (ctx) => {
          seen.push(ctx.config);
          return {
            adapterType: ctx.adapterType,
            status: "pass",
            checks: [],
            testedAt: new Date().toISOString(),
          };
        },
      ),
    );

    await wrapped.testEnvironment(envTestCtx({ apiKeyRef: REF, baseUrl: "https://x" }));

    expect(seen[0].apiKey).toBe(PLAINTEXT);
    expect(seen[0].apiKeyRef).toBeUndefined();
  });

  it("falls through to the inner probe when no resolver is registered (plugin reports unresolved_secret_ref)", async () => {
    const seen: Record<string, unknown>[] = [];
    const wrapped = wrapBrooklynAdapter(
      fakeAdapter(
        async () => fakePassResult(),
        async (ctx) => {
          seen.push(ctx.config);
          return {
            adapterType: ctx.adapterType,
            status: "fail",
            checks: [{ code: "unresolved_secret_ref", level: "error", message: "x" }],
            testedAt: new Date().toISOString(),
          };
        },
      ),
    );

    const result = await wrapped.testEnvironment(envTestCtx({ apiKeyRef: REF }));

    // The wrapper did NOT resolve and DID forward the original config.
    expect(seen[0].apiKeyRef).toBe(REF);
    expect(seen[0].apiKey).toBeUndefined();
    expect(result.status).toBe("fail");
  });
});

describe("setBrooklynCredentialResolver", () => {
  it("getter reflects the most recent set", () => {
    expect(getBrooklynCredentialResolver()).toBeNull();
    const fn = async () => "x";
    setBrooklynCredentialResolver(fn);
    expect(getBrooklynCredentialResolver()).toBe(fn);
    setBrooklynCredentialResolver(null);
    expect(getBrooklynCredentialResolver()).toBeNull();
  });
});
