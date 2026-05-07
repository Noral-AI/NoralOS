import { describe, expect, it } from "vitest";
import { manifest as voiceCascadeManifest } from "../../../packages/plugins/voice-cascade/src/manifest.ts";
import { manifest as bridgeManifest } from "../../../packages/plugins/conference-room-bridge/src/manifest.ts";
import {
  collectSecretRefPaths,
  isUuidSecretRef,
} from "../services/json-schema-secret-refs.ts";
import { extractSecretRefsFromConfig } from "../services/plugin-secrets-handler.ts";

describe("manifest hardening — voice-cascade", () => {
  it("declares format: 'secret-ref' on every *Ref field", () => {
    const schema = voiceCascadeManifest.instanceConfigSchema as {
      properties: Record<string, { format?: string }>;
    };
    expect(schema.properties.voiceConfigAgentTokenRef?.format).toBe("secret-ref");
    expect(schema.properties.googleTtsApiKeyRef?.format).toBe("secret-ref");
    expect(schema.properties.elevenLabsApiKeyRef?.format).toBe("secret-ref");
  });

  it("collectSecretRefPaths returns exactly the three secret-ref properties", () => {
    const paths = Array.from(
      collectSecretRefPaths(
        voiceCascadeManifest.instanceConfigSchema as Record<string, unknown>,
      ),
    ).sort();
    expect(paths).toEqual(
      [
        "elevenLabsApiKeyRef",
        "googleTtsApiKeyRef",
        "voiceConfigAgentTokenRef",
      ].sort(),
    );
  });

  it("with format declared, runtime scope-check still resolves UUIDs at the *Ref fields", () => {
    const uuidA = "11111111-1111-1111-1111-111111111111";
    const uuidB = "22222222-2222-2222-2222-222222222222";
    const config = {
      voiceConfigAgentTokenRef: uuidA,
      googleTtsApiKeyRef: uuidB,
      elevenLabsApiKeyRef: "",
      ttsMode: "dry_run",
      googleTtsDefaultLanguageCode: "en-US",
    };
    const refs = extractSecretRefsFromConfig(
      config,
      voiceCascadeManifest.instanceConfigSchema as Record<string, unknown>,
    );
    expect(Array.from(refs).sort()).toEqual([uuidA, uuidB].sort());
  });

  it("with format declared, UUIDs in non-secret-ref fields are NOT treated as resolvable", () => {
    // Adding format: secret-ref switches the resolver into strict mode. A
    // UUID-shaped string in a non-ref field (here ttsMode is a string enum
    // but tested against an arbitrary non-ref string) must not appear in the
    // allowed-refs set.
    const stowAwayUuid = "33333333-3333-3333-3333-333333333333";
    const config = {
      voiceConfigAgentTokenRef: "11111111-1111-1111-1111-111111111111",
      googleTtsDefaultLanguageCode: stowAwayUuid,
    };
    const refs = extractSecretRefsFromConfig(
      config,
      voiceCascadeManifest.instanceConfigSchema as Record<string, unknown>,
    );
    expect(refs.has(stowAwayUuid)).toBe(false);
    // Sanity: declared ref still picked up.
    expect(refs.has("11111111-1111-1111-1111-111111111111")).toBe(true);
  });
});

describe("manifest hardening — conference-room-bridge", () => {
  it("declares format: 'secret-ref' on both caller token fields", () => {
    const schema = bridgeManifest.instanceConfigSchema as {
      properties: Record<string, { format?: string }>;
    };
    expect(schema.properties.voiceConfigCallerTokenRef?.format).toBe("secret-ref");
    expect(schema.properties.voiceCascadeCallerTokenRef?.format).toBe("secret-ref");
  });

  it("collectSecretRefPaths includes both caller token fields", () => {
    const paths = new Set(
      collectSecretRefPaths(
        bridgeManifest.instanceConfigSchema as Record<string, unknown>,
      ),
    );
    expect(paths.has("voiceConfigCallerTokenRef")).toBe(true);
    expect(paths.has("voiceCascadeCallerTokenRef")).toBe(true);
  });
});

describe("isUuidSecretRef sanity", () => {
  it("accepts well-formed UUIDs", () => {
    expect(isUuidSecretRef("11111111-1111-1111-1111-111111111111")).toBe(true);
  });
  it("rejects non-UUID strings", () => {
    expect(isUuidSecretRef("not-a-uuid")).toBe(false);
    expect(isUuidSecretRef("")).toBe(false);
  });
});
