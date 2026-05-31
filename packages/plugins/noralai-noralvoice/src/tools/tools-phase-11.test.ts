/**
 * Tests for the Phase 11 seed-template builder.
 *
 * Three layers:
 *   1. Pure path helpers (`setAtPath` / `applyParameters`) — no network.
 *   2. `provision_voice_agent` cloning a registered template by slug.
 *   3. `apply_workflow_parameters` filling declared fillPoints and
 *      rejecting anything the template does not expose.
 *
 * Mocks `globalThis.fetch` per the established pattern in
 * `tools-phase-10a.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyParameters, getTemplate, setAtPath } from "../templates/index.js";
import { outboundLeadQualifier } from "../templates/outbound_lead_qualifier.js";
import { executeApplyWorkflowParameters } from "./apply_workflow_parameters.js";
import {
  type ProvisionVoiceAgentContext,
  executeProvisionVoiceAgent,
} from "./provision_voice_agent.js";

const baseConfig = { baseUrl: "https://voice.noral.ai", apiKey: "test-key" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>;

function mockJson(status: number, body: unknown) {
  fetchMock().mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

/** The request body of the Nth fetch call, parsed back from its JSON string. */
function requestBody(callIndex: number): Record<string, unknown> {
  const call = fetchMock().mock.calls[callIndex];
  return JSON.parse(String(call[1]?.body));
}

// ---------------------------------------------------------------------------
// 1. Pure path helpers
// ---------------------------------------------------------------------------

describe("setAtPath", () => {
  it("writes a leaf selected by a #id segment", () => {
    const root = { nodes: [{ id: "start", data: { greeting: "old" } }] };
    setAtPath(root, "nodes.#start.data.greeting", "new");
    expect(root.nodes[0].data.greeting).toBe("new");
  });

  it("throws when the #id segment matches no element", () => {
    const root = { nodes: [{ id: "start", data: {} }] };
    expect(() => setAtPath(root, "nodes.#missing.data.x", "v")).toThrow(/no element with id/);
  });

  it("rejects an empty path segment", () => {
    expect(() => setAtPath({}, "a..b", "v")).toThrow(/Invalid path/);
  });
});

describe("applyParameters", () => {
  it("applies only declared keys and reports them in input order", () => {
    const definition = structuredClone(outboundLeadQualifier.definition) as unknown as Record<
      string,
      unknown
    >;
    const { applied } = applyParameters(definition, outboundLeadQualifier, {
      openingLine: "Hello there!",
      agentSystemPrompt: "Be brief.",
    });
    expect(applied).toEqual(["openingLine", "agentSystemPrompt"]);
    const nodes = definition.nodes as Array<{ id: string; data: Record<string, unknown> }>;
    expect(nodes.find((n) => n.id === "start")!.data.greeting).toBe("Hello there!");
    expect(nodes.find((n) => n.id === "qualify")!.data.prompt).toBe("Be brief.");
  });

  it("rejects a key the template does not declare", () => {
    const definition = structuredClone(outboundLeadQualifier.definition) as unknown as Record<
      string,
      unknown
    >;
    expect(() =>
      applyParameters(definition, outboundLeadQualifier, { notAFillPoint: "x" }),
    ).toThrow(/Unknown parameter/);
  });
});

// ---------------------------------------------------------------------------
// 2. provision_voice_agent — clone a template by slug
// ---------------------------------------------------------------------------

function provisionCtx(overrides: Partial<ProvisionVoiceAgentContext> = {}): ProvisionVoiceAgentContext {
  return {
    resolveVoiceAgentUuid: async () => null,
    resolveAgentName: async () => "Acme Sales",
    writeVoiceAgentUuid: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("executeProvisionVoiceAgent — template slug", () => {
  it("clones the template, injects a standalone trigger node, and stores the trigger path", async () => {
    mockJson(200, {
      id: 555,
      workflow_uuid: "wf-uuid-1",
      name: "Acme Sales voice",
      workflow_configurations: {},
    });
    const ctx = provisionCtx();
    const result = await executeProvisionVoiceAgent(
      baseConfig,
      { noralosAgentId: "agent-1", template: "outbound_lead_qualifier" },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workflow_id).toBe(555);

    const call = fetchMock().mock.calls[0];
    expect(String(call[0])).toContain("/api/v1/workflow/create/definition");
    expect(call[1]?.method).toBe("POST");

    // The POST carries the template's nodes/edges PLUS an injected standalone
    // API trigger node (the dial handle). voice_agent_uuid is that trigger's
    // path — NOT the workflow_uuid, which is not a dialable agent trigger.
    const def = requestBody(0).workflow_definition as {
      nodes: { id: string; type?: string; data?: Record<string, unknown> }[];
      edges: { target?: string }[];
    };
    const trigger = def.nodes.find((n) => n.type === "trigger");
    expect(trigger).toBeDefined();
    const triggerPath = trigger!.data!.trigger_path as string;
    expect(typeof triggerPath).toBe("string");
    expect(triggerPath.length).toBeGreaterThan(0);

    expect(result.data.voice_agent_uuid).toBe(triggerPath);
    expect(result.data.voice_agent_uuid).not.toBe("wf-uuid-1");
    expect(ctx.writeVoiceAgentUuid).toHaveBeenCalledWith("agent-1", triggerPath);

    // The template's original nodes are preserved (clone, not replace) ...
    for (const tn of outboundLeadQualifier.definition.nodes) {
      expect(def.nodes.some((n) => n.id === tn.id)).toBe(true);
    }
    // ... and the is_start node still has NO incoming edge, and nothing targets
    // the trigger (it is a standalone launch handle) — else NV's runtime
    // validator rejects the graph and the call dead-airs.
    const startNode = def.nodes.find((n) => n.data?.is_start);
    expect(startNode).toBeDefined();
    expect(def.edges.some((e) => e.target === startNode!.id)).toBe(false);
    expect(def.edges.some((e) => e.target === "trigger")).toBe(false);
  });

  it("rejects an unknown slug with the list of available templates and makes no network call", async () => {
    const result = await executeProvisionVoiceAgent(
      baseConfig,
      { noralosAgentId: "agent-1", template: "does_not_exist" },
      provisionCtx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("UNKNOWN_TEMPLATE");
    if (result.error !== "UNKNOWN_TEMPLATE") return;
    expect(result.availableTemplates).toContain("outbound_lead_qualifier");
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("still short-circuits with ALREADY_PROVISIONED when a uuid exists", async () => {
    const result = await executeProvisionVoiceAgent(
      baseConfig,
      { noralosAgentId: "agent-1", template: "outbound_lead_qualifier" },
      provisionCtx({ resolveVoiceAgentUuid: async () => "existing-uuid" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("ALREADY_PROVISIONED");
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. apply_workflow_parameters — fill named fields on a clone
// ---------------------------------------------------------------------------

describe("executeApplyWorkflowParameters", () => {
  it("sets only the declared fillPoint and PUTs the mutated definition", async () => {
    // GET /workflow/fetch/{id} returns a clone of the template definition.
    mockJson(200, {
      id: 42,
      workflow_uuid: "wf-uuid-1",
      name: "Acme Sales voice",
      workflow_definition: structuredClone(outboundLeadQualifier.definition),
      workflow_configurations: {},
    });
    // PUT /workflow/{id} echoes back the saved row.
    mockJson(200, { id: 42, workflow_uuid: "wf-uuid-1", name: "Acme Sales voice" });

    const result = await executeApplyWorkflowParameters(baseConfig, {
      workflowId: 42,
      templateSlug: "outbound_lead_qualifier",
      parameters: { openingLine: "Hi! Quick question for you." },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.applied).toEqual(["openingLine"]);
    expect(result.data.workflow_id).toBe(42);

    // The PUT body carries the mutated greeting at the declared path.
    const putBody = requestBody(1);
    const def = putBody.workflow_definition as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(def.nodes.find((n) => n.id === "start")!.data.greeting).toBe(
      "Hi! Quick question for you.",
    );
    // Untouched fields are preserved.
    expect(def.nodes.find((n) => n.id === "qualify")!.data.prompt).toBe(
      outboundLeadQualifier.definition.nodes[1].data.prompt,
    );
  });

  it("rejects an undeclared parameter before any network call", async () => {
    const result = await executeApplyWorkflowParameters(baseConfig, {
      workflowId: 42,
      templateSlug: "outbound_lead_qualifier",
      parameters: { transferNumber: "+15551234567" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("UNKNOWN_PARAMETERS");
    if (result.error !== "UNKNOWN_PARAMETERS") return;
    expect(result.allowed).toEqual(getTemplate("outbound_lead_qualifier")!.fillPoints.map((f) => f.key));
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("rejects an unknown template slug", async () => {
    const result = await executeApplyWorkflowParameters(baseConfig, {
      workflowId: 42,
      templateSlug: "no_such_template",
      parameters: { openingLine: "x" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("UNKNOWN_TEMPLATE");
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
