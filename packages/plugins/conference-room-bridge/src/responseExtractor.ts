// Extract the user-facing assistant text from a Paperclip agent's chunk
// stream. Paperclip surfaces Claude Agent SDK output as newline-delimited
// JSON (each line is one of: system, user, assistant, rate_limit_event,
// result, plus occasional plain-text prefixes from Paperclip itself like
// "[paperclip] ..." lines).
//
// The canonical "this is the final assistant text" event is:
//   { "type": "result", "subtype": "success", "is_error": false,
//     "result": "<text>", ... }
//
// We extract `result.result` from the LAST type:result line. Confirmed
// against legacy Noral-OS/src/agent-voice-bridge.ts which uses the same
// SDK (`@anthropic-ai/claude-agent-sdk`).
//
// We deliberately do not concatenate intermediate `assistant` turns —
// those include tool-use round-trips and are not user-facing speech.
// Conference Room must speak only the final reply.

import { BRIDGE_RESPONSE_CAP_CHARS } from "./constants.js";

export type ExtractionResult =
  | {
      ok: true;
      text: string;
      capped: boolean;
      originalLength: number;
    }
  | {
      ok: false;
      reason: "no-result-event" | "result-error" | "empty-result";
      message: string;
    };

interface ResultEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
}

export function extractAssistantResponse(rawResponseText: string): ExtractionResult {
  const lines = rawResponseText.split("\n");
  let resultEvent: ResultEvent | null = null;

  for (const line of lines) {
    // Cheap filter: only attempt JSON parse on lines that start with "{".
    // Paperclip's "[paperclip] No project ..." prefix lines are skipped.
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as ResultEvent;
      if (parsed.type === "result") {
        // Keep the last result event if multiple arrive (defensive).
        resultEvent = parsed;
      }
    } catch {
      // ignore unparseable lines (truncated chunks, malformed JSON, etc.)
    }
  }

  if (!resultEvent) {
    return {
      ok: false,
      reason: "no-result-event",
      message: "No type:result event found in agent run output",
    };
  }
  if (resultEvent.is_error === true) {
    return {
      ok: false,
      reason: "result-error",
      message: `Agent run reported error (subtype=${resultEvent.subtype ?? "?"})`,
    };
  }
  if (typeof resultEvent.result !== "string" || resultEvent.result.length === 0) {
    return {
      ok: false,
      reason: "empty-result",
      message: "result field is empty or non-string",
    };
  }

  const text = resultEvent.result;
  const originalLength = text.length;
  const capped = originalLength > BRIDGE_RESPONSE_CAP_CHARS;
  return {
    ok: true,
    text: capped ? text.slice(0, BRIDGE_RESPONSE_CAP_CHARS) : text,
    capped,
    originalLength,
  };
}
