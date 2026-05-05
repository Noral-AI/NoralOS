import type { MeetingState } from "../hooks/useMeeting.js";

type MeetingControlsProps = {
  meetingState: MeetingState;
  micSupported: boolean;
  micListening: boolean;
  micError: string | null;
  awaitingAgent: boolean;
  onStart: () => void;
  onStop: () => void;
};

function statusLabel(props: MeetingControlsProps): {
  text: string;
  tone: "idle" | "live" | "thinking" | "error";
} {
  const { meetingState, micListening, micError, awaitingAgent, micSupported } = props;
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
    if (awaitingAgent) return { text: "Agent thinking…", tone: "thinking" };
    if (micError) return { text: `Mic: ${micError}`, tone: "error" };
    if (micListening) return { text: "Listening", tone: "live" };
    return { text: "Ready", tone: "live" };
  }
  return { text: "Start a meeting to begin", tone: "idle" };
}

export function MeetingControls(props: MeetingControlsProps) {
  const { meetingState, micListening, onStart, onStop } = props;
  const status = statusLabel(props);
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
