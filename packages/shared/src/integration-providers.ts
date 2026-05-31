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
  /**
   * Optional fixed list of allowed values. When present the UI renders a
   * select; otherwise a free-text/password input. `options[].value` is the
   * stored value; `options[].label` is the human-readable label.
   */
  options?: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * OAuth 2.0 metadata for a provider that uses the authorization-code flow.
 * When present, the credential is created in two steps: (1) admin submits
 * `clientId` + `clientSecret` via the standard create endpoint with
 * `oauthDraft: true`, which persists those values encrypted but does NOT
 * mark the credential `active`; (2) the admin is redirected to the
 * provider's authorize URL, and the platform callback exchanges the code
 * for a refresh token which is added to the same encrypted material.
 *
 * Templates use `{var}` placeholders. Supported substitutions:
 *   - `{clientId}` — from the credential's stored client id (non-secret metadata)
 *   - `{redirectUri}` — the platform's callback URL for this provider
 *   - `{scopes}` — space-joined `scopes` from this spec
 *   - `{state}` — the signed state JWT
 *   - `{<fieldKey>}` — any text-field value collected at create time (e.g. `{dataCenter}`)
 *
 * The token endpoint can also vary per-account (Zoho uses different
 * accounts servers per data center). `tokenUrlTemplate` may reference
 * `{accountsServer}` which is populated from the `accounts-server` query
 * parameter Zoho appends to the callback URL, falling back to the
 * `dataCenter`-derived default below.
 */
export interface IntegrationOAuthSpec {
  /** OAuth 2.0 authorize endpoint template. */
  authorizeUrlTemplate: string;
  /** OAuth 2.0 token endpoint template. */
  tokenUrlTemplate: string;
  /** Scope strings — joined with spaces and passed as `scope=`. */
  scopes: string[];
  /** Extra static parameters appended to the authorize URL (e.g. `access_type=offline`). */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * Token-response field whose value is stored in
   * `integration_credentials.metadata.apiDomain`. For Zoho this is
   * `api_domain`. Used at runtime to construct API base URLs without
   * hard-coding per-account regions.
   */
  apiDomainResponseField?: string;
  /**
   * Map from a text field's value (e.g. `dataCenter` = `"us"`) to the
   * default accounts-server URL used when the provider doesn't echo one
   * back on the callback. Keyed by `<fieldKey>:<fieldValue>`.
   */
  defaultAccountsServerByField?: Record<string, string>;
}

/** A plugin slot a credential can be assigned to. */
export interface IntegrationAssignableSlot {
  pluginKey: string;
  configPath: string;
  /** Human-friendly label for the assignment card. */
  label: string;
  /**
   * Optional. For multi-field providers, propagate selected non-secret
   * fields from `credential.metadata.fields` into the plugin's `configJson`
   * at the named paths, alongside the encrypted secret-ref written to
   * `configPath`.
   *
   * Use when a plugin's `instanceConfigSchema` requires more than just a
   * secret reference to function — e.g. NoralVoice needs `baseUrl` and
   * `organizationId` alongside `apiKeyRef`. Without this, the plugin
   * fails `instanceConfig` validation on first save and operators have
   * to hand-edit `plugin_config.config_json`.
   *
   * Credential metadata stores all non-secret values as strings.
   * `coerce` controls type conversion at the assignment-writer boundary
   * so the plugin's JSON-schema validation passes (e.g. an
   * `organizationId` field declared as `type: "integer"` in the manifest
   * gets `Number()`'d here).
   */
  pairedFields?: ReadonlyArray<{
    /** Field key on `credential.metadata.fields` (always string-valued). */
    sourceField: string;
    /** Destination key on the plugin's `configJson` (shallow). */
    targetConfigPath: string;
    /** Optional type coercion. Default: pass through as string. */
    coerce?: "integer" | "boolean";
  }>;
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
  /**
   * Optional HTTP Basic auth derivation. When set, the test runner computes
   * `base64(<userField>:<passField>)` from the submitted fields and exposes
   * the result as the `{{__basicAuth}}` placeholder so headers like
   * `Authorization: Basic {{__basicAuth}}` resolve without leaking either
   * half to logs. Use this for providers like Twilio whose REST API auth is
   * HTTP Basic over a key id + key secret pair.
   */
  basicAuth?: { userField: string; passField: string };
  /**
   * Optional fallback probes, tried in order only if the primary probe does
   * NOT return an ok status. The credential passes if the primary OR any
   * fallback probe returns an ok status. Use this for a single operator-facing
   * credential that may be valid against more than one upstream backend (e.g.
   * the NoralAI provider accepts a key for either its default backend or a
   * DeepSeek-backed agent). Each fallback is a self-contained probe, but the
   * caller-facing failure message always comes from the PRIMARY spec — a
   * fallback's upstream identity never leaks into operator-visible output.
   */
  fallbackProbes?: IntegrationTestSpec[];
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
  /**
   * Optional OAuth 2.0 flow metadata. When present, the credential is
   * provisioned through the platform's `/api/integrations/oauth/*` routes
   * instead of a single paste-the-token form.
   */
  oauth?: IntegrationOAuthSpec;
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
      "Google Cloud Text-to-Speech voices. Stored as a NoralOS credential; no assignment target today (NoralVoice manages its own TTS catalog).",
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
    assignableSlots: [],
  },
  elevenlabs: {
    id: "elevenlabs",
    category: "voice",
    credentialType: "api_key",
    displayName: "ElevenLabs",
    description:
      "ElevenLabs voices. Stored as a NoralOS credential; no assignment target today (NoralVoice manages its own TTS catalog).",
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
    assignableSlots: [],
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
  // through the safeErrorPrefix. A DeepSeek fallback probe (see
  // `fallbackProbes` below) lets a DeepSeek API key validate under the
  // same NoralAI credential — DeepSeek is supported as an upstream backend
  // behind the NoralAI brand, not as a separately-branded provider.
  noralai_brooklyn: {
    id: "noralai_brooklyn",
    category: "llm",
    credentialType: "api_key",
    displayName: "NoralAI",
    description:
      "API key for the NoralAI-hosted LLM endpoint. Assigned per-company; consumed by the noralai_brooklyn adapter when an agent is configured to run on NoralAI.",
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
      // A NoralAI credential may be a key for the default RunPod-backed
      // endpoint OR a DeepSeek API key (used when an agent points its
      // baseUrl at https://api.deepseek.com). Try the default probe first,
      // then fall back to DeepSeek's auth-gated balance endpoint so a valid
      // DeepSeek key validates too. On failure the operator still sees the
      // primary "Brooklyn LLM provider rejected the key" message — DeepSeek
      // is never named in operator-visible output.
      fallbackProbes: [
        {
          kind: "http",
          method: "GET",
          url: "https://api.deepseek.com/user/balance",
          headers: { Authorization: "Bearer {{apiKey}}" },
          okStatuses: [200],
          // Operator-facing prefix is unused for a fallback: the primary
          // probe's prefix is what surfaces on failure. Kept for shape.
          safeErrorPrefix: "DeepSeek rejected the key",
        },
      ],
    },
    assignableSlots: [
      {
        pluginKey: "noralai.brooklyn",
        configPath: "apiKeyRef",
        label: "Brooklyn LLM — API key",
      },
    ],
  },
  // ── NoralVoice ──────────────────────────────────────────────────
  // Phase 2 voice-runtime provider. The credential is an X-API-Key for a
  // NoralVoice deployment (default voice.noral.ai) bound to a specific
  // NoralVoice organization. The plugin worker
  // (`@noralos-plugins/noralai-noralvoice`) consumes this credential
  // through the standard ctx.secrets.resolve() path on every tool call;
  // the apiKeyRef in instanceConfig is populated by the assignment
  // pipeline below.
  //
  // Test probe: GET {{baseUrl}}/api/v1/health with X-API-Key. 200 means
  // the deployment is reachable AND the key is valid (the health route
  // is public, but invalid keys still get a 200 — so the test probe
  // mainly verifies reachability + that baseUrl is the right server.
  // A typo'd key surfaces at first tool call via NoralVoiceClientError
  // category=HTTP_4XX; that's an acceptable Phase 2 limit since the
  // health route is the only NoralVoice endpoint that doesn't need
  // X-API-Key today, and we don't want to make the test probe hit an
  // org-scoped endpoint that could side-effect on a misconfigured key).
  //
  // organizationId is an integer-valued text field (numeric input) so
  // the form keeps a normalised representation; the plugin parses it
  // at instanceConfig read time.
  noralvoice: {
    id: "noralvoice",
    category: "voice",
    credentialType: "api_key",
    displayName: "NoralVoice",
    description:
      "API key for a NoralVoice deployment (voice.noral.ai by default). Used by the noralai.noralvoice plugin to manage voice agents, place outbound calls, and review transcripts. Per-company; the assignment pipeline writes the encrypted reference into the plugin's instanceConfig.apiKeyRef on save.",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        inputType: "secret",
        required: true,
        helpText:
          "Mint a key under NoralVoice → Settings → API Keys. Bound to a single NoralVoice organization — the key's org binding must match `Organization ID` below. NoralOS stores this encrypted; admins never see the value back.",
      },
      {
        key: "baseUrl",
        label: "Base URL",
        inputType: "text",
        required: true,
        helpText:
          "Base URL of the NoralVoice deployment, e.g. `https://voice.noral.ai`. Override only if you run a dedicated NoralVoice cluster; the public deployment at voice.noral.ai is the default. No trailing slash.",
      },
      {
        key: "organizationId",
        label: "Organization ID",
        inputType: "text",
        required: true,
        helpText:
          "Numeric NoralVoice organization id this company maps to. Visible in the NoralVoice dashboard URL when an admin is in an org context (`/orgs/<id>/...`). Must match the org the API key was minted in — otherwise the plugin's tools 401 at runtime.",
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      // `/api/v1/health` is the canonical unauthenticated health
      // endpoint; we still send the X-API-Key header so a future
      // health-route hardening (e.g. requiring the key for org context)
      // doesn't silently break tests.
      urlTemplate: "{{baseUrl}}/api/v1/health",
      headers: { "X-API-Key": "{{apiKey}}" },
      okStatuses: [200],
      safeErrorPrefix: "NoralVoice rejected the credential or is unreachable",
    },
    assignableSlots: [
      {
        pluginKey: "noralai.noralvoice",
        configPath: "apiKeyRef",
        label: "NoralVoice — API key",
        // The NoralVoice plugin's instanceConfigSchema requires
        // `baseUrl` (string) and `organizationId` (integer) in addition
        // to the encrypted `apiKeyRef`. Propagate those from the
        // credential's non-secret fields so the assignment yields a
        // valid plugin config with no operator hand-editing.
        pairedFields: [
          { sourceField: "baseUrl", targetConfigPath: "baseUrl" },
          {
            sourceField: "organizationId",
            targetConfigPath: "organizationId",
            coerce: "integer",
          },
        ],
      },
    ],
  },

  // ── Twilio ──────────────────────────────────────────────────────
  // Telephony provider. NoralOS authenticates with a scoped API Key SID +
  // Secret (HTTP Basic), never the master Auth Token. The Account SID is
  // a public identifier carried in URL paths. The test probe hits the
  // account-info endpoint, which is the cheapest call that exercises
  // both auth and account access.
  twilio: {
    id: "twilio",
    category: "telephony",
    credentialType: "basic_auth",
    displayName: "Twilio",
    description:
      "Twilio voice + SMS. Uses a scoped API Key (SID + Secret) for HTTP Basic auth — the master Auth Token is never required. NoralOS encrypts the secret at rest; admins never see the value back after creation.",
    fields: [
      {
        key: "accountSid",
        label: "Account SID",
        inputType: "text",
        required: true,
        helpText:
          "Twilio Console → Account info. Starts with AC and is 34 chars. A public identifier — not a secret on its own — but pins the credential to a specific Twilio account.",
      },
      {
        key: "apiKeySid",
        label: "API Key SID",
        inputType: "text",
        required: true,
        helpText:
          "Twilio Console → Account → API keys & tokens → Create API key (Standard). Starts with SK and is 34 chars. The username half of HTTP Basic auth.",
      },
      {
        key: "apiKeySecret",
        label: "API Key Secret",
        inputType: "secret",
        required: true,
        helpText:
          "Shown exactly once on the API key creation screen — if you close that screen without copying it, delete the key and create a new one. NoralOS stores this encrypted.",
      },
      {
        key: "defaultFromNumber",
        label: "Default From Number",
        inputType: "text",
        required: false,
        helpText:
          "Optional. E.164 format, e.g. +14155552671. Used as the default sender for outbound SMS / voice when the calling agent doesn't specify one. Phone Numbers → Manage → Active numbers in the Twilio console.",
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      urlTemplate:
        "https://api.twilio.com/2010-04-01/Accounts/{{accountSid}}.json",
      headers: { Authorization: "Basic {{__basicAuth}}" },
      basicAuth: { userField: "apiKeySid", passField: "apiKeySecret" },
      okStatuses: [200],
      safeErrorPrefix: "Twilio rejected the credential",
    },
    // No assignable plugin slots yet — the Twilio plugin lives on an
    // unmerged branch (feat/twilio-plugin-foundation). The credential
    // can still be created, tested, and stored; assignments wire up
    // when the plugin lands.
    assignableSlots: [],
  },
  // ── Zoho CRM ────────────────────────────────────────────────────
  // First OAuth 2.0 (authorization-code + refresh-token) provider. The
  // admin supplies clientId, clientSecret, and dataCenter at create
  // time; the platform handles the redirect dance to mint a refresh
  // token. The api domain returned by Zoho on the callback is persisted
  // in `integration_credentials.metadata.apiDomain` and used by
  // downstream plugins to construct CRM API URLs.
  zoho: {
    // Provider id is the short `zoho` rather than `zoho_crm` because the
    // registered redirect URI in Zoho's API Console uses /oauth/zoho/
    // and the same OAuth app can carry scopes for CRM, Books, Desk, etc.
    // The displayName below distinguishes products to the operator.
    id: "zoho",
    category: "crm",
    credentialType: "oauth_refresh_token",
    displayName: "Zoho CRM",
    description:
      "Zoho CRM via OAuth 2.0. After saving the OAuth app's client id and secret, the platform redirects to Zoho for consent and persists the resulting refresh token. Access tokens are minted on demand.",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        inputType: "text",
        required: true,
        helpText:
          "From Zoho API Console → your Server-based app → Client ID. Not a secret on its own, but together with the client secret it authorizes token refresh.",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        inputType: "secret",
        required: true,
        helpText:
          "From Zoho API Console → your Server-based app → Client Secret. Stored encrypted; never displayed again.",
      },
      {
        key: "dataCenter",
        label: "Data Center",
        inputType: "text",
        required: true,
        helpText:
          "Pick the Zoho data center your CRM org lives in. This determines the accounts server used for the OAuth handshake.",
        options: [
          { value: "us", label: "United States (.com)" },
          { value: "eu", label: "Europe (.eu)" },
          { value: "in", label: "India (.in)" },
          { value: "au", label: "Australia (.com.au)" },
          { value: "jp", label: "Japan (.jp)" },
          { value: "ca", label: "Canada (.ca)" },
        ],
      },
    ],
    test: {
      kind: "http",
      method: "GET",
      // `{{apiDomain}}` is substituted from `metadata.apiDomain` and
      // `{{accessToken}}` is minted on demand by the OAuth-aware test
      // path. Zoho's auth header is `Zoho-oauthtoken <token>` — not the
      // standard `Bearer` scheme — so it's pinned here in the registry.
      urlTemplate: "{{apiDomain}}/crm/v7/users?type=CurrentUser",
      headers: { Authorization: "Zoho-oauthtoken {{accessToken}}" },
      okStatuses: [200],
      safeErrorPrefix: "Zoho CRM rejected the access token",
    },
    assignableSlots: [],
    oauth: {
      authorizeUrlTemplate:
        "https://accounts.zoho.{dataCenterTld}/oauth/v2/auth" +
        "?response_type=code" +
        "&client_id={clientId}" +
        "&scope={scopes}" +
        "&redirect_uri={redirectUri}" +
        "&state={state}" +
        "&access_type=offline" +
        "&prompt=consent",
      tokenUrlTemplate: "{accountsServer}/oauth/v2/token",
      scopes: [
        "ZohoCRM.modules.ALL",
        "ZohoCRM.settings.ALL",
        "ZohoCRM.users.READ",
      ],
      extraAuthorizeParams: {},
      apiDomainResponseField: "api_domain",
      defaultAccountsServerByField: {
        "dataCenter:us": "https://accounts.zoho.com",
        "dataCenter:eu": "https://accounts.zoho.eu",
        "dataCenter:in": "https://accounts.zoho.in",
        "dataCenter:au": "https://accounts.zoho.com.au",
        "dataCenter:jp": "https://accounts.zoho.jp",
        "dataCenter:ca": "https://accounts.zohocloud.ca",
      },
    },
  },
};

/** Maps Zoho `dataCenter` -> accounts-server TLD. Used by the authorize URL template. */
export const ZOHO_DATA_CENTER_TLD: Record<string, string> = {
  us: "com",
  eu: "eu",
  in: "in",
  au: "com.au",
  jp: "jp",
  ca: "zohocloud.ca",
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

/** Slots known to the assignment UI. Extended as new assignable plugins ship. */
export const ASSIGNMENT_TARGETS: Array<{
  pluginKey: string;
  pluginDisplayName: string;
  slots: Array<{ configPath: string; label: string; expectsProvider: string }>;
}> = [
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
  {
    pluginKey: "noralai.noralvoice",
    pluginDisplayName: "NoralVoice",
    slots: [
      {
        configPath: "apiKeyRef",
        label: "NoralVoice — API key",
        expectsProvider: "noralvoice",
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
  /**
   * When the linked secret last resolved successfully (`company_secrets.last_resolved_at`),
   * as an ISO string. `null` if it has never resolved or has no material.
   */
  lastResolvedAt: string | null;
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
