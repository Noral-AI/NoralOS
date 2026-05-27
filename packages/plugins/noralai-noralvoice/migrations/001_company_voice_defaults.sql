-- Phase 6 PR-4b followup: per-company voice defaults table.
--
-- Schema name is derived by the host as `plugin_<slug>_<10-char sha256(pluginId)>`.
-- The migration runner doesn't set search_path or substitute identifiers, so
-- the schema name is hardcoded. If the plugin id or namespaceSlug changes,
-- recompute via `derivePluginDatabaseNamespace` (server/src/services/plugin-database.ts:30).
--
--   plugin id        = noralai-noralvoice
--   namespace slug   = noralvoice
--   schema           = plugin_noralvoice_8b794bc53d
--
-- Departures from voice-config's legacy table:
--   - drop default_provider               -- NV picks per-agent via agents.voice_agent_uuid
--   - drop default_conference_room_enabled  -- Conference Room removed in #105
--   - keep dashboard / slack / phone / tts_replies -- the live surfaces
--
-- No cross-schema backfill from voice-config here. The plugin SQL validator
-- forbids out-of-namespace references and DO blocks; a follow-up server-side
-- script (or a manual one-shot INSERT under the host's full permissions) can
-- copy historical defaults if needed. Most companies relied on the shipped
-- defaults anyway, so an empty table is a safe starting point.

CREATE TABLE plugin_noralvoice_8b794bc53d.company_voice_defaults (
  company_id                       uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_dashboard_voice_enabled  boolean NOT NULL DEFAULT true,
  default_slack_voice_enabled      boolean NOT NULL DEFAULT false,
  default_phone_voice_enabled      boolean NOT NULL DEFAULT false,
  default_tts_replies_enabled      boolean NOT NULL DEFAULT true,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
