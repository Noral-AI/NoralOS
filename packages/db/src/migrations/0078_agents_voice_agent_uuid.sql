-- Phase 3: link a NoralOS agent to its NoralVoice workflow.
--
-- The two systems live in different databases, so this is a soft FK
-- (no REFERENCES clause). NoralVoice exposes workflow_uuid as a stable
-- 36-char string; we store it on the agent so the noralai.noralvoice
-- plugin can drive its voice surface without round-tripping through
-- a per-call lookup table.
--
-- Partial index: the vast majority of agents are non-voice today and
-- carry NULL here. Filter NULLs out of the index so we don't bloat
-- index size with no-op rows.
--
-- Phase 7 may promote this to an enforced FK once the schemas merge
-- (or once we add a periodic reconciliation job). Today it stays
-- nullable + soft.

ALTER TABLE "agents" ADD COLUMN "voice_agent_uuid" varchar(36);

CREATE INDEX "agents_voice_agent_uuid_idx"
  ON "agents" ("voice_agent_uuid")
  WHERE "voice_agent_uuid" IS NOT NULL;
