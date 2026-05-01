# NoralAI → NoralOS Migration Plan

Working spec for porting NoralAI / ClaudeClaw features onto a forked NoralOS install. Designed to be run as a series of Claude Code sessions on the VPS where NoralOS lives.

**Source repo:** `Noral-OS/` (current ClaudeClaw codebase)
**Target repo:** NoralOS fork on VPS (`paperclipai/paperclip` lineage)
**Execution:** Claude Code, one phase per session, commit between phases
**Owner:** Quentin

---

## Principles

1. **Port what's worth porting, retire what NoralOS already does.** NoralOS ships task management, cost tracking, agent state, governance, and a dashboard. Don't re-port any of those — migrate the data and delete the code.
2. **Adapter > rewrite.** Where NoralAI's logic is sound (voice pipeline, message classifier, exfiltration guard), wrap it behind a NoralOS-shaped interface rather than rebuilding.
3. **One phase, one commit, one rollback point.** Every phase ends in a working system. No multi-phase half-states on `main`.
4. **Heartbeats replace event loops.** ClaudeClaw runs on Telegram-driven event handlers. NoralOS runs on scheduled heartbeats + event triggers. Anything reactive in ClaudeClaw becomes either a NoralOS input adapter (event-triggered) or a heartbeat hook (periodic).

---

## Phase 0 — Recon (read-only, ~1 session)

**Goal:** map NoralOS's internal structure and replace every `<TBD>` in this document with real file paths.

**Tasks for Claude Code on the VPS:**

```
1. Run `tree -L 3 -I 'node_modules|dist|.git'` in the NoralOS fork root. Save output as NORALOS_TREE.md alongside this file.
2. Find and summarize:
   - The plugin / extension entry point (where custom code is registered)
   - The input adapter layer (where Telegram-style channels would hook in)
   - The skill loader (how ClawHub skills are fetched, validated, installed at runtime)
   - The agent runtime interface (heartbeat callback signature, state shape)
   - The memory subsystem (PARA file layout, where files live, how agents read/write)
   - The task / mission system (schema, lifecycle, API)
   - The cost / budget tracker (data model, where token usage lands)
   - The dashboard backend API (REST endpoints the React UI consumes)
   - The security scanner (the 7-threat-category check before skill install)
3. For each system above, write 3-5 lines: "lives at <path>, exposes <interface>, NoralAI's equivalent is <Noral-OS path>."
4. Update this MIGRATION.md, replacing every <TBD: ...> tag with the answer.
5. Commit: `chore(migration): recon — paperclip internal map`.
```

**Exit criteria:** every `<TBD: ...>` in this doc is filled in. No code changed yet.

---

## Phase 1 — Telegram input adapter (~1-2 sessions)

**Goal:** Telegram messages arrive at NoralOS and trigger the right agent. Voice/text/photo all work.

**What to port:**
- `Noral-OS/src/bot.ts` — message routing logic
- `Noral-OS/src/message-classifier.ts` — intent classification before dispatch
- Voice/photo/video handlers (the file-marker parser for `[SEND_FILE:...]` etc.)

**How:**

1. Build a NoralOS input adapter at `packages/plugins/<noral-telegram>/` (a NoralOS plugin scaffolded from `packages/plugins/create-noralos-plugin/`, using `@paperclipai/plugin-sdk`; integrates with the runtime adapter registry at `server/src/adapters/registry.ts` per `adapter-plugin.md`) that:
   - Receives Telegram updates via webhook (preferred) or polling
   - Runs the message classifier as middleware
   - Maps classifier output → NoralOS task assignment for the right agent
   - Handles voice messages by routing to the STT skill (Phase 2) before classifying
2. Port the `[SEND_FILE:...]` / `[SEND_PHOTO:...]` marker parser as an output filter — NoralOS agents return text, the filter strips markers and ships files via Telegram bot API.
3. Move `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` config into NoralOS's config layer at `server/src/config.ts` (loads JSON from `NORALOS_CONFIG=/noralos/instances/<id>/config.json` via `server/src/config-file.ts`; secret material via `server/src/services/secrets.ts` and the `secrets/` directory).

**Tests:**
- Send "/dashboard" → bot replies with link
- Send a text message → correct agent receives a task
- Send a voice message → STT transcribes → correct agent receives transcribed task
- Agent response containing `[SEND_FILE:/tmp/test.pdf|caption]` → file delivered, marker stripped from text

**Exit criteria:** Telegram traffic flows in/out of NoralOS-managed agents end-to-end.

---

## Phase 2 — Voice skills (TTS + STT) (~1 session)

**Goal:** any NoralOS agent can speak (ElevenLabs) or transcribe (Groq Whisper) at runtime via skill injection.

**Decision:** wrap as ClawHub-format skills, not native NoralOS plugins. Reason: per-agent voice config (comms agent has voice, ops agent silent) without code changes.

**What to port:**
- ElevenLabs integration code from `Noral-OS/src/` (locate via `grep -r ELEVENLABS_API_KEY`)
- Groq Whisper integration code (locate via `grep -r GROQ_API_KEY`)
- Voice transcription routing logic from `Noral-OS/src/bot.ts` voice handler

**How:**

1. Create two skills under `Noral-OS/skills/clawhub-imports/`:
   - `noralai-tts/` — SKILL.md + script that calls ElevenLabs, writes WAV/MP3 to `~/noralos-cache/tts/<task-id>.mp3`
   - `noralai-stt/` — SKILL.md + script that calls Groq Whisper on a given audio file, returns transcript text
2. Each skill follows the ClawHub SKILL.md frontmatter spec (name, slug, description, metadata.runtimeId, capabilities tags).
3. Register both skills in NoralOS's skill registry at `server/src/services/company-skills.ts` (DB-backed via the `companySkills` table; routes at `server/src/routes/company-skills.ts`; native source types: `github`, `skills_sh`, `url`, `local_path`, `catalog`). Adapter-side runtime sync into per-adapter skill homes (e.g. `~/.claude/skills/`) lives at `packages/adapters/<adapter>/src/server/skills.ts`.
4. Phase 1's input adapter calls the STT skill on inbound voice. Output filter calls the TTS skill when an agent's response should be voiced (per-agent flag in agent config).

**Tests:**
- Agent with `voice: true` returns text → user receives voice message in Telegram
- User sends voice → transcript reaches agent
- Agent with `voice: false` returns text → user receives text only

**Exit criteria:** voice round-trip works for at least one agent. ElevenLabs + Groq calls observable in NoralOS's cost dashboard.

---

## Phase 3 — Memory and consolidation (~2 sessions)

**Goal:** NoralAI's persistent memory survives the move. Either replace NoralOS's PARA layer or wrap it.

**Decision point:** evaluate during Phase 0 whether NoralOS's PARA file-based memory is sufficient for NoralAI's existing patterns (`memories` table, `conversation_log`, `token_usage`, salience scoring, semantic search via embeddings).

- **If PARA is sufficient:** export NoralAI's SQLite memories as Markdown into the appropriate PARA buckets, retire `Noral-OS/src/memory.ts` and friends.
- **If PARA is insufficient:** keep NoralAI's SQLite layer, expose it to NoralOS via a memory plugin at `packages/plugins/<noral-memory>/` (scaffolded from `packages/plugins/create-noralos-plugin/`, using `@paperclipai/plugin-sdk`). Recommended option — embeddings + salience scoring are non-trivial to recreate.

> **Phase 0 finding:** NoralOS does NOT ship a built-in PARA memory layer. Per `doc/memory-landscape.md`, NoralOS is a "control-plane memory surface" for plugin-provided memory providers. PARA is exposed as a single skill (`skills/para-memory-files/SKILL.md`) using `$AGENT_HOME/life/{projects,areas,resources,archives}/<entity>/{summary.md,items.yaml}`. The decision tree above should be re-read as **"use the para-memory-files skill as-is"** vs. **"build a memory plugin"** — there is no built-in PARA layer to keep, and no built-in alternative to wrap.

**What to port (insufficient case):**
- `Noral-OS/src/memory.ts`
- `Noral-OS/src/memory-ingest.ts`
- `Noral-OS/src/memory-consolidate.ts`
- `Noral-OS/src/embeddings.ts`
- `store/claudeclaw.db` schema and data

**How (insufficient case):**

1. Lift the four memory `.ts` files into a NoralOS plugin module.
2. Wire the consolidation runner into NoralOS's heartbeat — every N hours, call `memory-consolidate.ts` against the agent's recent activity.
3. Inject `[Memory context]` into agent prompts via NoralOS's prompt-augmentation hook at `server/src/services/agent-instructions.ts` (managed instruction bundles per agent; default templates seeded from `server/src/onboarding-assets/{ceo,default}/`; defaults loaded by `server/src/services/default-agent-instructions.ts`). Memory context is added to the agent's instruction bundle, not as a runtime output filter.
4. Migrate the SQLite DB. The `claudeclaw.db` file moves to `/noralos/instances/default/data/noralai.db` (NoralOS data root is `NORALOS_HOME=/noralos` per Dockerfile; default instance dir is `/noralos/instances/default/`). Same schema, same data.

**Tests:**
- New conversation → memory context block appears in prompt
- "Do you remember X?" with a known fact → agent recalls it
- Consolidation runs on heartbeat → log entry confirms

**Exit criteria:** memory recall across sessions works at least as well as on ClaudeClaw. No regression on the `convolife` / `checkpoint` commands.

---

## Phase 4 — Security and classification middleware (~1 session)

**Goal:** NoralOS benefits from NoralAI's existing exfiltration guard and message classifier.

**What to port:**
- `Noral-OS/src/exfiltration-guard.ts`
- `Noral-OS/src/message-classifier.ts` (already partly used in Phase 1; this phase adds it as global middleware)
- `Noral-OS/src/hooks.ts` (any pre-tool / pre-output hooks)

**How:**

1. Register the exfiltration guard as a NoralOS output filter at **(no native hook exists)**. The plugin SDK (`packages/plugins/sdk/src/index.ts`) exposes events, jobs, data registration, and state — but no `output_filter` / `response.filter` / `postProcess` slot. Three options, decide before implementing:
   - **(a)** Per-agent skill that wraps tool/output calls. Not enforced — the agent has to invoke it.
   - **(b)** Heartbeat post-processor that scans `heartbeatRunEvents` payloads after a run completes and redacts/quarantines before the event surfaces. Implementation goes in `server/src/services/heartbeat.ts` near `boundHeartbeatRunEventPayloadForStorage` (line ~829).
   - **(c)** Propose an upstream plugin hook (e.g. `events.beforeRunDeliver`) and contribute it; carry a small fork-side patch until it lands.

   Recommended: **(b)** for near-term Phase 4 timing.
2. Stack it with NoralOS's native approval gates — both layers active. NoralOS handles "this action requires approval"; NoralAI's guard handles "this output looks like data exfiltration."
3. Message classifier runs as Phase 1 middleware (already wired); promote any classifier-derived metadata (sentiment, urgency, intent) into NoralOS's task metadata for downstream use.

**Tests:**
- Agent attempts to output a credential pattern → exfiltration guard blocks
- Agent attempts a high-stakes action → NoralOS approval gate triggers
- Both pass cleanly when the output is benign

**Exit criteria:** zero regression in security posture. Both guard and approval gate active.

---

## Phase 5 — Data migration: mission tasks and cost (~1 session)

**Goal:** retire ClaudeClaw's task and cost code, migrate the historical data into NoralOS's native tables.

**What to migrate:**
- `mission_tasks` table → NoralOS's task table: `issues` (NoralOS vocabulary calls tasks "issues"). Service: `server/src/services/issues.ts`. Routes: `server/src/routes/issues.ts`. Companion tables: `issueApprovals`, `issueAttachments`, `issueComments`, `issueDocuments`, `issueLabels`, `issueRelations`, `issueReadStates`, `issueThreadInteractions`, `issueWorkProducts`, `issueInboxArchives`. Lifecycle statuses: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`.
- `token_usage` table → NoralOS's cost / budget tables: `costEvents` (per-event log) plus `budgets` (limits + tracking). Service: `server/src/services/costs.ts` + `server/src/services/budgets.ts`. Routes: `server/src/routes/costs.ts`. `costEvents` columns: `costCents`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `companyId`, `agentId`, `occurredAt`. Billing types: `metered_api`, `subscription_included`, `subscription_overage`.
- `sessions` table → NoralOS's session table (if shape matches; otherwise drop)

**How:**

1. Write a one-shot migration script `Noral-OS/scripts/migrate-to-noralos.ts`.
2. Map columns: `mission_tasks.assigned_agent` → NoralOS's `task.agentId`, `mission_tasks.title` → `task.title`, etc.
3. Run on a backup first. Verify counts, spot-check 10 random records.
4. Once verified, retire `dist/mission-cli.js` and the matching source. Update CLAUDE.md so any agent reference to mission-cli now uses NoralOS's CLI / API.

**Tests:**
- Historical task list visible in NoralOS dashboard
- `convolife` command (or its NoralOS equivalent) returns coherent token counts pulled from the migrated cost data
- No orphaned references to old CLI in any CLAUDE.md

**Exit criteria:** old data visible in new system. Old code paths removed.

---

## Phase 6 — Dashboard parity and extensions (~1-2 sessions, optional)

**Goal:** any custom dashboard panel from NoralAI's `dashboard.ts` that NoralOS lacks gets contributed upstream or added as a NoralOS extension.

**What to port:**
- `Noral-OS/src/dashboard.ts` and `dashboard-html.ts` — identify panels NoralOS's React UI doesn't have

**How:**

1. List NoralOS's existing dashboard panels (from Phase 0 recon).
2. Diff against NoralAI's panels. Likely gaps: memory drilldown, conversation log search, per-agent cost charts, exfiltration guard log.
3. For each gap: add a React component to NoralOS's dashboard at `ui/src/components/` (existing major panels: `IssuesList.tsx`, `IssueDetail.tsx`, `IssueChatThread.tsx`, `IssueRunLedger.tsx`, `Agents.tsx`, `CompanySettings.tsx`, `Routines.tsx`, `PluginSettings.tsx`, `AdapterManager.tsx`) and pages at `ui/src/pages/`. Backend endpoints at `server/src/routes/dashboard.ts` (currently a single `GET /companies/:companyId/dashboard` summary route) backed by `server/src/services/dashboard.ts`.
4. Either keep the additions in your fork or open a PR upstream — your call.

**Exit criteria:** dashboard parity. Anything NoralAI showed, NoralOS shows.

---

## Phase 7 — Cutover (~1 session)

**Goal:** flip Telegram traffic from ClaudeClaw to NoralOS with a rollback path.

**How:**

1. Stand up NoralOS alongside ClaudeClaw on the VPS, different ports.
2. Point a *staging* Telegram bot (different `TELEGRAM_BOT_TOKEN`) at NoralOS. Run for 1-2 days against your real workflows.
3. Once confidence is high: change DNS / webhook to flip the *production* bot to NoralOS. Keep ClaudeClaw running but idle for 48h as a hot rollback.
4. After 48h with no rollback events: stop ClaudeClaw's launchd services, archive `Noral-OS/` as `Noral-OS-archive/`, remove from launchd.

**Rollback plan:** flip the webhook back to ClaudeClaw's bot.ts. ClaudeClaw still has all its data (DB never moved, only copied for migration). Zero data loss.

**Exit criteria:** Telegram bot fully on NoralOS. ClaudeClaw retired but recoverable for 48h.

---

## Appendix A — NoralAI feature → source file map

For Claude Code's grep convenience.

| Feature | Primary files |
|---|---|
| Telegram bot | `Noral-OS/src/bot.ts` |
| Agent runtime | `Noral-OS/src/agent.ts` |
| Database | `Noral-OS/src/db.ts` (search), `store/claudeclaw.db` |
| Memory layer | `Noral-OS/src/memory.ts`, `memory-ingest.ts`, `memory-consolidate.ts` |
| Embeddings | `Noral-OS/src/embeddings.ts` |
| Message classifier | `Noral-OS/src/message-classifier.ts` |
| Exfiltration guard | `Noral-OS/src/exfiltration-guard.ts` |
| Cost / token tracking | `Noral-OS/src/cost-footer.ts`, `token_usage` table |
| Dashboard | `Noral-OS/src/dashboard.ts`, `dashboard-html.ts` |
| Hooks | `Noral-OS/src/hooks.ts` |
| Voice integration | grep `ELEVENLABS_API_KEY`, `GROQ_API_KEY` |
| Video / Gemini | `Noral-OS/src/gemini.ts` |
| Media | `Noral-OS/src/media.ts` |
| Schedule CLI | `Noral-OS/dist/schedule-cli.js` (compiled), source via grep |
| Mission CLI | `Noral-OS/dist/mission-cli.js` (compiled), source via grep |

---

## Appendix B — Risks and mitigations

| Risk | Mitigation |
|---|---|
| NoralOS's PARA memory model can't represent NoralAI's salience-scored, embedding-indexed memory cleanly | Phase 3 decision point: keep SQLite layer as a plugin |
| Heartbeat latency makes Telegram feel slow | Phase 1 input adapter triggers tasks via *event* (not heartbeat). Heartbeats only run scheduled/proactive work |
| Skill install scanner rejects custom voice skills | Sign / whitelist your own publisher key in NoralOS config |
| ClawHub runtime injection fails inside NoralOS | Skills can be installed locally without registry — use the `local_path` source type in the skill registry (`server/src/services/company-skills.ts`); content is stored in `companySkills.fileInventory` and synced into per-adapter homes (e.g. `~/.claude/skills/`, `~/.codex/skills/`, etc.) by `packages/adapters/<adapter>/src/server/skills.ts`. Top-level platform skills (NoralOS-bundled) live at `skills/` in the repo. |
| Token-usage data loses precision in migration | Run migration script on a copy first; spot-check; keep ClaudeClaw DB as cold backup forever |

---

## Appendix C — Per-session prompt template for Claude Code

Use as the kickoff prompt for each phase. Replace `<phase>` with the phase number.

```
Read /path/to/NORALOS_MIGRATION.md.

Execute Phase <phase> exactly as written. Do not skip the recon step from Phase 0.
Before writing any code, summarize:
  1. What you're about to change
  2. Which NoralOS files you'll touch
  3. Which NoralAI files you'll lift from
  4. The test plan for this phase

Wait for my "go" before touching files. Once approved, implement, run the tests, commit with the conventional message format from this doc.

If you hit any of the risks in Appendix B, stop and ask.
```

---

## Status tracker

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 — Recon | ☑ Done (2026-04-30) | _commit added by audit push_ | All 12 `<TBD>` tags above now filled. See companion `NORALOS_AUDIT.md` for full report and `NORALOS_NEXT_SESSION.md` for follow-on work. |
| Pre-1 — Rebrand to NoralOS | ☐ Not started | | Decided 2026-04-30: Maximum-tier rebrand (everything except LICENSE copyright). Phased PRs. Must rebase onto `upstream/master` before starting (fork is currently 13 behind). |
| 1 — Telegram adapter | ☐ Not started | | Build as plugin under `packages/plugins/<noral-telegram>/`. |
| 2 — Voice skills | ☐ Not started | | |
| 3 — Memory | ☐ Not started | | Updated decision: there's no built-in PARA layer. Choose between (a) use `skills/para-memory-files` skill as-is, or (b) build a memory plugin at `packages/plugins/<noral-memory>/`. |
| 4 — Security middleware | ☐ Not started | | |
| 5 — Data migration | ☐ Not started | | |
| 6 — Dashboard parity | ☐ Not started | | Optional |
| 7 — Cutover | ☐ Not started | | Hold until 1-5 stable |
