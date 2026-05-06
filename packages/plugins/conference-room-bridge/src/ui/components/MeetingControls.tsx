import { useEffect, useState } from "react";
import type { MeetingState } from "../hooks/useMeeting.js";

type MeetingControlsProps = {
  meetingState: MeetingState;
  micSupported: boolean;
  micListening: boolean;
  micError: string | null;
  awaitingAgent: boolean;
  // Wall-clock ms when the agent run was kicked off; null when not waiting.
  awaitingSinceMs: number | null;
  // Streamed-chunk count from the most recent pending poll. 0 when the
  // bridge hasn't reported any chunks yet.
  partialChunkCount: number;
  onStart: () => void;
  onStop: () => void;
};

// Cheap once-per-second ticker — only re-renders this component while the
// caller is awaiting a response. Returns elapsed seconds since `sinceMs`.
function useElapsedSeconds(sinceMs: number | null): number {
  const [elapsed, setElapsed] = useState(() =>
    sinceMs == null ? 0 : Math.max(0, Math.floor((Date.now() - sinceMs) / 1000)),
  );
  useEffect(() => {
    if (sinceMs == null) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - sinceMs) / 1000)));
    tick(); // immediate sync so the first paint isn't 0s late
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sinceMs]);
  return elapsed;
}

function thinkingLabel(elapsedSec: number, partialChunkCount: number): string {
  // Tiered copy: gives users a clear signal that long runs are normal.
  // Numbers picked to match Brooklyn's typical 60–90s claude_local latency.
  if (elapsedSec >= 75) {
    return `Still working… ${elapsedSec}s · keep this session open for the response`;
  }
  if (elapsedSec >= 30) {
    return `Still working… ${elapsedSec}s · longer agent runs can take about a minute`;
  }
  const base = `Brooklyn is working… ${elapsedSec}s`;
  return partialChunkCount > 0 ? `${base} · ${partialChunkCount} chunks` : base;
}

function statusLabel(
  props: MeetingControlsProps,
  elapsedSec: number,
): {
  text: string;
  tone: "idle" | "live" | "thinking" | "error";
} {
  const {
    meetingState,
    micListening,
    micError,
    awaitingAgent,
    micSupported,
    partialChunkCount,
  } = props;
  if (meetingState.phase === "error") return { text: meetingState.message, tone: "error" };
  if (!micSupported && meetingState.phase === "idle") {
    return {
      text: "Speech recognition unsupported in this browser. Try Chrome or Edge.",
      tone: "error",
    };
  }
  if (meetingState.phase === "starting") return { text: "Starting…", tone: "thinking" };
  if (meetingState.phase === "ending") return { text: "Ending…", tone: "thinking" };
  if (meetingState.phase === "active") {
    if (awaitingAgent) {
      return { text: thinkingLabel(elapsedSec, partialChunkCount), tone: "thinking" };
    }
    if (micError) return { text: `Mic: ${micError}`, tone: "error" };
    if (micListening) return { text: "Listening", tone: "live" };
    return { text: "Ready", tone: "live" };
  }
  return { text: "Start a meeting to begin", tone: "idle" };
}

export function MeetingControls(props: MeetingControlsProps) {
  const { meetingState, micListening, onStart, onStop, awaitingSinceMs } = props;
  // Only ticks while a run is in flight; otherwise sinceMs is null and the
  // hook's interval isn't installed.
  const elapsedSec = useElapsedSeconds(awaitingSinceMs);
  const status = statusLabel(props, elapsedSec);
  const active = meetingState.phase === "active" || meetingState.phase === "ending";
  const transitioning = meetingState.phase === "starting" || meetingState.phase === "ending";

  const dotClass = {
    idle: "bg-muted",
    live: "bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]",
    thinking: "bg-amber-500 animate-pulse",
    error: "bg-rose-500",
  }[status.tone];

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px]">
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
        <span className="font-medium text-foreground/80">{status.text}</span>
      </span>

      <span
        className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] ${
          micListening ? "border-emerald-500/40 text-emerald-600" : "border-border text-muted-foreground"
        }`}
        title={micListening ? "Microphone is live" : "Microphone idle"}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        {micListening ? "Mic on" : "Mic"}
      </span>

      {active ? (
        <button
          type="button"
          disabled={transitioning}
          onClick={onStop}
          className="rounded-md bg-rose-600/90 px-4 py-2 text-sm font-semibold text-rose-50 hover:bg-rose-600 disabled:opacity-50"
        >
          End Meeting
        </button>
      ) : (
        <button
          type="button"
          disabled={transitioning}
          onClick={onStart}
          className="rounded-md bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Start Meeting
        </button>
      )}
    </div>
  );
}
