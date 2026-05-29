import { DEFAULT_DEEPSEEK_OPENCODE_MODEL, type CompanyLlmBackendSettings } from "@noralos/shared";

/**
 * Pure helpers for the company-level "LLM backend" switch. The heartbeat applies
 * these as an EXECUTION-TIME override — they never touch the agent row, so the
 * agent's stored `adapter_type` / `adapter_config` are unchanged and flipping a
 * company back to `native` losslessly restores its agents' own adapters.
 */

/** The adapter that should actually run for THIS run given the company setting. */
export function resolveEffectiveAdapterType(
  settings: CompanyLlmBackendSettings | null | undefined,
  agentAdapterType: string,
): string {
  return settings?.mode === "deepseek_v4" ? "opencode_local" : agentAdapterType;
}

/**
 * Forge an `opencode_local` adapter config for the DeepSeek backend. It carries
 * ONLY adapter-agnostic runtime fields from the agent's resolved config (cwd,
 * instructions, timeouts, runtime skills, env) and deliberately drops every
 * claude-specific field (esp. `command`). The DeepSeek key is injected into the
 * subprocess env as `DEEPSEEK_API_KEY`; the OpenCode provider config on the box
 * reads it via `{env:DEEPSEEK_API_KEY}`.
 */
export function buildDeepseekOverrideConfig(input: {
  runtimeConfig: Record<string, unknown>;
  model: string | undefined;
  deepseekApiKey: string;
}): Record<string, unknown> {
  const { runtimeConfig, model, deepseekApiKey } = input;
  const baseEnv =
    runtimeConfig.env && typeof runtimeConfig.env === "object" && !Array.isArray(runtimeConfig.env)
      ? (runtimeConfig.env as Record<string, unknown>)
      : {};
  const backendModel =
    typeof model === "string" && model.trim().length > 0
      ? model.trim()
      : DEFAULT_DEEPSEEK_OPENCODE_MODEL;
  return {
    model: backendModel,
    command: "opencode",
    dangerouslySkipPermissions: true,
    env: { ...baseEnv, DEEPSEEK_API_KEY: deepseekApiKey },
    noralosRuntimeSkills: runtimeConfig.noralosRuntimeSkills,
    ...(runtimeConfig.cwd !== undefined ? { cwd: runtimeConfig.cwd } : {}),
    ...(runtimeConfig.instructionsFilePath !== undefined
      ? { instructionsFilePath: runtimeConfig.instructionsFilePath }
      : {}),
    ...(runtimeConfig.timeoutSec !== undefined ? { timeoutSec: runtimeConfig.timeoutSec } : {}),
    ...(runtimeConfig.graceSec !== undefined ? { graceSec: runtimeConfig.graceSec } : {}),
  };
}
