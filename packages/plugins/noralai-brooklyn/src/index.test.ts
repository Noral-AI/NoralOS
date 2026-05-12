import { describe, expect, it } from "vitest";

import {
  agentConfigurationDoc,
  createServerAdapter,
  label,
  models,
  type as adapterType,
} from "./index.js";

describe("adapter manifest", () => {
  it("uses the locked identity values from the integration map", () => {
    expect(adapterType).toBe("noralai_brooklyn");
    expect(label).toBe("Brooklyn LLM (NORALAI)");
  });

  it("exposes brooklyn-core as the first model", () => {
    expect(models[0]).toEqual({ id: "brooklyn-core", label: "Brooklyn Core" });
  });

  it("never mentions Qwen or RunPod in operator-facing surface fields", () => {
    const surface = [label, ...models.map((m) => m.label), ...models.map((m) => m.id)].join(" ");
    expect(surface).not.toMatch(/qwen/i);
    expect(surface).not.toMatch(/runpod/i);
  });

  it("agentConfigurationDoc documents the required adapterConfig fields", () => {
    expect(agentConfigurationDoc).toContain("baseUrl");
    expect(agentConfigurationDoc).toContain("upstreamModel");
    expect(agentConfigurationDoc).toContain("apiKeyRef");
    expect(agentConfigurationDoc).toContain("brooklyn-core");
  });
});

describe("createServerAdapter()", () => {
  it("returns a ServerAdapterModule with the expected shape", () => {
    const m = createServerAdapter();
    expect(m.type).toBe("noralai_brooklyn");
    expect(typeof m.execute).toBe("function");
    expect(typeof m.testEnvironment).toBe("function");
    expect(m.models).toEqual(models);
    expect(m.agentConfigurationDoc).toBe(agentConfigurationDoc);
    // Brooklyn is HTTPS-based; it does NOT manage a Claude/Codex-style
    // instructions bundle.
    expect(m.supportsInstructionsBundle).toBe(false);
    expect(m.requiresMaterializedRuntimeSkills).toBe(false);
  });

  it("does not expose a sessionCodec (single-shot chat completion)", () => {
    expect(createServerAdapter().sessionCodec).toBeUndefined();
  });

  it("does not expose listSkills/syncSkills (Brooklyn is not a code-editing adapter)", () => {
    const m = createServerAdapter();
    expect(m.listSkills).toBeUndefined();
    expect(m.syncSkills).toBeUndefined();
  });
});
