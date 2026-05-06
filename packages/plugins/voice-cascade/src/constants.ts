export const PLUGIN_ID = "noralos.voice-cascade";
export const PLUGIN_VERSION = "0.1.0";

export const PLUGIN_API_PREFIX = `/api/plugins/${PLUGIN_ID}/api`;

// voice-config plugin we depend on for effective-config reads
export const VOICE_CONFIG_PLUGIN_ID = "noralos.voice-config";
export const VOICE_CONFIG_API_BASE = `/api/plugins/${VOICE_CONFIG_PLUGIN_ID}/api`;

export const API_ROUTE_KEYS = {
  synthesize: "synthesize",
  health: "health",
  // Read-only voice catalogue + bounded preview. Both are board-or-agent so
  // the in-app Voice Picker modal can call them with the user's session
  // cookie alone — provider keys never leave the server.
  listVoices: "list-voices",
  previewVoice: "preview-voice",
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

// Voice Picker preview: fixed phrase, server-owned. The browser cannot
// inject text — closing prompt-injection / TTS-as-arbitrary-narration
// concerns. Length is intentionally short to keep cost negligible across
// dozens of voice auditions.
export const PREVIEW_TEXT = "Brooklyn here. This is a voice preview.";
// Hard upper bound on preview text size in case PREVIEW_TEXT is changed
// to something user-influenced in the future. Kept small on purpose.
export const PREVIEW_MAX_CHARS = 200;
