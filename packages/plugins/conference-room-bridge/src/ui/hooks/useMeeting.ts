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
  startMeeting: (targetAgentId: string | null) => Promise<void>;
  sendUtterance: (text: string) => Promise<void>;
  endMeeting: () => Promise<void>;
  appendSystem: (text: string) => void;
};

const POLL_INTERVAL_MS = 2000;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useMeeting(
  companyId: string | null,
  agentLabelLookup: (id: string) => string,
): MeetingApi {
  const [state, setState] = useState<MeetingState>({ phase: "idle" });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [awaitingAgentResponse, setAwaitingAgentResponse] = useState(false);
  const lastSeenRunIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const append = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev, entry]);
  }, []);

  const appendSystem = useCallback((text: string) => {
    append({
      id: newId(),
      speaker: "system",
      speakerLabel: "System",
      text,
      ts: Date.now(),
    });
  }, [append]);

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
          if (result.status === "done" && result.responseText) {
            // Avoid double-appending across multiple polls; tag by responseText hash.
            const sig = `${result.conferenceSessionId}::${result.responseText.slice(0, 32)}::${result.responseText.length}`;
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
            }
          } else if (result.status === "error") {
            setAwaitingAgentResponse(false);
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
    [companyId, stopPolling, appendSystem],
  );

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

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
      try {
        await conferenceApi.sendMessage(
          companyId,
          state.conferenceSessionId,
          trimmed,
        );
      } catch (err) {
        setAwaitingAgentResponse(false);
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
    try {
      if (companyId) await conferenceApi.closeSession(companyId, id);
    } catch (err) {
      // Best effort; the user clicked stop.
      // eslint-disable-next-line no-console
      console.warn("close session failed", err);
    }
    appendSystem("Meeting ended.");
    setState({ phase: "idle" });
  }, [state, companyId, stopPolling, appendSystem]);

  // Latest agent text for status lines.
  const lastAgentText =
    [...transcript].reverse().find((t) => t.speaker === "agent")?.text ?? null;

  return {
    state,
    transcript,
    lastAgentText,
    awaitingAgentResponse,
    startMeeting,
    sendUtterance,
    endMeeting,
    appendSystem,
  };
}
