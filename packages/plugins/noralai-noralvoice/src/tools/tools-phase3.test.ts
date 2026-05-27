/**
 * Tests for the three Phase 3 tool handlers.
 *
 * Each handler is a pure function over (config, params, side-effect-ctx).
 * Stubs:
 *   - `globalThis.fetch` for NoralVoice HTTP I/O
 *   - ctx callbacks for agent table reads/writes + voice-config mirror
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoralVoiceClientError } from "../noralvoice-client.js";
import { executeListVoices } from "./list_voices.js";
import { executeProvisionVoiceAgent } from "./provision_voice_agent.js";
import { executeSetAgentVoice } from "./set_agent_voice.js";

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

// ============== list_voices ===========================================

describe("executeListVoices", () => {
  it("filtered: hits a single provider endpoint and shapes the response", async () => {
    mockJson(200, {
      voices: [
        { voice_id: "v1", name: "Rachel", language: "en-US", gender: "female" },
        { voice_id: "v2", name: "Adam", language: "en-US", gender: "male" },
      ],
    });
    const r = await executeListVoices(baseConfig, { provider: "elevenlabs" });
    expect(r.data.providers).toEqual(["elevenlabs"]);
    expect(r.data.voices).toHaveLength(2);
    expect(r.data.voices[0]).toMatchObject({ provider: "elevenlabs", voiceId: "v1", name: "Rachel" });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(
      "https://voice.noral.ai/api/v1/configurations/voices/elevenlabs",
    );
  });

  it("unfiltered: fans out across all six providers", async () => {
    // Six providers in NORALVOICE_TTS_PROVIDERS — return one voice from each.
    for (const _ of ["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"]) {
      mockJson(200, { voices: [{ voice_id: "v", name: "Generic" }] });
    }
    const r = await executeListVoices(baseConfig, {});
    expect(r.data.providers).toHaveLength(6);
    expect(r.data.voices).toHaveLength(6);
  });

  it("tolerates one provider 5xx — keeps results from the others", async () => {
    mockJson(200, { voices: [{ voice_id: "v", name: "OK" }] }); // elevenlabs
    mockJson(503, { detail: "down" });                          // deepgram
    mockJson(200, { voices: [{ voice_id: "v", name: "OK" }] }); // sarvam
    mockJson(200, { voices: [] });                              // cartesia
    mockJson(200, { voices: [] });                              // dograh
    mockJson(200, { voices: [{ voice_id: "v", name: "OK" }] }); // rime
    const r = await executeListVoices(baseConfig, {});
    expect(r.data.voices).toHaveLength(3);
  });

  it("4xx propagates as HTTP_4XX (treat as user error in worker)", async () => {
    mockJson(401, { detail: "Invalid or expired API key" });
    await expect(executeListVoices(baseConfig, { provider: "elevenlabs" })).rejects.toMatchObject({
      category: "HTTP_4XX",
      httpStatus: 401,
    });
  });
});

// ============== set_agent_voice =======================================

describe("executeSetAgentVoice", () => {
  function makeCtx(overrides: Partial<Parameters<typeof executeSetAgentVoice>[2]> = {}) {
    return {
      companyId: "company-A",
      resolveVoiceAgentUuid: vi.fn().mockResolvedValue("wf-uuid-1"),
      ...overrides,
    } as Parameters<typeof executeSetAgentVoice>[2];
  }

  it("happy path: PUT lands, ok=true", async () => {
    // 1) getWorkflowByUuid: list workflows
    mockJson(200, [{ id: 7, workflow_uuid: "wf-uuid-1", name: "VD", status: "active" }]);
    // 2) getWorkflowById: detail
    mockJson(200, {
      id: 7,
      workflow_uuid: "wf-uuid-1",
      name: "VD",
      workflow_configurations: { model_overrides: { llm: { provider: "openai" } } },
    });
    // 3) updateWorkflow PUT
    mockJson(200, {
      id: 7,
      workflow_uuid: "wf-uuid-1",
      name: "VD",
      workflow_configurations: {
        model_overrides: {
          llm: { provider: "openai" },
          tts: { provider: "elevenlabs", voice: "vNew" },
        },
      },
    });
    const ctx = makeCtx();
    const r = await executeSetAgentVoice(
      baseConfig,
      { noralosAgentId: "agent-A", provider: "elevenlabs", voiceId: "vNew" },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.voice_agent_uuid).toBe("wf-uuid-1");
      expect(r.data.provider).toBe("elevenlabs");
    }
  });

  it("merge preserves other model_overrides (llm/stt) on the PUT", async () => {
    mockJson(200, [{ id: 7, workflow_uuid: "wf-uuid-1" }]);
    mockJson(200, {
      id: 7,
      workflow_uuid: "wf-uuid-1",
      name: "VD",
      workflow_configurations: {
        model_overrides: {
          llm: { provider: "openai", model: "gpt-4o" },
          stt: { provider: "deepgram" },
        },
      },
    });
    mockJson(200, {
      id: 7,
      workflow_uuid: "wf-uuid-1",
      name: "VD",
      workflow_configurations: {},
    });
    await executeSetAgentVoice(
      baseConfig,
      { noralosAgentId: "a1", provider: "cartesia", voiceId: "sonic" },
      makeCtx(),
    );
    const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2];
    const body = JSON.parse(putCall[1].body as string);
    expect(body.workflow_configurations.model_overrides.llm).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(body.workflow_configurations.model_overrides.stt).toEqual({ provider: "deepgram" });
    expect(body.workflow_configurations.model_overrides.tts).toMatchObject({
      provider: "cartesia",
      voice: "sonic",
    });
  });

  it("NO_VOICE_AGENT when the agent has no linked workflow", async () => {
    const ctx = makeCtx({ resolveVoiceAgentUuid: vi.fn().mockResolvedValue(null) });
    const r = await executeSetAgentVoice(
      baseConfig,
      { noralosAgentId: "agent-A", provider: "elevenlabs", voiceId: "vNew" },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("NO_VOICE_AGENT");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("NV 4xx (workflow uuid not found in NV list) surfaces as HTTP_4XX", async () => {
    // list returns no matching uuid → wrapper throws 404.
    mockJson(200, [{ id: 99, workflow_uuid: "different" }]);
    const ctx = makeCtx();
    await expect(
      executeSetAgentVoice(
        baseConfig,
        { noralosAgentId: "agent-A", provider: "elevenlabs", voiceId: "vNew" },
        ctx,
      ),
    ).rejects.toMatchObject({ category: "HTTP_4XX", httpStatus: 404 });
  });

  it("NV 5xx during PUT surfaces as HTTP_5XX", async () => {
    mockJson(200, [{ id: 7, workflow_uuid: "wf-uuid-1" }]);
    mockJson(200, { id: 7, workflow_uuid: "wf-uuid-1", workflow_configurations: {} });
    mockJson(503, { detail: "down" });
    await expect(
      executeSetAgentVoice(
        baseConfig,
        { noralosAgentId: "a1", provider: "elevenlabs", voiceId: "v" },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ category: "HTTP_5XX" });
  });

});

// ============== provision_voice_agent =================================

describe("executeProvisionVoiceAgent", () => {
  function makeCtx(overrides: Partial<Parameters<typeof executeProvisionVoiceAgent>[2]> = {}) {
    return {
      resolveVoiceAgentUuid: vi.fn().mockResolvedValue(null),
      resolveAgentName: vi.fn().mockResolvedValue("Outbound Sales Bot"),
      writeVoiceAgentUuid: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as Parameters<typeof executeProvisionVoiceAgent>[2];
  }

  it("happy path: creates workflow, writes uuid back, returns ok+uuid", async () => {
    mockJson(200, {
      id: 42,
      workflow_uuid: "wf-new-uuid",
      name: "Outbound Sales Bot voice",
      status: "draft",
    });
    const ctx = makeCtx();
    const r = await executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "agent-A" }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.voice_agent_uuid).toBe("wf-new-uuid");
      expect(r.data.workflow_name).toBe("Outbound Sales Bot voice");
    }
    expect(ctx.writeVoiceAgentUuid).toHaveBeenCalledWith("agent-A", "wf-new-uuid");
    const postCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(postCall[0]).toBe("https://voice.noral.ai/api/v1/workflow/create/definition");
    const body = JSON.parse(postCall[1].body as string);
    expect(body.name).toBe("Outbound Sales Bot voice");
    // Default minimal definition: at least one agentNode in the graph.
    expect(body.workflow_definition.nodes).toBeDefined();
    expect(body.workflow_definition.nodes.length).toBeGreaterThan(0);
  });

  it("displayName override wins over derived agent-name", async () => {
    mockJson(200, { id: 1, workflow_uuid: "u", name: "Custom Name" });
    await executeProvisionVoiceAgent(
      baseConfig,
      { noralosAgentId: "a", displayName: "Custom Name" },
      makeCtx(),
    );
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.name).toBe("Custom Name");
  });

  it("ALREADY_PROVISIONED when voice_agent_uuid is already set", async () => {
    const ctx = makeCtx({
      resolveVoiceAgentUuid: vi.fn().mockResolvedValue("existing-uuid"),
    });
    const r = await executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "a" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("ALREADY_PROVISIONED");
      expect(r.voice_agent_uuid).toBe("existing-uuid");
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctx.writeVoiceAgentUuid).not.toHaveBeenCalled();
  });

  it("NV 4xx (e.g. validation) surfaces as HTTP_4XX", async () => {
    mockJson(422, { detail: "Trigger path conflict" });
    await expect(
      executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "a" }, makeCtx()),
    ).rejects.toMatchObject({ category: "HTTP_4XX", httpStatus: 422 });
  });

  it("NV 5xx surfaces as HTTP_5XX", async () => {
    mockJson(500, { detail: "boom" });
    await expect(
      executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "a" }, makeCtx()),
    ).rejects.toMatchObject({ category: "HTTP_5XX" });
  });

  it("NV returns no workflow_uuid → throws (defensive guard)", async () => {
    // Phase 0 D2 enforced workflow_uuid NOT NULL; if a future regression
    // returns null, fail loudly rather than silently writing an empty
    // string into agents.voice_agent_uuid.
    mockJson(200, { id: 42, workflow_uuid: "", name: "x" });
    await expect(
      executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "a" }, makeCtx()),
    ).rejects.toThrow(/no workflow_uuid/i);
  });

  it("transport error surfaces as UNREACHABLE", async () => {
    mockReject(new Error("ENOTFOUND"));
    await expect(
      executeProvisionVoiceAgent(baseConfig, { noralosAgentId: "a" }, makeCtx()),
    ).rejects.toBeInstanceOf(NoralVoiceClientError);
  });
});
