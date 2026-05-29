import { describe, it, expect } from "vitest";
import type { CompanyLlmBackendSettings } from "@noralos/shared";
import {
  resolveEffectiveAdapterType,
  buildDeepseekOverrideConfig,
} from "../services/llm-backend-override.ts";

describe("resolveEffectiveAdapterType", () => {
  it("keeps the agent's own adapter for native / null / undefined settings", () => {
    expect(resolveEffectiveAdapterType({ mode: "native" }, "claude_local")).toBe("claude_local");
    expect(resolveEffectiveAdapterType(null, "claude_local")).toBe("claude_local");
    expect(resolveEffectiveAdapterType(undefined, "codex_local")).toBe("codex_local");
  });

  it("forces opencode_local when the company is on deepseek_v4, regardless of the stored adapter", () => {
    const settings: CompanyLlmBackendSettings = { mode: "deepseek_v4", credentialId: "cred" };
    expect(resolveEffectiveAdapterType(settings, "claude_local")).toBe("opencode_local");
    expect(resolveEffectiveAdapterType(settings, "gemini_local")).toBe("opencode_local");
  });
});

describe("buildDeepseekOverrideConfig", () => {
  const runtimeConfig = {
    command: "claude", // claude-specific — must be dropped
    promptTemplate: "claude template", // claude-specific — must be dropped
    model: "claude-sonnet", // must be overridden
    cwd: "/work/repo",
    instructionsFilePath: "/work/AGENT.md",
    timeoutSec: 900,
    graceSec: 20,
    noralosRuntimeSkills: [{ key: "deploy" }],
    env: { FOO: "bar", NORALOS_API_URL: "http://x" },
  };

  it("forges an opencode config that injects DEEPSEEK_API_KEY and carries only adapter-agnostic fields", () => {
    const out = buildDeepseekOverrideConfig({
      runtimeConfig,
      model: "deepseek/deepseek-v4-pro",
      deepseekApiKey: "sk-secret",
    });
    expect(out.command).toBe("opencode");
    expect(out.model).toBe("deepseek/deepseek-v4-pro");
    expect(out.dangerouslySkipPermissions).toBe(true);
    expect(out.env).toMatchObject({ FOO: "bar", NORALOS_API_URL: "http://x", DEEPSEEK_API_KEY: "sk-secret" });
    expect(out.cwd).toBe("/work/repo");
    expect(out.instructionsFilePath).toBe("/work/AGENT.md");
    expect(out.timeoutSec).toBe(900);
    expect(out.graceSec).toBe(20);
    expect(out.noralosRuntimeSkills).toEqual([{ key: "deploy" }]);
    // claude-specific fields must NOT leak through.
    expect(out).not.toHaveProperty("promptTemplate");
  });

  it("does not mutate the input runtimeConfig (its env/command stay claude's)", () => {
    const before = JSON.parse(JSON.stringify(runtimeConfig));
    buildDeepseekOverrideConfig({ runtimeConfig, model: undefined, deepseekApiKey: "k" });
    expect(runtimeConfig).toEqual(before);
    expect(runtimeConfig.command).toBe("claude");
    expect((runtimeConfig.env as Record<string, unknown>).DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("defaults the model to deepseek/deepseek-v4-pro when unset or blank", () => {
    expect(
      buildDeepseekOverrideConfig({ runtimeConfig, model: undefined, deepseekApiKey: "k" }).model,
    ).toBe("deepseek/deepseek-v4-pro");
    expect(
      buildDeepseekOverrideConfig({ runtimeConfig, model: "   ", deepseekApiKey: "k" }).model,
    ).toBe("deepseek/deepseek-v4-pro");
  });

  it("handles a runtimeConfig with no env by still injecting the key", () => {
    const out = buildDeepseekOverrideConfig({
      runtimeConfig: { noralosRuntimeSkills: [] },
      model: "deepseek/deepseek-v4-flash",
      deepseekApiKey: "k2",
    });
    expect(out.env).toEqual({ DEEPSEEK_API_KEY: "k2" });
    expect(out).not.toHaveProperty("cwd");
  });
});
