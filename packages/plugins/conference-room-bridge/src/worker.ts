import {
  definePlugin,
  runWorker,
  type AgentSessionEvent,
  type PluginApiRequestInput,
  type PluginApiResponse,
  type PluginContext,
} from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  CORE_EVENTS,
  EVENT_KEYS,
  LATENCY_HINTS,
  PLUGIN_DB_SCHEMA,
  PLUGIN_ID,
  TRANSPORTS,
  VOICE_CASCADE_PLUGIN_ID,
  type FailureReason,
  type LatencyHint,
  type SessionStatus,
  type Transport,
} from "./constants.js";
import { deriveParticipantContext } from "./participant-isolation.js";
import type {
  BridgeError,
  CloseSessionResult,
  CreateSessionBody,
  CreateSessionResult,
  EffectiveOrFailClosed,
  GetSessionResult,
  HealthResult,
  LastResult,
  SendMessageBody,
  SendMessageResult,
  SynthesisResult,
} from "./types.js";
import { fetchEffectiveConfig } from "./voiceConfigClient.js";
import { callSynthesize } from "./voiceCascadeClient.js";
import { extractAssistantResponse } from "./responseExtractor.js";
import {
  BRIDGE_RESPONSE_CAP_CHARS,
  CONFERENCE_ROOM_ADAPTER_OVERRIDES,
  SPOKEN_RESPONSE_CAP_CHARS,
} from "./constants.js";

// Truncate text to <= SPOKEN_RESPONSE_CAP_CHARS at the nearest sentence
// boundary, falling back to the nearest word boundary, and finally to a
// hard cut. Used to keep TTS input short for A/B latency testing.
function truncateForSpeech(text: string): string {
  if (text.length <= SPOKEN_RESPONSE_CAP_CHARS) return text;
  const window = text.slice(0, SPOKEN_RESPONSE_CAP_CHARS);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("!\n"),
    window.lastIndexOf("?\n"),
  );
  if (sentenceEnd > 0) return window.slice(0, sentenceEnd + 1);
  const wordEnd = window.lastIndexOf(" ");
  if (wordEnd > 0) return window.slice(0, wordEnd);
  return window;
}

// ---------------------------------------------------------------------------
// Module-scope context (kitchen-sink pattern).
// ---------------------------------------------------------------------------

let currentContext: PluginContext | null = null;

interface PluginConfig {
  voiceConfigCallerTokenRef?: string;
  voiceCascadeCallerTokenRef?: string;
  voiceConfigBaseUrl?: string;
  voiceCascadeBaseUrl?: string;
  agentRunTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing or invalid field: ${field}`);
  }
  return value;
}

function asTransport(value: unknown): Transport {
  if (typeof value !== "string" || !TRANSPORTS.includes(value as Transport)) {
    throw new ValidationError(`Invalid transport: ${String(value)}`);
  }
  return value as Transport;
}

function asLatencyHint(value: unknown): LatencyHint | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !LATENCY_HINTS.includes(value as LatencyHint)) {
    throw new ValidationError(`Invalid latencyHint: ${String(value)}`);
  }
  return value as LatencyHint;
}

function asObjectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected JSON object body");
  }
  return value as Record<string, unknown>;
}

function bridgeError(
  reason: FailureReason,
  message: string,
  conferenceSessionId?: string,
): BridgeError {
  return {
    ok: false,
    reason,
    message,
    ...(conferenceSessionId ? { conferenceSessionId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

async function resolveCallerTokens(
  ctx: PluginContext,
  config: PluginConfig,
): Promise<{ voiceConfigToken: string; voiceCascadeToken: string }> {
  if (!config.voiceConfigCallerTokenRef) {
    throw new Error("voiceConfigCallerTokenRef not configured");
  }
  if (!config.voiceCascadeCallerTokenRef) {
    throw new Error("voiceCascadeCallerTokenRef not configured");
  }
  const voiceConfigToken = await ctx.secrets.resolve(config.voiceConfigCallerTokenRef);
  const voiceCascadeToken =
    config.voiceCascadeCallerTokenRef === config.voiceConfigCallerTokenRef
      ? voiceConfigToken
      : await ctx.secrets.resolve(config.voiceCascadeCallerTokenRef);
  return { voiceConfigToken, voiceCascadeToken };
}

function baseUrls(config: PluginConfig) {
  return {
    voiceConfig: config.voiceConfigBaseUrl ?? "http://localhost:3100",
    voiceCascade: config.voiceCascadeBaseUrl ?? "http://localhost:3100",
  };
}

// ---------------------------------------------------------------------------
// Target-agent resolution
// ---------------------------------------------------------------------------

async function resolveTargetAgentId(
  ctx: PluginContext,
  companyId: string,
  explicitTargetAgentId: string | null | undefined,
): Promise<{ agentId: string; agentName: string } | { error: BridgeError }> {
  if (explicitTargetAgentId) {
    const agent = await ctx.agents.get(explicitTargetAgentId, companyId);
    if (!agent) {
      return {
        error: bridgeError("agent-not-found", `Agent ${explicitTargetAgentId} not found in company`),
      };
    }
    return { agentId: agent.id, agentName: agent.name };
  }
  // Default target = CEO. List CEOs in this company; pick the first by created order.
  const allAgents = await ctx.agents.list({ companyId });
  const ceos = allAgents
    .filter((a) => a.role === "ceo")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (ceos.length === 0) {
    return { error: bridgeError("ceo-not-found", "No agent with role=ceo in this company") };
  }
  return { agentId: ceos[0].id, agentName: ceos[0].name };
}

// ---------------------------------------------------------------------------
// Voice-config eligibility gate
// ---------------------------------------------------------------------------

async function ensureConferenceEligible(
  baseUrl: string,
  agentToken: string,
  companyId: string,
  agentId: string,
): Promise<EffectiveOrFailClosed> {
  return await fetchEffectiveConfig({
    baseUrl,
    agentToken,
    companyId,
    agentId,
  });
}

function isEligibleForConferenceRoom(eff: EffectiveOrFailClosed): boolean {
  if (!eff.resolved) return false;
  if (!eff.voiceEnabled) return false;
  if (eff.effectiveVisibility === "hidden") return false;
  if (!eff.conferenceRoomEnabled) return false;
  return true;
}

// ---------------------------------------------------------------------------
// DB row I/O
// ---------------------------------------------------------------------------

interface MappingRow {
  conference_session_id: string;
  company_id: string;
  participant_id: string | null;
  target_agent_id: string;
  paperclip_session_id: string;
  transport: Transport;
  status: SessionStatus;
  latency_hint: LatencyHint | null;
  created_at: string;
  last_seen_at: string;
  last_run_id: string | null;
  last_voice_provider: "elevenlabs" | "google_tts" | null;
  last_voice_id: string | null;
}

async function loadMapping(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
): Promise<MappingRow | null> {
  const rows = await ctx.db.query<MappingRow>(
    `SELECT * FROM ${PLUGIN_DB_SCHEMA}.conference_session_mappings
       WHERE company_id = $1 AND conference_session_id = $2`,
    [companyId, conferenceSessionId],
  );
  return rows[0] ?? null;
}

async function insertMapping(
  ctx: PluginContext,
  row: Omit<MappingRow, "created_at" | "last_seen_at" | "last_run_id" | "last_voice_provider" | "last_voice_id">,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO ${PLUGIN_DB_SCHEMA}.conference_session_mappings (
       conference_session_id, company_id, participant_id, target_agent_id,
       paperclip_session_id, transport, status, latency_hint,
       created_at, last_seen_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [
      row.conference_session_id,
      row.company_id,
      row.participant_id,
      row.target_agent_id,
      row.paperclip_session_id,
      row.transport,
      row.status,
      row.latency_hint,
    ],
  );
}

async function updateMappingAfterRun(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
  patch: {
    runId?: string | null;
    voiceProvider?: "elevenlabs" | "google_tts" | null;
    voiceId?: string | null;
    status?: SessionStatus;
  },
): Promise<void> {
  await ctx.db.execute(
    `UPDATE ${PLUGIN_DB_SCHEMA}.conference_session_mappings
       SET last_seen_at        = now(),
           last_run_id         = COALESCE($3, last_run_id),
           last_voice_provider = COALESCE($4, last_voice_provider),
           last_voice_id       = COALESCE($5, last_voice_id),
           status              = COALESCE($6, status)
       WHERE company_id = $1 AND conference_session_id = $2`,
    [
      companyId,
      conferenceSessionId,
      patch.runId ?? null,
      patch.voiceProvider ?? null,
      patch.voiceId ?? null,
      patch.status ?? null,
    ],
  );
}

async function setMappingStatus(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
  status: SessionStatus,
): Promise<void> {
  await ctx.db.execute(
    `UPDATE ${PLUGIN_DB_SCHEMA}.conference_session_mappings
       SET status = $3, last_seen_at = now()
       WHERE company_id = $1 AND conference_session_id = $2`,
    [companyId, conferenceSessionId, status],
  );
}

// ---------------------------------------------------------------------------
// Async run state — lives only in worker memory.
//
// Why async: the host enforces a 30s plugin-RPC timeout on onApiRequest, but
// real Brooklyn heartbeat runs take 60–120s. Bridge fires the run, returns
// immediately with { status: "accepted", runId }, and Pipecat polls
// /sessions/:id/last-result until the run completes.
//
// chunks accumulate via the onEvent callback the host streams to the worker.
// finalizeRun runs after the "done" event fires and calls voice-cascade.
//
// Limitation: state is in-memory only. If the worker restarts mid-run, the
// run continues server-side (agent_task_sessions outlives the bridge worker)
// but the bridge loses the chunk accumulation. Pipecat will poll and see
// no-run; it should re-issue the message in that case. v1.1 candidate:
// persist chunks to the plugin DB.
// ---------------------------------------------------------------------------

interface RunState {
  conferenceSessionId: string;
  companyId: string;
  agentId: string;
  paperclipSessionId: string;
  runId: string;
  chunks: string[];
  status: "pending" | "done" | "error";
  responseText?: string;
  spokenText?: string;
  ttsResult?: SynthesisResult;
  error?: { reason: FailureReason; message: string };
  startedAt: number;
  finalizationStarted: boolean;
}

const runStates = new Map<string, RunState>();
const sessionToRun = new Map<string, string>(); // sessionKey -> runId

function sessionKey(companyId: string, conferenceSessionId: string): string {
  return `${companyId}:${conferenceSessionId}`;
}

function buildAgentEventHandler(
  ctx: PluginContext,
  config: PluginConfig,
  companyId: string,
  conferenceSessionId: string,
): (event: AgentSessionEvent) => void {
  return (event) => {
    const state = runStates.get(event.runId);
    if (!state) return;
    if (event.eventType === "chunk" && typeof event.message === "string") {
      // Accept all chunks; finalizeRun calls extractAssistantResponse to
      // pull out the canonical {"type":"result","result":"..."} line.
      // Paperclip's adapter emits everything on stream="stdout" so we
      // can't filter at this layer.
      state.chunks.push(event.message);
    } else if (event.eventType === "done") {
      state.responseText = state.chunks.join("");
      // Kick off voice-cascade asynchronously. Don't await — we don't want
      // to block the host's event delivery callback.
      void finalizeRun(ctx, config, state);
    } else if (event.eventType === "error") {
      state.status = "error";
      state.error = {
        reason: "agent-run-failed",
        message: event.message ?? "agent run errored",
      };
      void emitFailureEvent(ctx, state);
    }
  };
}

async function finalizeRun(
  ctx: PluginContext,
  config: PluginConfig,
  state: RunState,
): Promise<void> {
  if (state.finalizationStarted) return;
  state.finalizationStarted = true;

  // Extract the user-facing assistant reply from the raw chunk stream.
  // Paperclip emits the full Claude Agent SDK transcript (system, user,
  // assistant turns, tool round-trips, rate-limit events, plus a final
  // type:result line). Only the result line is what should be spoken.
  const rawResponseText = state.chunks.join("");
  const extraction = extractAssistantResponse(rawResponseText);

  let extractedText = "";
  let preTtsBlock: SynthesisResult | null = null;

  if (!extraction.ok) {
    // No assistant text could be extracted. Surface a clear bridge-level
    // reason and skip voice-cascade. responseText stays empty so callers
    // know there's nothing to display either.
    extractedText = "";
    preTtsBlock = {
      ok: false,
      agentId: state.agentId,
      surface: "conference_room",
      reason:
        extraction.reason === "no-result-event"
          ? "no-assistant-text"
          : extraction.reason,
      message: extraction.message,
    };
    ctx.logger.warn("finalizeRun: assistant-text extraction failed", {
      conferenceSessionId: state.conferenceSessionId,
      reason: extraction.reason,
      rawLength: rawResponseText.length,
    });
  } else if (extraction.capped) {
    // Extraction succeeded but the assistant reply exceeds the bridge cap.
    // Don't synthesize a truncated voice — return the full text for
    // textual fallback and skip TTS with a clear bridge-level reason.
    extractedText = extraction.text; // already capped to BRIDGE_RESPONSE_CAP_CHARS
    preTtsBlock = {
      ok: false,
      agentId: state.agentId,
      surface: "conference_room",
      reason: "bridge-response-too-long",
      message: `Extracted assistant text length ${extraction.originalLength} exceeds bridge cap ${BRIDGE_RESPONSE_CAP_CHARS}; TTS skipped.`,
    };
  } else {
    extractedText = extraction.text;
  }

  // Persist the extracted text on the run state so /last-result returns
  // the user-facing reply, not the 100KB raw transcript.
  state.responseText = extractedText;

  // Compute the spoken subset (<= SPOKEN_RESPONSE_CAP_CHARS, sentence/word
  // boundary). Empty when there's nothing to speak or TTS is being skipped.
  const spokenText = preTtsBlock
    ? ""
    : extractedText.length > 0
      ? truncateForSpeech(extractedText)
      : "";
  state.spokenText = spokenText;

  await ctx.events.emit(EVENT_KEYS.responseCompleted, state.companyId, {
    companyId: state.companyId,
    conferenceSessionId: state.conferenceSessionId,
    agentId: state.agentId,
    runId: state.runId,
    responseLength: extractedText.length,
  });

  // Resolve voice-cascade caller token (only needed if we're going to call).
  let voiceCascadeToken = "";
  if (!preTtsBlock) {
    try {
      const tokens = await resolveCallerTokens(ctx, config);
      voiceCascadeToken = tokens.voiceCascadeToken;
    } catch (err) {
      ctx.logger.warn("finalizeRun: caller token unresolved", {
        conferenceSessionId: state.conferenceSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let ttsResult: SynthesisResult;
  if (preTtsBlock) {
    ttsResult = preTtsBlock;
  } else if (!voiceCascadeToken) {
    ttsResult = {
      ok: false,
      agentId: state.agentId,
      surface: "conference_room",
      reason: "voice-cascade-unreachable",
      message: "voiceCascadeCallerTokenRef not configured",
    };
  } else {
    try {
      ttsResult = await callSynthesize({
        baseUrl: baseUrls(config).voiceCascade,
        agentToken: voiceCascadeToken,
        companyId: state.companyId,
        agentId: state.agentId,
        text: spokenText,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.warn("voice-cascade call failed; returning text-only", {
        conferenceSessionId: state.conferenceSessionId,
        agentId: state.agentId,
        error: message,
      });
      ttsResult = {
        ok: false,
        agentId: state.agentId,
        surface: "conference_room",
        reason: "voice-cascade-unreachable",
        message,
      };
    }
  }

  state.ttsResult = ttsResult;
  state.status = "done";

  // Persist run metadata on the mapping.
  const usedProvider = ttsResult.ok ? ttsResult.providerUsed : null;
  const usedVoiceId = ttsResult.ok ? ttsResult.voiceId : null;
  await updateMappingAfterRun(ctx, state.companyId, state.conferenceSessionId, {
    runId: state.runId,
    voiceProvider: usedProvider,
    voiceId: usedVoiceId,
  });

  await ctx.events.emit(EVENT_KEYS.ttsCompleted, state.companyId, {
    companyId: state.companyId,
    conferenceSessionId: state.conferenceSessionId,
    agentId: state.agentId,
    ok: ttsResult.ok,
    reason: ttsResult.ok ? null : ttsResult.reason,
    provider: ttsResult.ok ? ttsResult.providerUsed : ttsResult.providerAttempted ?? null,
  });
}

async function emitFailureEvent(ctx: PluginContext, state: RunState): Promise<void> {
  await setMappingStatus(ctx, state.companyId, state.conferenceSessionId, "errored");
  await ctx.events.emit(EVENT_KEYS.failed, state.companyId, {
    companyId: state.companyId,
    conferenceSessionId: state.conferenceSessionId,
    stage: "agent-run",
    error: state.error?.message ?? "unknown",
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleCreateSession(
  ctx: PluginContext,
  config: PluginConfig,
  companyId: string,
  body: CreateSessionBody,
  actor: PluginApiRequestInput["actor"] | undefined,
): Promise<CreateSessionResult> {
  const conferenceSessionId = asString(body.conferenceSessionId, "conferenceSessionId");
  const transport = asTransport(body.transport);
  const latencyHint = asLatencyHint(body.latencyHint);
  const isolation = deriveParticipantContext(actor, body, conferenceSessionId);
  const participantId = isolation.participantId;

  // Idempotency: if a mapping already exists, return it (resumed=true).
  const existing = await loadMapping(ctx, companyId, conferenceSessionId);
  if (existing && existing.status === "active") {
    ctx.logger.info("conference-room: session resumed", {
      companyId,
      conferenceSessionId,
      agentId: existing.target_agent_id,
      participantPresent: existing.participant_id !== null,
      isolationKeyType: isolation.isolationKeyType,
      resumed: true,
    });
    return {
      ok: true,
      conferenceSessionId,
      paperclipSessionId: existing.paperclip_session_id,
      agentId: existing.target_agent_id,
      agentName: "(resumed)",
      status: "active",
      resumed: true,
    };
  }

  // Resolve target agent.
  const targetResult = await resolveTargetAgentId(ctx, companyId, body.targetAgentId ?? null);
  if ("error" in targetResult) return { ...targetResult.error, conferenceSessionId };
  const { agentId, agentName } = targetResult;

  // Eligibility gate.
  let tokens: { voiceConfigToken: string; voiceCascadeToken: string };
  try {
    tokens = await resolveCallerTokens(ctx, config);
  } catch (err) {
    return bridgeError(
      "internal-error",
      `caller token unresolved: ${err instanceof Error ? err.message : String(err)}`,
      conferenceSessionId,
    );
  }
  const urls = baseUrls(config);

  let eff: EffectiveOrFailClosed;
  try {
    eff = await ensureConferenceEligible(
      urls.voiceConfig,
      tokens.voiceConfigToken,
      companyId,
      agentId,
    );
  } catch (err) {
    return bridgeError(
      "voice-config-unreachable",
      err instanceof Error ? err.message : String(err),
      conferenceSessionId,
    );
  }

  if (!isEligibleForConferenceRoom(eff)) {
    const detail = !eff.resolved
      ? `voice-config returned fail-closed: ${eff.reason}`
      : eff.effectiveVisibility === "hidden"
        ? "agent is hidden from voice surfaces"
        : !eff.voiceEnabled
          ? "agent voice not enabled"
          : !eff.conferenceRoomEnabled
            ? "agent not enabled for conference_room surface"
            : "agent not eligible";
    return bridgeError("agent-not-voice-eligible", detail, conferenceSessionId);
  }

  // Create the Paperclip agent session.
  //
  // The host's `agents.sessions.create` is now find-or-create on the
  // (company, agent, adapter, taskKey) tuple — so two different conference
  // sessions belonging to the same authenticated user converge on the same
  // agent_task_sessions row, and the second one resumes the user's Claude
  // session instead of starting fresh. Anonymous sessions get a per-session
  // taskKey and therefore never resume each other.
  let paperclipSessionId: string;
  try {
    const session = await ctx.agents.sessions.create(agentId, companyId, {
      reason: `Conference Room session ${conferenceSessionId} (${transport})`,
      taskKey: isolation.taskKey,
    });
    paperclipSessionId = session.sessionId;
  } catch (err) {
    return bridgeError(
      "internal-error",
      `failed to create agent session: ${err instanceof Error ? err.message : String(err)}`,
      conferenceSessionId,
    );
  }

  await insertMapping(ctx, {
    conference_session_id: conferenceSessionId,
    company_id: companyId,
    participant_id: participantId,
    target_agent_id: agentId,
    paperclip_session_id: paperclipSessionId,
    transport,
    status: "active",
    latency_hint: latencyHint ?? null,
  });

  // Structured metadata only — never include transcript text. Lets prod
  // logs answer "did this run get the right isolation key for the right
  // participant?" without leaking conversation content.
  ctx.logger.info("conference-room: session created", {
    companyId,
    conferenceSessionId,
    agentId,
    participantPresent: participantId !== null,
    isolationKeyType: isolation.isolationKeyType,
    resumed: false,
  });

  await ctx.events.emit(EVENT_KEYS.sessionStarted, companyId, {
    companyId,
    conferenceSessionId,
    participantId,
    targetAgentId: agentId,
    paperclipSessionId,
    transport,
  });

  await ctx.activity.log({
    companyId,
    message: `Conference Room session started for agent ${agentName} (${agentId}) via ${transport}`,
    entityType: "agent",
    entityId: agentId,
    metadata: {
      kind: "conference-room-bridge.session.started",
      conferenceSessionId,
      paperclipSessionId,
      transport,
    },
  });

  return {
    ok: true,
    conferenceSessionId,
    paperclipSessionId,
    agentId,
    agentName,
    status: "active",
    resumed: false,
  };
}

async function handleSendMessage(
  ctx: PluginContext,
  config: PluginConfig,
  companyId: string,
  conferenceSessionId: string,
  body: SendMessageBody,
): Promise<SendMessageResult> {
  const transcript = asString(body.transcript, "transcript");

  const mapping = await loadMapping(ctx, companyId, conferenceSessionId);
  if (!mapping) {
    return bridgeError("session-not-found", `No session for conferenceSessionId=${conferenceSessionId}`);
  }
  if (mapping.status !== "active") {
    return bridgeError("session-errored", `Session status is ${mapping.status}`, conferenceSessionId);
  }

  // Validate caller tokens are resolvable (fail fast — don't start the run
  // if voice-cascade can't be called later).
  try {
    await resolveCallerTokens(ctx, config);
  } catch (err) {
    return bridgeError(
      "internal-error",
      err instanceof Error ? err.message : String(err),
      conferenceSessionId,
    );
  }

  await ctx.events.emit(EVENT_KEYS.messageReceived, companyId, {
    companyId,
    conferenceSessionId,
    participantId: mapping.participant_id,
    transcriptLength: transcript.length,
  });

  // Set up the onEvent handler BEFORE sending so chunks aren't lost.
  // Since runId is only known after sendMessage returns, use a closure that
  // looks up the state by event.runId — the host always tags events with it.
  const onEvent = buildAgentEventHandler(ctx, config, companyId, conferenceSessionId);

  let sendResult: { runId: string };
  try {
    sendResult = await ctx.agents.sessions.sendMessage(
      mapping.paperclip_session_id,
      companyId,
      {
        prompt: transcript,
        onEvent,
        // Lightweight runtime profile for conversational voice — applied
        // for this run only by the host. Brooklyn's stored adapter_config
        // (chrome+long-loop) stays untouched for issue/heartbeat work.
        adapterConfigOverrides: CONFERENCE_ROOM_ADAPTER_OVERRIDES,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setMappingStatus(ctx, companyId, conferenceSessionId, "errored");
    await ctx.events.emit(EVENT_KEYS.failed, companyId, {
      companyId,
      conferenceSessionId,
      stage: "send-message",
      error: message,
    });
    return bridgeError("agent-run-failed", message, conferenceSessionId);
  }

  // Initialize the run state. onEvent already wired; events arriving from now
  // on will accumulate into this state's chunks.
  const runState: RunState = {
    conferenceSessionId,
    companyId,
    agentId: mapping.target_agent_id,
    paperclipSessionId: mapping.paperclip_session_id,
    runId: sendResult.runId,
    chunks: [],
    status: "pending",
    startedAt: Date.now(),
    finalizationStarted: false,
  };
  runStates.set(sendResult.runId, runState);
  sessionToRun.set(sessionKey(companyId, conferenceSessionId), sendResult.runId);

  // Update mapping with the new run id (best-effort).
  await updateMappingAfterRun(ctx, companyId, conferenceSessionId, {
    runId: sendResult.runId,
  });

  return {
    ok: true,
    status: "accepted",
    conferenceSessionId,
    paperclipSessionId: mapping.paperclip_session_id,
    agentId: mapping.target_agent_id,
    runId: sendResult.runId,
  };
}

async function handleGetLastResult(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
): Promise<LastResult> {
  const mapping = await loadMapping(ctx, companyId, conferenceSessionId);
  if (!mapping) {
    return bridgeError("session-not-found", `No session for conferenceSessionId=${conferenceSessionId}`);
  }

  const runId = sessionToRun.get(sessionKey(companyId, conferenceSessionId)) ?? mapping.last_run_id;
  if (!runId) {
    return { ok: true, status: "no-run", conferenceSessionId };
  }

  const state = runStates.get(runId);
  if (!state) {
    // Mapping has a last_run_id but worker memory has no chunks (worker
    // restarted, or run is older than current process). Caller should
    // re-issue the message.
    return { ok: true, status: "no-run", conferenceSessionId };
  }

  if (state.status === "pending") {
    return {
      ok: true,
      status: "pending",
      conferenceSessionId,
      runId,
      agentId: state.agentId,
      partialChunkCount: state.chunks.length,
    };
  }

  if (state.status === "error") {
    return {
      ok: false,
      status: "error",
      conferenceSessionId,
      runId,
      agentId: state.agentId,
      reason: state.error?.reason ?? "agent-run-failed",
      message: state.error?.message ?? "agent run errored",
    };
  }

  // status === "done"
  return {
    ok: true,
    status: "done",
    conferenceSessionId,
    runId,
    agentId: state.agentId,
    responseText: state.responseText ?? "",
    spokenText: state.spokenText ?? "",
    ttsResult:
      state.ttsResult ??
      ({
        ok: false,
        agentId: state.agentId,
        surface: "conference_room",
        reason: "voice-cascade-unreachable",
        message: "tts result missing",
      } as SynthesisResult),
  };
}

async function handleCloseSession(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
): Promise<CloseSessionResult> {
  const mapping = await loadMapping(ctx, companyId, conferenceSessionId);
  if (!mapping) {
    return bridgeError("session-not-found", `No session for conferenceSessionId=${conferenceSessionId}`);
  }
  if (mapping.status === "active") {
    try {
      await ctx.agents.sessions.close(mapping.paperclip_session_id, companyId);
    } catch (err) {
      ctx.logger.warn("agent session close failed; marking mapping closed anyway", {
        conferenceSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await setMappingStatus(ctx, companyId, conferenceSessionId, "closed");
  }
  return { ok: true, conferenceSessionId, status: "closed" };
}

async function handleGetSession(
  ctx: PluginContext,
  companyId: string,
  conferenceSessionId: string,
): Promise<GetSessionResult> {
  const mapping = await loadMapping(ctx, companyId, conferenceSessionId);
  if (!mapping) {
    return bridgeError("session-not-found", `No session for conferenceSessionId=${conferenceSessionId}`);
  }
  return {
    ok: true,
    conferenceSessionId: mapping.conference_session_id,
    paperclipSessionId: mapping.paperclip_session_id,
    agentId: mapping.target_agent_id,
    status: mapping.status,
    transport: mapping.transport,
    participantId: mapping.participant_id,
    createdAt: mapping.created_at,
    lastSeenAt: mapping.last_seen_at,
    lastRunId: mapping.last_run_id,
  };
}

async function handleHealth(
  ctx: PluginContext,
  config: PluginConfig,
  companyId: string,
): Promise<HealthResult> {
  const urls = baseUrls(config);
  let voiceConfigReachable = false;
  let voiceCascadeReachable = false;
  let tokens: { voiceConfigToken: string; voiceCascadeToken: string } | null = null;

  try {
    tokens = await resolveCallerTokens(ctx, config);
  } catch {
    // Tokens not configured; both checks remain false.
  }

  if (tokens) {
    // Probe voice-config: a known-bad agentId returns 200 with resolved=false.
    // We just need a non-error response to confirm reachability.
    try {
      await fetchEffectiveConfig({
        baseUrl: urls.voiceConfig,
        agentToken: tokens.voiceConfigToken,
        companyId,
        agentId: "00000000-0000-0000-0000-000000000000",
      });
      voiceConfigReachable = true;
    } catch {
      voiceConfigReachable = false;
    }

    // voice-cascade health endpoint accepts board-or-agent.
    try {
      const healthUrl = `${urls.voiceCascade}/api/plugins/${"noralos.voice-cascade"}/api/health?companyId=${encodeURIComponent(companyId)}`;
      const res = await fetch(healthUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokens.voiceCascadeToken}` },
      });
      voiceCascadeReachable = res.ok;
    } catch {
      voiceCascadeReachable = false;
    }
  }

  const okCount = (voiceConfigReachable ? 1 : 0) + (voiceCascadeReachable ? 1 : 0);
  const status: HealthResult["status"] = okCount === 2 ? "ok" : okCount === 1 ? "degraded" : "unavailable";
  return {
    status,
    voiceConfig: { reachable: voiceConfigReachable },
    voiceCascade: { reachable: voiceCascadeReachable },
  };
}

// ---------------------------------------------------------------------------
// API dispatcher
// ---------------------------------------------------------------------------

async function dispatchApi(
  ctx: PluginContext,
  input: PluginApiRequestInput,
): Promise<PluginApiResponse> {
  const companyId = input.companyId;
  if (!companyId) return { status: 400, body: { error: "missing companyId" } };

  const config = (await ctx.config.get()) as PluginConfig;

  switch (input.routeKey) {
    case API_ROUTE_KEYS.createSession: {
      try {
        const body = asObjectBody(input.body) as unknown as CreateSessionBody;
        const result = await handleCreateSession(ctx, config, companyId, body, input.actor);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: bridgeError("invalid-input", err.message) };
        }
        ctx.logger.error("createSession failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: bridgeError("internal-error", "Internal error") };
      }
    }

    case API_ROUTE_KEYS.sendMessage: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      try {
        const body = asObjectBody(input.body) as unknown as SendMessageBody;
        const result = await handleSendMessage(ctx, config, companyId, conferenceSessionId, body);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: bridgeError("invalid-input", err.message, conferenceSessionId) };
        }
        ctx.logger.error("sendMessage failed", {
          conferenceSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: bridgeError("internal-error", "Internal error", conferenceSessionId) };
      }
    }

    case API_ROUTE_KEYS.lastResult: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      const result = await handleGetLastResult(ctx, companyId, conferenceSessionId);
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.closeSession: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      const result = await handleCloseSession(ctx, companyId, conferenceSessionId);
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.getSession: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      const result = await handleGetSession(ctx, companyId, conferenceSessionId);
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.health: {
      const result = await handleHealth(ctx, config, companyId);
      return { status: 200, body: result };
    }

    // -------------------------------------------------------------------------
    // /ui/* routes: browser-callable proxies. Same internal helpers, but
    // exposed to board-auth callers (the NoralOS user session). The browser
    // never receives a service-agent token; server-side hops to voice-config
    // and voice-cascade still use the configured token refs.
    // -------------------------------------------------------------------------

    case API_ROUTE_KEYS.uiState: {
      // Aggregate the bits the page needs at mount: bridge health + voice-cascade
      // ttsMode (so the page can render the dry-run badge correctly).
      const health = await handleHealth(ctx, config, companyId);
      let ttsMode: string | null = null;
      let providers: Record<string, string> | null = null;
      try {
        const tokenRef = config.voiceCascadeCallerTokenRef;
        if (tokenRef) {
          const vcUrl = `${config.voiceCascadeBaseUrl ?? "http://localhost:3100"}/api/plugins/${VOICE_CASCADE_PLUGIN_ID}/api/health?companyId=${encodeURIComponent(companyId)}`;
          const token = await ctx.secrets.resolve(tokenRef);
          const res = await fetch(vcUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const j = (await res.json()) as { ttsMode?: string; providers?: Record<string, string> };
            ttsMode = j.ttsMode ?? null;
            providers = j.providers ?? null;
          }
        }
      } catch (err) {
        ctx.logger.warn("ui-state: voice-cascade health unreachable", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return {
        status: 200,
        body: { bridge: health, voiceCascade: { ttsMode, providers } },
      };
    }

    case API_ROUTE_KEYS.uiCreateSession: {
      try {
        const body = asObjectBody(input.body) as unknown as CreateSessionBody;
        const result = await handleCreateSession(ctx, config, companyId, body, input.actor);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: bridgeError("invalid-input", err.message) };
        }
        ctx.logger.error("ui-create-session failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: bridgeError("internal-error", "Internal error") };
      }
    }

    case API_ROUTE_KEYS.uiSendMessage: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      try {
        const body = asObjectBody(input.body) as unknown as SendMessageBody;
        const result = await handleSendMessage(ctx, config, companyId, conferenceSessionId, body);
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ValidationError) {
          return { status: 400, body: bridgeError("invalid-input", err.message, conferenceSessionId) };
        }
        ctx.logger.error("ui-send-message failed", {
          conferenceSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 500, body: bridgeError("internal-error", "Internal error", conferenceSessionId) };
      }
    }

    case API_ROUTE_KEYS.uiLastResult: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      const result = await handleGetLastResult(ctx, companyId, conferenceSessionId);
      return { status: 200, body: result };
    }

    case API_ROUTE_KEYS.uiCloseSession: {
      const conferenceSessionId = input.params.conferenceSessionId;
      if (!conferenceSessionId) {
        return { status: 400, body: bridgeError("invalid-input", "missing conferenceSessionId") };
      }
      const result = await handleCloseSession(ctx, companyId, conferenceSessionId);
      return { status: 200, body: result };
    }

    default:
      return { status: 404, body: { error: `Unknown route: ${input.routeKey}` } };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;
    ctx.logger.info(`${PLUGIN_ID} starting`, { schema: PLUGIN_DB_SCHEMA });

    // Mark sessions errored if their agent run fails or is cancelled.
    // Payload shape: PluginEvent { entityType: "agent" | "issue", entityId, ... }.
    // Heartbeat-run events carry runId — we don't get a direct mapping back
    // to conference_session_id without joining, so v1 just leaves session
    // status unchanged on these and relies on send-message to surface errors.
    // Subscribed for future use.
    ctx.events.on(CORE_EVENTS.agentRunFailed, async () => {
      // No-op for v1; reserved for future correlation work.
    });
    ctx.events.on(CORE_EVENTS.agentRunCancelled, async () => {
      // No-op for v1.
    });
  },

  async onApiRequest(input: PluginApiRequestInput): Promise<PluginApiResponse> {
    const ctx = currentContext;
    if (!ctx) return { status: 503, body: { error: "Plugin not initialized" } };
    try {
      return await dispatchApi(ctx, input);
    } catch (err) {
      ctx.logger.error("conference-room-bridge: api handler failed", {
        routeKey: input.routeKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: 500, body: bridgeError("internal-error", "Internal error") };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
