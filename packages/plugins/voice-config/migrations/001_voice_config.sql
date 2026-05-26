-- Schema name is derived by the host as `plugin_<slug>_<10-char sha256(pluginId)>`.
-- The migration runner does not set search_path or template-substitute identifiers,
-- so the schema name is hardcoded. If the plugin id or namespaceSlug changes,
-- recompute via `derivePluginDatabaseNamespace` (server/src/services/plugin-database.ts:30).
--
-- pluginId        = "noralos.voice-config"
-- namespaceSlug   = "voiceconfig"
-- schema name     = "plugin_voiceconfig_d9257ba961"
--
-- Surface flags model: dashboard, conference_room, slack, phone.
-- Phone is vendor-neutral (Twilio / Telnyx / SignalWire / SIP); a future
-- channel plugin (e.g. @noralos-plugins/twilio-voice-channel) consumes the
-- phone_voice_enabled flag from voice-config without naming a specific vendor.

CREATE TABLE plugin_voiceconfig_d9257ba961.company_voice_defaults (
  company_id                       uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_provider                 text NOT NULL CHECK (default_provider IN ('elevenlabs', 'google_tts')),
  default_dashboard_voice_enabled  boolean NOT NULL DEFAULT true,
  default_conference_room_enabled  boolean NOT NULL DEFAULT true,
  default_slack_voice_enabled      boolean NOT NULL DEFAULT false,
  default_phone_voice_enabled      boolean NOT NULL DEFAULT false,
  default_tts_replies_enabled      boolean NOT NULL DEFAULT true,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_voiceconfig_d9257ba961.agent_voice_config (
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_id                uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,

  voice_enabled           boolean NOT NULL,

  provider                text NOT NULL CHECK (provider IN ('elevenlabs', 'google_tts', 'default')),
  voice_id                text NOT NULL DEFAULT '',

  dashboard_voice_enabled boolean NOT NULL,
  conference_room_enabled boolean NOT NULL,
  slack_voice_enabled     boolean NOT NULL,
  phone_voice_enabled     boolean NOT NULL,
  tts_replies_enabled     boolean NOT NULL,

  tier_override           text NULL CHECK (tier_override IS NULL OR tier_override IN ('exec', 'manager', 'worker')),
  visibility_override     text NULL CHECK (visibility_override IS NULL OR visibility_override IN ('shown', 'hidden')),

  -- Text not uuid: principal IDs come from either Better Auth users (text)
  -- or agents (uuid). Storing as text accommodates both forms.
  updated_by_principal_id text NULL,
  updated_by_kind         text NULL CHECK (updated_by_kind IS NULL OR updated_by_kind IN ('board', 'agent', 'plugin')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (company_id, agent_id)
);
