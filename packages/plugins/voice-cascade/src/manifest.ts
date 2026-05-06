import type { NoralosPluginManifestV1 } from "@noralos/plugin-sdk";
import {
  API_ROUTE_KEYS,
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_TEXT_CHARS,
  PLUGIN_ID,
  PLUGIN_VERSION,
} from "./constants.js";

export const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Voice Cascade",
  description:
    "TTS execution layer. Reads voice-config for eligibility, runs pre-TTS exfiltration scan, then synthesizes audio via ElevenLabs or Google Cloud TTS with serial fallback. Reusable across Conference Room, future Twilio phone, future Dashboard voice, and future Slack-audio surfaces.",
  author: "NoralOS",
  categories: ["connector", "automation"],

  capabilities: [
    "companies.read",
    "agents.read",
    "events.subscribe",
    "events.emit",
    "api.routes.register",
    "http.outbound",
    "secrets.read-ref",
    "activity.log.write",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
  },

  apiRoutes: [
    // Synthesize audio. Caller is a service-agent (Conference Room bridge,
    // future Twilio plugin, etc.). Always returns 200; success vs failure
    // is signaled by `ok: true | false` in the body.
    {
      routeKey: API_ROUTE_KEYS.synthesize,
      method: "POST",
      path: "/synthesize",
      auth: "agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Provider health probe. Read-only, used by operators and other plugins
    // to check whether voice-cascade can serve requests.
    {
      routeKey: API_ROUTE_KEYS.health,
      method: "GET",
      path: "/health",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // List available voices for one provider. board-or-agent so the in-app
    // Voice Picker modal can call it with only the user's NoralOS session
    // cookie — provider keys never reach the browser.
    {
      routeKey: API_ROUTE_KEYS.listVoices,
      method: "GET",
      path: "/voices",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    // Synthesize a fixed, server-owned preview phrase for a chosen voice.
    // Caller cannot influence the text. Reuses the same provider impls and
    // exfiltration guard as /synthesize.
    {
      routeKey: API_ROUTE_KEYS.previewVoice,
      method: "POST",
      path: "/voices/preview",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],

  instanceConfigSchema: {
    type: "object",
    properties: {
      voiceConfigAgentTokenRef: {
        type: "string",
        title: "Voice-Config Agent Token (secret reference)",
        description:
          "Reference to a Paperclip agent API key with read access to voice-config. Used for HTTP fallback when the local cache misses.",
      },
      elevenLabsApiKeyRef: {
        type: "string",
        title: "ElevenLabs API Key (secret reference)",
      },
      googleTtsApiKeyRef: {
        type: "string",
        title: "Google Cloud TTS API Key (secret reference)",
      },
      googleTtsDefaultLanguageCode: {
        type: "string",
        title: "Default language code for Google Cloud TTS voices",
        default: "en-US",
      },
      ttsMode: {
        type: "string",
        enum: ["live", "dry_run"],
        title: "TTS mode",
        description:
          "Defaults to 'dry_run'. Live provider calls require explicitly setting this to 'live' — provider keys alone do NOT activate live TTS. 'dry_run' runs all gating + exfiltration scan but skips provider calls and returns reason=dry-run.",
      },
      maxTextChars: {
        type: "integer",
        title: "Maximum input text length (characters)",
        default: DEFAULT_MAX_TEXT_CHARS,
        minimum: 1,
      },
      maxAudioBytes: {
        type: "integer",
        title: "Maximum generated audio size (bytes)",
        default: DEFAULT_MAX_AUDIO_BYTES,
        minimum: 1024,
      },
      fallbackEnabled: {
        type: "boolean",
        title: "Enable provider fallback",
        default: false,
        description:
          "When true and the primary provider fails, voice-cascade retries with `fallbackProvider`.",
      },
      fallbackProvider: {
        type: "string",
        enum: ["elevenlabs", "google_tts"],
        title: "Fallback provider used when primary fails",
      },
      voiceConfigBaseUrl: {
        type: "string",
        title: "Voice-config base URL",
        default: "http://localhost:3100",
        description:
          "Same-origin host base URL. Operators rarely need to change this; defaults match the in-process noralos-server.",
      },
    },
    additionalProperties: false,
  },
};

export default manifest;
