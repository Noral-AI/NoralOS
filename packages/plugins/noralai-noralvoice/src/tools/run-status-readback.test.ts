/**
 * Tests for the org-scoped run-status read-back (v0.9.1).
 *
 * get_run / get_run_detail / list_runs resolve a run from just its id via
 * NoralVoice's org-scoped `GET /organizations/usage/runs` — the standalone
 * `/workflow-run/{id}` route was removed and the agent holds no workflow id
 * after dialing an agent-trigger. See memory: project-noralvoice-uuid-
 * serialization-fix (Layer 3 residual).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRun, getRunDetail, listOrgRuns } from "../noralvoice-client.js";
import { executeListRuns } from "./list_runs.js";

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

function fetchCalls() {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
}

describe("listOrgRuns", () => {
  it("hits the org usage-history endpoint and maps usage records", async () => {
    mockJson(200, {
      runs: [
        {
          id: 36,
          workflow_id: 46,
          name: "WR-API-2488",
          call_type: "outbound",
          disposition: "user_qualified",
          call_duration_seconds: 75,
          recording_url: "recordings/36.wav",
          transcript_url: "transcripts/36.txt",
        },
      ],
      page: 1,
      limit: 25,
      total_pages: 3,
      total_count: 60,
    });
    const page = await listOrgRuns(baseConfig, { limit: 25 });
    expect(fetchCalls()[0][0]).toContain("/api/v1/organizations/usage/runs?page=1&limit=25");
    expect(page.items).toHaveLength(1);
    // Usage records carry no `state`/`is_completed`; presence of a disposition
    // means the run concluded → derived completed.
    expect(page.items[0]).toMatchObject({
      id: 36,
      state: "completed",
      isCompleted: true,
      callType: "outbound",
      disposition: "user_qualified",
    });
    // costInfo is synthesized from the flat usage fields.
    expect(page.items[0].costInfo).toMatchObject({ call_duration_seconds: 75 });
    expect(page.total).toBe(60);
    expect(page.nextCursor).toBe("2"); // page 1 of 3
  });

  it("nextCursor is null on the last page; cursor selects the page", async () => {
    mockJson(200, { runs: [], page: 3, limit: 25, total_pages: 3, total_count: 60 });
    const page = await listOrgRuns(baseConfig, { cursor: "3" });
    expect(fetchCalls()[0][0]).toContain("page=3");
    expect(page.nextCursor).toBeNull();
  });
});

describe("executeListRuns (org-scoped — no workflowUuid required)", () => {
  it("lists recent org runs", async () => {
    mockJson(200, {
      runs: [{ id: 36, name: "WR-API-2488", disposition: "user_qualified" }],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    const result = await executeListRuns(baseConfig, {});
    expect(fetchCalls()[0][0]).toContain("/api/v1/organizations/usage/runs");
    expect(result.data.runs).toHaveLength(1);
    expect(result.content).toContain("1 recent run");
  });

  it("reports an empty history gracefully", async () => {
    mockJson(200, { runs: [], page: 1, total_pages: 1, total_count: 0 });
    const result = await executeListRuns(baseConfig, {});
    expect(result.data.runs).toHaveLength(0);
    expect(result.content).toContain("No voice runs");
  });
});

describe("getRun / getRunDetail (resolve by id over usage history)", () => {
  it("derives status + outcome from a disposition-only usage record", async () => {
    mockJson(200, {
      runs: [{ id: 7, disposition: "no_answer", call_duration_seconds: 0 }],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    const run = await getRun(baseConfig, "7");
    expect(run.runId).toBe("7");
    expect(run.status).toBe("completed");
    expect(run.disposition).toBe("no_answer");
  });

  it("pages forward to find a run not on the first page", async () => {
    // Page 1 (no match), total_pages=2 → scanner advances to page 2 (match).
    mockJson(200, { runs: [{ id: 1 }, { id: 2 }], page: 1, total_pages: 2, total_count: 3 });
    mockJson(200, {
      runs: [{ id: 36, workflow_id: 46, disposition: "user_qualified", call_duration_seconds: 75 }],
      page: 2,
      total_pages: 2,
      total_count: 3,
    });
    const detail = await getRunDetail(baseConfig, "36");
    expect(detail.id).toBe("36");
    expect(detail.workflowId).toBe(46);
    expect(detail.durationSec).toBe(75);
    expect(fetchCalls()).toHaveLength(2);
    expect(fetchCalls()[1][0]).toContain("page=2");
  });

  it("throws a 404-category error when the run is not in the history", async () => {
    mockJson(200, { runs: [{ id: 1 }], page: 1, total_pages: 1, total_count: 1 });
    await expect(getRun(baseConfig, "999")).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 404,
    });
  });
});
