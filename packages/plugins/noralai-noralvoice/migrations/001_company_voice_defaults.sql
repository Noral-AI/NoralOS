-- Phase 6 PR-4b: per-company voice defaults move from the retired
-- voice-config plugin into noralai.noralvoice's own schema.
--
-- Schema name is derived by the host as `plugin_<slug>_<10-char sha256(pluginId)>`.
-- The migration runner doesn't set search_path or substitute identifiers, so
-- the schema name is hardcoded. If the plugin id or namespaceSlug changes,
-- recompute via `derivePluginDatabaseNamespace` (server/src/services/plugin-database.ts:30).
--
--   pluginId       = "noralai.noralvoice"
--   namespaceSlug  = "noralvoice"
--   schema name    = "plugin_noralvoice_8b794bc53d"
--
-- Departures from voice-config's `company_voice_defaults`:
--   - drop `default_provider`              — NoralVoice picks per-agent via
--                                             agents.voice_agent_uuid (Phase 3).
--   - drop `default_conference_room_enabled` — Conference Room removed in #105.
--   - keep dashboard/slack/phone + tts_replies — these are the live surfaces.

CREATE TABLE plugin_noralvoice_8b794bc53d.company_voice_defaults (
  company_id                       uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_dashboard_voice_enabled  boolean NOT NULL DEFAULT true,
  default_slack_voice_enabled      boolean NOT NULL DEFAULT false,
  default_phone_voice_enabled      boolean NOT NULL DEFAULT false,
  default_tts_replies_enabled      boolean NOT NULL DEFAULT true,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

-- Backfill from voice-config's company_voice_defaults if it still exists
-- (PR-4a flipped voice-config to status='uninstalled' but didn't drop the
-- data schema). Guarded so the migration is idempotent across envs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace n WHERE n.nspname = 'plugin_voiceconfig_d9257ba961'
  ) THEN
    EXECUTE $sql$
      INSERT INTO plugin_noralvoice_8b794bc53d.company_voice_defaults (
        company_id,
        default_dashboard_voice_enabled,
        default_slack_voice_enabled,
        default_phone_voice_enabled,
        default_tts_replies_enabled
      )
      SELECT
        cvd.company_id,
        cvd.default_dashboard_voice_enabled,
        cvd.default_slack_voice_enabled,
        cvd.default_phone_voice_enabled,
        cvd.default_tts_replies_enabled
      FROM plugin_voiceconfig_d9257ba961.company_voice_defaults cvd
      ON CONFLICT (company_id) DO NOTHING
    $sql$;
  END IF;
END
$$;
