import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Force the adapter-plugin-store to read/write a throwaway directory so
// this test never touches the developer's actual ~/.paperclip state.
// vi.hoisted runs before the static imports below, which means the
// registry.ts module-load IIFE sees the isolated NORALOS_HOME from the
// very first listAdapterPlugins() call. The callback cannot reference
// other module-scope bindings (they haven't been initialised yet), so
// it pulls fs/os/path inline via require().
const TEST_HOME = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  const dir = mkdtempSync(nodePath.join(tmpdir(), "noralos-brooklyn-test-"));
  process.env.NORALOS_HOME = dir;
  return dir;
});

import type {
  AdapterAgent,
  AdapterExecutionContext,
} from "@noralos/adapter-utils";

import {
  ensureBrooklynRegistered,
} from "./auto-register-brooklyn.js";
import {
  findServerAdapter,
  listServerAdapters,
  unregisterServerAdapter,
  waitForExternalAdapters,
} from "./registry.js";
import {
  BROOKLYN_ADAPTER_TYPE,
  setBrooklynCredentialResolver,
} from "./brooklyn-secret-ref.js";
import {
  listAdapterPlugins,
  removeAdapterPlugin,
} from "../services/adapter-plugin-store.js";

const COMPANY_ID = "company-1";
const PLAINTEXT = "rp_resolved_plaintext_x9";
const CREDENTIAL_ID = "cred-9";
const REF = `company-secret:${CREDENTIAL_ID}`;

function agent(): AdapterAgent {
  return {
    id: "agent-1",
    companyId: COMPANY_ID,
    name: "Brooklyn-Smoke",
    adapterType: BROOKLYN_ADAPTER_TYPE,
    adapterConfig: {},
  };
}

function executionCtx(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-smoke",
    agent: agent(),
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: { noralosWakePrompt: "hello" },
    onLog: async () => {},
  };
}

beforeAll(async () => {
  // Make sure the module-load IIFE has fully resolved before the first test.
  await waitForExternalAdapters();
});

beforeEach(() => {
  // Re-register cleanly per test so order doesn't matter.
  unregisterServerAdapter(BROOKLYN_ADAPTER_TYPE);
  removeAdapterPlugin(BROOKLYN_ADAPTER_TYPE);
  setBrooklynCredentialResolver(null);
});

afterEach(() => {
  unregisterServerAdapter(BROOKLYN_ADAPTER_TYPE);
  removeAdapterPlugin(BROOKLYN_ADAPTER_TYPE);
  setBrooklynCredentialResolver(null);
});

afterAll(() => {
  // Best-effort cleanup of the throwaway home dir.
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("ensureBrooklynRegistered", () => {
  it("registers the Brooklyn adapter from the workspace on first call", async () => {
    expect(findServerAdapter(BROOKLYN_ADAPTER_TYPE)).toBeNull();

    const outcome = await ensureBrooklynRegistered();

    expect(outcome.registered).toBe(true);
    expect(outcome.performedRegistration).toBe(true);
    expect(outcome.persistedToStore).toBe(true);

    const adapter = findServerAdapter(BROOKLYN_ADAPTER_TYPE);
    expect(adapter).not.toBeNull();
    expect(adapter?.type).toBe(BROOKLYN_ADAPTER_TYPE);

    // The plugin store should have a single Brooklyn record pointing at
    // the workspace package — not a registry npm package.
    const stored = listAdapterPlugins().filter((r) => r.type === BROOKLYN_ADAPTER_TYPE);
    expect(stored).toHaveLength(1);
    expect(stored[0].packageName).toBe("@noralos-plugins/noralai-brooklyn");
    expect(stored[0].localPath).toBeTruthy();
  });

  it("appears in listServerAdapters after registration", async () => {
    await ensureBrooklynRegistered();
    const types = listServerAdapters().map((a) => a.type);
    expect(types).toContain(BROOKLYN_ADAPTER_TYPE);
  });

  it("is idempotent — second call is a no-op", async () => {
    const first = await ensureBrooklynRegistered();
    expect(first.performedRegistration).toBe(true);

    const second = await ensureBrooklynRegistered();
    expect(second.registered).toBe(true);
    expect(second.performedRegistration).toBe(false);
    expect(second.persistedToStore).toBe(false);
  });
});

describe("Brooklyn end-to-end via the registry", () => {
  it("registered Brooklyn refuses an apiKeyRef when no resolver is set", async () => {
    await ensureBrooklynRegistered();
    const adapter = findServerAdapter(BROOKLYN_ADAPTER_TYPE)!;

    const result = await adapter.execute(
      executionCtx({ apiKeyRef: REF, baseUrl: "https://x", upstreamModel: "m" }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("brooklyn_no_resolver");
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL_ID);
  });

  it("smoke execute: resolved plaintext reaches the adapter and triggers an upstream fetch (mocked)", async () => {
    await ensureBrooklynRegistered();
    setBrooklynCredentialResolver(async (companyId, credentialId) => {
      expect(companyId).toBe(COMPANY_ID);
      expect(credentialId).toBe(CREDENTIAL_ID);
      return PLAINTEXT;
    });

    // The plugin uses globalThis.fetch — intercept it so the smoke
    // test runs entirely in-process and we can inspect what the
    // resolved-plaintext call actually looked like on the wire.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok", role: "assistant" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const adapter = findServerAdapter(BROOKLYN_ADAPTER_TYPE)!;
    const result = await adapter.execute(
      executionCtx({
        apiKeyRef: REF,
        baseUrl: "https://api.example/v1",
        upstreamModel: "Qwen/Qwen3-32B-FP8",
        timeoutSec: 5,
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const authHeader = (init.headers as Record<string, string>)["Authorization"];
    expect(authHeader).toBe(`Bearer ${PLAINTEXT}`);

    expect(result.exitCode).toBe(0);
    expect(result.provider).toBe(BROOKLYN_ADAPTER_TYPE);

    // The result must not echo the plaintext or the reference back out.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PLAINTEXT);
    expect(serialized).not.toContain(CREDENTIAL_ID);
    expect(serialized).not.toContain("company-secret:");

    fetchSpy.mockRestore();
  });
});
