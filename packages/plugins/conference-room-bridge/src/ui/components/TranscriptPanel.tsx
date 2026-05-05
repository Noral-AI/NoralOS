import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../hooks/useMeeting.js";

type TranscriptPanelProps = {
  entries: TranscriptEntry[];
  interimText: string;
  empty: boolean;
};

export function TranscriptPanel({ entries, interimText, empty }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, interimText]);

  if (empty && entries.length === 0 && !interimText) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="text-3xl opacity-15">🎙️</div>
        <div className="text-sm text-muted-foreground">
          Start a meeting to begin
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
      {entries.map((entry) => (
        <div key={entry.id} className="mb-5">
          <div
            className={`mb-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
              entry.speaker === "user"
                ? "text-orange-500"
                : entry.speaker === "system"
                  ? "text-muted-foreground"
                  : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {entry.speakerLabel}
          </div>
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
            {entry.text}
          </div>
        </div>
      ))}
      {interimText ? (
        <div className="mb-5 opacity-60">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-orange-500">
            You (interim)
          </div>
          <div className="whitespace-pre-wrap text-[14px] italic leading-relaxed text-foreground/70">
            {interimText}
          </div>
        </div>
      ) : null}
    </div>
  );
}
