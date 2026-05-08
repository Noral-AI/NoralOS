// @vitest-environment jsdom

// Regression coverage for the integrations page Voice Cascade mode banner.
// Phase-1 of PR #46 ([fb3488e]) shipped a hard-coded "Voice Cascade stays in
// dry_run after assignment" string and a static `Mode: dry_run` badge. The
// canonical DB has had `ttsMode: "live"` since 2026-05-06 09:26 EDT, so the
// hard-coded copy was lying to admins. PR #47 replaces it with a dynamic
// banner derived from the running plugin's /health probe; these tests pin
// that contract so a future regression cannot reintroduce the lie.

import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { VoiceCascadeModeBanner } from "./CompanyIntegrations";

function renderInto(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("VoiceCascadeModeBanner — truthful mode copy", () => {
  it("renders the dry_run warning when mode is dry_run", () => {
    const { container, cleanup } = renderInto(<VoiceCascadeModeBanner mode="dry_run" />);
    const text = container.textContent ?? "";

    expect(text).toContain("Current mode:");
    expect(text).toContain("dry_run");
    expect(text).toContain("does not enable live TTS");
    expect(container.querySelector("[data-mode='dry_run']")).not.toBeNull();
    cleanup();
  });

  it("renders the live warning when mode is live", () => {
    const { container, cleanup } = renderInto(<VoiceCascadeModeBanner mode="live" />);
    const text = container.textContent ?? "";

    expect(text).toContain("Current mode:");
    expect(text).toContain("live");
    expect(text).toContain("can affect live TTS behavior immediately");
    // Specifically: when mode is live, we must not still claim dry_run.
    expect(text).not.toContain("does not enable live TTS");
    expect(text).not.toContain("stays in dry_run");
    expect(container.querySelector("[data-mode='live']")).not.toBeNull();
    cleanup();
  });

  it("renders the verification warning when mode cannot be determined", () => {
    const { container, cleanup } = renderInto(<VoiceCascadeModeBanner mode={null} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Current mode could not be verified");
    expect(text).toContain("Confirm Voice Cascade mode before assigning production credentials");
    // No claim about either mode while we don't know.
    expect(text).not.toContain("dry_run");
    expect(text).not.toContain("Mode: live");
    expect(container.querySelector("[data-mode='unknown']")).not.toBeNull();
    cleanup();
  });
});
