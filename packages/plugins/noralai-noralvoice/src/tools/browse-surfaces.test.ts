/**
 * Tests for the Phase 4 browse-surface client helpers.
 *
 * Covers shape-mapping (snake_case → camelCase), pagination cursor
 * encoding, telephony fan-out across multiple configs, and uniform
 * error categories.
 *
 * The plugin worker integration tests live alongside in worker.ts and
 * exercise the route dispatch logic; these focus on the SDK wrapper
 * surface that both the worker and the migration script consume.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoralVoiceClientError } from "../noralvoice-client.js";
import {
  getCampaign,
  getCurrentPeriodUsage,
  getRecordingDownloadUrl,
  getWorkflowRun,
  listCampaigns,
  listKbDocuments,
  listRecordings,
  listTelephonyNumbers,
  listTelephonyProviders,
  listWorkflowRuns,
  searchKbDocuments,
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

// ── Runs ────────────────────────────────────────────────────────────────

describe("listWorkflowRuns", () => {
  it("maps snake_case to camelCase + computes nextCursor", async () => {
    mockJson(200, {
      runs: [
        { id: 7, name: "WR-001", state: "completed", is_completed: true, created_at: "2026-05-15T10:00:00Z" },
        { id: 8, name: "WR-002", state: "running", is_completed: false },
      ],
      total: 12,
    });
    const page = await listWorkflowRuns(baseConfig, 42, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ id: 7, state: "completed", isCompleted: true });
    expect(page.total).toBe(12);
    expect(page.nextCursor).toBe("2"); // 0+2 = 2 < total 12
  });

  it("nextCursor=null when offset+items reaches total", async () => {
    mockJson(200, { runs: [{ id: 1, state: "completed", is_completed: true }], total: 1 });
    const page = await listWorkflowRuns(baseConfig, 42, { limit: 25 });
    expect(page.nextCursor).toBeNull();
  });

  it("respects cursor pagination", async () => {
    mockJson(200, { runs: [], total: 100 });
    await listWorkflowRuns(baseConfig, 42, { limit: 10, cursor: "50" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("limit=10&offset=50");
  });

  it("clamps limit to 1..100", async () => {
    mockJson(200, { runs: [], total: 0 });
    await listWorkflowRuns(baseConfig, 42, { limit: 500 });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("limit=100");
  });
});

describe("getWorkflowRun", () => {
  it("includes gathered_context as gatheredContext", async () => {
    mockJson(200, {
      id: 7,
      state: "completed",
      is_completed: true,
      gathered_context: { extracted_variables: { qualified: true } },
    });
    const run = await getWorkflowRun(baseConfig, 42, 7);
    expect(run.gatheredContext?.extracted_variables).toEqual({ qualified: true });
  });
});

// ── Recordings ──────────────────────────────────────────────────────────

describe("listRecordings", () => {
  it("filters by workflow_id when provided", async () => {
    mockJson(200, { recordings: [{ id: 1, name: "intro" }], total: 1 });
    await listRecordings(baseConfig, { workflowId: 99 });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("workflow_id=99");
  });
});

describe("getRecordingDownloadUrl", () => {
  it("returns the url + optional expires_at", async () => {
    mockJson(200, { url: "https://s3/x.wav", expires_at: "2026-05-15T11:00:00Z" });
    const r = await getRecordingDownloadUrl(baseConfig, 5);
    expect(r.url).toBe("https://s3/x.wav");
    expect(r.expiresAt).toBe("2026-05-15T11:00:00Z");
  });

  it("falls back to download_url alias", async () => {
    mockJson(200, { download_url: "https://s3/y.wav" });
    const r = await getRecordingDownloadUrl(baseConfig, 5);
    expect(r.url).toBe("https://s3/y.wav");
  });
});

// ── KB ──────────────────────────────────────────────────────────────────

describe("searchKbDocuments", () => {
  it("POSTs query + limit and maps hits", async () => {
    mockJson(200, {
      hits: [
        { document_id: 1, document_name: "spec.pdf", chunk_index: 3, text: "match", score: 0.91 },
      ],
    });
    const r = await searchKbDocuments(baseConfig, { query: "pricing", limit: 5 });
    expect(r.hits[0]).toMatchObject({ documentId: 1, chunkIndex: 3, text: "match", score: 0.91 });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ query: "pricing", limit: 5 });
  });

  it("clamps search limit to 1..50", async () => {
    mockJson(200, { hits: [] });
    await searchKbDocuments(baseConfig, { query: "x", limit: 200 });
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.limit).toBe(50);
  });
});

describe("listKbDocuments", () => {
  it("maps documents → KbDocumentSummary", async () => {
    mockJson(200, {
      documents: [{ id: 1, filename: "spec.pdf", mime_type: "application/pdf", size_bytes: 1024 }],
      total: 1,
    });
    const page = await listKbDocuments(baseConfig);
    expect(page.items[0]).toMatchObject({ filename: "spec.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
  });
});

// ── Campaigns ───────────────────────────────────────────────────────────

describe("listCampaigns", () => {
  it("forwards status + limit query params", async () => {
    mockJson(200, { campaigns: [{ id: 1, name: "Q1 outbound", status: "running" }], total: 1 });
    await listCampaigns(baseConfig, { status: "running", limit: 25 });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("status=running");
    expect(call[0]).toContain("limit=25");
  });
});

describe("getCampaign", () => {
  it("returns progress field when present", async () => {
    mockJson(200, {
      id: 5,
      name: "Q1",
      status: "running",
      progress: { dialed: 10, completed: 7 },
    });
    const c = await getCampaign(baseConfig, 5);
    expect(c.progress).toEqual({ dialed: 10, completed: 7 });
  });
});

// ── Telephony ──────────────────────────────────────────────────────────

describe("listTelephonyProviders", () => {
  it("maps configurations to provider summaries", async () => {
    mockJson(200, {
      configurations: [
        { id: 1, name: "Twilio prod", provider: "twilio", is_active: true },
      ],
    });
    const p = await listTelephonyProviders(baseConfig);
    expect(p[0]).toMatchObject({ id: 1, name: "Twilio prod", provider: "twilio", isActive: true });
  });
});

describe("listTelephonyNumbers", () => {
  it("fans out across telephony configs and tags numbers with provider", async () => {
    mockJson(200, {
      configurations: [{ id: 1, name: "Twilio", provider: "twilio", is_active: true }],
    });
    mockJson(200, {
      phone_numbers: [{ id: 10, phone_number: "+15555550100", is_active: true }],
    });
    const nums = await listTelephonyNumbers(baseConfig);
    expect(nums).toHaveLength(1);
    expect(nums[0]).toMatchObject({ phoneNumber: "+15555550100", provider: "twilio" });
  });

  it("continues when one config 5xx's", async () => {
    mockJson(200, {
      configurations: [
        { id: 1, name: "Twilio", provider: "twilio", is_active: true },
        { id: 2, name: "Telnyx", provider: "telnyx", is_active: true },
      ],
    });
    mockJson(503, { detail: "down" });
    mockJson(200, { phone_numbers: [{ id: 11, phone_number: "+15555550200" }] });
    const nums = await listTelephonyNumbers(baseConfig);
    expect(nums).toHaveLength(1);
    expect(nums[0].provider).toBe("telnyx");
  });
});

// ── Usage ──────────────────────────────────────────────────────────────

describe("getCurrentPeriodUsage", () => {
  it("converts total_cost_usd → totalCostCents and maps per-workflow", async () => {
    mockJson(200, {
      total_cost_usd: 12.34,
      call_duration_seconds: 120,
      call_count: 5,
      per_workflow: [{ workflow_uuid: "wf-abc", workflow_name: "Outbound", cost_usd: 5.5, call_count: 2 }],
    });
    const u = await getCurrentPeriodUsage(baseConfig);
    expect(u.totalCostCents).toBe(1234);
    expect(u.callCount).toBe(5);
    expect(u.perWorkflow?.[0]).toMatchObject({
      workflowUuid: "wf-abc",
      workflowName: "Outbound",
      costCents: 550,
      callCount: 2,
    });
  });
});

// ── Error categories ────────────────────────────────────────────────────

describe("error category mapping", () => {
  it("4xx surfaces as HTTP_4XX", async () => {
    mockJson(401, { detail: "no key" });
    await expect(listWorkflowRuns(baseConfig, 42)).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 401,
    });
  });

  it("5xx surfaces as HTTP_5XX", async () => {
    mockJson(503, { detail: "down" });
    await expect(getCurrentPeriodUsage(baseConfig)).rejects.toMatchObject({
      category: "HTTP_5XX",
    });
  });

  it("missing API key short-circuits with NO_API_KEY before any fetch", async () => {
    await expect(
      listWorkflowRuns({ baseUrl: "https://voice.noral.ai", apiKey: "" }, 42),
    ).rejects.toMatchObject({ category: "NO_API_KEY" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("transport error surfaces as UNREACHABLE", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(getCurrentPeriodUsage(baseConfig)).rejects.toBeInstanceOf(NoralVoiceClientError);
  });
});
