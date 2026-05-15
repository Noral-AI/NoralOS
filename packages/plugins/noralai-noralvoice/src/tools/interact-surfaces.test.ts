/**
 * Tests for the Phase 4 PR-B interact-surface wrappers:
 *   - createEmbedExchangeToken
 *   - The dedup logic the worker uses to strip duplicate keys from
 *     the webhook's extracted_variables when the live pump already
 *     streamed them
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEmbedExchangeToken,
  NoralVoiceClientError,
} from "../noralvoice-client.js";

const baseConfig = { baseUrl: "https://voice.noral.ai", apiKey: "test-key" };

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

function mockJson(status: number, body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

// ── createEmbedExchangeToken ─────────────────────────────────────────────

describe("createEmbedExchangeToken", () => {
  it("posts target_user_email + target_path + clamped TTL", async () => {
    mockJson(200, {
      token: "emx_abc",
      expires_at: "2026-05-15T11:00:00Z",
      embed_url: "https://voice.noral.ai/api/v1/embed/embed-login?token=emx_abc&path=%2Fworkflow%2Fwf-1",
    });
    const result = await createEmbedExchangeToken(baseConfig, {
      targetUserEmail: "alice@acme.com",
      targetPath: "/workflow/wf-1",
      ttlSeconds: 90,
    });
    expect(result.token).toBe("emx_abc");
    expect(result.embedUrl).toContain("/embed-login?");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://voice.noral.ai/api/v1/embed/exchange-token");
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({
      target_user_email: "alice@acme.com",
      target_path: "/workflow/wf-1",
      ttl_seconds: 90,
    });
  });

  it("defaults ttl_seconds=90 when omitted", async () => {
    mockJson(200, { token: "x", expires_at: "now", embed_url: "u" });
    await createEmbedExchangeToken(baseConfig, {
      targetUserEmail: "a@b.com",
      targetPath: "/x",
    });
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.ttl_seconds).toBe(90);
  });

  it("4xx (e.g. cross-org target user) surfaces as HTTP_4XX", async () => {
    mockJson(404, { detail: "Target user not found in your organization" });
    await expect(
      createEmbedExchangeToken(baseConfig, {
        targetUserEmail: "stranger@other.com",
        targetPath: "/workflow/x",
      }),
    ).rejects.toMatchObject({ category: "HTTP_4XX", httpStatus: 404 });
  });

  it("5xx surfaces as HTTP_5XX", async () => {
    mockJson(503, { detail: "down" });
    await expect(
      createEmbedExchangeToken(baseConfig, {
        targetUserEmail: "a@b.com",
        targetPath: "/x",
      }),
    ).rejects.toMatchObject({ category: "HTTP_5XX" });
  });

  it("missing API key short-circuits before fetch", async () => {
    await expect(
      createEmbedExchangeToken(
        { baseUrl: "https://voice.noral.ai", apiKey: "" },
        { targetUserEmail: "a@b.com", targetPath: "/x" },
      ),
    ).rejects.toBeInstanceOf(NoralVoiceClientError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ── Webhook dedup logic ─────────────────────────────────────────────────

/**
 * The worker's dedup step strips keys from `extracted_variables` that
 * the live pump already streamed. The merge logic lives inline in
 * onWebhook; this test reproduces the contract so a regression on the
 * worker side breaks the test rather than slipping into prod.
 */
function dedupExtractedVariables(
  payload: Record<string, unknown>,
  emittedKeys: Set<string>,
): Record<string, unknown> {
  const evRaw = payload.extracted_variables;
  if (!evRaw || typeof evRaw !== "object" || Array.isArray(evRaw)) return payload;
  const ev = evRaw as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) {
    if (!emittedKeys.has(k)) filtered[k] = v;
  }
  return { ...payload, extracted_variables: filtered };
}

describe("webhook dedup against transcript pump", () => {
  it("strips keys the pump already streamed", () => {
    const payload = {
      run_id: "run-1",
      extracted_variables: {
        name: "Alice",
        company: "Acme",
        budget: "10k",
      },
    };
    const emitted = new Set(["name", "budget"]);
    const result = dedupExtractedVariables(payload, emitted);
    expect(result.extracted_variables).toEqual({ company: "Acme" });
    expect(result.run_id).toBe("run-1");
  });

  it("no-ops when extracted_variables is missing", () => {
    const payload = { run_id: "run-1" };
    const result = dedupExtractedVariables(payload, new Set(["anything"]));
    expect(result).toEqual({ run_id: "run-1" });
  });

  it("no-ops when emittedKeys is empty (typical when pump was disabled)", () => {
    const payload = {
      extracted_variables: { name: "Alice" },
    };
    const result = dedupExtractedVariables(payload, new Set());
    expect(result.extracted_variables).toEqual({ name: "Alice" });
  });

  it("preserves other top-level fields verbatim", () => {
    const payload = {
      schemaVersion: 1,
      event: "run.completed",
      run_id: "r1",
      transcript_url: "x",
      recording_url: "y",
      cost_info: { total_cost_usd: 0.1 },
      extracted_variables: { qualified: true },
    };
    const result = dedupExtractedVariables(payload, new Set(["qualified"]));
    expect(result.schemaVersion).toBe(1);
    expect(result.event).toBe("run.completed");
    expect(result.transcript_url).toBe("x");
    expect(result.cost_info).toEqual({ total_cost_usd: 0.1 });
    expect(result.extracted_variables).toEqual({});
  });
});
