import type { CreateConfigValues } from "@noralos/adapter-utils";

/**
 * Translate the agent-create form values into the Brooklyn
 * `adapterConfig` shape the server-side `execute()` consumes.
 *
 * Field mapping decisions (kept here in one place so the React form,
 * the validator, and the server-side schema all line up):
 *   - `v.url`          → `adapterConfig.baseUrl`
 *     Reuses the existing typed `url` field on `CreateConfigValues`
 *     (openclaw-gateway convention) instead of declaring a new top-level
 *     field. The label in the UI is "Base URL" — `url` is just the storage
 *     slot.
 *   - `v.model`        → `adapterConfig.model`
 *     Defaults to "brooklyn-core" when the user hasn't picked one. The id
 *     is the *operator-facing* model id — the upstream technical model id
 *     is configured separately via `adapterSchemaValues.upstreamModel`.
 *   - `adapterSchemaValues.upstreamModel`  → `adapterConfig.upstreamModel`
 *     Optional override. When unset, the plugin falls back to its internal
 *     `DEFAULT_UPSTREAM_MODEL_ID` (currently "Qwen/Qwen3-32B-FP8"). Reading
 *     from `adapterSchemaValues` (the catch-all bag) avoids polluting the
 *     strict `CreateConfigValues` type with provider-specific fields.
 *   - `adapterSchemaValues.apiKeyRef`      → `adapterConfig.apiKeyRef`
 *     Format: "company-secret:<credentialId>". The host's
 *     `brooklyn-secret-ref` resolver decrypts this to plaintext immediately
 *     before each `execute()` call; the plaintext never reaches storage.
 *
 * Intentionally NOT mapped from `CreateConfigValues`:
 *   - `cwd`, `command`, `extraArgs`, `envVars`, `instructionsFilePath`
 *     etc. — Brooklyn is an HTTPS adapter, not a CLI subprocess, so
 *     process-level knobs are irrelevant.
 *   - `chrome`, `dangerouslySkipPermissions`, `fastMode`, `search` —
 *     Claude-CLI-specific flags with no analog on a chat-completion call.
 */
export function buildBrooklynConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};

  if (v.url) ac.baseUrl = v.url;
  ac.model = v.model || "brooklyn-core";

  const schema = v.adapterSchemaValues ?? {};
  const upstreamModel = schema.upstreamModel;
  if (typeof upstreamModel === "string" && upstreamModel.trim()) {
    ac.upstreamModel = upstreamModel.trim();
  }
  const apiKeyRef = schema.apiKeyRef;
  if (typeof apiKeyRef === "string" && apiKeyRef.trim()) {
    ac.apiKeyRef = apiKeyRef.trim();
  }

  // Brooklyn execute() reads `timeoutSec === 0` as "unset" and applies its
  // own 30-second default. Leaving timeoutSec absent here preserves that
  // behavior so cold-start latency on the upstream endpoint doesn't get
  // clipped by a host default that was meant for CLI adapters.

  return ac;
}
