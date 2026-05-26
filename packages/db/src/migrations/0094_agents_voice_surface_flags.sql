-- Phase 6 PR-4: Migrate voice surface flags off voice-config and onto public.agents.
--
-- The voice-config plugin (noralos.voice-config) is being retired in this PR.
-- Its per-agent state moves to core columns on public.agents; its per-company
-- defaults move to a plugin-owned table inside noralai.noralvoice. Voice picker
-- state (provider + voice_id) is NOT migrated — NoralVoice owns that via
-- agents.voice_agent_uuid (added in #93).
--
-- New columns:
--   - surface_flags        jsonb     — keyed by surface name. Phase 6 drops
--                                       conference_room (Conference Room was
--                                       removed in #105); the three remaining
--                                       surfaces are dashboard / slack / phone.
--   - tier_override        text NULL — exec | manager | worker (CHECK below).
--   - visibility_override  text NULL — shown | hidden          (CHECK below).
--   - tts_replies_enabled  boolean   — opt-out switch for the per-agent
--                                       TTS-on-replies behaviour.
--
-- The `voice_enabled` concept is now derived: `voice_agent_uuid IS NOT NULL`.
-- We don't store it; readers compute it from voice_agent_uuid.
--
-- Backfill:
--   Cross-schema UPDATE pulls per-agent state from voice-config's
--   `agent_voice_config` table (still installed when this migration runs;
--   PR-4 marks it uninstalled at the bottom of this file). The
--   `conference_room` flag is intentionally dropped from the JSON.
--
-- Plugin uninstall (folded in from PR-3's TODO):
--   Both voice-cascade and voice-config plugins are flipped to status='uninstalled'.
--   Their schemas (plugin_voicecascade_*, plugin_voiceconfig_*) are NOT
--   dropped here — kept as a rollback snapshot. A follow-up PR drops them
--   after a soak.

ALTER TABLE "agents"
  ADD COLUMN "surface_flags" jsonb NOT NULL
    DEFAULT '{"dashboard": true, "slack": false, "phone": false}'::jsonb;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tier_override" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "visibility_override" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tts_replies_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "agents"
  ADD CONSTRAINT "agents_tier_override_check"
  CHECK ("tier_override" IS NULL OR "tier_override" IN ('exec', 'manager', 'worker'));
--> statement-breakpoint
ALTER TABLE "agents"
  ADD CONSTRAINT "agents_visibility_override_check"
  CHECK ("visibility_override" IS NULL OR "visibility_override" IN ('shown', 'hidden'));
--> statement-breakpoint

-- Backfill from voice-config, if the source table exists. Wrapped in DO so the
-- migration is idempotent across envs that may already have uninstalled
-- voice-config (e.g. fresh seeds or test fixtures that never installed it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace n WHERE n.nspname = 'plugin_voiceconfig_d9257ba961'
  ) THEN
    EXECUTE $sql$
      UPDATE public.agents a
      SET surface_flags = jsonb_build_object(
            'dashboard', avc.dashboard_voice_enabled,
            'slack',     avc.slack_voice_enabled,
            'phone',     avc.phone_voice_enabled
          ),
          tier_override = avc.tier_override,
          visibility_override = avc.visibility_override,
          tts_replies_enabled = avc.tts_replies_enabled
      FROM plugin_voiceconfig_d9257ba961.agent_voice_config avc
      WHERE a.id = avc.agent_id
    $sql$;
  END IF;
END
$$;
--> statement-breakpoint

-- Phase 6 PR-3 + PR-4 plugin uninstalls. Folded into this migration so
-- post-deploy DB cleanup isn't a separate operator step. The plugin loader
-- treats status='uninstalled' as "do not load on next boot"; the schemas
-- stay in place as a rollback snapshot.
UPDATE public.plugins
SET status = 'uninstalled', last_error = NULL
WHERE plugin_key IN ('noralos.voice-cascade', 'noralos.voice-config')
  AND status <> 'uninstalled';
