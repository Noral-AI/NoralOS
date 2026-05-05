export const PLUGIN_ID = "noralos.conference-room-bridge";
export const PLUGIN_VERSION = "0.1.0";

export const NAMESPACE_SLUG = "confroombridge";
export const PLUGIN_DB_SCHEMA = "plugin_confroombridge_e966e2f80c";

export const PLUGIN_API_PREFIX = `/api/plugins/${PLUGIN_ID}/api`;

// Sibling plugins this bridge depends on.
export const VOICE_CONFIG_PLUGIN_ID = "noralos.voice-config";
export const VOICE_CONFIG_API_BASE = `/api/plugins/${VOICE_CONFIG_PLUGIN_ID}/api`;

export const VOICE_CASCADE_PLUGIN_ID = "noralos.voice-cascade";
export const VOICE_CASCADE_API_BASE = `/api/plugins/${VOICE_CASCADE_PLUGIN_ID}/api`;

// API route keys.
export const API_ROUTE_KEYS = {
  createSession: "create-session",
  sendMessage: "send-message",
  lastResult: "last-result",
  closeSession: "close-session",
  getSession: "get-session",
  health: "health",
} as const;

// Bare event names. Host prepends `plugin.<pluginId>.` automatically.
export const EVENT_KEYS = {
  sessionStarted: "session.started",
  messageReceived: "message.received",
  responseCompleted: "response.completed",
  ttsCompleted: "tts.completed",
  failed: "failed",
} as const;

// Subscribed events.
export const CORE_EVENTS = {
  agentRunFailed: "agent.run.failed",
  agentRunCancelled: "agent.run.cancelled",
} as const;

export const TRANSPORTS = ["daily", "websocket", "livekit", "twilio"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const SESSION_STATUSES = ["active", "closed", "errored"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const LATENCY_HINTS = ["interactive", "thorough"] as const;
export type LatencyHint = (typeof LATENCY_HINTS)[number];

// Reasons returned to callers when session creation, messaging, or close fails.
export const FAILURE_REASONS = [
  "agent-not-voice-eligible",
  "agent-not-found",
  "ceo-not-found",
  "session-not-found",
  "session-errored",
  "agent-run-failed",
  "agent-run-timeout",
  "voice-config-unreachable",
  "voice-cascade-unreachable",
  "internal-error",
  "invalid-input",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

// Default agent-run timeout (ms). Pipecat sessions are latency-tolerant for
// thorough mode; shorter for interactive mode is set by the caller via the
// session's latencyHint (informational; no enforcement in v1).
export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 60_000;

// Bridge-side cap on the extracted assistant text. Sized for a few seconds
// of conference-room speech. voice-cascade has its own (wider) cap; this
// cap is the bridge-level safety so we never hand even a "valid by
// voice-cascade rules" but very long blob to TTS. If exceeded, the bridge
// SKIPS TTS entirely, sets ttsResult.reason = "bridge-response-too-long",
// and still returns the full extracted text for textual fallback.
export const BRIDGE_RESPONSE_CAP_CHARS = 2000;
