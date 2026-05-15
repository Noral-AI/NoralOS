-- Phase 3 (consolidation): mark rows that have been pushed to NoralVoice.
--
-- The noralai.noralvoice plugin's `set_agent_voice` tool stamps this
-- column after a successful PATCH-equivalent to NoralVoice's workflow
-- settings. The Phase 3 data-migration script
-- (server/scripts/migrate-voice-config-to-noralvoice.ts) uses it as
-- the idempotency cursor: rows with NULL get migrated; rows with a
-- non-NULL timestamp are skipped.
--
-- voice-config remains the source of truth for the four surface flags
-- (dashboard/conference_room/slack/phone) and the tier/visibility
-- overrides — those don't map to NoralVoice's settings model and stay
-- here until Phase 6 retires this plugin.

ALTER TABLE plugin_voiceconfig_d9257ba961.agent_voice_config
  ADD COLUMN migrated_to_noralvoice_at timestamptz NULL;
