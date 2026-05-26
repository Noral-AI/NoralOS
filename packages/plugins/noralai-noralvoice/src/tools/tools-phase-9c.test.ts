/**
 * Tests for the Phase 9C tool handlers (13 new tools).
 *
 * One happy-path test per tool, plus one end-to-end chain test for
 * `create_workflow` + `save_workflow` through the worker dispatcher
 * pattern (simulated inline — no live backend).
 *
 * Mocks `globalThis.fetch` like the existing test files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NoralVoiceClientError,
  agentCreateWorkflow,
  agentSaveWorkflow,
  createCampaign,
  deleteWorkflowTool,
  getDailyReport,
  getRunDetail,
  listKbDocumentsFiltered,
  listRecordings,
  getRecordingDownloadUrl,
  startCampaign,
  addWorkflowTool,
  updateWorkflowTool,
  uploadKbDocument,
} from "../noralvoice-client.js";
import { executeCreateWorkflow } from "./create_workflow.js";
import { executeSaveWorkflow } from "./save_workflow.js";
import { executeCreateCampaign } from "./create_campaign.js";
import { executeStartCampaign } from "./start_campaign.js";
import { executeUploadKbDocument } from "./upload_kb_document.js";
import { executeAddWorkflowTool } from "./add_workflow_tool.js";
import { executeUpdateWorkflowTool } from "./update_workflow_tool.js";
import { executeDeleteWorkflowTool } from "./delete_workflow_tool.js";
import { executeGetRunDetail } from "./get_run_detail.js";
import { executeListRecordings } from "./list_recordings.js";
import { executeGetRecordingDownloadUrl } from "./get_recording_download_url.js";
import { executeListKbDocuments } from "./list_kb_documents.js";
import { executeGetDailyReport } from "./get_daily_report.js";

const baseConfig = { baseUrl: "https://voice.noral.ai", apiKey: "test-key" };

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

// ── Tier 1 write tools ──────────────────────────────────────────────────────

describe("executeCreateWorkflow", () => {
  it("happy path: calls POST /workflow/create/definition and returns id/uuid/name", async () => {
    mockJson(200, { id: 7, workflow_uuid: "wf-uuid-7", name: "Sales bot" });
    const result = await executeCreateWorkflow(baseConfig, { name: "Sales bot" });
    expect(result.data).toMatchObject({ id: 7, workflow_uuid: "wf-uuid-7", name: "Sales bot" });
    expect(result.content).toContain("Sales bot");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow/create/definition");
    expect(call[1]?.method).toBe("POST");
  });

  it("forwards a caller-supplied workflowDefinition", async () => {
    const customDef = { nodes: [{ id: "n1" }], edges: [] };
    mockJson(200, { id: 8, workflow_uuid: "wf-uuid-8", name: "Custom" });
    const result = await executeCreateWorkflow(baseConfig, {
      name: "Custom",
      workflowDefinition: customDef,
    });
    expect(result.data.id).toBe(8);
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body as string);
    expect(body.workflow_definition).toMatchObject(customDef);
  });
});

describe("executeSaveWorkflow", () => {
  it("happy path: calls PUT /workflow/{id} and returns updated record", async () => {
    mockJson(200, { id: 5, workflow_uuid: "wf-uuid-5", name: "Updated bot", status: "draft" });
    const def = { nodes: [], edges: [] };
    const result = await executeSaveWorkflow(baseConfig, { workflowId: 5, workflowDefinition: def });
    expect(result.data.id).toBe(5);
    expect(result.data.name).toBe("Updated bot");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow/5");
    expect(call[1]?.method).toBe("PUT");
  });
});

describe("executeCreateCampaign", () => {
  it("happy path: calls POST /campaign/create and returns campaign", async () => {
    mockJson(200, {
      id: 3,
      name: "Q2 Outreach",
      status: "pending",
      workflow_id: 5,
      source_type: "csv",
      source_id: "contacts.csv",
    });
    const result = await executeCreateCampaign(baseConfig, {
      name: "Q2 Outreach",
      workflowId: 5,
      sourceType: "csv",
      sourceId: "contacts.csv",
    });
    expect(result.data.id).toBe(3);
    expect(result.data.status).toBe("pending");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/campaign/create");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("executeStartCampaign", () => {
  it("happy path: calls POST /campaign/{id}/start and returns running status", async () => {
    mockJson(200, { id: 3, name: "Q2 Outreach", status: "running" });
    const result = await executeStartCampaign(baseConfig, { campaignId: 3 });
    expect(result.data.status).toBe("running");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/campaign/3/start");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("executeUploadKbDocument", () => {
  it("happy path: 3-call sequence (presign → PUT → process) and returns uuid+status", async () => {
    // Step 1: presign
    mockJson(200, { upload_url: "https://s3.example.com/presigned", document_uuid: "doc-uuid-1" });
    // Step 2: S3 PUT
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({}),
    } as Response);
    // Step 3: process
    mockJson(200, { document_uuid: "doc-uuid-1", status: "processing" });

    const result = await executeUploadKbDocument(baseConfig, {
      filename: "faq.pdf",
      contentBase64: Buffer.from("hello pdf").toString("base64"),
      contentType: "application/pdf",
    });
    expect(result.data.document_uuid).toBe("doc-uuid-1");
    expect(result.data.status).toBe("processing");

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    // Step 1: presign POST
    expect(calls[0][0]).toContain("/api/v1/knowledge-base/upload-url");
    expect(calls[0][1]?.method).toBe("POST");
    // Step 2: S3 PUT (no API key header)
    expect(calls[1][0]).toBe("https://s3.example.com/presigned");
    expect(calls[1][1]?.method).toBe("PUT");
    expect((calls[1][1]?.headers as Record<string, string>)?.["X-API-Key"]).toBeUndefined();
    // Step 3: process POST
    expect(calls[2][0]).toContain("/api/v1/knowledge-base/process-document");
    expect(calls[2][1]?.method).toBe("POST");
  });

  it("rejects when contentBase64 is empty", async () => {
    await expect(
      executeUploadKbDocument(baseConfig, { filename: "x.pdf", contentBase64: "" }),
    ).rejects.toMatchObject({ category: "HTTP_4XX" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("executeAddWorkflowTool", () => {
  it("happy path: calls POST /tool/ and returns tool record", async () => {
    mockJson(200, {
      tool_uuid: "tool-uuid-1",
      name: "lookup_customer",
      description: "Look up a customer",
    });
    const result = await executeAddWorkflowTool(baseConfig, {
      name: "lookup_customer",
      description: "Look up a customer",
      toolDefinition: { input_schema: {} },
    });
    expect(result.data.tool_uuid).toBe("tool-uuid-1");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/tool/");
    expect(call[1]?.method).toBe("POST");
  });
});

describe("executeUpdateWorkflowTool", () => {
  it("happy path: calls PUT /tool/{uuid} and returns updated record", async () => {
    mockJson(200, {
      tool_uuid: "tool-uuid-1",
      name: "lookup_customer_v2",
      description: "Look up a customer (v2)",
    });
    const result = await executeUpdateWorkflowTool(baseConfig, {
      toolUuid: "tool-uuid-1",
      name: "lookup_customer_v2",
    });
    expect(result.data.name).toBe("lookup_customer_v2");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/tool/tool-uuid-1");
    expect(call[1]?.method).toBe("PUT");
  });
});

describe("executeDeleteWorkflowTool", () => {
  it("happy path: calls DELETE /tool/{uuid} and returns archived status", async () => {
    mockJson(200, { tool_uuid: "tool-uuid-1", status: "archived" });
    const result = await executeDeleteWorkflowTool(baseConfig, { toolUuid: "tool-uuid-1" });
    expect(result.data.status).toBe("archived");
    expect(result.data.tool_uuid).toBe("tool-uuid-1");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/tool/tool-uuid-1");
    expect(call[1]?.method).toBe("DELETE");
  });
});

// ── Tier 2 read tools ──────────────────────────────────────────────────────

describe("executeGetRunDetail", () => {
  it("happy path: calls GET /workflow-run/{id} and returns full run record", async () => {
    mockJson(200, {
      id: "run-42",
      state: "completed",
      workflow_uuid: "wf-uuid-5",
      transcript_url: "https://cdn.example.com/t.json",
      gathered_context: { customer_name: "Acme" },
    });
    const result = await executeGetRunDetail(baseConfig, { runId: "run-42" });
    expect(result.data.id).toBe("run-42");
    expect(result.data.state).toBe("completed");
    expect(result.data.gatheredContext).toMatchObject({ customer_name: "Acme" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow-run/run-42");
    expect(call[1]?.method).toBe("GET");
  });
});

describe("executeListRecordings", () => {
  it("happy path: returns recording list with count summary", async () => {
    mockJson(200, {
      recordings: [
        { id: 1, name: "rec-1", tts_provider: "elevenlabs", duration_sec: 5.2 },
        { id: 2, name: "rec-2", tts_provider: "deepgram", duration_sec: 3.1 },
      ],
      total: 2,
    });
    const result = await executeListRecordings(baseConfig, {});
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]).toMatchObject({ id: 1, ttsProvider: "elevenlabs" });
    expect(result.content).toContain("2 recording");
  });

  it("passes workflowId filter as query param", async () => {
    mockJson(200, { recordings: [], total: 0 });
    await executeListRecordings(baseConfig, { workflowId: 5 });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("workflow_id=5");
  });
});

describe("executeGetRecordingDownloadUrl", () => {
  it("happy path: returns url + expires_in", async () => {
    mockJson(200, { url: "https://cdn.example.com/rec-1.wav", expires_at: "2026-05-20T00:00:00Z" });
    const result = await executeGetRecordingDownloadUrl(baseConfig, { recordingId: 1 });
    expect(result.data.url).toBe("https://cdn.example.com/rec-1.wav");
    expect(result.data.expires_in).toBe(3600);
    expect(result.data.expiresAt).toBe("2026-05-20T00:00:00Z");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow-recordings/1/download-url");
  });
});

describe("executeListKbDocuments", () => {
  it("happy path: returns document list with count summary", async () => {
    mockJson(200, {
      documents: [
        { id: 10, name: "product-faq.pdf", status: "ready", chunk_count: 42 },
      ],
      total: 1,
    });
    const result = await executeListKbDocuments(baseConfig, {});
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]).toMatchObject({ id: 10, chunkCount: 42 });
    expect(result.content).toContain("1 KB document");
  });

  it("passes status filter as query param", async () => {
    mockJson(200, { documents: [], total: 0 });
    await executeListKbDocuments(baseConfig, { status: "ready" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("status=ready");
  });
});

describe("executeGetDailyReport", () => {
  it("happy path: returns report with call counts and cost", async () => {
    mockJson(200, {
      date: "2026-05-19",
      total_calls: 42,
      completed_calls: 38,
      failed_calls: 4,
      average_duration_sec: 123.5,
      total_cost_usd: 5.25,
    });
    const result = await executeGetDailyReport(baseConfig, { date: "2026-05-19" });
    expect(result.data.date).toBe("2026-05-19");
    expect(result.data.totalCalls).toBe(42);
    expect(result.data.completedCalls).toBe(38);
    expect(result.data.totalCostCents).toBe(525); // $5.25 * 100
    expect(result.content).toContain("42 calls");
  });

  it("omits date param when not supplied (server defaults to today)", async () => {
    mockJson(200, { date: "2026-05-19", total_calls: 10, completed_calls: 10 });
    await executeGetDailyReport(baseConfig, {});
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // No ?date= in URL
    expect(call[0]).not.toContain("date=");
  });
});

// ── End-to-end chain test: create_workflow + save_workflow ─────────────────
//
// Exercises the execute functions together — simulating what the worker
// dispatcher does when it routes two sequential tool calls for the same
// Voice Director agent session. Asserts the correct URL/method sequence
// and result chain.

describe("create_workflow + save_workflow chain (e2e simulation)", () => {
  it("creates a workflow then saves an updated definition", async () => {
    // create_workflow → POST /workflow/create/definition
    mockJson(200, { id: 11, workflow_uuid: "wf-uuid-11", name: "New Agent" });
    const createResult = await executeCreateWorkflow(baseConfig, { name: "New Agent" });
    expect(createResult.data.id).toBe(11);

    // save_workflow → PUT /workflow/11
    const updatedDef = { nodes: [{ id: "n1", type: "agentNode" }], edges: [] };
    mockJson(200, { id: 11, workflow_uuid: "wf-uuid-11", name: "New Agent", status: "published" });
    const saveResult = await executeSaveWorkflow(baseConfig, {
      workflowId: createResult.data.id,
      workflowDefinition: updatedDef,
    });
    expect(saveResult.data.id).toBe(11);
    expect(saveResult.data.status).toBe("published");

    // Verify correct HTTP verbs in call order
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]?.method).toBe("POST");
    expect(calls[1][1]?.method).toBe("PUT");
    expect(calls[1][0]).toContain(`/api/v1/workflow/11`);
  });
});
