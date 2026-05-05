export const PLUGIN_ID = "noralos.voice-config";
export const PLUGIN_VERSION = "0.1.0";

export const NAMESPACE_SLUG = "voiceconfig";
export const PLUGIN_DB_SCHEMA = "plugin_voiceconfig_d9257ba961";

export const SLOT_IDS = {
  voiceSettingsTab: "voice-settings-tab",
  companyDefaultsPage: "company-voice-defaults-page",
} as const;

export const EXPORT_NAMES = {
  voiceSettingsTab: "VoiceSettingsTab",
  companyDefaultsPage: "CompanyVoiceDefaultsPage",
} as const;

// Read-only data handlers (safe — getData is for reads only).
export const DATA_KEYS = {
  voiceSettings: "voice-settings",
  companyDefaults: "company-defaults",
} as const;

// All write operations are routed through host-authenticated API routes,
// not action handlers. Action handlers do not receive caller identity in v1.
export const API_ROUTE_KEYS = {
  effectiveConfig: "effective-config",        // GET, board-or-agent
  updateAgentConfig: "update-agent-config",   // PUT, board
  resetAgentConfig: "reset-agent-config",     // DELETE, board
  updateCompanyDefaults: "update-company-defaults", // PUT, board
} as const;

// Bare event names — the host prepends `plugin.<pluginId>.` automatically.
// Subscribers see "plugin.noralos.voice-config.changed" / "plugin.noralos.voice-config.defaults.changed".
export const EVENT_KEYS = {
  agentConfigChanged: "changed",
  companyDefaultsChanged: "defaults.changed",
} as const;

// Plugin-scoped API path prefix. Used by the UI to call its own routes
// via same-origin fetch with credentials.
export const PLUGIN_API_PREFIX = `/api/plugins/${PLUGIN_ID}/api`;

// Provider identifiers consumed by voice-cascade and channel plugins.
//
// "elevenlabs" — ElevenLabs HTTP TTS
// "google_tts" — Google Cloud Text-to-Speech (request/response)
// "default"    — placeholder meaning "use company default"; resolved at read time
//
// Reserved for future use (do NOT add until the channel-side support is real):
//   "gemini_live" — Pipecat-internal Gemini Live native real-time audio
export const PROVIDERS = ["elevenlabs", "google_tts", "default"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TIERS = ["exec", "manager", "worker"] as const;
export type Tier = (typeof TIERS)[number];

export const VISIBILITIES = ["shown", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
