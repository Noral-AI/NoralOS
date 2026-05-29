import { describe, it, expect } from "vitest";
import {
  updateCompanyLlmBackendSchema,
  COMPANY_LLM_BACKEND_MODES,
  DEFAULT_DEEPSEEK_OPENCODE_MODEL,
  DEEPSEEK_OPENCODE_MODELS,
} from "./company.js";

const CREDENTIAL_ID = "11111111-1111-1111-1111-111111111111";

describe("updateCompanyLlmBackendSchema", () => {
  it("accepts native without model or credential", () => {
    expect(updateCompanyLlmBackendSchema.safeParse({ mode: "native" }).success).toBe(true);
  });

  it("requires credentialId when mode is deepseek_v4", () => {
    const result = updateCompanyLlmBackendSchema.safeParse({ mode: "deepseek_v4" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("credentialId"))).toBe(true);
    }
  });

  it("accepts deepseek_v4 with a credentialId and a deepseek model", () => {
    const result = updateCompanyLlmBackendSchema.safeParse({
      mode: "deepseek_v4",
      credentialId: CREDENTIAL_ID,
      model: "deepseek/deepseek-v4-flash",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-deepseek opencode model id", () => {
    expect(
      updateCompanyLlmBackendSchema.safeParse({
        mode: "deepseek_v4",
        credentialId: CREDENTIAL_ID,
        model: "openai/gpt-5.2",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid credentialId and unknown modes and extra keys", () => {
    expect(
      updateCompanyLlmBackendSchema.safeParse({ mode: "deepseek_v4", credentialId: "nope" }).success,
    ).toBe(false);
    expect(updateCompanyLlmBackendSchema.safeParse({ mode: "gpt5" }).success).toBe(false);
    expect(updateCompanyLlmBackendSchema.safeParse({ mode: "native", foo: 1 }).success).toBe(false);
  });

  it("exposes a default model + known models in opencode provider/model form", () => {
    expect(DEFAULT_DEEPSEEK_OPENCODE_MODEL).toBe("deepseek/deepseek-v4-pro");
    expect(DEEPSEEK_OPENCODE_MODELS.every((entry) => entry.id.startsWith("deepseek/"))).toBe(true);
    expect(COMPANY_LLM_BACKEND_MODES).toContain("native");
    expect(COMPANY_LLM_BACKEND_MODES).toContain("deepseek_v4");
  });
});
