/**
 * Live transcript pump for NoralVoice calls.
 *
 * **Architecture call:** the prompt anticipated this in Phase 4's
 * stop-and-report list: "The plugin worker turns out to not support
 * long-lived WS subscriptions ... propose either an extension or
 * moving the pump out of the plugin worker into a dedicated
 * server-side process." After inspecting `packages/plugins/sdk/src/`
 * the plugin worker model is RPC-shaped — workers respond to discrete
 * calls (tools, apiRoutes, webhooks, lifecycle hooks). The host's
 * `ctx.events.emit` is one-shot fire-and-forget; there's no idiom for
 * a plugin to hold an open WebSocket across many tool calls.
 *
 * So the pump lives here in the NoralOS server process. The plugin's
 * `transcript_pump_control` apiRoute emits a
 * `noralai.noralvoice.transcript_pump.start` event when `run_call`
 * lands; this service subscribes to that event, opens the WS, and
 * pumps `ctx.session.append`-style updates into the originating
 * agent's task session.
 *
 * Lifecycle:
 *   - start(action="start", runId, workflowUuid, companyId, …)
 *   - WS open: `wss://<noralvoice_base>/api/v1/agent-stream/<workflowUuid>?api_key=…`
 *     (auth gate built in Phase 0 D4)
 *   - For each `transcript_chunk` frame → session.append type=transcript_chunk
 *   - For each `extracted_variable` frame → session.append type=extracted_variable
 *   - On run terminal (Phase 1B webhook fires
 *     `noralai.noralvoice.run.completed`) — close the WS for that run
 *   - Reconnect on disconnect with exp backoff (1s, 2s, 4s, 8s, 16s,
 *     cap 30s, max 5 attempts)
 *   - Circuit-breaker: >10 connection failures per company in a 5-min
 *     window → pause that company's pumps for 15 min, emit an
 *     activity-log warning
 *
 * Feature flag: `process.env.ENABLE_NORALVOICE_TRANSCRIPT_STREAM`.
 * Default off in production until B5 smoke is live.
 *
 * The pump does NOT itself import the plugin SDK. The host-side
 * registration (in `app.ts`) wires its event subscription via the
 * plugin host's event bus.
 */

import { WebSocket } from "ws";

import { logger } from "../middleware/logger.js";

const PUMP_FEATURE_FLAG_ENV = "ENABLE_NORALVOICE_TRANSCRIPT_STREAM";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_FACTOR = 2;
const RECONNECT_CAP_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const CIRCUIT_WINDOW_MS = 5 * 60 * 1_000;
const CIRCUIT_TRIP_THRESHOLD = 10;
const CIRCUIT_PAUSE_MS = 15 * 60 * 1_000;

export interface PumpStartParams {
  runId: string;
  workflowUuid: string;
  companyId: string;
  callerAgentId: string;
  /** NoralVoice base URL — e.g. `https://voice.noral.ai`. */
  noralvoiceBaseUrl: string;
  /** Resolved per-company NoralVoice API key. */
  apiKey: string;
}

export interface SessionAppender {
  /**
   * Append a streaming event to the agent's task session. The host's
   * task-session service exposes this; we accept a closure so the
   * pump module doesn't import the agents service directly (the
   * service has a heavier dep chain).
   */
  append: (
    callerAgentId: string,
    event: {
      type: "transcript_chunk" | "extracted_variable";
      // type=transcript_chunk: { text, speaker, timestamp }
      // type=extracted_variable: { key, value }
      payload: Record<string, unknown>;
    },
  ) => Promise<void>;
}

interface ActivePump {
  ws: WebSocket | null;
  closing: boolean;
  reconnectAttempts: number;
  // Keys already emitted to the agent so the post-run webhook can
  // de-dupe (Phase 4 B4): the webhook receiver checks this set and
  // skips emitting an extracted_variable event for any key the pump
  // already streamed.
  emittedVariableKeys: Set<string>;
}

interface CompanyCircuit {
  failureTimestamps: number[];
  pausedUntil: number;
}

// Module-scoped state — single-instance per server process.
const activePumps = new Map<string, ActivePump>();
const companyCircuits = new Map<string, CompanyCircuit>();
let appenderRef: SessionAppender | null = null;

function pumpKey(companyId: string, runId: string): string {
  return `${companyId}:${runId}`;
}

function nowMs(): number {
  return Date.now();
}

function isFeatureFlagEnabled(): boolean {
  return process.env[PUMP_FEATURE_FLAG_ENV] === "true" ||
    process.env[PUMP_FEATURE_FLAG_ENV] === "1";
}

/**
 * Register the appender once at server startup. Idempotent — calling
 * twice replaces the previous appender (useful for tests).
 */
export function registerTranscriptAppender(appender: SessionAppender): void {
  appenderRef = appender;
}

/** Returns a snapshot of who's been streamed for a run — used by B4 dedup. */
export function getPumpEmittedVariableKeys(
  companyId: string,
  runId: string,
): Set<string> {
  const pump = activePumps.get(pumpKey(companyId, runId));
  return pump?.emittedVariableKeys ?? new Set();
}

/** Test hook + graceful shutdown. */
export async function stopAllPumps(): Promise<void> {
  for (const pump of activePumps.values()) {
    pump.closing = true;
    try {
      pump.ws?.close();
    } catch {
      // ignore
    }
  }
  activePumps.clear();
}

function checkCircuit(companyId: string): { open: boolean; reason?: string } {
  const c = companyCircuits.get(companyId);
  if (!c) return { open: true };
  const now = nowMs();
  if (c.pausedUntil > now) {
    return { open: false, reason: "company_paused" };
  }
  // Decay old failures outside the window.
  c.failureTimestamps = c.failureTimestamps.filter((ts) => now - ts < CIRCUIT_WINDOW_MS);
  return { open: true };
}

function recordFailure(companyId: string): void {
  let c = companyCircuits.get(companyId);
  if (!c) {
    c = { failureTimestamps: [], pausedUntil: 0 };
    companyCircuits.set(companyId, c);
  }
  const now = nowMs();
  c.failureTimestamps = c.failureTimestamps.filter((ts) => now - ts < CIRCUIT_WINDOW_MS);
  c.failureTimestamps.push(now);
  if (c.failureTimestamps.length >= CIRCUIT_TRIP_THRESHOLD) {
    c.pausedUntil = now + CIRCUIT_PAUSE_MS;
    logger.warn(
      { companyId, failures: c.failureTimestamps.length },
      "NoralVoice transcript pump circuit tripped — pausing pumps for company",
    );
  }
}

async function openWebSocket(params: PumpStartParams, pump: ActivePump): Promise<void> {
  const url = new URL(params.noralvoiceBaseUrl);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl =
    `${wsProtocol}//${url.host}/api/v1/agent-stream/${encodeURIComponent(params.workflowUuid)}` +
    `?api_key=${encodeURIComponent(params.apiKey)}` +
    `&runId=${encodeURIComponent(params.runId)}`;

  const ws = new WebSocket(wsUrl);
  pump.ws = ws;

  ws.on("message", async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const msg = parsed as Record<string, unknown>;
    const type = typeof msg.type === "string" ? msg.type : "";

    if (type === "transcript_chunk") {
      const payload = {
        text: typeof msg.text === "string" ? msg.text : "",
        speaker: typeof msg.speaker === "string" ? msg.speaker : "unknown",
        timestamp:
          typeof msg.timestamp === "string"
            ? msg.timestamp
            : new Date().toISOString(),
      };
      if (!appenderRef) return;
      try {
        await appenderRef.append(params.callerAgentId, { type, payload });
      } catch (err) {
        logger.warn(
          { err, runId: params.runId },
          "NoralVoice pump: failed to append transcript_chunk",
        );
      }
      return;
    }

    if (type === "extracted_variable") {
      const key = typeof msg.key === "string" ? msg.key : "";
      const value = msg.value;
      if (!key) return;
      pump.emittedVariableKeys.add(key);
      if (!appenderRef) return;
      try {
        await appenderRef.append(params.callerAgentId, {
          type,
          payload: { key, value },
        });
      } catch (err) {
        logger.warn(
          { err, runId: params.runId, key },
          "NoralVoice pump: failed to append extracted_variable",
        );
      }
    }
  });

  ws.on("close", () => {
    if (pump.closing) return;
    if (pump.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      logger.warn(
        { runId: params.runId, attempts: pump.reconnectAttempts },
        "NoralVoice pump: max reconnect attempts reached; giving up",
      );
      activePumps.delete(pumpKey(params.companyId, params.runId));
      recordFailure(params.companyId);
      return;
    }
    pump.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, pump.reconnectAttempts - 1),
    );
    setTimeout(() => {
      const stillActive = activePumps.get(pumpKey(params.companyId, params.runId));
      if (stillActive && !stillActive.closing) {
        openWebSocket(params, stillActive).catch((err) =>
          logger.warn(
            { err, runId: params.runId },
            "NoralVoice pump: reconnect failed",
          ),
        );
      }
    }, delay);
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message, runId: params.runId }, "NoralVoice pump WS error");
    recordFailure(params.companyId);
  });
}

/**
 * Start streaming for a (companyId, runId). Idempotent — if already
 * pumping, no-op. Circuit-broken companies are silently skipped (we
 * log once at trip, not on every attempt).
 */
export async function startPump(params: PumpStartParams): Promise<void> {
  if (!isFeatureFlagEnabled()) {
    logger.debug({ runId: params.runId }, "NoralVoice pump: feature flag off; skipping");
    return;
  }
  const circuit = checkCircuit(params.companyId);
  if (!circuit.open) {
    logger.debug(
      { runId: params.runId, reason: circuit.reason },
      "NoralVoice pump: circuit open; skipping",
    );
    return;
  }
  const key = pumpKey(params.companyId, params.runId);
  if (activePumps.has(key)) {
    return;
  }
  const pump: ActivePump = {
    ws: null,
    closing: false,
    reconnectAttempts: 0,
    emittedVariableKeys: new Set(),
  };
  activePumps.set(key, pump);
  try {
    await openWebSocket(params, pump);
  } catch (err) {
    logger.warn({ err, runId: params.runId }, "NoralVoice pump: initial connect failed");
    activePumps.delete(key);
    recordFailure(params.companyId);
  }
}

/**
 * Stop streaming for a (companyId, runId). Called when the
 * `run.completed` webhook fires (Phase 1B) — the pump closes cleanly
 * and we keep the emittedVariableKeys snapshot around briefly for the
 * B4 dedup.
 */
export async function stopPump(companyId: string, runId: string): Promise<Set<string>> {
  const key = pumpKey(companyId, runId);
  const pump = activePumps.get(key);
  if (!pump) return new Set();
  pump.closing = true;
  try {
    pump.ws?.close();
  } catch {
    // ignore
  }
  const emitted = pump.emittedVariableKeys;
  activePumps.delete(key);
  return emitted;
}

/** For tests + admin diagnostics. */
export function _internals() {
  return {
    activePumpsCount: () => activePumps.size,
    circuitOpenForCompany: (companyId: string) => checkCircuit(companyId).open,
    resetForTests: () => {
      activePumps.clear();
      companyCircuits.clear();
      appenderRef = null;
    },
  };
}
