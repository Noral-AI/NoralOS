/**
 * Tests for the Phase 10A workflow-lifecycle tools (validate + publish).
 *
 * These close the agent-authoring loop: a draft built with
 * `create_workflow` / `save_workflow` can now be self-checked and
 * promoted to executable without operator intervention.
 *
 * Mocks `globalThis.fetch` per the established pattern in
 * `tools-phase-9c.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NoralVoiceClientError,
  agentPublishWorkflow,
  agentValidateWorkflow,
} from "../noralvoice-client.js";
import { executePublishWorkflow } from "./publish_workflow.js";
import { executeValidateWorkflow } from "./validate_workflow.js";

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

describe("agentValidateWorkflow", () => {
  it("happy path: POST /workflow/{id}/validate, returns valid=true on 200", async () => {
    mockJson(200, { is_valid: true, errors: [] });
    const result = await agentValidateWorkflow(baseConfig, { workflowId: 7 });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow/7/validate");
    expect(call[1]?.method).toBe("POST");
  });

  it("propagates a 422 with structured findings as NoralVoiceClientError", async () => {
    mockJson(422, {
      detail: {
        errors: [{ kind: "node", id: "agent-1", field: "prompt", message: "Required" }],
      },
    });
    await expect(
      agentValidateWorkflow(baseConfig, { workflowId: 7 }),
    ).rejects.toBeInstanceOf(NoralVoiceClientError);
  });
});

describe("executeValidateWorkflow", () => {
  it("returns a publish-ready summary when the draft is valid", async () => {
    mockJson(200, { is_valid: true, errors: [] });
    const result = await executeValidateWorkflow(baseConfig, { workflowId: 42 });
    expect(result.data.valid).toBe(true);
    expect(result.content).toContain("ready to publish");
    expect(result.content).toContain("42");
  });
});

describe("agentPublishWorkflow", () => {
  it("happy path: POST /workflow/{id}/publish, returns version/status", async () => {
    mockJson(200, {
      id: 99,
      version_number: 3,
      status: "published",
      published_at: "2026-05-26T00:00:00Z",
    });
    const result = await agentPublishWorkflow(baseConfig, { workflowId: 11 });
    expect(result.id).toBe(99);
    expect(result.version_number).toBe(3);
    expect(result.status).toBe("published");
    expect(result.published_at).toBe("2026-05-26T00:00:00Z");
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/workflow/11/publish");
    expect(call[1]?.method).toBe("POST");
  });

  it("propagates a 422 validation failure to the caller", async () => {
    // Per workflow.py:_validation_errors_http_exception, publish throws
    // 422 with the same shape as validate when the draft is invalid.
    mockJson(422, {
      detail: { errors: [{ kind: "edge", id: "e1", field: null, message: "Bad target" }] },
    });
    await expect(
      agentPublishWorkflow(baseConfig, { workflowId: 11 }),
    ).rejects.toBeInstanceOf(NoralVoiceClientError);
  });
});

describe("executePublishWorkflow", () => {
  it("returns a runtime-handoff summary", async () => {
    mockJson(200, {
      id: 5,
      version_number: 2,
      status: "published",
      published_at: "2026-05-26T00:00:00Z",
    });
    const result = await executePublishWorkflow(baseConfig, { workflowId: 13 });
    expect(result.data.version_number).toBe(2);
    expect(result.content).toContain("version 2");
    expect(result.content).toContain("Runtime will now execute");
  });
});

describe("validate → publish chain", () => {
  it("agent can self-check then promote in two calls", async () => {
    // First call: validate returns valid=true.
    mockJson(200, { is_valid: true, errors: [] });
    const validateResult = await executeValidateWorkflow(baseConfig, { workflowId: 21 });
    expect(validateResult.data.valid).toBe(true);

    // Second call: publish succeeds.
    mockJson(200, {
      id: 21,
      version_number: 1,
      status: "published",
      published_at: "2026-05-26T00:00:00Z",
    });
    const publishResult = await executePublishWorkflow(baseConfig, { workflowId: 21 });
    expect(publishResult.data.status).toBe("published");
  });
});
