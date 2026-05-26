/**
 * Pure-function tests for the helpers used inside the Slack worker.
 *
 * The Socket Mode + agent-session paths are integration-level (they need
 * the host RPC bridge), so we only unit-test the small message-shaping
 * helpers here.
 */

import { describe, expect, it } from "vitest";

// The helpers live inside worker.ts as module-private functions. We
// re-export them from a sibling so tests can hit them without spinning
// up the full plugin runtime.
import { stripTrailingModelTag } from "./response-cleanup.js";

describe("stripTrailingModelTag", () => {
  it("strips a bracketed model tag on its own trailing line", () => {
    expect(stripTrailingModelTag("Hey. What do you need researched?\n\n[haiku]")).toBe(
      "Hey. What do you need researched?",
    );
  });

  it("strips a model tag with hyphens (e.g. claude-3.5-sonnet)", () => {
    expect(stripTrailingModelTag("All done.\n[claude-3.5-sonnet]")).toBe("All done.");
  });

  it("strips when there's only a space between text and tag", () => {
    expect(stripTrailingModelTag("Quick reply. [opus]")).toBe("Quick reply.");
  });

  it("leaves inline brackets in the middle of a message alone", () => {
    expect(
      stripTrailingModelTag("See the docs at [the readme](https://example.com)."),
    ).toBe("See the docs at [the readme](https://example.com).");
  });

  it("leaves a sentence-ending bracket that doesn't look like a model handle alone", () => {
    // "Order #12345" is not a lowercase-prefix model handle; the trailing
    // closing bracket of a markdown link or list entry shouldn't be touched.
    expect(stripTrailingModelTag("First step: read the spec [3]")).toBe(
      "First step: read the spec [3]",
    );
  });

  it("is a no-op on text without any trailing tag", () => {
    expect(stripTrailingModelTag("Just a regular reply.")).toBe("Just a regular reply.");
  });

  it("strips even when there are multiple blank lines before the tag", () => {
    expect(stripTrailingModelTag("Reply body.\n\n\n[haiku]")).toBe("Reply body.");
  });

  it("returns empty for a message that was JUST the model tag", () => {
    expect(stripTrailingModelTag("[haiku]")).toBe("");
  });
});
