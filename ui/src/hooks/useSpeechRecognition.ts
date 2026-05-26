// Browser-native speech-to-text wrapper around the Web Speech API.
//
// Lifted (intentionally duplicated, not imported) from the conference-room
// bridge plugin's identical hook. Conference Room and host UI surfaces have
// different lifecycle needs and we don't want to cross plugin/host import
// boundaries, so the two copies are allowed to diverge.
//
// The Web Speech API is Chrome/Edge only. Safari and Firefox don't ship
// `(webkit)SpeechRecognition`; `supported` will be false there and callers
// should gate their mic UI on it. We deliberately don't fall back to a
// server-side STT (Whisper, Deepgram, etc.) here — that's a much bigger
// architectural choice and would be wrong to slip in behind a hook name.

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal local typing for the Web Speech API (it isn't in lib.dom.d.ts).
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
};
type SpeechRecognitionResultList = {
  length: number;
  item: (i: number) => SpeechRecognitionResult;
  [i: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionErrorEvent = { error: string; message?: string };
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechRecognitionState = {
  supported: boolean;
  listening: boolean;
  interimText: string;
  error: string | null;
};

export type SpeechRecognitionApi = SpeechRecognitionState & {
  start: () => void;
  stop: () => void;
};

export function useSpeechRecognition(opts: {
  onFinalUtterance: (text: string) => void;
  lang?: string;
}): SpeechRecognitionApi {
  const { onFinalUtterance, lang = "en-US" } = opts;
  const ctor = getCtor();
  const [supported] = useState<boolean>(!!ctor);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinalRef = useRef(onFinalUtterance);
  onFinalRef.current = onFinalUtterance;

  const buildRecognizer = useCallback(() => {
    if (!ctor) return null;
    const rec = new ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (!r) continue;
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) {
          if (text.trim()) onFinalRef.current(text.trim());
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are routine; treat as transient.
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error || "speech-recognition-error");
    };
    rec.onend = () => {
      setListening(false);
      setInterimText("");
    };
    return rec;
  }, [ctor, lang]);

  const start = useCallback(() => {
    if (!ctor) return;
    if (recRef.current) return;
    setError(null);
    const rec = buildRecognizer();
    if (!rec) return;
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "start-failed");
      recRef.current = null;
    }
  }, [ctor, buildRecognizer]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
    setInterimText("");
  }, []);

  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { supported, listening, interimText, error, start, stop };
}
