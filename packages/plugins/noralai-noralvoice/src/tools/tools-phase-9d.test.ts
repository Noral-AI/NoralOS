/**
 * Tests for the Phase 9D tool handlers (6 new Tier 3 tools).
 *
 * One happy-path test per tool (6 tests) plus per-embed-token-tool security
 * assertion tests that confirm the raw token NEVER appears in the JSON-
 * serialised tool result. This is the contractual security test from the
 * kickoff prompt §2 PR 6.
 *
 * Mocks `globalThis.fetch` like the existing test files.
 * Mocks `ctx.state` with minimal fakes for the embed-token tools.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginStateClient } from "@noralos/plugin-sdk";
import { executePauseCampaign } from "./pause_campaign.js";
import { executeResumeCampaign } from "./resume_campaign.js";
import { executeRedialCampaign } from "./redial_campaign.js";
import {
  executeCreatePersistentEmbedToken,
  embedTokenStateKey,
} from "./create_persistent_embed_token.js";
import { executeGetPersistentEmbedToken } from "./get_persistent_embed_token.js";
import { executeRevokePersistentEmbedToken } from "./revoke_persistent_embed_token.js";

const baseConfig = { baseUrl: "https://voice.noral.ai", apiKey: "test-key" };
const COMPANY_ID = "company-uuid-test";

/** Sentinel raw token for security assertion tests. Must NOT appear in results. */
const DANGER_RAW_TOKEN = "DANGER_RAW_TOKEN_DO_NOT_LEAK_42";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJson(status: number, body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

/** Minimal fake for PluginStateClient — backed by an in-memory Map. */
function makeStateFake(): PluginStateClient & { _store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const key = (input: { stateKey: string }) => input.stateKey;
  return {
    _store: store,
    async get(input) {
      return store.get(key(input)) ?? null;
    },
    async set(input, value) {
      store.set(key(input), value);
    },
    async delete(input) {
      store.delete(key(input));
    },
  };
}

// ── Tier 3 — campaign lifecycle ─────────────────────────────────────────────

describe("executePauseCampaign", () => {
  it("happy path: calls POST /campaign/{id}/pause and returns paused status", async () => {
    mockJson(200, { id: 5, name: "Q2 Outreach", status: "paused" });
    const result = await executePauseCampaign(baseConfig, { campaignId: 5 });
    expect(result.data.status).toBe("paused");
    expect(result.data.id).toBe(5);
    expect(result.content).toContain("paused");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/campaign/5/pause");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("executeResumeCampaign", () => {
  it("happy path: calls POST /campaign/{id}/resume and returns running status", async () => {
    mockJson(200, { id: 5, name: "Q2 Outreach", status: "running" });
    const result = await executeResumeCampaign(baseConfig, { campaignId: 5 });
    expect(result.data.status).toBe("running");
    expect(result.content).toContain("resumed");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/campaign/5/resume");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("executeRedialCampaign", () => {
  it("happy path: calls POST /campaign/{id}/redial and returns new campaign", async () => {
    mockJson(200, { id: 9, name: "Q2 Outreach Redial", status: "pending" });
    const result = await executeRedialCampaign(baseConfig, {
      campaignId: 5,
      name: "Q2 Outreach Redial",
      retryOnVoicemail: true,
      retryOnNoAnswer: true,
      retryOnBusy: false,
    });
    expect(result.data.id).toBe(9);
    expect(result.data.status).toBe("pending");
    expect(result.content).toContain("Redial campaign");
    expect(result.content).toContain("campaign 5");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/campaign/5/redial");
    expect(call[1]?.method).toBe("POST");
    const body = JSON.parse(call[1]?.body as string);
    expect(body.retry_on_voicemail).toBe(true);
    expect(body.retry_on_no_answer).toBe(true);
    expect(body.retry_on_busy).toBe(false);
    expect(body.name).toBe("Q2 Outreach Redial");
  });
});

// ── Tier 3 — embed-token CRUD ────────────────────────────────────────────────

describe("executeCreatePersistentEmbedToken", () => {
  it("happy path: writes token to state and returns ref — not the raw token", async () => {
    const state = makeStateFake();
    mockJson(200, {
      token: "raw-token-abc123",
      expires_at: "2027-01-01T00:00:00Z",
    });
    const result = await executeCreatePersistentEmbedToken(
      baseConfig,
      { workflowId: 7 },
      state,
      COMPANY_ID,
    );
    // Result must contain the ref key
    expect(result.data.embed_token_ref).toBe(embedTokenStateKey(7));
    expect(result.data.workflow_id).toBe(7);
    expect(result.data.expires_at).toBe("2027-01-01T00:00:00Z");
    // Token must be stored in state
    expect(state._store.get(embedTokenStateKey(7))).toBe("raw-token-abc123");
    // Result must NOT contain the raw token
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("raw-token-abc123");
  });

  it("forwards expiresInDays in the request body", async () => {
    const state = makeStateFake();
    mockJson(200, { token: "tok-xyz", expires_at: "2026-12-31T00:00:00Z" });
    await executeCreatePersistentEmbedToken(
      baseConfig,
      { workflowId: 3, expiresInDays: 30 },
      state,
      COMPANY_ID,
    );
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.expires_in_days).toBe(30);
  });

  // ── Security assertion: DANGER_RAW_TOKEN must not appear in result ─────────
  it("[SECURITY] raw token sentinel never appears in JSON.stringify(result)", async () => {
    const state = makeStateFake();
    mockJson(200, { token: DANGER_RAW_TOKEN, expires_at: "2027-01-01T00:00:00Z" });
    const result = await executeCreatePersistentEmbedToken(
      baseConfig,
      { workflowId: 42 },
      state,
      COMPANY_ID,
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(DANGER_RAW_TOKEN);
  });
});

describe("executeGetPersistentEmbedToken", () => {
  it("happy path: returns ref when token is stored", async () => {
    const state = makeStateFake();
    // Pre-seed state as if create was previously called
    await state.set({ scopeKind: "company", scopeId: COMPANY_ID, stateKey: embedTokenStateKey(7) }, "some-raw-token");
    const result = await executeGetPersistentEmbedToken(
      baseConfig,
      { workflowId: 7 },
      state,
      COMPANY_ID,
    );
    expect(result.data.embed_token_ref).toBe(embedTokenStateKey(7));
    expect(result.data.workflow_id).toBe(7);
    // Does not call NV API (no fetch needed for get)
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns null when no token has been stored", async () => {
    const state = makeStateFake();
    const result = await executeGetPersistentEmbedToken(
      baseConfig,
      { workflowId: 99 },
      state,
      COMPANY_ID,
    );
    expect(result.data.embed_token_ref).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ── Security assertion: DANGER_RAW_TOKEN must not appear in result ─────────
  it("[SECURITY] raw token value stored in state never appears in JSON.stringify(result)", async () => {
    const state = makeStateFake();
    await state.set(
      { scopeKind: "company", scopeId: COMPANY_ID, stateKey: embedTokenStateKey(42) },
      DANGER_RAW_TOKEN,
    );
    const result = await executeGetPersistentEmbedToken(
      baseConfig,
      { workflowId: 42 },
      state,
      COMPANY_ID,
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(DANGER_RAW_TOKEN);
  });
});

describe("executeRevokePersistentEmbedToken", () => {
  it("happy path: calls DELETE /embed-token, removes state, returns revoked:true", async () => {
    const state = makeStateFake();
    await state.set(
      { scopeKind: "company", scopeId: COMPANY_ID, stateKey: embedTokenStateKey(7) },
      "some-raw-token",
    );
    // NV DELETE returns 204-style empty body
    mockJson(200, {});
    const result = await executeRevokePersistentEmbedToken(
      baseConfig,
      { workflowId: 7 },
      state,
      COMPANY_ID,
    );
    expect(result.data.revoked).toBe(true);
    expect(result.data.workflow_id).toBe(7);
    // State must be cleaned up
    expect(state._store.get(embedTokenStateKey(7))).toBeUndefined();
    // NV was called
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow/7/embed-token");
    expect(call[1]?.method).toBe("DELETE");
  });

  // ── Security assertion: DANGER_RAW_TOKEN must not appear in result ─────────
  it("[SECURITY] raw token previously in state never appears in JSON.stringify(result)", async () => {
    const state = makeStateFake();
    await state.set(
      { scopeKind: "company", scopeId: COMPANY_ID, stateKey: embedTokenStateKey(42) },
      DANGER_RAW_TOKEN,
    );
    mockJson(200, {});
    const result = await executeRevokePersistentEmbedToken(
      baseConfig,
      { workflowId: 42 },
      state,
      COMPANY_ID,
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(DANGER_RAW_TOKEN);
  });
});
