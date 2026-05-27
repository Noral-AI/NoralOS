// Unit-level coverage for the assignment writer's most security-relevant
// promises: it preserves every unrelated config field and only writes
// the named slot path. Each test mocks the drizzle/registry boundary so
// we exercise the merge logic without touching a real database.
//
// Tests target `noralai.brooklyn`'s single `apiKeyRef` slot — voice-cascade
// (the original two-slot fixture) was retired in Phase 6 PR-3.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unprocessable } from "../errors.js";

// ----- Hoisted mocks ---------------------------------------------------
// Vitest hoists `vi.mock` calls; the mocked modules need to use stub
// objects we control from each test. We expose those stubs via
// `vi.hoisted` so the module factory can refer to them.
const mocks = vi.hoisted(() => ({
  credentialRow: null as null | {
    id: string;
    companyId: string;
    secretId: string;
    provider: string;
    status: "active" | "disabled";
  },
  pluginRow: null as null | {
    id: string;
    pluginKey: string;
    manifestJson: { displayName?: string };
  },
  patchedConfig: null as null | { configJson: Record<string, unknown> },
  patchCalls: [] as Array<{ pluginId: string; configJson: Record<string, unknown> }>,
  upsertCalls: [] as Array<{ pluginId: string; configJson: Record<string, unknown> }>,
  txCalls: [] as Array<{ kind: "delete-assignment" | "insert-assignment"; payload?: unknown }>,
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => ({
    patchConfig: async (pluginId: string, input: { configJson: Record<string, unknown> }) => {
      mocks.patchCalls.push({ pluginId, configJson: input.configJson });
      mocks.patchedConfig = {
        configJson: {
          ...((mocks.patchedConfig?.configJson ?? {}) as Record<string, unknown>),
          ...input.configJson,
        },
      };
      return mocks.patchedConfig!;
    },
    upsertConfig: async (pluginId: string, input: { configJson: Record<string, unknown> }) => {
      mocks.upsertCalls.push({ pluginId, configJson: input.configJson });
      mocks.patchedConfig = { configJson: { ...input.configJson } };
      return mocks.patchedConfig;
    },
  }),
}));

vi.mock("../services/integrations/credentials.js", () => ({
  integrationCredentialService: () => ({
    loadCredentialRow: async (_id: string) => mocks.credentialRow,
    getById: async (_companyId: string, _id: string) => ({
      id: mocks.credentialRow?.id ?? "",
      provider: mocks.credentialRow?.provider ?? "",
      assignments: [],
    }),
    list: async () => [],
  }),
}));

// The assignment service uses `eq()` etc. from drizzle and the schema
// table imports — but we never call `db.select/insert/delete` directly
// because we mock the registry. The only DB call left is the inner
// `db.transaction(async tx => ...)` for the assignment row + the final
// `db.delete(...)` rollback path. We stub those by passing a minimal
// mock `db` object with `transaction(fn)` and chainable `delete().where(...)`.
function makeMockDb() {
  const txDelegate = {
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: (payload: unknown) => {
        mocks.txCalls.push({ kind: "insert-assignment", payload });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([mocks.pluginRow].filter(Boolean)),
      }),
    }),
  };
  return {
    transaction: async <T,>(fn: (tx: typeof txDelegate) => Promise<T>) => fn(txDelegate),
    delete: txDelegate.delete,
    insert: txDelegate.insert,
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([mocks.pluginRow].filter(Boolean)),
      }),
    }),
  } as never;
}

import { integrationAssignmentService } from "../services/integrations/assignments.js";

const COMPANY = "00000000-0000-4000-8000-000000000001";
const QUENTIN_ACTOR = { userId: "user-quentin", agentId: null };
const PLUGIN_ID = "00000000-0000-4000-8000-aaaaaaaaaaaa";

beforeEach(() => {
  mocks.credentialRow = null;
  mocks.pluginRow = null;
  mocks.patchedConfig = null;
  mocks.patchCalls = [];
  mocks.upsertCalls = [];
  mocks.txCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integrationAssignmentService.assign — merge invariants", () => {
  it("patches only the targeted slot and preserves every unrelated config field", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-brooklyn-1",
      provider: "noralai_brooklyn",
      status: "active",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };
    // Seed the existing config with several non-slot fields. The assign
    // call must leave every one of these untouched.
    mocks.patchedConfig = {
      configJson: {
        baseUrl: "https://api.runpod.ai/v2/abc/openai/v1",
        upstreamModel: "Qwen/Qwen3-32B-FP8",
        thinkingEffort: "auto",
        maxTurns: 50,
        retainedEnvVar: "value",
      },
    };

    const svc = integrationAssignmentService(makeMockDb());
    await svc.assign(
      COMPANY,
      {
        credentialId: "cred-1",
        targetPluginId: PLUGIN_ID,
        targetConfigPath: "apiKeyRef",
      },
      QUENTIN_ACTOR,
    );

    expect(mocks.patchCalls).toHaveLength(1);
    expect(mocks.patchCalls[0]?.pluginId).toBe(PLUGIN_ID);
    // The patch payload must contain ONLY the slot we changed.
    expect(mocks.patchCalls[0]?.configJson).toEqual({
      apiKeyRef: "secret-brooklyn-1",
    });
    // After patch (registry shallow-merges), the resulting config must
    // retain every prior field verbatim.
    expect(mocks.patchedConfig?.configJson).toEqual({
      baseUrl: "https://api.runpod.ai/v2/abc/openai/v1",
      upstreamModel: "Qwen/Qwen3-32B-FP8",
      thinkingEffort: "auto",
      maxTurns: 50,
      retainedEnvVar: "value",
      apiKeyRef: "secret-brooklyn-1",
    });
    // upsertConfig was NOT called for assign — only patchConfig is used.
    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("rejects when slot expects noralai_brooklyn but credential is elevenlabs", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-eleven-1",
      provider: "elevenlabs",
      status: "active",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };

    const svc = integrationAssignmentService(makeMockDb());
    await expect(
      svc.assign(
        COMPANY,
        {
          credentialId: "cred-1",
          targetPluginId: PLUGIN_ID,
          targetConfigPath: "apiKeyRef",
        },
        QUENTIN_ACTOR,
      ),
    ).rejects.toThrow(/expects a noralai_brooklyn credential/);

    expect(mocks.patchCalls).toHaveLength(0);
  });

  it("rejects when the target plugin slot is not on the allowlist", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-1",
      provider: "noralai_brooklyn",
      status: "active",
    };
    mocks.pluginRow = {
      id: PLUGIN_ID,
      pluginKey: "noralos.some-other-plugin",
      manifestJson: {},
    };

    const svc = integrationAssignmentService(makeMockDb());
    await expect(
      svc.assign(
        COMPANY,
        {
          credentialId: "cred-1",
          targetPluginId: PLUGIN_ID,
          targetConfigPath: "apiKeyRef",
        },
        QUENTIN_ACTOR,
      ),
    ).rejects.toThrow(/not assignable from the Integrations page/);
    expect(mocks.patchCalls).toHaveLength(0);
  });

  it("rejects when the credential is not active", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-1",
      provider: "noralai_brooklyn",
      status: "disabled",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };

    const svc = integrationAssignmentService(makeMockDb());
    await expect(
      svc.assign(
        COMPANY,
        {
          credentialId: "cred-1",
          targetPluginId: PLUGIN_ID,
          targetConfigPath: "apiKeyRef",
        },
        QUENTIN_ACTOR,
      ),
    ).rejects.toThrow(/disabled or attention-flagged/);
    expect(mocks.patchCalls).toHaveLength(0);
  });

  it("rejects an unknown configPath on the allowlisted plugin", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-1",
      provider: "noralai_brooklyn",
      status: "active",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };

    const svc = integrationAssignmentService(makeMockDb());
    await expect(
      svc.assign(
        COMPANY,
        {
          credentialId: "cred-1",
          targetPluginId: PLUGIN_ID,
          targetConfigPath: "secretBackdoorPath",
        },
        QUENTIN_ACTOR,
      ),
    ).rejects.toThrow(/does not expose an assignable slot/);
    expect(mocks.patchCalls).toHaveLength(0);
  });

  it("never sneaks unrelated fields into the patch payload", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-1",
      provider: "noralai_brooklyn",
      status: "active",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };
    // Seed existing config with arbitrary unrelated fields. The patch
    // must not write them, even though the registry will merge them
    // back into the resulting state.
    mocks.patchedConfig = {
      configJson: { baseUrl: "https://api.runpod.ai/v2/abc/openai/v1", thinkingEffort: "auto" },
    };

    const svc = integrationAssignmentService(makeMockDb());
    await svc.assign(
      COMPANY,
      {
        credentialId: "cred-1",
        targetPluginId: PLUGIN_ID,
        targetConfigPath: "apiKeyRef",
      },
      QUENTIN_ACTOR,
    );

    for (const call of mocks.patchCalls) {
      expect(Object.keys(call.configJson)).toEqual(["apiKeyRef"]);
      expect(call.configJson).not.toHaveProperty("baseUrl");
      expect(call.configJson).not.toHaveProperty("thinkingEffort");
    }
  });

  it("notifies the worker via configChanged after a successful patch", async () => {
    mocks.credentialRow = {
      id: "cred-1",
      companyId: COMPANY,
      secretId: "secret-1",
      provider: "noralai_brooklyn",
      status: "active",
    };
    mocks.pluginRow = { id: PLUGIN_ID, pluginKey: "noralai.brooklyn", manifestJson: {} };
    mocks.patchedConfig = { configJson: { baseUrl: "https://api.runpod.ai/v2/abc/openai/v1" } };

    const isRunning = vi.fn().mockReturnValue(true);
    const call = vi.fn().mockResolvedValue(undefined);
    const restartWorker = vi.fn();
    const svc = integrationAssignmentService(makeMockDb(), {
      workerManager: { isRunning, call },
      lifecycle: { restartWorker },
    });

    await svc.assign(
      COMPANY,
      {
        credentialId: "cred-1",
        targetPluginId: PLUGIN_ID,
        targetConfigPath: "apiKeyRef",
      },
      QUENTIN_ACTOR,
    );

    expect(isRunning).toHaveBeenCalledWith(PLUGIN_ID);
    expect(call).toHaveBeenCalledWith(
      PLUGIN_ID,
      "configChanged",
      {
        config: expect.objectContaining({
          apiKeyRef: "secret-1",
          baseUrl: "https://api.runpod.ai/v2/abc/openai/v1",
        }),
      },
    );
    expect(restartWorker).not.toHaveBeenCalled();
  });
});

void unprocessable;
