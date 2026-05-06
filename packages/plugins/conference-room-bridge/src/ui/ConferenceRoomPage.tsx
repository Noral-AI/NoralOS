import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginPageProps } from "@noralos/plugin-sdk/ui";
import { Header } from "./components/Header.js";
import { YourTeamPanel } from "./components/YourTeamPanel.js";
import { ModeToggle, type Mode } from "./components/ModeToggle.js";
import { MeetingControls } from "./components/MeetingControls.js";
import { TranscriptPanel } from "./components/TranscriptPanel.js";
import { useAgents } from "./hooks/useAgents.js";
import { useUiState } from "./hooks/useUiState.js";
import { useMeeting } from "./hooks/useMeeting.js";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition.js";

const DEFAULT_PINNED_NAME = "Brooklyn";

export function ConferenceRoomPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const { agents, loading: agentsLoading, error: agentsError } = useAgents(companyId);
  const { data: uiState } = useUiState(companyId);

  // Pin Brooklyn by default, fall back to first agent. No persistence in v1.
  const defaultPinnedAgentId = useMemo(() => {
    if (agents.length === 0) return null;
    const brooklyn = agents.find(
      (a) => a.name.toLowerCase() === DEFAULT_PINNED_NAME.toLowerCase(),
    );
    return brooklyn?.id ?? agents[0]?.id ?? null;
  }, [agents]);

  const [pinnedAgentId, setPinnedAgentId] = useState<string | null>(null);
  useEffect(() => {
    if (pinnedAgentId == null) setPinnedAgentId(defaultPinnedAgentId);
  }, [defaultPinnedAgentId, pinnedAgentId]);

  const [mode, setMode] = useState<Mode>("direct");

  const agentLabelLookup = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent",
    [agents],
  );

  // Forward refs so the meeting hook's audio playback can duck the mic. We
  // reach into speech via a ref because useSpeechRecognition is created
  // below useMeeting, and we want the meeting hook's play callbacks to see
  // the latest start/stop without re-creating the hook on each render.
  const speechRef = useRef<{
    stop: () => void;
    start: () => void;
    listening: boolean;
  } | null>(null);
  const meetingActiveRef = useRef(false);

  const meeting = useMeeting(companyId, agentLabelLookup, {
    onPlayStart: () => {
      speechRef.current?.stop();
    },
    onPlayEnd: () => {
      // Wait 400ms after audio ends before resuming the mic, so the tail of
      // playback (or any echo from the speakers) doesn't get transcribed.
      window.setTimeout(() => {
        if (meetingActiveRef.current) speechRef.current?.start();
      }, 400);
    },
  });

  useEffect(() => {
    meetingActiveRef.current = meeting.state.phase === "active";
  }, [meeting.state.phase]);

  const speech = useSpeechRecognition({
    onFinalUtterance: (text) => {
      void meeting.sendUtterance(text);
    },
  });

  useEffect(() => {
    speechRef.current = {
      stop: speech.stop,
      start: speech.start,
      listening: speech.listening,
    };
  }, [speech.stop, speech.start, speech.listening]);

  // Auto-stop the mic when the meeting ends.
  useEffect(() => {
    if (meeting.state.phase !== "active" && speech.listening) {
      speech.stop();
    }
  }, [meeting.state.phase, speech]);

  const onStart = useCallback(async () => {
    if (!speech.supported) return;
    // Click handler = user gesture — prime browser audio playback NOW so
    // subsequent polling-driven plays are allowed. Fire-and-forget; failure
    // is logged inside primeAudio.
    void meeting.primeAudio();
    await meeting.startMeeting(mode === "direct" ? pinnedAgentId : null);
    // The phase transition to "active" is async — start the mic on next tick
    // by piggybacking on a microtask.
    queueMicrotask(() => speech.start());
  }, [speech, meeting, mode, pinnedAgentId]);

  const onStop = useCallback(async () => {
    speech.stop();
    await meeting.endMeeting();
  }, [speech, meeting]);

  const speakingAgentId =
    meeting.state.phase === "active" ? meeting.state.agentId : null;

  const ttsMode = uiState?.voiceCascade.ttsMode ?? null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <Header ttsMode={ttsMode} />

      <div className="flex flex-1 overflow-hidden">
        <YourTeamPanel
          agents={agents}
          pinnedAgentId={pinnedAgentId}
          speakingAgentId={speakingAgentId}
          onPin={(id) => setPinnedAgentId(id)}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          <TranscriptPanel
            entries={meeting.transcript}
            interimText={speech.interimText}
            empty={meeting.state.phase === "idle" && meeting.transcript.length === 0}
          />

          <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
            <ModeToggle
              mode={mode}
              onChange={setMode}
              disabled={meeting.state.phase === "active"}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => meeting.toggleAudio()}
                aria-pressed={meeting.audioEnabled}
                title={meeting.audioEnabled ? "Click to mute audio replies" : "Click to enable audio replies"}
                className={
                  "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                  (meeting.audioEnabled
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                    : "border-border bg-muted text-muted-foreground hover:bg-muted/70")
                }
              >
                <span aria-hidden="true">{meeting.audioEnabled ? "🔊" : "🔇"}</span>
                <span>Audio: {meeting.audioEnabled ? "ON" : "OFF"}</span>
              </button>
              <MeetingControls
                meetingState={meeting.state}
                micSupported={speech.supported}
                micListening={speech.listening}
                micError={speech.error}
                awaitingAgent={meeting.awaitingAgentResponse}
                onStart={() => void onStart()}
                onStop={() => void onStop()}
              />
            </div>
          </div>

          {agentsError ? (
            <div className="border-t border-rose-500/40 bg-rose-500/10 px-6 py-2 text-xs text-rose-600 dark:text-rose-400">
              Could not load team: {agentsError}
            </div>
          ) : null}
          {agentsLoading && agents.length === 0 ? (
            <div className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
              Loading team…
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
