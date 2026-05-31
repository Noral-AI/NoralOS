/**
 * Tests for the three Phase 1B tool handlers.
 *
 * Each tool's handler is a pure function over `(NoralVoiceClientConfig,
 * params)` so the tests stub `globalThis.fetch` and assert the four
 * paths the prompt names:
 *   - happy path (HTTP 200)
 *   - NoralVoice 4xx
 *   - NoralVoice 5xx
 *   - missing api key (NO_API_KEY)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoralVoiceClientError } from "../noralvoice-client.js";
import { executeGetRun } from "./get_run.js";
import { executeListWorkflows } from "./list_workflows.js";
import { executeRunCall } from "./run_call.js";

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

function mockReject(err: Error) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
}

// -------- list_workflows ----------------------------------------------------

describe("executeListWorkflows", () => {
  it("happy path: maps fields + emits count summary", async () => {
    mockJson(200, [
      { workflow_uuid: "u1", name: "Sales screener", status: "published", version: 3 },
      { workflow_uuid: "u2", name: "Support callback" },
    ]);
    const result = await executeListWorkflows(baseConfig, {});
    expect(result.data.workflows).toHaveLength(2);
    expect(result.data.workflows[0]).toMatchObject({ uuid: "u1", name: "Sales screener" });
    expect(result.content).toContain("2 voice workflows");
  });

  it("empty list returns the helpful zero-state copy", async () => {
    mockJson(200, []);
    const result = await executeListWorkflows(baseConfig, {});
    expect(result.data.workflows).toHaveLength(0);
    expect(result.content).toMatch(/no voice workflows/i);
  });

  it("propagates NoralVoice 4xx as HTTP_4XX category", async () => {
    mockJson(401, { detail: "Invalid or expired API key" });
    await expect(executeListWorkflows(baseConfig, {})).rejects.toMatchObject({
      name: "NoralVoiceClientError",
      category: "HTTP_4XX",
      httpStatus: 401,
    });
  });

  it("propagates NoralVoice 5xx as HTTP_5XX category", async () => {
    mockJson(503, { detail: "service unavailable" });
    await expect(executeListWorkflows(baseConfig, {})).rejects.toMatchObject({
      category: "HTTP_5XX",
      httpStatus: 503,
    });
  });

  it("missing API key → NO_API_KEY before any fetch happens", async () => {
    await expect(
      executeListWorkflows({ baseUrl: "https://voice.noral.ai", apiKey: "" }, {}),
    ).rejects.toMatchObject({ category: "NO_API_KEY" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// -------- run_call ----------------------------------------------------------

describe("executeRunCall", () => {
  it("happy path: extracts run id + status, builds the right URL + body", async () => {
    mockJson(200, { workflow_run_id: 42, status: "queued", workflow_run_name: "WR-API-1234" });
    const result = await executeRunCall(baseConfig, {
      workflowUuid: "wf-abc",
      toNumber: "+15555550100",
      variables: { customer: "Acme" },
    });
    expect(result.data.runId).toBe("42");
    expect(result.data.status).toBe("queued");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://voice.noral.ai/api/v1/public/agent/wf-abc");
    expect(call[1].method).toBe("POST");
    const sentBody = JSON.parse(call[1].body as string);
    expect(sentBody.phone_number).toBe("+15555550100");
    expect(sentBody.initial_context.customer).toBe("Acme");
  });

  it("4xx (e.g. workflow not found) surfaces as HTTP_4XX", async () => {
    mockJson(404, { detail: "Workflow not found" });
    await expect(
      executeRunCall(baseConfig, { workflowUuid: "x", toNumber: "+15555550100" }),
    ).rejects.toMatchObject({ category: "HTTP_4XX", httpStatus: 404 });
  });

  it("transport error (NoralVoice unreachable) surfaces as UNREACHABLE", async () => {
    mockReject(new Error("ENOTFOUND voice.noral.ai"));
    await expect(
      executeRunCall(baseConfig, { workflowUuid: "x", toNumber: "+15555550100" }),
    ).rejects.toMatchObject({ category: "UNREACHABLE" });
  });
});

// -------- get_run -----------------------------------------------------------

describe("executeGetRun", () => {
  it("happy path: resolves by id via org usage history, maps state + URLs + variables", async () => {
    mockJson(200, {
      runs: [
        {
          id: 7,
          state: "completed",
          transcript_url: "https://voice.noral.ai/transcripts/7.txt",
          recording_url: "https://voice.noral.ai/recordings/7.wav",
          gathered_context: { extracted_variables: { qualified: true } },
          cost_info: { total_cost_usd: 0.12 },
        },
      ],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    const result = await executeGetRun(baseConfig, { runId: "7" });
    expect(result.data.run.runId).toBe("7");
    expect(result.data.run.status).toBe("completed");
    expect(result.data.run.transcriptUrl).toContain("/transcripts/7.txt");
    expect(result.data.run.recordingUrl).toContain("/recordings/7.wav");
    expect(result.content).toContain("transcript ready");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/organizations/usage/runs");
  });

  it("5xx surfaces cleanly", async () => {
    mockJson(500, { detail: "boom" });
    await expect(executeGetRun(baseConfig, { runId: "7" })).rejects.toMatchObject({
      category: "HTTP_5XX",
    });
  });

  it("missing API key → NO_API_KEY", async () => {
    await expect(
      executeGetRun({ baseUrl: "https://voice.noral.ai", apiKey: "" }, { runId: "7" }),
    ).rejects.toBeInstanceOf(NoralVoiceClientError);
  });
});
