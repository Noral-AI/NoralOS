import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@noralos/adapter-utils";

import { buildBrooklynConfig } from "./build-config.js";

function baseValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "noralai_brooklyn",
    cwd: "",
    promptTemplate: "",
    model: "",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: false,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    maxTurnsPerRun: 0,
    heartbeatEnabled: false,
    intervalSec: 0,
    ...overrides,
  };
}

describe("buildBrooklynConfig", () => {
  it("maps v.url → baseUrl and defaults model to brooklyn-core", () => {
    const ac = buildBrooklynConfig(
      baseValues({ url: "https://api.runpod.ai/v2/abc/openai/v1" }),
    );
    expect(ac.baseUrl).toBe("https://api.runpod.ai/v2/abc/openai/v1");
    expect(ac.model).toBe("brooklyn-core");
  });

  it("preserves an explicit model selection", () => {
    const ac = buildBrooklynConfig(baseValues({ model: "brooklyn-core" }));
    expect(ac.model).toBe("brooklyn-core");
  });

  it("passes through optional upstreamModel from adapterSchemaValues, trimmed", () => {
    const ac = buildBrooklynConfig(
      baseValues({
        url: "https://api.runpod.ai/v2/abc/openai/v1",
        adapterSchemaValues: { upstreamModel: "  Qwen/Qwen3-32B-FP8  " },
      }),
    );
    expect(ac.upstreamModel).toBe("Qwen/Qwen3-32B-FP8");
  });

  it("omits upstreamModel when blank so the plugin falls back to its internal default", () => {
    const ac = buildBrooklynConfig(
      baseValues({ adapterSchemaValues: { upstreamModel: "   " } }),
    );
    expect("upstreamModel" in ac).toBe(false);
  });

  it("writes apiKeyRef as a company-secret reference, never plaintext", () => {
    const ac = buildBrooklynConfig(
      baseValues({
        adapterSchemaValues: { apiKeyRef: "company-secret:cred-123" },
      }),
    );
    expect(ac.apiKeyRef).toBe("company-secret:cred-123");
    expect("apiKey" in ac).toBe(false);
  });

  it("omits apiKeyRef when blank — the operator will set it after creation", () => {
    const ac = buildBrooklynConfig(baseValues());
    expect("apiKeyRef" in ac).toBe(false);
  });

  it("does not set timeoutSec — execute() interprets 0/missing as 30s default", () => {
    const ac = buildBrooklynConfig(baseValues({ url: "https://x.example/v1" }));
    expect("timeoutSec" in ac).toBe(false);
  });

  it("ignores Claude-CLI-specific fields that have no analog for chat completion", () => {
    const ac = buildBrooklynConfig(
      baseValues({
        url: "https://x.example/v1",
        cwd: "/tmp/should-not-be-here",
        command: "claude",
        chrome: true,
        dangerouslySkipPermissions: true,
        envVars: "FOO=bar",
        instructionsFilePath: "/etc/AGENTS.md",
      }),
    );
    expect("cwd" in ac).toBe(false);
    expect("command" in ac).toBe(false);
    expect("chrome" in ac).toBe(false);
    expect("dangerouslySkipPermissions" in ac).toBe(false);
    expect("env" in ac).toBe(false);
    expect("instructionsFilePath" in ac).toBe(false);
  });
});
