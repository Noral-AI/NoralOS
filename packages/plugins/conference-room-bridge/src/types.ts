import type {
  FailureReason,
  LatencyHint,
  SessionStatus,
  Transport,
} from "./constants.js";

// ---------------------------------------------------------------------------
// voice-config response shape (mirror of subset we use)
// ---------------------------------------------------------------------------

export interface EffectiveVoiceConfig {
  resolved: true;
  companyId: string;
  agentId: string;
  effectiveTier: "exec" | "manager" | "worker";
  effectiveVisibility: "shown" | "hidden";
  voiceEnabled: boolean;
  effectiveProvider: "elevenlabs" | "google_tts";
  voiceId: string;
  conferenceRoomEnabled: boolean;
  ttsRepliesEnabled: boolean;
}

export interface FailClosedVoiceConfig {
  resolved: false;
  companyId: string;
  agentId: string;
  reason: string;
  voiceEnabled: false;
  effectiveVisibility: "hidden";
  conferenceRoomEnabled: false;
  ttsRepliesEnabled: false;
}

export type EffectiveOrFailClosed = EffectiveVoiceConfig | FailClosedVoiceConfig;

// ---------------------------------------------------------------------------
// voice-cascade response shapes (mirror)
// ---------------------------------------------------------------------------

export interface AudioResult {
  ok: true;
  agentId: string;
  surface: "conference_room";
  providerUsed: "elevenlabs" | "google_tts";
  voiceId: string;
  mimeType: string;
  audioBase64: string;
  durationMs: number | null;
}

export interface NoAudioResult {
  ok: false;
  agentId: string;
  surface: "conference_room";
  reason: string;
  message: string;
  providerAttempted?: "elevenlabs" | "google_tts";
}

export type SynthesisResult = AudioResult | NoAudioResult;

// ---------------------------------------------------------------------------
// Bridge request bodies
// ---------------------------------------------------------------------------

export interface CreateSessionBody {
  conferenceSessionId: string;
  participantId?: string | null;
  targetAgentId?: string | null;
  transport: Transport;
  latencyHint?: LatencyHint;
}

export interface SendMessageBody {
  transcript: string;
  latencyHint?: LatencyHint;
}

// ---------------------------------------------------------------------------
// Bridge response shapes
// ---------------------------------------------------------------------------

export interface CreateSessionOk {
  ok: true;
  conferenceSessionId: string;
  paperclipSessionId: string;
  agentId: string;
  agentName: string;
  status: "active";
  resumed: boolean;
}

export interface BridgeError {
  ok: false;
  reason: FailureReason;
  message: string;
  conferenceSessionId?: string;
}

export type CreateSessionResult = CreateSessionOk | BridgeError;

// SendMessage is async-accepted: the host enforces a 30s plugin RPC timeout,
// but real Brooklyn agent runs routinely take 60–120s. Bridge fires the run,
// returns immediately with `status: "accepted"` + runId, and Pipecat polls
// /sessions/:id/last-result until the run completes.
export interface SendMessageAccepted {
  ok: true;
  status: "accepted";
  conferenceSessionId: string;
  paperclipSessionId: string;
  agentId: string;
  runId: string;
}

export type SendMessageResult = SendMessageAccepted | BridgeError;

// Polled result of an in-flight or completed run.
export type LastResultStatus = "no-run" | "pending" | "done" | "error";

export interface LastResultPending {
  ok: true;
  status: "pending";
  conferenceSessionId: string;
  runId: string;
  agentId: string;
  partialChunkCount: number;
}

export interface LastResultDone {
  ok: true;
  status: "done";
  conferenceSessionId: string;
  runId: string;
  agentId: string;
  responseText: string;
  // Subset of responseText actually handed to TTS — truncated at the nearest
  // sentence/word boundary <= SPOKEN_RESPONSE_CAP_CHARS. Equals responseText
  // when no truncation was needed; empty string when no TTS attempt was made.
  spokenText: string;
  ttsResult: SynthesisResult;
}

export interface LastResultError {
  ok: false;
  status: "error";
  conferenceSessionId: string;
  runId: string;
  agentId: string;
  reason: FailureReason;
  message: string;
}

export interface LastResultNoRun {
  ok: true;
  status: "no-run";
  conferenceSessionId: string;
}

export type LastResult =
  | LastResultPending
  | LastResultDone
  | LastResultError
  | LastResultNoRun
  | BridgeError;

export interface CloseSessionOk {
  ok: true;
  conferenceSessionId: string;
  status: "closed";
}

export type CloseSessionResult = CloseSessionOk | BridgeError;

export interface GetSessionOk {
  ok: true;
  conferenceSessionId: string;
  paperclipSessionId: string;
  agentId: string;
  status: SessionStatus;
  transport: Transport;
  participantId: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastRunId: string | null;
}

export type GetSessionResult = GetSessionOk | BridgeError;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResult {
  status: "ok" | "degraded" | "unavailable";
  voiceConfig: { reachable: boolean };
  voiceCascade: { reachable: boolean };
}
