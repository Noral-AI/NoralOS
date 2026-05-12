import { describe, expect, it } from "vitest";

import { ASSIGNMENT_TARGETS, INTEGRATION_PROVIDERS } from "./integration-providers.js";

describe("INTEGRATION_PROVIDERS — noralai_brooklyn", () => {
  it("is registered with category=llm and credentialType=api_key", () => {
    const p = INTEGRATION_PROVIDERS["noralai_brooklyn"];
    expect(p).toBeDefined();
    expect(p!.id).toBe("noralai_brooklyn");
    expect(p!.category).toBe("llm");
    expect(p!.credentialType).toBe("api_key");
  });

  it("uses the operator-facing display name (no Qwen / RunPod) in the displayName", () => {
    const p = INTEGRATION_PROVIDERS["noralai_brooklyn"]!;
    expect(p.displayName).toBe("Brooklyn LLM (NORALAI)");
    expect(p.displayName).not.toMatch(/qwen/i);
    expect(p.displayName).not.toMatch(/runpod/i);
  });

  it("declares exactly one apiKey secret field", () => {
    const p = INTEGRATION_PROVIDERS["noralai_brooklyn"]!;
    expect(p.fields).toHaveLength(1);
    expect(p.fields[0]).toMatchObject({
      key: "apiKey",
      inputType: "secret",
      required: true,
    });
  });

  it("uses an HTTP test probe with the apiKey substituted as a Bearer token", () => {
    const p = INTEGRATION_PROVIDERS["noralai_brooklyn"]!;
    expect(p.test.kind).toBe("http");
    expect(p.test.method).toBe("GET");
    expect(p.test.headers?.Authorization).toBe("Bearer {{apiKey}}");
    expect(p.test.okStatuses).toContain(200);
    expect(p.test.safeErrorPrefix).toContain("Brooklyn");
  });

  it("exposes exactly one assignable slot, pointing at the noralai.brooklyn plugin's apiKeyRef path", () => {
    const p = INTEGRATION_PROVIDERS["noralai_brooklyn"]!;
    expect(p.assignableSlots).toHaveLength(1);
    expect(p.assignableSlots[0]).toEqual({
      pluginKey: "noralai.brooklyn",
      configPath: "apiKeyRef",
      label: "Brooklyn LLM — API key",
    });
  });

  it("does not regress the existing voice-cascade providers", () => {
    expect(INTEGRATION_PROVIDERS["google_tts"]).toBeDefined();
    expect(INTEGRATION_PROVIDERS["elevenlabs"]).toBeDefined();
  });
});

describe("ASSIGNMENT_TARGETS — noralai.brooklyn", () => {
  it("registers the noralai.brooklyn plugin as assignable", () => {
    const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralai.brooklyn");
    expect(target).toBeDefined();
    expect(target!.pluginDisplayName).toBe("Brooklyn LLM");
  });

  it("declares exactly one apiKeyRef slot expecting the noralai_brooklyn provider", () => {
    const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralai.brooklyn")!;
    expect(target.slots).toHaveLength(1);
    expect(target.slots[0]).toEqual({
      configPath: "apiKeyRef",
      label: "Brooklyn LLM — API key",
      expectsProvider: "noralai_brooklyn",
    });
  });

  it("does not regress the existing voice-cascade assignment target", () => {
    const vc = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralos.voice-cascade");
    expect(vc).toBeDefined();
    expect(vc!.slots.length).toBeGreaterThanOrEqual(2);
  });
});
