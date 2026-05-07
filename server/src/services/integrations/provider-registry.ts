/**
 * Settings → Integrations provider registry.
 *
 * Single source of truth shared between the API and UI. Each provider
 * declares:
 *   - identity (id, displayName, category)
 *   - the credential type it expects
 *   - which plugin instance config fields a credential of this provider may
 *     be assigned to (the only allow-listed assignment targets — assignment
 *     to any field not in this list is rejected at the API layer)
 *   - a `test` function (live providers only) that performs a low-impact
 *     credential check against the provider's API
 *
 * Phase 1 implements only `google_tts` and `elevenlabs`. The rest are
 * declared as `enabled: false` so the UI can show "Coming soon" tiles
 * without enabling any runtime behaviour.
 */
import type { TestResult } from "./providers/types.js";
import { testGoogleTts } from "./providers/google-tts.js";
import { testElevenLabs } from "./providers/elevenlabs.js";

export type ProviderId =
  | "google_tts"
  | "elevenlabs"
  | "noralos_voice_config"
  | "openai"
  | "anthropic"
  | "google_gemini"
  | "twilio"
  | "ringcentral"
  | "gohighlevel"
  | "hubspot"
  | "salesforce"
  | "n8n"
  | "make"
  | "zapier";

export type ProviderCategory =
  | "voice"
  | "llm"
  | "telephony"
  | "crm"
  | "email_calendar"
  | "webhook"
  | "other";

export type CredentialType =
  | "api_key"
  | "bearer_token"
  | "webhook_signing_secret"
  | "hmac_secret"
  | "shared_secret"
  | "oauth_client_secret"
  | "oauth_refresh_token"
  | "connection_url"
  | "custom_json_secret";

export interface AssignmentTarget {
  /** Plugin key (e.g. "voice-cascade"), not the plugin UUID. */
  pluginKey: string;
  /** Property name on the plugin's instanceConfigSchema. */
  field: string;
}

export interface ProviderTestInput {
  secretValue: string;
  metadata: Record<string, unknown>;
}

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  category: ProviderCategory;
  credentialType: CredentialType;
  /** Whether this provider is wired up in this build. */
  enabled: boolean;
  /** Plugin config fields a credential of this provider can be assigned to. */
  assignmentTargets: AssignmentTarget[];
  /** Live test function. Only required when `enabled: true`. */
  test?: (input: ProviderTestInput) => Promise<TestResult>;
  /** Optional docs URL surfaced in the UI. */
  docsUrl?: string;
  /** Short description for the Add Credential drawer. */
  description?: string;
}

export const providerRegistry: ProviderDefinition[] = [
  {
    id: "google_tts",
    displayName: "Google Cloud TTS",
    category: "voice",
    credentialType: "api_key",
    enabled: true,
    assignmentTargets: [
      { pluginKey: "voice-cascade", field: "googleTtsApiKeyRef" },
    ],
    test: testGoogleTts,
    docsUrl: "https://cloud.google.com/text-to-speech/docs/voices",
    description:
      "Google Cloud Text-to-Speech API key. Powers the Google leg of Voice Cascade.",
  },
  {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    category: "voice",
    credentialType: "api_key",
    enabled: true,
    assignmentTargets: [
      { pluginKey: "voice-cascade", field: "elevenLabsApiKeyRef" },
    ],
    test: testElevenLabs,
    docsUrl: "https://elevenlabs.io/docs/api-reference",
    description: "ElevenLabs API key. Powers the ElevenLabs leg of Voice Cascade.",
  },
  {
    id: "noralos_voice_config",
    displayName: "NoralOS Voice-Config Token",
    category: "other",
    credentialType: "bearer_token",
    enabled: true,
    assignmentTargets: [
      { pluginKey: "voice-cascade", field: "voiceConfigAgentTokenRef" },
      { pluginKey: "conference-room-bridge", field: "voiceConfigCallerTokenRef" },
      { pluginKey: "conference-room-bridge", field: "voiceCascadeCallerTokenRef" },
    ],
    description:
      "Internal Paperclip agent API key used by Voice Cascade and Conference Room Bridge to call same-instance services.",
  },
  // Phase-2 placeholders. Declared so the UI can show "Coming soon" tiles
  // grouped by category. None of these are usable at runtime.
  {
    id: "openai",
    displayName: "OpenAI",
    category: "llm",
    credentialType: "api_key",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    category: "llm",
    credentialType: "api_key",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "google_gemini",
    displayName: "Google Gemini",
    category: "llm",
    credentialType: "api_key",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "twilio",
    displayName: "Twilio",
    category: "telephony",
    credentialType: "api_key",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "ringcentral",
    displayName: "RingCentral",
    category: "telephony",
    credentialType: "oauth_refresh_token",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "gohighlevel",
    displayName: "GoHighLevel",
    category: "crm",
    credentialType: "api_key",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "hubspot",
    displayName: "HubSpot",
    category: "crm",
    credentialType: "oauth_refresh_token",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "salesforce",
    displayName: "Salesforce",
    category: "crm",
    credentialType: "oauth_refresh_token",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "n8n",
    displayName: "n8n",
    category: "webhook",
    credentialType: "webhook_signing_secret",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "make",
    displayName: "Make",
    category: "webhook",
    credentialType: "webhook_signing_secret",
    enabled: false,
    assignmentTargets: [],
  },
  {
    id: "zapier",
    displayName: "Zapier",
    category: "webhook",
    credentialType: "webhook_signing_secret",
    enabled: false,
    assignmentTargets: [],
  },
];

const providerById = new Map(providerRegistry.map((p) => [p.id, p]));

export function getProvider(id: string): ProviderDefinition | null {
  return providerById.get(id as ProviderId) ?? null;
}

export function isAssignmentTargetAllowed(
  providerId: string,
  pluginKey: string,
  field: string,
): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  return provider.assignmentTargets.some(
    (t) => t.pluginKey === pluginKey && t.field === field,
  );
}

export type { TestResult } from "./providers/types.js";
