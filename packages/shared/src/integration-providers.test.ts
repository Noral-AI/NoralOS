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
    expect(p.displayName).toBe("NoralAI");
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

describe("INTEGRATION_PROVIDERS — zoho", () => {
  it("is registered with category=crm and credentialType=oauth_refresh_token", () => {
    const p = INTEGRATION_PROVIDERS["zoho"];
    expect(p).toBeDefined();
    expect(p!.category).toBe("crm");
    expect(p!.credentialType).toBe("oauth_refresh_token");
  });

  it("declares an OAuth spec with offline-capable authorize template + Zoho scopes", () => {
    const p = INTEGRATION_PROVIDERS["zoho"]!;
    expect(p.oauth).toBeDefined();
    const oauth = p.oauth!;
    expect(oauth.authorizeUrlTemplate).toContain("accounts.zoho.{dataCenterTld}");
    expect(oauth.authorizeUrlTemplate).toContain("access_type=offline");
    expect(oauth.tokenUrlTemplate).toContain("{accountsServer}");
    expect(oauth.scopes).toContain("ZohoCRM.modules.ALL");
    expect(oauth.apiDomainResponseField).toBe("api_domain");
    expect(oauth.defaultAccountsServerByField).toMatchObject({
      "dataCenter:us": "https://accounts.zoho.com",
      "dataCenter:eu": "https://accounts.zoho.eu",
    });
  });

  it("exposes clientId/clientSecret/dataCenter fields", () => {
    const fields = INTEGRATION_PROVIDERS["zoho"]!.fields;
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.clientId.inputType).toBe("text");
    expect(byKey.clientSecret.inputType).toBe("secret");
    expect(byKey.dataCenter.inputType).toBe("text");
    expect(byKey.dataCenter.options?.length).toBeGreaterThan(0);
  });
});

describe("INTEGRATION_PROVIDERS — twilio", () => {
  it("is registered with category=telephony and credentialType=basic_auth", () => {
    const p = INTEGRATION_PROVIDERS["twilio"];
    expect(p).toBeDefined();
    expect(p!.id).toBe("twilio");
    expect(p!.category).toBe("telephony");
    expect(p!.credentialType).toBe("basic_auth");
  });

  it("exposes accountSid/apiKeySid/apiKeySecret with only apiKeySecret marked secret", () => {
    const fields = INTEGRATION_PROVIDERS["twilio"]!.fields;
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.accountSid.inputType).toBe("text");
    expect(byKey.accountSid.required).toBe(true);
    expect(byKey.apiKeySid.inputType).toBe("text");
    expect(byKey.apiKeySid.required).toBe(true);
    expect(byKey.apiKeySecret.inputType).toBe("secret");
    expect(byKey.apiKeySecret.required).toBe(true);
    expect(byKey.defaultFromNumber.inputType).toBe("text");
    expect(byKey.defaultFromNumber.required).toBe(false);
  });

  it("declares HTTP Basic auth derivation from apiKeySid + apiKeySecret", () => {
    const p = INTEGRATION_PROVIDERS["twilio"]!;
    expect(p.test.basicAuth).toEqual({
      userField: "apiKeySid",
      passField: "apiKeySecret",
    });
    expect(p.test.headers?.Authorization).toBe("Basic {{__basicAuth}}");
    expect(p.test.urlTemplate).toContain("Accounts/{{accountSid}}.json");
    expect(p.test.okStatuses).toContain(200);
    expect(p.test.safeErrorPrefix).toContain("Twilio");
  });

  it("does NOT reference the master Auth Token anywhere (forces API-key auth)", () => {
    const fields = INTEGRATION_PROVIDERS["twilio"]!.fields;
    expect(fields.find((f) => /auth\s*token/i.test(f.label))).toBeUndefined();
    expect(fields.find((f) => f.key === "authToken")).toBeUndefined();
  });

  it("ships with no assignable slots yet (plugin lands separately)", () => {
    expect(INTEGRATION_PROVIDERS["twilio"]!.assignableSlots).toEqual([]);
  });
});

describe("INTEGRATION_PROVIDERS — noralvoice", () => {
  it("is registered with category=voice and credentialType=api_key", () => {
    const p = INTEGRATION_PROVIDERS["noralvoice"];
    expect(p).toBeDefined();
    expect(p!.id).toBe("noralvoice");
    expect(p!.category).toBe("voice");
    expect(p!.credentialType).toBe("api_key");
    expect(p!.displayName).toBe("NoralVoice");
  });

  it("declares apiKey (secret), baseUrl (text), and organizationId (text)", () => {
    const p = INTEGRATION_PROVIDERS["noralvoice"]!;
    expect(p.fields).toHaveLength(3);
    const byKey: Record<string, (typeof p.fields)[number]> = Object.fromEntries(
      p.fields.map((f) => [f.key, f]),
    );
    expect(byKey.apiKey).toBeDefined();
    expect(byKey.apiKey!.inputType).toBe("secret");
    expect(byKey.apiKey!.required).toBe(true);
    expect(byKey.baseUrl).toBeDefined();
    expect(byKey.baseUrl!.inputType).toBe("text");
    expect(byKey.baseUrl!.required).toBe(true);
    expect(byKey.organizationId).toBeDefined();
    expect(byKey.organizationId!.inputType).toBe("text");
    expect(byKey.organizationId!.required).toBe(true);
  });

  it("test probe hits {{baseUrl}}/api/v1/health with X-API-Key substituted", () => {
    const p = INTEGRATION_PROVIDERS["noralvoice"]!;
    expect(p.test.kind).toBe("http");
    expect(p.test.method).toBe("GET");
    expect(p.test.urlTemplate).toBe("{{baseUrl}}/api/v1/health");
    expect(p.test.headers?.["X-API-Key"]).toBe("{{apiKey}}");
    expect(p.test.okStatuses).toContain(200);
    expect(p.test.safeErrorPrefix).toContain("NoralVoice");
  });

  it("exposes exactly one assignable slot pointing at noralai.noralvoice apiKeyRef", () => {
    const p = INTEGRATION_PROVIDERS["noralvoice"]!;
    expect(p.assignableSlots).toHaveLength(1);
    const slot = p.assignableSlots[0]!;
    expect(slot.pluginKey).toBe("noralai.noralvoice");
    expect(slot.configPath).toBe("apiKeyRef");
    expect(slot.label).toBe("NoralVoice — API key");
  });

  it("declares pairedFields so baseUrl + organizationId propagate to plugin config alongside the secret-ref", () => {
    const p = INTEGRATION_PROVIDERS["noralvoice"]!;
    const slot = p.assignableSlots[0]!;
    expect(slot.pairedFields).toBeDefined();
    expect(slot.pairedFields).toHaveLength(2);

    const baseUrl = slot.pairedFields!.find((pf) => pf.sourceField === "baseUrl");
    expect(baseUrl).toBeDefined();
    expect(baseUrl!.targetConfigPath).toBe("baseUrl");
    expect(baseUrl!.coerce).toBeUndefined(); // plain string passthrough

    const orgId = slot.pairedFields!.find((pf) => pf.sourceField === "organizationId");
    expect(orgId).toBeDefined();
    expect(orgId!.targetConfigPath).toBe("organizationId");
    expect(orgId!.coerce).toBe("integer"); // plugin manifest declares organizationId as integer
  });

  it("pairedFields source keys all exist as declared non-secret fields on the provider", () => {
    // Guards against drift between a slot's pairedFields and the form
    // fields it refers to: a typo here would silently no-op the
    // propagation. Every pairedField sourceField must be a declared
    // non-secret field on the same provider.
    const p = INTEGRATION_PROVIDERS["noralvoice"]!;
    const nonSecretKeys = new Set(
      p.fields.filter((f) => f.inputType !== "secret").map((f) => f.key),
    );
    for (const slot of p.assignableSlots) {
      for (const paired of slot.pairedFields ?? []) {
        expect(nonSecretKeys.has(paired.sourceField)).toBe(true);
      }
    }
  });

  it("does not regress the existing providers (twilio + brooklyn + voice-cascade)", () => {
    expect(INTEGRATION_PROVIDERS["twilio"]).toBeDefined();
    expect(INTEGRATION_PROVIDERS["noralai_brooklyn"]).toBeDefined();
    expect(INTEGRATION_PROVIDERS["google_tts"]).toBeDefined();
    expect(INTEGRATION_PROVIDERS["elevenlabs"]).toBeDefined();
  });
});

describe("ASSIGNMENT_TARGETS — noralai.noralvoice", () => {
  it("registers the noralai.noralvoice plugin as assignable", () => {
    const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralai.noralvoice");
    expect(target).toBeDefined();
    expect(target!.pluginDisplayName).toBe("NoralVoice");
  });

  it("declares exactly one apiKeyRef slot expecting the noralvoice provider", () => {
    const target = ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralai.noralvoice")!;
    expect(target.slots).toHaveLength(1);
    expect(target.slots[0]).toEqual({
      configPath: "apiKeyRef",
      label: "NoralVoice — API key",
      expectsProvider: "noralvoice",
    });
  });

  it("does not regress the noralai.brooklyn or voice-cascade assignment targets", () => {
    expect(ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralai.brooklyn")).toBeDefined();
    expect(ASSIGNMENT_TARGETS.find((t) => t.pluginKey === "noralos.voice-cascade")).toBeDefined();
  });
});
