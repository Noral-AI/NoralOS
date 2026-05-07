-- Conference Room visibility controls.
--
-- Adds three explicit, admin-controllable fields on agent_voice_config so
-- the Conference Room can be the source of truth for which agents appear
-- to participants and which is the default target. Long-term replacement
-- for the implicit tier-not-equal-to-worker filter:
--
--   conference_room_visible          NULL means inherit (fallthrough rules);
--                                    true or false is an explicit override.
--   conference_room_role             host, director, hidden, or NULL.
--                                    NULL inherits from the visibility plus
--                                    derived-tier resolution rules.
--   conference_room_default_target   true marks this agent as the
--                                    Conference Room default target when
--                                    no explicit pin is provided.
--                                    A partial unique index guarantees at
--                                    most one default-target per company.
--
-- Comments avoid apostrophes because the plugin migration validator
-- strips quoted runs before checking for DDL keywords; an unbalanced
-- apostrophe in a comment can mangle the next quoted literal in the
-- statement and trip the DDL check.

ALTER TABLE plugin_voiceconfig_d9257ba961.agent_voice_config
  ADD COLUMN conference_room_visible boolean NULL;

ALTER TABLE plugin_voiceconfig_d9257ba961.agent_voice_config
  ADD COLUMN conference_room_role text NULL CHECK (
    conference_room_role IS NULL
    OR conference_room_role IN ('host', 'director', 'hidden')
  );

ALTER TABLE plugin_voiceconfig_d9257ba961.agent_voice_config
  ADD COLUMN conference_room_default_target boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX agent_voice_config_one_default_target_per_company
  ON plugin_voiceconfig_d9257ba961.agent_voice_config (company_id)
  WHERE conference_room_default_target = true;
