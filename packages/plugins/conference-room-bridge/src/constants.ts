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
  // Browser-callable proxies (auth: "board-or-agent"). The host page calls
  // these using only the user's NoralOS session cookie — no service-agent
  // tokens leave the server. Each /ui/* route delegates to the same internal
  // handler as its agent-auth twin.
  uiState: "ui-state",
  uiCreateSession: "ui-create-session",
  uiSendMessage: "ui-send-message",
  uiLastResult: "ui-last-result",
  uiCloseSession: "ui-close-session",
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

// Spoken-response cap: text handed to TTS is truncated at the nearest
// sentence/word boundary <= this many chars. The full extracted text is
// still returned as `responseText` for display; only `spokenText` is what
// gets synthesized. Keeps voice replies short for A/B latency comparison.
export const SPOKEN_RESPONSE_CAP_CHARS = 600;

// Task-key prefixes that isolate Conference Room model sessions per
// participant. Lives inside the plugin's reserved
// `plugin:<pluginId>:session:*` namespace so the host's existing per-plugin
// list/sendMessage filters keep matching.
//
// USER = authenticated participant — same human across browser tabs and
//        refreshes converges on a single Claude session for that user
//        (within-user continuity, cross-user isolation).
// ANON = unauthenticated — keyed by the per-tab conferenceSessionId so an
//        anonymous session never inherits another user's prior agent state.
export const ISOLATION_TASK_KEY_PREFIX_USER =
  "plugin:noralos.conference-room-bridge:session:user:";
export const ISOLATION_TASK_KEY_PREFIX_ANON =
  "plugin:noralos.conference-room-bridge:session:anon:";

// Privacy directive prepended to every Conference Room user message before
// the agent sees it. This is the temporary, prompt-level mitigation for
// the agent-home leak described in the audit on PR #43: NoralOS agents
// store durable facts under `<agent_home>/life/` and `<agent_home>/memory/`
// (or "alongside their instructions" per their AGENTS.md), and that tree
// is keyed by `companyId + agentId` only — not by participant. Without
// this directive a fact one Conference Room participant tells the agent
// is auto-extracted into the shared tree and surfaces in the next
// participant's prompt.
//
// Pair with the `__participantSubPath` plumbing in PR #43: the host also
// redirects the run's `AGENT_HOME` env var and pre-creates a per-
// participant `life/`+`memory/` tree, so even if the agent ignores the
// directive the writes land in a per-participant filesystem location.
//
// Structural scoping (per-participant instructions bundle root, with
// per-participant siblings of the bundle) is the durable fix and is
// flagged for follow-up.
export const CONFERENCE_ROOM_PRIVACY_DIRECTIVE = [
  "[Conference Room — private session]",
  "",
  "You are speaking with one authenticated participant in a private session. Multiple",
  "users share your agent identity, so you must not let this conversation leak into",
  "any cross-user store:",
  "",
  "1. Do NOT write to `$AGENT_HOME/life/`, `$AGENT_HOME/memory/`, or any \"personal",
  "   files\" directory next to your instructions during this session. Those paths",
  "   are reachable by every participant and would expose this conversation to",
  "   other users.",
  "2. Do NOT invoke the `para-memory-files` skill, fact extraction, or any other",
  "   durable-memory write in this session.",
  "3. If the participant says \"remember this\" / \"save this fact\" / similar,",
  "   acknowledge that you'll keep it within the current Conference Room session",
  "   only. Do NOT perform a filesystem write.",
  "4. Do NOT read `$AGENT_HOME/life/areas/people/user/`, `$AGENT_HOME/memory/`,",
  "   or sibling-of-instructions personal-fact stores to answer questions in this",
  "   session. Treat their contents as off-limits, even if previously populated.",
  "5. The session itself (your in-context conversation history) is your memory for",
  "   this Conference Room exchange. Lean on that instead.",
  "",
  "User message follows below.",
  "",
  "---",
  "",
].join("\n");

// Per-call adapter_config override applied for Conference Room runs only.
// Shallow-merged on top of the agent's stored adapter_config inside the
// host (heartbeat.executeRun), never persisted. The agent retains its
// full base config (`chrome:true`, large `maxTurnsPerRun`, no timeout)
// for issue/heartbeat work; only the conversational Conference Room run
// uses this lightweight profile.
//
// Values are kept as strings where the existing adapter parser already
// accepts strings for these fields (timeoutSec, maxTurnsPerRun in
// claude_local) so we don't perturb the parser path.
export const CONFERENCE_ROOM_ADAPTER_OVERRIDES: Record<string, unknown> = {
  chrome: false,
  timeoutSec: "90",
  maxTurnsPerRun: "4",
};
