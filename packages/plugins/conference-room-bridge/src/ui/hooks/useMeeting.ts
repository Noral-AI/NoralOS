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
  /**
   * User-controlled audio toggle. Defaults to true. When false, agent
   * replies still arrive as text, but `playAgentAudio` skips playback.
   */
  audioEnabled: boolean;
  /**
   * Set the audio-enabled flag. Calling this with `true` from a click /
   * touch handler also opportunistically primes the browser's autoplay
   * token (WebAudio resume + a muted HTMLAudio play() round-trip).
   */
  setAudioEnabled: (enabled: boolean) => void;
  /**
   * Toggle the audio-enabled flag. Same gesture-priming behavior as
   * `setAudioEnabled(true)` when the result is true.
   */
  toggleAudio: () => void;
  /**
   * Best-effort autoplay primer. Safe to call from any click / touch
   * handler in the page. Idempotent. Does not change `audioEnabled`.
   * Kept on the API so the Start-Meeting button can prime audio without
   * flipping the toggle.
   */
  primeAudio: () => Promise<void>;
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
  // Audio defaults ON. The polling closure reads via the ref so we don't
  // re-bind the interval when the user toggles.
  const [audioEnabled, setAudioEnabledState] = useState(true);
  const audioEnabledRef = useRef(true);
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);
  // WebAudio context, lazily created on the first user gesture. Used as the
  // ACTUAL playback path: HTMLAudioElement.play() promises were observed
  // hanging pending forever in production (Chrome on macOS) even after a
  // muted-play primer; WebAudio's decodeAudioData + BufferSourceNode bypass
  // the HTMLAudioElement autoplay heuristic entirely. Once `ctx.resume()`
  // succeeds during a user gesture, subsequent BufferSourceNode.start()
  // calls play without further interaction.
  const audioContextRef = useRef<AudioContext | null>(null);
  // The currently-playing AudioBufferSourceNode, so a new reply can stop
  // the previous one cleanly.
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Whether we've already attempted (and succeeded at) priming the browser
  // for autoplay. Once true, subsequent prime() calls short-circuit.
  const audioPrimedRef = useRef(false);
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

  const primeAudio = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (audioPrimedRef.current) return;
    let webAudioOk = false;
    let htmlAudioOk = false;
    let webAudioError: string | null = null;
    let htmlAudioError: string | null = null;

    // Step 1: WebAudio resume. Calling resume() on a freshly-created
    // AudioContext from inside a user gesture grants user activation for
    // audio playback in the page. Even though we use HTMLAudioElement for
    // real playback, this satisfies Chrome's "user activation persists"
    // heuristic for the next ~5s, and on iOS Safari it's the canonical
    // unlock primitive.
    try {
      const AudioCtxCtor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor) {
        const ctx = audioContextRef.current ?? new AudioCtxCtor();
        audioContextRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        // Schedule a 1-sample silent buffer so iOS treats the context as
        // "having played" rather than dormant.
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        webAudioOk = true;
      } else {
        webAudioError = "AudioContext not supported";
      }
    } catch (err) {
      webAudioError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    // Step 2: muted HTMLAudioElement primer. Browsers always allow muted
    // playback regardless of user gesture, but having one successful
    // play()/pause() round-trip on the SAME element we'll use for real
    // audio also helps in some Safari scenarios. We never load a real
    // source here — `audio.play()` with no src is allowed and treated as
    // a no-op success in modern browsers.
    try {
      const audio = audioElRef.current ?? new Audio();
      audioElRef.current = audio;
      audio.muted = true;
      // Calling play() on an element with no src returns a resolved promise
      // in current browsers. If the browser objects, we'll catch and
      // continue — WebAudio resume above is the load-bearing step anyway.
      const playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audio.muted = false;
      htmlAudioOk = true;
    } catch (err) {
      htmlAudioError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    if (webAudioOk || htmlAudioOk) {
      audioPrimedRef.current = true;
    }

    // eslint-disable-next-line no-console
    console.log("[CR-METRICS] audio primed", {
      webAudio: webAudioOk ? "ok" : webAudioError ?? "failed",
      htmlAudio: htmlAudioOk ? "ok" : htmlAudioError ?? "failed",
      primed: audioPrimedRef.current,
    });
  }, []);

  const setAudioEnabled = useCallback(
    (enabled: boolean) => {
      setAudioEnabledState(enabled);
      audioEnabledRef.current = enabled;
      // eslint-disable-next-line no-console
      console.log("[CR-METRICS] audio toggle", { enabled });
      // Turning audio ON from a click handler is also a great moment to
      // prime, since browsers count the click as user activation.
      if (enabled) {
        void primeAudio();
      }
    },
    [primeAudio],
  );

  const toggleAudio = useCallback(() => {
    setAudioEnabled(!audioEnabledRef.current);
  }, [setAudioEnabled]);

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
      // eslint-disable-next-line no-console
      console.log("[CR-METRICS] received audio payload", {
        ...meta,
        mimeType,
        base64Length: audioBase64.length,
        audioEnabled: audioEnabledRef.current,
        primed: audioPrimedRef.current,
      });
      if (!audioEnabledRef.current) {
        // eslint-disable-next-line no-console
        console.log("[CR-METRICS] playback suppressed — audio toggle off", {
          ...meta,
          played: false,
          endedReason: "audio-disabled",
        });
        return;
      }
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

      // Resolve / lazy-create the AudioContext. primeAudio (called from the
      // Start-Meeting click handler) normally gets here first and resumes
      // it; if the user typed straight into the chat without clicking
      // anything the context might still be suspended, in which case
      // `start()` won't actually emit until the next gesture. The
      // decodeAudioData / start sequence below still runs so the failure
      // mode is visible in logs rather than silent.
      const AudioCtxCtor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxCtor) {
        // eslint-disable-next-line no-console
        console.warn("[CR-METRICS] AudioContext not supported", { ...meta });
        return;
      }
      const ctx = audioContextRef.current ?? new AudioCtxCtor();
      audioContextRef.current = ctx;

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
        onPlayEndRef.current?.();
      };

      // Stop any in-flight playback before we decode the new clip.
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.onended = null;
          audioSourceRef.current.stop();
        } catch {
          /* ignore — already finished */
        }
        audioSourceRef.current = null;
      }

      // decodeAudioData consumes the underlying ArrayBuffer; copy the slice
      // we own so subsequent calls aren't aliasing the same buffer. Cast
      // through `ArrayBuffer` because TS 5.7 widens `Uint8Array.buffer` to
      // `ArrayBufferLike` (covers SharedArrayBuffer); ours is always plain.
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;

      const beginPlayback = () => {
        ctx.decodeAudioData(
          arrayBuffer,
          (audioBuffer) => {
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.onended = () => finish("ended");
            try {
              source.start(0);
              audioSourceRef.current = source;
              // eslint-disable-next-line no-console
              console.log("[CR-METRICS] audio.play() success", {
                runId: meta.runId,
                audioBytes: meta.audioBytes,
                mimeType,
                durationSec: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
                sampleRate: audioBuffer.sampleRate,
                ctxState: ctx.state,
              });
              onPlayStartRef.current?.();
            } catch (err) {
              const name = err instanceof Error ? err.name : "Error";
              const message = err instanceof Error ? err.message : String(err);
              // eslint-disable-next-line no-console
              console.warn("[CR-METRICS] audio.play() rejected", {
                name,
                message,
                ...meta,
                mimeType,
                ctxState: ctx.state,
              });
              if (name === "NotAllowedError") {
                audioPrimedRef.current = false;
              }
              finish("error");
            }
          },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.warn("[CR-METRICS] decodeAudioData failed", {
              message,
              ...meta,
              mimeType,
            });
            finish("error");
          },
        );
      };

      if (ctx.state === "suspended") {
        // Best-effort resume; if browser refuses (no user gesture), the
        // start() below will still run but stay silent until the next
        // user interaction. Surface that in logs so it's diagnosable.
        ctx.resume().then(beginPlayback, (err) => {
          const name = err instanceof Error ? err.name : "Error";
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn("[CR-METRICS] AudioContext.resume() rejected", {
            name,
            message,
            ...meta,
          });
          if (name === "NotAllowedError") {
            audioPrimedRef.current = false;
          }
          // Try anyway — start() might queue and play once unblocked.
          beginPlayback();
        });
      } else {
        beginPlayback();
      }
    },
    [],
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
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.onended = null;
          audioSourceRef.current.stop();
        } catch {
          /* ignore */
        }
        audioSourceRef.current = null;
      }
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

  /**
   * One-shot enumeration of the browser's audio devices, surfaced both in
   * DevTools and as a system line in the transcript. Diagnoses Continuity /
   * Handoff routing on macOS — when an iPhone shows up in the output list
   * the user knows the OS is offering it as an option, even though
   * `navigator.mediaDevices` doesn't expose which one is currently active
   * (Chrome doesn't surface the active output for security reasons; the
   * user has to check macOS Control Center → Sound).
   *
   * Labels only appear once the page has been granted mic permission, so
   * we run this AFTER `speech.start()` triggers the permission prompt.
   */
  const logAudioDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ id: d.deviceId, label: d.label || "(unknown — needs mic permission)" }));
      const outputs = devices
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ id: d.deviceId, label: d.label || "(unknown — needs mic permission)" }));
      // eslint-disable-next-line no-console
      console.log("[CR-METRICS] audio devices", {
        ctxState: audioContextRef.current?.state ?? "no-context",
        ctxSampleRate: audioContextRef.current?.sampleRate ?? null,
        inputs,
        outputs,
      });
      const outputLabels = outputs.map((o) => o.label).filter(Boolean);
      if (outputLabels.length > 0) {
        const iphoneOutput = outputLabels.find((l) => /iphone|continuity|handoff/i.test(l));
        const summary = `Audio outputs: ${outputLabels.join(" · ")}`;
        appendSystem(
          iphoneOutput
            ? `${summary}. ⚠ macOS may route through "${iphoneOutput}" via Continuity — check Control Center → Sound if you don't hear replies on this Mac.`
            : summary,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[CR-METRICS] audio devices enumeration failed", err);
    }
  }, [appendSystem]);

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
        // Fire-and-forget; first call may show empty labels until the mic
        // permission prompt resolves, but the page side starts speech
        // recognition in `onStart` immediately after this returns, which
        // primes labels for the next render. Re-run after a short delay
        // to capture the post-permission label set as well.
        void logAudioDevices();
        window.setTimeout(() => void logAudioDevices(), 1500);
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Failed to start meeting",
        });
      }
    },
    [companyId, startPolling, appendSystem, agentLabelLookup, logAudioDevices],
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
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.onended = null;
        audioSourceRef.current.stop();
      } catch {
        /* ignore */
      }
      audioSourceRef.current = null;
    }
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
    audioEnabled,
    setAudioEnabled,
    toggleAudio,
    primeAudio,
    startMeeting,
    sendUtterance,
    endMeeting,
    appendSystem,
  };
}
