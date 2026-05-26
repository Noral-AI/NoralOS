// Autoplay TTS for chat surfaces (Issue chat → Dashboard surface).
//
// Watches a list of "comments" (or equivalent agent-authored messages) and,
// when a new agent-authored entry arrives, asks NoralVoice (via the
// noralai.noralvoice plugin's /synthesize proxy) to synthesize the body
// and plays the resulting audio. Honors the autoplay-rejection path the
// Conference Room ships: if `audio.play()` is rejected by the browser
// (stale gesture / unfocused tab / autoplay policy), the clip stays armed
// and callers can render an "Enable audio" pill that calls `resumeAudio()`
// from a fresh user gesture.
//
// Scope
//   - Only synthesizes for entries whose `authorAgentId` is non-null.
//     User-authored entries are skipped.
//   - Dedups on entry `id` via a Set of seen ids — re-rendering the list
//     never replays old clips. The "seen" baseline is captured on first
//     mount, so existing history is NOT auto-played when the thread first
//     opens; only entries that arrive AFTER mount trigger playback.
//   - Only one clip plays at a time. A new agent message that arrives
//     while another is mid-playback pre-empts the prior clip (matches the
//     Conference Room behaviour where a later reply supersedes an earlier
//     one).
//
// Safety
//   - Exfiltration scan and provider keys live behind the noralvoice
//     plugin's /synthesize proxy. This hook does NOT replicate any of
//     those checks — it just asks and reacts to the answer. Non-ok
//     responses (`reason: exfiltration-blocked`, etc.) are silently
//     dropped: the agent simply has no voice on this surface.

import { useCallback, useEffect, useRef, useState } from "react";
import { noralVoiceTtsApi } from "../api/noralVoiceTts";

export interface ChatVoiceEntry {
  id: string;
  /** Non-null means this entry was authored by an agent. */
  authorAgentId: string | null;
  /** Plain-text body. The caller is responsible for stripping markdown if needed. */
  body: string;
  /** Optional — used for ordering only. */
  createdAt?: Date | string;
}

export interface UseChatVoiceAutoplayOptions {
  /** When false (default), the hook is a no-op — useful when the surface
   * is disabled or the company hasn't been resolved yet. */
  enabled?: boolean;
  /** Which surface to attribute this synthesis to. Kept on the API
   * surface for Phase 6 PR-4, which will gate playback on
   * `agents.surface_flags[surface]`. NoralVoice's /synthesize doesn't
   * use this today. */
  surface?: string;
  /** Replace the comment-body sanitiser. Default strips markdown formatting
   * characters so TTS doesn't read out "**bold**" literally. */
  textFromBody?: (body: string) => string;
}

export interface UseChatVoiceAutoplayApi {
  /** True when the browser rejected `audio.play()` and a queued clip is
   * waiting for a user gesture. Render the resume control while true. */
  audioBlocked: boolean;
  /** Retry the queued clip via a fresh user gesture. Safe to call when
   * nothing is queued (no-op). */
  resumeAudio: () => void;
  /** True while a clip is actively playing. Lets the UI render a stop
   * affordance only when there's something to stop. */
  isPlaying: boolean;
  /** Stop the currently-playing clip (and release its blob URL). Safe to
   * call when nothing is playing (no-op). Does NOT change the autoplay
   * preference — the next inbound agent message will still synthesize if
   * the hook is `enabled`. Callers who want to mute *future* messages
   * should also flip their `enabled` flag off. */
  stopAudio: () => void;
  /** Last entry id whose synthesis returned ok=false — useful for tests /
   * debugging only. Not surfaced to end users. */
  lastSuppressedEntryId: string | null;
}

const DEFAULT_SURFACE = "dashboard";

/**
 * Strip the most common markdown noise so TTS reads "hello world" instead
 * of "asterisk asterisk hello asterisk asterisk world". Deliberately
 * conservative — leaves punctuation that affects prosody alone.
 */
function defaultTextFromBody(body: string): string {
  return body
    // fenced code blocks → drop the fence markers, keep contents
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    // inline code `x` → x
    .replace(/`([^`]+)`/g, "$1")
    // bold/italics
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // links [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // headings #, ##, ###
    .replace(/^#{1,6}\s+/gm, "")
    // collapse 3+ blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function useChatVoiceAutoplay(
  companyId: string | null | undefined,
  entries: readonly ChatVoiceEntry[],
  options: UseChatVoiceAutoplayOptions = {},
): UseChatVoiceAutoplayApi {
  const enabled = options.enabled ?? true;
  const surface = options.surface ?? DEFAULT_SURFACE;
  const textFromBody = options.textFromBody ?? defaultTextFromBody;

  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastSuppressedEntryId, setLastSuppressedEntryId] = useState<
    string | null
  >(null);

  // Entries we've already handled (either played, blocked, or skipped).
  // Seeded with the initial render's entry ids so existing history doesn't
  // auto-play when the user first opens the thread.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  // Active audio playback. We keep a single shared `<audio>` element so a
  // new clip can interrupt the previous one cleanly.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // When `audio.play()` is rejected, the prepared element stays armed
  // here so `resumeAudio` can retry from a fresh user gesture.
  const pendingPlayRef = useRef<HTMLAudioElement | null>(null);

  const releaseBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  // Generic play-from-URL primitive. Used by the NoralVoice TTS path
  // (which returns a pre-signed audio URL). Mirrors playAudioBytes'
  // autoplay-rejection handling + single-clip-at-a-time semantics.
  const playAudioFromUrl = useCallback(
    (audioUrl: string) => {
      if (typeof window === "undefined") return;
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      // Free any prior blob URL — we're switching to a remote URL now.
      releaseBlobUrl();

      const audio = audioElRef.current ?? new Audio();
      audioElRef.current = audio;
      pendingPlayRef.current = null;
      setAudioBlocked(false);

      audio.onended = () => {
        pendingPlayRef.current = null;
        setIsPlaying(false);
      };
      audio.onerror = () => {
        pendingPlayRef.current = null;
        setIsPlaying(false);
      };
      audio.onpause = () => {
        // Distinguish manual stop from natural completion — `onended` already
        // covers the latter; we only want to flip the visible state when the
        // user (or `stopAudio`) interrupted playback.
        if (!audio.ended) setIsPlaying(false);
      };
      audio.src = audioUrl;

      void audio.play().then(
        () => {
          setAudioBlocked(false);
          setIsPlaying(true);
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("[chat-voice] audio.play() rejected (URL path)", err);
          pendingPlayRef.current = audio;
          setAudioBlocked(true);
          setIsPlaying(false);
        },
      );
    },
    [releaseBlobUrl],
  );

  const stopAudio = useCallback(() => {
    const audio = audioElRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* ignore — audio element may already be teared down */
      }
    }
    pendingPlayRef.current = null;
    setAudioBlocked(false);
    setIsPlaying(false);
    releaseBlobUrl();
  }, [releaseBlobUrl]);

  const resumeAudio = useCallback(() => {
    const audio = pendingPlayRef.current;
    if (!audio) {
      setAudioBlocked(false);
      return;
    }
    void audio.play().then(
      () => {
        setAudioBlocked(false);
        setIsPlaying(true);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn("[chat-voice] resumeAudio failed", err);
      },
    );
  }, []);

  // When `enabled` flips to false mid-session (user toggled the preference
  // off), stop any in-flight clip so the agent doesn't keep talking after
  // the user has explicitly muted. Future inbound messages won't synthesize
  // because the main effect early-returns on `!enabled`.
  useEffect(() => {
    if (enabled) return;
    const audio = audioElRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    pendingPlayRef.current = null;
    setAudioBlocked(false);
    setIsPlaying(false);
  }, [enabled]);

  useEffect(() => {
    // Tear down audio on unmount or when the hook is disabled.
    return () => {
      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      pendingPlayRef.current = null;
      releaseBlobUrl();
    };
  }, [releaseBlobUrl]);

  useEffect(() => {
    if (!enabled || !companyId) return;

    // First render after mount: capture the existing entry ids as already
    // "seen" so the historical thread doesn't burst-synthesize. Subsequent
    // renders only fire for entries we haven't seen yet.
    if (!seededRef.current) {
      seededRef.current = true;
      for (const e of entries) seenIdsRef.current.add(e.id);
      return;
    }

    const next: ChatVoiceEntry[] = [];
    for (const e of entries) {
      if (seenIdsRef.current.has(e.id)) continue;
      seenIdsRef.current.add(e.id);
      if (!e.authorAgentId) continue;
      const text = textFromBody(e.body);
      if (!text) continue;
      next.push({ ...e, body: text });
    }
    if (next.length === 0) return;

    // Only synthesize the last new agent message — if many landed in one
    // poll cycle, replaying all of them would be a wall of audio. The last
    // is almost always the most recent / relevant.
    const target = next[next.length - 1];
    if (!target) return;

    let cancelled = false;
    void noralVoiceTtsApi
      .synthesize({ companyId, text: target.body })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLastSuppressedEntryId(target.id);
          return;
        }
        playAudioFromUrl(result.audioUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[chat-voice] NV synthesize failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [
    companyId,
    enabled,
    entries,
    playAudioFromUrl,
    surface,
    textFromBody,
  ]);

  return {
    audioBlocked,
    resumeAudio,
    isPlaying,
    stopAudio,
    lastSuppressedEntryId,
  };
}
