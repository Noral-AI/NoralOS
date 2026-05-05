-- Schema name is derived by the host as `plugin_<slug>_<10-char sha256(pluginId)>`.
-- The migration runner does not set search_path or template-substitute identifiers,
-- so the schema name is hardcoded.
--
-- pluginId        = "noralos.conference-room-bridge"
-- namespaceSlug   = "confroombridge"
-- schema name     = "plugin_confroombridge_e966e2f80c"
--
-- This table maps Pipecat-side session IDs to Paperclip AgentSession IDs and
-- tracks the active target agent + transport per session. paperclip_session_id
-- has no FK because agent_task_sessions is not in PLUGIN_DATABASE_CORE_READ_TABLES;
-- the bridge is responsible for cleanup on close/error.

CREATE TABLE plugin_confroombridge_e966e2f80c.conference_session_mappings (
  conference_session_id  text NOT NULL,
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  participant_id         text NULL,
  target_agent_id        uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  paperclip_session_id   uuid NOT NULL,
  transport              text NOT NULL CHECK (transport IN ('daily','websocket','livekit','twilio')),
  status                 text NOT NULL CHECK (status IN ('active','closed','errored')),
  latency_hint           text NULL CHECK (latency_hint IS NULL OR latency_hint IN ('interactive','thorough')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_run_id            uuid NULL,
  last_voice_provider    text NULL CHECK (last_voice_provider IS NULL OR last_voice_provider IN ('elevenlabs','google_tts')),
  last_voice_id          text NULL,
  PRIMARY KEY (company_id, conference_session_id)
);
