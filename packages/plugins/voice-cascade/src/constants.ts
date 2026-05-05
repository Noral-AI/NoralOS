export const PLUGIN_ID = "noralos.voice-cascade";
export const PLUGIN_VERSION = "0.1.0";

export const PLUGIN_API_PREFIX = `/api/plugins/${PLUGIN_ID}/api`;

// voice-config plugin we depend on for effective-config reads
export const VOICE_CONFIG_PLUGIN_ID = "noralos.voice-config";
export const VOICE_CONFIG_API_BASE = `/api/plugins/${VOICE_CONFIG_PLUGIN_ID}/api`;

export const API_ROUTE_KEYS = {
  synthesize: "synthesize",
  health: "health",
} as const;

export const SURFACES = ["dashboard", "conference_room", "slack", "phone"] as const;
export type Surface = (typeof SURFACES)[number];

// Provider identifiers MUST match voice-config's PROVIDERS minus "default".
//
// "elevenlabs" — ElevenLabs HTTP TTS
// "google_tts" — Google Cloud Text-to-Speech (request/response)
//
// Reserved for future use (do NOT add until channel-side support is real):
//   "gemini_live" — Pipecat-internal Gemini Live native real-time audio
export const PROVIDERS = ["elevenlabs", "google_tts"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TTS_MODES = ["live", "dry_run"] as const;
export type TtsMode = (typeof TTS_MODES)[number];

// Bare event names. Host prepends `plugin.<pluginId>.` automatically.
export const EVENT_KEYS = {
  synthesized: "synthesized",
  suppressed: "suppressed",
  failed: "failed",
} as const;

// Subscribed events from voice-config plugin (full names).
export const VOICE_CONFIG_EVENTS = {
  changed: "plugin.noralos.voice-config.changed",
  defaultsChanged: "plugin.noralos.voice-config.defaults.changed",
} as const;

export const NO_AUDIO_REASONS = [
  "voice-config-fail-closed",
  "voice-config-disabled",
  "voice-config-hidden",
  "surface-disabled",
  "exfiltration-blocked",
  "no-voice-id",
  "provider-failed",
  "provider-rate-limited",
  "invalid-input",
  "config-missing",
  "dry-run",
  "text-too-long",
  "audio-too-large",
] as const;
export type NoAudioReason = (typeof NO_AUDIO_REASONS)[number];

// Default Google Cloud TTS language fallback when voiceId omits a leading
// "xx-XX-" prefix. Operators can override via instance config.
export const DEFAULT_GOOGLE_TTS_LANGUAGE_CODE = "en-US";

// Guardrail defaults applied when instance config does not override them.
// Text limit is a few minutes of speech at typical TTS cadence.
// Audio limit caps inline base64 response payload to ~10 MB raw audio.
export const DEFAULT_MAX_TEXT_CHARS = 5000;
export const DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
