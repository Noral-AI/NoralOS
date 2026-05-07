import { describe, expect, it } from "vitest";
import {
  getProvider,
  isAssignmentTargetAllowed,
  providerRegistry,
} from "../services/integrations/provider-registry.ts";

describe("integrations provider registry", () => {
  it("exposes google_tts and elevenlabs as enabled with voice category", () => {
    const google = getProvider("google_tts");
    const eleven = getProvider("elevenlabs");
    expect(google?.enabled).toBe(true);
    expect(google?.category).toBe("voice");
    expect(eleven?.enabled).toBe(true);
    expect(eleven?.category).toBe("voice");
  });

  it("declares only allow-listed assignment targets for voice providers", () => {
    expect(getProvider("google_tts")?.assignmentTargets).toEqual([
      { pluginKey: "voice-cascade", field: "googleTtsApiKeyRef" },
    ]);
    expect(getProvider("elevenlabs")?.assignmentTargets).toEqual([
      { pluginKey: "voice-cascade", field: "elevenLabsApiKeyRef" },
    ]);
  });

  it("rejects provider/target mismatches", () => {
    // The Google key cannot be assigned to the ElevenLabs field.
    expect(
      isAssignmentTargetAllowed("google_tts", "voice-cascade", "elevenLabsApiKeyRef"),
    ).toBe(false);
    // ElevenLabs cannot be assigned to the Google field.
    expect(
      isAssignmentTargetAllowed("elevenlabs", "voice-cascade", "googleTtsApiKeyRef"),
    ).toBe(false);
    // Voice providers cannot leak into ttsMode (or any other non-target field).
    expect(
      isAssignmentTargetAllowed("google_tts", "voice-cascade", "ttsMode"),
    ).toBe(false);
    expect(
      isAssignmentTargetAllowed("elevenlabs", "voice-cascade", "ttsMode"),
    ).toBe(false);
  });

  it("permits matching provider/target pairs", () => {
    expect(
      isAssignmentTargetAllowed("google_tts", "voice-cascade", "googleTtsApiKeyRef"),
    ).toBe(true);
    expect(
      isAssignmentTargetAllowed("elevenlabs", "voice-cascade", "elevenLabsApiKeyRef"),
    ).toBe(true);
  });

  it("declares disabled placeholders without assignment targets", () => {
    const disabled = providerRegistry.filter((p) => !p.enabled);
    expect(disabled.length).toBeGreaterThan(0);
    for (const p of disabled) {
      expect(p.assignmentTargets).toEqual([]);
      expect(p.test).toBeUndefined();
    }
  });

  it("declares the noralos_voice_config provider mapping to the voice-cascade and bridge agent token fields", () => {
    const noralos = getProvider("noralos_voice_config");
    expect(noralos?.enabled).toBe(true);
    expect(noralos?.assignmentTargets).toEqual(
      expect.arrayContaining([
        { pluginKey: "voice-cascade", field: "voiceConfigAgentTokenRef" },
        { pluginKey: "conference-room-bridge", field: "voiceConfigCallerTokenRef" },
        { pluginKey: "conference-room-bridge", field: "voiceCascadeCallerTokenRef" },
      ]),
    );
  });
});
