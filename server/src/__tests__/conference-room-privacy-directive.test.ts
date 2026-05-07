import { describe, expect, it } from "vitest";
import { CONFERENCE_ROOM_PRIVACY_DIRECTIVE } from "../../../packages/plugins/conference-room-bridge/src/constants.ts";

// The bridge prepends this directive to every Conference Room user message.
// These tests pin the wording so future edits can't silently weaken the
// agent-home isolation half of PR #44.

describe("Conference Room privacy directive", () => {
  it("instructs the agent not to write to the shared AGENT_HOME life tree", () => {
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE).toContain("$AGENT_HOME/life/");
  });

  it("instructs the agent not to write to the shared AGENT_HOME memory tree", () => {
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE).toContain("$AGENT_HOME/memory/");
  });

  it("explicitly disables the para-memory-files skill in this session", () => {
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE).toContain("para-memory-files");
  });

  it("describes the session as private to one authenticated participant", () => {
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE.toLowerCase()).toContain(
      "private session",
    );
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE.toLowerCase()).toContain(
      "authenticated participant",
    );
  });

  it("ends with a delimiter so the user message follows on a fresh line", () => {
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE.endsWith("---\n")).toBe(true);
  });

  it("contains no transcript-derived text or PII placeholders", () => {
    // The directive is a static string; it must not embed any user input
    // or runtime ids. Tightens the contract so future edits don't sneak
    // in templated values that could leak across sessions.
    expect(CONFERENCE_ROOM_PRIVACY_DIRECTIVE).not.toMatch(/\$\{|\{\{/);
  });
});
