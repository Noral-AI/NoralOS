// Autoplay TTS for chat surfaces (Issue chat → Dashboard surface).
//
// Watches a list of "comments" (or equivalent agent-authored messages) and,
// when a new agent-authored entry arrives, asks voice-cascade to synthesize
// the body and plays the resulting audio. Honors the autoplay-rejection
// path the Conference Room ships: if `audio.play()` is rejected by the
// browser (stale gesture / unfocused tab / autoplay policy), the clip
// stays armed and callers can render an "Enable audio" pill that calls
// `resumeAudio()` from a fresh user gesture.
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
//   - Resolution of `dashboardVoiceEnabled`, `ttsMode`, exfiltration, and
//     provider keys all live in voice-cascade /synthesize. This hook does
//     NOT replicate any of those checks — it just asks and reacts to the
//     answer. Non-ok responses (`reason: voice-config-disabled`, etc.)
//     are silently dropped: the agent simply has no voice on this surface.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  voiceCascadeApi,
  type VoiceCascadeSurface,
} from "../api/voiceCascade";

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
  /** Which voice-cascade surface to attribute this synthesis to. Drives
   * the per-agent surface gate (e.g. `dashboardVoiceEnabled`). */
  surface?: VoiceCascadeSurface;
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
  /** Last entry id whose synthesis returned ok=false — useful for tests /
   * debugging only. Not surfaced to end users. */
  lastSuppressedEntryId: string | null;
}

const DEFAULT_SURFACE: VoiceCascadeSurface = "dashboard";

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

  const playAudioBytes = useCallback(
    (audioBase64: string, mimeType: string) => {
      if (typeof window === "undefined") return;
      let bytes: Uint8Array;
      try {
        const binary = atob(audioBase64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        // eslint-disable-next-line no-console
        console.warn("[chat-voice] base64 decode failed");
        return;
      }
      const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);

      if (audioElRef.current) {
        try {
          audioElRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      releaseBlobUrl();
      blobUrlRef.current = url;

      const audio = audioElRef.current ?? new Audio();
      audioElRef.current = audio;
      pendingPlayRef.current = null;
      setAudioBlocked(false);

      audio.onended = () => {
        pendingPlayRef.current = null;
        if (blobUrlRef.current === url) {
          URL.revokeObjectURL(url);
          blobUrlRef.current = null;
        }
      };
      audio.onerror = () => {
        pendingPlayRef.current = null;
        if (blobUrlRef.current === url) {
          URL.revokeObjectURL(url);
          blobUrlRef.current = null;
        }
      };
      audio.src = url;

      void audio.play().then(
        () => {
          setAudioBlocked(false);
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn("[chat-voice] audio.play() rejected", err);
          pendingPlayRef.current = audio;
          setAudioBlocked(true);
        },
      );
    },
    [releaseBlobUrl],
  );

  const resumeAudio = useCallback(() => {
    const audio = pendingPlayRef.current;
    if (!audio) {
      setAudioBlocked(false);
      return;
    }
    void audio.play().then(
      () => setAudioBlocked(false),
      (err) => {
        // eslint-disable-next-line no-console
        console.warn("[chat-voice] resumeAudio failed", err);
      },
    );
  }, []);

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
    void voiceCascadeApi
      .synthesize({
        companyId,
        agentId: target.authorAgentId!,
        surface,
        text: target.body,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLastSuppressedEntryId(target.id);
          return;
        }
        playAudioBytes(result.audioBase64, result.mimeType);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[chat-voice] synthesize failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, enabled, entries, playAudioBytes, surface, textFromBody]);

  return { audioBlocked, resumeAudio, lastSuppressedEntryId };
}
