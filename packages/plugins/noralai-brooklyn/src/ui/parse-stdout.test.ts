import { describe, expect, it } from "vitest";

import { parseBrooklynStdoutLine } from "./parse-stdout.js";

const TS = "2026-05-17T00:00:00.000Z";

describe("parseBrooklynStdoutLine", () => {
  it("renders the assistant response line as an assistant transcript entry", () => {
    const entries = parseBrooklynStdoutLine("Hello from Qwen.", TS);
    expect(entries).toEqual([{ kind: "assistant", ts: TS, text: "Hello from Qwen." }]);
  });

  it("drops empty and whitespace-only lines", () => {
    expect(parseBrooklynStdoutLine("", TS)).toEqual([]);
    expect(parseBrooklynStdoutLine("   ", TS)).toEqual([]);
    expect(parseBrooklynStdoutLine("\t", TS)).toEqual([]);
  });

  it("does not attempt to parse JSON or look for structured event prefixes", () => {
    const noisy = '{"type":"system","subtype":"init"}';
    expect(parseBrooklynStdoutLine(noisy, TS)).toEqual([
      { kind: "assistant", ts: TS, text: noisy },
    ]);
  });
});
