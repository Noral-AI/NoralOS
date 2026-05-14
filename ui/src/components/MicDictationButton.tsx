// Reusable mic-toggle button for any free-text input on a host page.
//
// Click → starts Web Speech recognition. Each final utterance is delivered
// via `onTranscript(text)` so the parent can append it to whatever state
// backs the text input. Click again to stop. The button shows three
// visual states:
//   - inert (idle): outlined mic icon
//   - listening: filled mic + animated dot, plus interim text in a tooltip
//   - error / unsupported: disabled with a tooltip explaining why
//
// Browser support: Chrome and Chromium-based Edge ship the Web Speech API.
// Safari and Firefox don't. On unsupported browsers we render a disabled
// button rather than hiding it — callers shouldn't have to gate on
// `useSpeechRecognition().supported` in two places.

import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface MicDictationButtonProps {
  /** Called with each final utterance. The parent decides how to append
   * it (e.g. `setBody(prev => (prev ? prev + " " : "") + text)`). */
  onTranscript: (text: string) => void;
  /** Label / aria-label override. Defaults to "Dictate". */
  label?: string;
  /** When true, the button is disabled regardless of speech support. */
  disabled?: boolean;
  /** Optional test id for end-to-end test targeting. */
  testId?: string;
  /** Tailwind size class on the icon. Default 16px (`h-4 w-4`). */
  iconClassName?: string;
}

export function MicDictationButton({
  onTranscript,
  label = "Dictate",
  disabled = false,
  testId,
  iconClassName = "h-4 w-4",
}: MicDictationButtonProps) {
  const speech = useSpeechRecognition({ onFinalUtterance: onTranscript });

  const isDisabled = disabled || !speech.supported;

  const title = !speech.supported
    ? "Dictation needs the Web Speech API. Use Chrome or Edge."
    : speech.error
      ? `Mic error: ${speech.error}`
      : speech.listening
        ? speech.interimText
          ? `Listening: ${speech.interimText}`
          : "Listening — click to stop"
        : label;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => (speech.listening ? speech.stop() : speech.start())}
      data-testid={testId}
      data-listening={speech.listening || undefined}
      aria-label={label}
      aria-pressed={speech.listening}
      title={title}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors " +
        (speech.listening
          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : speech.error
            ? "border-rose-500/40 text-rose-600 dark:text-rose-400"
            : "border-border text-muted-foreground hover:text-foreground") +
        (isDisabled ? " opacity-50 cursor-not-allowed" : "")
      }
    >
      <svg
        viewBox="0 0 24 24"
        stroke="currentColor"
        fill={speech.listening ? "currentColor" : "none"}
        strokeWidth={speech.listening ? "1.5" : "2"}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName}
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
      <span>
        {!speech.supported
          ? "Mic n/a"
          : speech.listening
            ? "Listening"
            : label}
      </span>
      {speech.listening ? (
        <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
      ) : null}
    </button>
  );
}
