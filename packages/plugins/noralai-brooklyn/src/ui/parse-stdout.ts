import type { TranscriptEntry } from "@noralos/adapter-utils";

/**
 * Brooklyn is a pure HTTPS chat-completion adapter — there is no CLI
 * subprocess and no structured event protocol on stdout. The server-side
 * `execute()` emits exactly one `ctx.onLog("stdout", result.text)` per run
 * (the full assistant response, possibly multi-line) and zero or more
 * `ctx.onLog("stderr", ...)` entries on failure. The host's stderr pipeline
 * surfaces failures separately, so this parser only handles the success
 * stdout path.
 *
 * Mapping policy:
 *   - Empty / whitespace-only lines: drop (nothing useful to render).
 *   - Anything else: surface as an `assistant` transcript entry so the
 *     issue-thread UI styles it like a model response rather than as raw
 *     stdout. Multi-line responses produce one entry per non-empty line;
 *     this is acceptable for v1 — Brooklyn does not stream tokens today.
 */
export function parseBrooklynStdoutLine(line: string, ts: string): TranscriptEntry[] {
  if (!line || !line.trim()) return [];
  return [{ kind: "assistant", ts, text: line }];
}
