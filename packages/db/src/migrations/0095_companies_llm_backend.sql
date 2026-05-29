-- Company-wide LLM backend switch.
--
-- Adds a single jsonb setting on `companies`. It is applied at agent EXECUTION
-- time (in the heartbeat) as an OVERRIDE and never mutates
-- agents.adapter_type / agents.adapter_config — so flipping back to "native"
-- is instant and lossless (agents return to their own stored adapter, e.g.
-- claude_local).
--
-- Shape:
--   { "mode": "native" | "deepseek_v4",
--     "model"?: string,            -- e.g. "deepseek/deepseek-v4-pro"
--     "credentialId"?: string,     -- integration credential holding the DeepSeek key
--     "updatedAt"?: string, "updatedByUserId"?: string|null }
--   - native      → each agent runs on its own configured adapter (default).
--   - deepseek_v4 → every agent is forced onto opencode_local + DeepSeek V4.
ALTER TABLE "companies"
  ADD COLUMN "llm_backend_settings" jsonb NOT NULL
    DEFAULT '{"mode":"native"}'::jsonb;
