import { useCallback, useEffect, useRef, useState } from "react";
import { conferenceApi, type LastResultResponse } from "../api.js";

export type TranscriptEntry = {
  id: string;
  speaker: "user" | "agent" | "system";
  speakerLabel: string;
  text: string;
  ts: number;
};

export type MeetingState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "active"; conferenceSessionId: string; agentId: string }
  | { phase: "ending" }
  | { phase: "error"; message: string };

export type MeetingApi = {
  state: MeetingState;
  transcript: TranscriptEntry[];
  lastAgentText: string | null;
  awaitingAgentResponse: boolean;
  // ms timestamp when the latest sendUtterance went out; null when not
  // waiting. Consumers tick a 1-second timer against this to render
  // elapsed seconds in the thinking indicator.
  awaitingSinceMs: number | null;
  // Streamed chunk count from the bridge's last pending poll; 0 when not
  // waiting or before the first chunk arrives.
  partialChunkCount: number;
  startMeeting: (targetAgentId: string | null) => Promise<void>;
  sendUtterance: (text: string) => Promise<void>;
  endMeeting: () => Promise<void>;
  appendSystem: (text: string) => void;
};

export type UseMeetingOptions = {
  // Fired right before the agent's TTS audio starts playing. Use to duck the
  // mic / pause speech recognition so the page doesn't transcribe its own
  // audio output.
  onPlayStart?: () => void;
  // Fired ~400ms after the audio ends (or errors). Use to resume the mic.
  onPlayEnd?: () => void;
};

const POLL_INTERVAL_MS = 2000;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function useMeeting(
  companyId: string | null,
  agentLabelLookup: (id: string) => string,
  options: UseMeetingOptions = {},
): MeetingApi {
  const [state, setState] = useState<MeetingState>({ phase: "idle" });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [awaitingAgentResponse, setAwaitingAgentResponse] = useState(false);
  const [awaitingSinceMs, setAwaitingSinceMs] = useState<number | null>(null);
  const [partialChunkCount, setPartialChunkCount] = useState(0);
  // Dedup signature for "we already handled this done-result". Includes the
  // runId when available, plus a content-hash fallback for the legacy case.
  const lastSeenRunIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  // Single shared <audio> element so a new response can interrupt the prior
  // playback cleanly.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Tracks the URL.createObjectURL handle currently attached so we can revoke
  // it when playback ends or is replaced.
  const audioObjectUrlRef = useRef<string | null>(null);
  // Per-runId send-time, used to compute send→audio-ready latency.
  const sendStartedAtByRunIdRef = useRef<Map<string, number>>(new Map());
  // Most recent sendUtterance timestamp; used as a fallback when the bridge
  // doesn't surface runId on the immediate sendMessage response.
  const lastSendStartedAtRef = useRef<number | null>(null);

  // Stash the latest callbacks in refs so the polling closure picks up new
  // values without re-creating the interval.
  const onPlayStartRef = useRef(options.onPlayStart);
  const onPlayEndRef = useRef(options.onPlayEnd);
  useEffect(() => {
    onPlayStartRef.current = options.onPlayStart;
    onPlayEndRef.current = options.onPlayEnd;
  }, [options.onPlayStart, options.onPlayEnd]);

  const append = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev, entry]);
  }, []);

  const appendSystem = useCallback(
    (text: string) => {
      append({
        id: newId(),
        speaker: "system",
        speakerLabel: "System",
        text,
        ts: Date.now(),
      });
    },
    [append],
  );

  const releaseAudioObjectUrl = useCallback(() => {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
  }, []);

  const playAgentAudio = useCallback(
    (
      audioBase64: string,
      mimeType: string,
      meta: {
        runId: string | null;
        provider: string | null;
        voiceId: string | null;
        sendToAudioReadyMs: number | null;
        audioBytes: number;
      },
    ) => {
      if (typeof window === "undefined") return;
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64ToBytes(audioBase64);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[CR-METRICS] base64 decode failed", err);
        // eslint-disable-next-line no-console
        console.log("[CR-METRICS]", {
          ...meta,
          played: false,
          endedReason: "decode-failed",
        });
        return;
      }
      // Cast through BlobPart: TS 5.7's Uint8Array<ArrayBufferLike> isn't
      // assignable to ArrayBufferView<ArrayBuffer> because of SharedArrayBuffer.
      const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);

      // Tear down any prior playback before swapping in the new clip.
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      releaseAudioObjectUrl();
      audioObjectUrlRef.current = url;

      const audio = audioElRef.current ?? new Audio();
      audioElRef.current = audio;

      let endedFired = false;
      const finish = (endedReason: "ended" | "error") => {
        if (endedFired) return;
        endedFired = true;
        // eslint-disable-next-line no-console
        console.log("[CR-METRICS]", {
          ...meta,
          played: true,
          endedReason,
        });
        // Revoke synchronously; the element no longer needs the blob URL.
        if (audioObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioObjectUrlRef.current = null;
        }
        // Fire end callback immediately. Caller decides whether to debounce
        // (e.g. the page sets a 400ms gap before resuming the mic).
        onPlayEndRef.current?.();
      };

      audio.onended = () => finish("ended");
      audio.onerror = () => finish("error");
      audio.src = url;

      onPlayStartRef.current?.();
      void audio.play().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[CR-METRICS] audio.play() rejected", err);
        finish("error");
      });
    },
    [releaseAudioObjectUrl],
  );

  // ---- polling ----------------------------------------------------------
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (conferenceSessionId: string) => {
      if (!companyId) return;
      stopPolling();
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const result: LastResultResponse = await conferenceApi.lastResult(
            companyId,
            conferenceSessionId,
          );
          // Surface chunk progress for the in-flight run so the UI can show
          // "N chunks" alongside the elapsed seconds. Cheap; only changes
          // state when the count actually moves.
          if (result.status === "pending") {
            const next = result.partialChunkCount ?? 0;
            setPartialChunkCount((prev) => (prev === next ? prev : next));
          }
          if (result.status === "done" && result.responseText) {
            // Dedup: prefer runId when present, otherwise fall back to a
            // content sig. Same dedup gate covers both transcript append
            // and audio playback so neither double-fires across polls.
            const sig = result.runId
              ? `${result.conferenceSessionId}::run::${result.runId}`
              : `${result.conferenceSessionId}::sig::${result.responseText.slice(0, 32)}::${result.responseText.length}`;
            if (lastSeenRunIdRef.current !== sig) {
              lastSeenRunIdRef.current = sig;
              setTranscript((prev) => [
                ...prev,
                {
                  id: newId(),
                  speaker: "agent",
                  speakerLabel: "Agent",
                  text: result.responseText!,
                  ts: Date.now(),
                },
              ]);
              setAwaitingAgentResponse(false);
              setAwaitingSinceMs(null);
              setPartialChunkCount(0);

              const tts = result.ttsResult;
              const provider = tts?.providerUsed ?? null;
              const voiceId = tts?.voiceId ?? null;
              const audioBase64 =
                tts && tts.ok && typeof tts.audioBase64 === "string"
                  ? tts.audioBase64
                  : null;
              const mimeType =
                tts && tts.ok && typeof tts.mimeType === "string"
                  ? tts.mimeType
                  : "audio/mpeg";
              const audioBytes = audioBase64
                ? Math.floor((audioBase64.length * 3) / 4)
                : 0;
              const startedAt = result.runId
                ? sendStartedAtByRunIdRef.current.get(result.runId) ?? null
                : lastSendStartedAtRef.current;
              const sendToAudioReadyMs =
                startedAt != null ? Date.now() - startedAt : null;
              if (result.runId) {
                sendStartedAtByRunIdRef.current.delete(result.runId);
              }

              if (audioBase64) {
                playAgentAudio(audioBase64, mimeType, {
                  runId: result.runId ?? null,
                  provider,
                  voiceId,
                  sendToAudioReadyMs,
                  audioBytes,
                });
              } else {
                // eslint-disable-next-line no-console
                console.log("[CR-METRICS]", {
                  runId: result.runId ?? null,
                  provider,
                  voiceId,
                  sendToAudioReadyMs,
                  audioBytes: 0,
                  played: false,
                  endedReason: tts?.reason ?? "no-audio",
                });
              }
            }
          } else if (result.status === "error") {
            setAwaitingAgentResponse(false);
            setAwaitingSinceMs(null);
            setPartialChunkCount(0);
            appendSystem(`Bridge error: ${result.reason ?? "unknown"}`);
          }
        } catch (err) {
          // Polling errors are usually transient (auth glitch, network). Log
          // and continue; surface persistent errors via the error phase.
          // eslint-disable-next-line no-console
          console.warn("conference-room: poll failed", err);
        }
      }, POLL_INTERVAL_MS) as unknown as number;
    },
    [companyId, stopPolling, appendSystem, playAgentAudio],
  );

  useEffect(() => {
    return () => {
      stopPolling();
      // Tear down audio on unmount.
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      releaseAudioObjectUrl();
    };
  }, [stopPolling, releaseAudioObjectUrl]);

  // ---- actions ----------------------------------------------------------

  const startMeeting = useCallback(
    async (targetAgentId: string | null) => {
      if (!companyId) {
        setState({ phase: "error", message: "No active company" });
        return;
      }
      setState({ phase: "starting" });
      try {
        const conferenceSessionId = newId();
        const result = await conferenceApi.createSession(companyId, {
          conferenceSessionId,
          targetAgentId,
        });
        setState({
          phase: "active",
          conferenceSessionId: result.conferenceSessionId,
          agentId: result.agentId,
        });
        appendSystem(
          `Meeting started with ${agentLabelLookup(result.agentId)}.`,
        );
        startPolling(result.conferenceSessionId);
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Failed to start meeting",
        });
      }
    },
    [companyId, startPolling, appendSystem, agentLabelLookup],
  );

  const sendUtterance = useCallback(
    async (text: string) => {
      if (state.phase !== "active" || !companyId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      append({
        id: newId(),
        speaker: "user",
        speakerLabel: "You",
        text: trimmed,
        ts: Date.now(),
      });
      setAwaitingAgentResponse(true);
      const startedAt = Date.now();
      setAwaitingSinceMs(startedAt);
      setPartialChunkCount(0);
      lastSendStartedAtRef.current = startedAt;
      try {
        const sendResp = await conferenceApi.sendMessage(
          companyId,
          state.conferenceSessionId,
          trimmed,
        );
        if (sendResp.runId) {
          sendStartedAtByRunIdRef.current.set(sendResp.runId, startedAt);
        }
      } catch (err) {
        setAwaitingAgentResponse(false);
        setAwaitingSinceMs(null);
        setPartialChunkCount(0);
        appendSystem(
          `Send failed: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    },
    [state, companyId, append, appendSystem],
  );

  const endMeeting = useCallback(async () => {
    if (state.phase !== "active") {
      setState({ phase: "idle" });
      return;
    }
    const id = state.conferenceSessionId;
    setState({ phase: "ending" });
    stopPolling();
    setAwaitingAgentResponse(false);
    setAwaitingSinceMs(null);
    setPartialChunkCount(0);
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {
        /* ignore */
      }
    }
    releaseAudioObjectUrl();
    try {
      if (companyId) await conferenceApi.closeSession(companyId, id);
    } catch (err) {
      // Best effort; the user clicked stop.
      // eslint-disable-next-line no-console
      console.warn("close session failed", err);
    }
    appendSystem("Meeting ended.");
    setState({ phase: "idle" });
  }, [state, companyId, stopPolling, appendSystem, releaseAudioObjectUrl]);

  // Latest agent text for status lines.
  const lastAgentText =
    [...transcript].reverse().find((t) => t.speaker === "agent")?.text ?? null;

  return {
    state,
    transcript,
    lastAgentText,
    awaitingAgentResponse,
    awaitingSinceMs,
    partialChunkCount,
    startMeeting,
    sendUtterance,
    endMeeting,
    appendSystem,
  };
}
