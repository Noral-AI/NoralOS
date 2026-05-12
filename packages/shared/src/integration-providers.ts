// Provider registry for the visible Integrations Settings page.
//
// Phase 1 ships only `google_tts` and `elevenlabs`. The shape is designed to
// extend cleanly to telephony / CRM / LLM / webhook providers in later
// phases without touching the database schema.
//
// Source of truth: this file is imported by both the server (for credential
// validation + the test runner) and the UI (for rendering the Add Credential
// drawer + Assignment cards).
//
// Security: this registry contains NO secret values. The `apiKey` etc.
// fields are placeholders the UI uses to render input boxes; the actual
// secret material lives in `company_secrets` + `company_secret_versions`.

export const INTEGRATION_CATEGORIES = [
  "voice",
  "llm",
  "telephony",
  "crm",
  "email_calendar",
  "webhook",
  "other",
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const INTEGRATION_CREDENTIAL_TYPES = [
  "api_key",
  "bearer_token",
  "basic_auth",
  "oauth_client_secret",
  "oauth_refresh_token",
  "webhook_signing_secret",
  "webhook_verification_token",
  "inbound_webhook_secret",
  "outbound_webhook_bearer_token",
  "hmac_secret",
  "shared_secret",
  "webhook_url",
  "custom_header_secret",
  "connection_url",
  "custom_json_secret",
  "private_key",
  "username_password",
] as const;
export type IntegrationCredentialType = (typeof INTEGRATION_CREDENTIAL_TYPES)[number];

export const INTEGRATION_ENVIRONMENTS = ["production", "test", "development"] as const;
export type IntegrationEnvironment = (typeof INTEGRATION_ENVIRONMENTS)[number];

export const INTEGRATION_STATUSES = ["active", "disabled", "needs_attention"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_LAST_TEST_STATUSES = ["ok", "failed"] as const;
export type IntegrationLastTestStatus = (typeof INTEGRATION_LAST_TEST_STATUSES)[number];

/** A single input shown to the admin when adding a credential. */
export interface IntegrationField {
  /** Form key. `secret` fields flow into the encrypted material; `text` fields land in non-secret metadata. */
  key: string;
  label: string;
  inputType: "secret" | "text";
  required: boolean;
  helpText?: string;
}

/** A plugin slot a credential can be assigned to. */
export interface IntegrationAssignableSlot {
  pluginKey: string;
  configPath: string;
  /** Human-friendly label for the assignment card. */
  label: string;
}

/** Provider-specific test instructions. Phase 1 only supports HTTP probes. */
export interface IntegrationTestSpec {
  kind: "http";
  method: "GET";
  /**
   * URL with optional `{{key}}` placeholders. Placeholders MUST refer to
   * `secret` fields in the provider's `fields` list. Resolved server-side
   * immediately before the call; never logged.
   */
  urlTemplate?: string;
  /** Hard-coded URL when no template substitution is needed. */
  url?: string;
  headers?: Record<string, string>;
  okStatuses: number[];
  /** Prefixed in front of the safe error message so the admin sees provider context. */
  safeErrorPrefix: string;
}

export interface IntegrationProvider {
  id: string;
  category: IntegrationCategory;
  credentialType: IntegrationCredentialType;
  displayName: string;
  description?: string;
  fields: IntegrationField[];
  test: IntegrationTestSpec;
  /** Plugin slots this provider's credentials can be assigned to. */
  assignableSlots: IntegrationAssignableSlot[];
}

/**
 * Phase 1 provider registry. Extending: drop a new `IntegrationProvider`
 * into the `PROVIDERS` map and surface it in the UI's category groups.
 */
export const INTEGRATION_PROVIDERS: Record<string, IntegrationProvider> = {
  google_tts: {
    id: "google_tts",
    category: "voice",
    credentialType: "api_key",
    displayName: "Google Cloud TTS",
    description:
      "Google Cloud Text-to-Speech voices. Used by voice-cascade for the conversational Conference Room agent voice.",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        inputType: "secret",
        required: true,
        helpText:
          "Create a Google Cloud API key restricted to the Text-to-Speech API. NoralOS only ever stores this encrypted; admins never see the value back.",
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      urlTemplate:
        "https://texttospeech.googleapis.com/v1/voices?key={{apiKey}}&languageCode=en-US",
      okStatuses: [200],
      safeErrorPrefix: "Google Cloud TTS rejected the key",
    },
    assignableSlots: [
      {
        pluginKey: "noralos.voice-cascade",
        configPath: "googleTtsApiKeyRef",
        label: "Voice Cascade — Google Cloud TTS",
      },
    ],
  },
  elevenlabs: {
    id: "elevenlabs",
    category: "voice",
    credentialType: "api_key",
    displayName: "ElevenLabs",
    description:
      "ElevenLabs voices. Used by voice-cascade for higher-fidelity conversational voice synthesis.",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        inputType: "secret",
        required: true,
        helpText:
          "Find your key under ElevenLabs → Profile → API Keys. NoralOS only ever stores this encrypted.",
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      url: "https://api.elevenlabs.io/v1/voices",
      headers: { "xi-api-key": "{{apiKey}}" },
      okStatuses: [200],
      safeErrorPrefix: "ElevenLabs rejected the key",
    },
    assignableSlots: [
      {
        pluginKey: "noralos.voice-cascade",
        configPath: "elevenLabsApiKeyRef",
        label: "Voice Cascade — ElevenLabs",
      },
    ],
  },
  // ── Brooklyn LLM (NORALAI) ──────────────────────────────────────
  // Phase 2 LLM provider. The credential is the API key for the
  // RunPod-hosted OpenAI-compatible endpoint that backs Brooklyn LLM
  // today. The endpoint URL is stored per-agent in adapterConfig, not
  // in the credential; only the API key is encrypted here.
  //
  // The test probe targets RunPod's REST API (the same key authorizes
  // both the management API and the per-endpoint OpenAI-compatible
  // chat completions). 200 = key is valid. Other statuses surface
  // through the safeErrorPrefix.
  noralai_brooklyn: {
    id: "noralai_brooklyn",
    category: "llm",
    credentialType: "api_key",
    displayName: "Brooklyn LLM (NORALAI)",
    description:
      "API key for the NORALAI-managed Brooklyn LLM endpoint. Assigned per-company; consumed by the noralai_brooklyn adapter when an agent is configured to run on Brooklyn.",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        inputType: "secret",
        required: true,
        helpText:
          "Provided by NORALAI operations. NoralOS only ever stores this encrypted; admins never see the value back. The same key authorizes both the management API (for credential testing) and the chat-completion endpoint at execute time.",
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      url: "https://rest.runpod.io/v1/endpoints",
      headers: { Authorization: "Bearer {{apiKey}}" },
      okStatuses: [200],
      safeErrorPrefix: "Brooklyn LLM provider rejected the key",
    },
    assignableSlots: [
      {
        pluginKey: "noralai.brooklyn",
        configPath: "apiKeyRef",
        label: "Brooklyn LLM — API key",
      },
    ],
  },
};

export type IntegrationProviderId = keyof typeof INTEGRATION_PROVIDERS;

/** Stable category ordering used by the credential list grouping. */
export const INTEGRATION_CATEGORY_ORDER: IntegrationCategory[] = [
  "llm",
  "voice",
  "telephony",
  "crm",
  "email_calendar",
  "webhook",
  "other",
];

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  llm: "AI Models",
  voice: "Voice",
  telephony: "Telephony",
  crm: "CRM",
  email_calendar: "Email & Calendar",
  webhook: "Webhooks",
  other: "Other",
};

/** Slots known to assignment UI in Phase 1. Extends to telephony etc. later. */
export const ASSIGNMENT_TARGETS: Array<{
  pluginKey: string;
  pluginDisplayName: string;
  slots: Array<{ configPath: string; label: string; expectsProvider: string }>;
}> = [
  {
    pluginKey: "noralos.voice-cascade",
    pluginDisplayName: "Voice Cascade",
    slots: [
      {
        configPath: "googleTtsApiKeyRef",
        label: "Google Cloud TTS",
        expectsProvider: "google_tts",
      },
      {
        configPath: "elevenLabsApiKeyRef",
        label: "ElevenLabs",
        expectsProvider: "elevenlabs",
      },
    ],
  },
  {
    pluginKey: "noralai.brooklyn",
    pluginDisplayName: "Brooklyn LLM",
    slots: [
      {
        configPath: "apiKeyRef",
        label: "Brooklyn LLM — API key",
        expectsProvider: "noralai_brooklyn",
      },
    ],
  },
];

/**
 * Wire DTO returned by the credentials API. NEVER includes the secret
 * value, the underlying secret_id, or the secret version.
 */
export interface IntegrationCredentialDto {
  id: string;
  provider: string;
  category: IntegrationCategory;
  credentialType: IntegrationCredentialType;
  displayName: string;
  description: string | null;
  environment: IntegrationEnvironment;
  status: IntegrationStatus;
  /** Last 4 chars only, prefixed with `****`. */
  maskedSuffix: string;
  lastTestedAt: string | null;
  lastTestStatus: IntegrationLastTestStatus | null;
  lastTestError: string | null;
  rotationNotes: string | null;
  metadata: Record<string, unknown>;
  /** True when an encrypted secret version exists. */
  hasMaterial: boolean;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  assignments: IntegrationAssignmentDto[];
}

export interface IntegrationAssignmentDto {
  id: string;
  credentialId: string;
  targetKind: "plugin_config";
  targetPluginId: string;
  targetPluginKey: string;
  targetPluginDisplayName: string | null;
  targetConfigPath: string;
  targetSlotLabel: string;
  assignedAt: string;
}

/** Returned by `GET /companies/:companyId/integrations/unmanaged-secrets`. */
export interface UnmanagedSecretDto {
  /** Underlying `company_secrets` row id (owned by the existing secret store). */
  secretId: string;
  /** Existing `company_secrets.name`. */
  name: string;
  description: string | null;
  /** Best-guess provider/category from the name; UI overrides this on import. */
  suggestedProvider: string | null;
  suggestedCategory: IntegrationCategory | null;
  createdAt: string;
}

export interface ImportUnmanagedSecretInput {
  secretId: string;
  provider: string;
  displayName: string;
  environment: IntegrationEnvironment;
  category: IntegrationCategory;
  credentialType: IntegrationCredentialType;
  description?: string;
}

export interface IntegrationProviderTestResult {
  ok: boolean;
  statusCode: number;
  safeMessage: string;
}
