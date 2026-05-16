# NoralVoice ↔ NoralOS Overlap Map

**Audit date:** 2026-05-14
**NoralVoice HEAD:** `cc38e41` (worktree branch `claude/musing-sinoussi-be1dd9`, fork of `Noral-AI/NoralVoice` at `rebrand/noralvoice`)
**NoralOS HEAD:** `926a67a3` (`Noral-AI/NoralOS` canonical, branch `master`, 0/0 vs `origin/master`)

> Goal: catalogue every place the two products implement the same concept, with file references and a disposition (keep one / extract / deprecate / coexist). Companion to [integration-architecture.md](integration-architecture.md) which decides how the two products talk after consolidation.

---

## Disposition legend

- **REPLACE-LEFT** — kill the NoralOS implementation, route to NoralVoice
- **REPLACE-RIGHT** — kill the NoralVoice implementation, route to NoralOS
- **THIN-WRAP** — keep a thin proxy/cache layer, delegate logic to the canonical owner
- **COEXIST** — both stay; concepts are similar-named but materially different
- **EXTRACT** — pull a shared library out, both consume
- **DEDUPE-INSIDE** — duplication is internal to one product; the sibling is unaffected

---

## A. Voice runtime (the largest overlap surface)

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| A1 | TTS provider execution | 9 providers wired in [api/services/pipecat/service_factory.py](../../api/services/pipecat/service_factory.py): Cartesia, Deepgram, OpenAI, ElevenLabs, Rime, Sarvam, Speaches, Camb, Dograh. Phase 6 added one-shot HTTP endpoint `POST /api/v1/public/embed/synthesize` ([NoralVoice #10](https://github.com/Noral-AI/NoralVoice/pull/10)) with X-API-Key dual auth. | ~~2 providers in `packages/plugins/voice-cascade/`~~ — being retired in Phase 6 PR-3. Last consumer (Dashboard autoplay) migrated to NV in [NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106). | **IN-PROGRESS REPLACE-LEFT.** voice-cascade retires after PR-2 (#106) soaks for 1 week. Combined Phase 6 LOC delta ≥ -6400 (incl. #105). |
| A2 | STT provider execution | 9 providers (Deepgram, OpenAI, Cartesia, Sarvam, Speaches, AssemblyAI, Gladia, Speechmatics, Dograh) | None native. Conference Room (which used browser `webkitSpeechRecognition`) was removed in [#105](https://github.com/Noral-AI/NoralOS/pull/105). | **OBSOLETE for STT.** Browser STT was the only NoralOS STT surface; it's gone with Conference Room. |
| A3 | LLM provider execution | 8 providers (OpenAI, Groq, OpenRouter, Google, Azure, AWS Bedrock, Speaches, Dograh-MPS) registered in [api/services/configuration/registry.py:16](../../api/services/configuration/registry.py) | Native adapters in `server/src/adapters/` (claude-local, codex-local, openclaw-gateway, noralai_brooklyn — Qwen3 via RunPod) | **COEXIST.** Different jobs: NoralOS adapters drive worker agents over long-running sessions; NoralVoice LLM services drive single-call conversations. Both pull keys from the same `integration_credentials` once unified (see C1). |
| A4 | Pipecat runtime | Submodule `pipecat/` pinned to `dograh-hq/pipecat` ([.gitmodules:3](../../.gitmodules)); installed in `api/Dockerfile:22` | NOT bundled. ~~`packages/plugins/conference-room-bridge/`~~ removed in [#105](https://github.com/Noral-AI/NoralOS/pull/105). | **DONE.** NoralVoice's Pipecat is the only Pipecat. No NoralOS-side Pipecat dependency remains. |
| A5 | Per-agent voice config | Per-user defaults in `UserConfigurationModel.configuration` JSON ([api/db/models.py:74](../../api/db/models.py)) + per-workflow `model_overrides` resolved at run time | DB table `plugin_voiceconfig_d9257ba961.agent_voice_config` in voice-config plugin ([packages/plugins/voice-config/migrations/001_voice_config.sql:30](../../packages/plugins/voice-config/migrations/001_voice_config.sql)) — provider, voice_id, ttsRepliesEnabled, surface flags, tier override | **IN-PROGRESS REPLACE-LEFT.** Phase 6 PR-4 moves voice-config state into `agents.surface_flags` JSONB + `agents.tier_override` + a small `company_voice_defaults` table. voice-config plugin gets uninstalled. |
| A6 | ~~Conference Room glue~~ | ~~None (telephony + WebRTC embed widget are NoralVoice's job — `public_embed.py`, `webrtc_signaling.py`)~~ | ~~`packages/plugins/conference-room-bridge/`~~ — removed in [NoralOS #105](https://github.com/Noral-AI/NoralOS/pull/105) (merged `8f2b9076`, ~-3900 LOC). Had zero production callers; only 2 test files referenced it. | **DONE.** Conference Room had no production reach. Surface fully retired. |
| A7 | Telephony providers | 7 fully registered: Twilio, Telnyx, Plivo, Vonage, Cloudonix, Vobiz, ARI — [api/services/telephony/providers/](../../api/services/telephony/providers/) | One on an **unmerged branch**: `feat/twilio-plugin-foundation` (referenced in [packages/shared/src/integration-providers.ts:285-288](../../packages/shared/src/integration-providers.ts)) | **REPLACE-LEFT.** Do not merge the NoralOS Twilio plugin. Telephony provider registry stays in NoralVoice. Phone numbers (`telephony_phone_numbers`) and inbound-workflow binding are NoralVoice-only concepts. |
| A8 | Voice / TTS credentials | Stored on `user_configurations.configuration` JSON (per user, plaintext JSON column) + `external_credentials` (for webhook auth) | Stored via `integration_credentials` → `company_secrets` → `company_secret_versions` (encrypted at rest, master-key-protected) | **REPLACE-RIGHT** in the long term — NoralVoice should move secrets to encrypted storage. Short-term: keep both. When NoralOS plugin is the caller, NoralOS encrypts; NoralVoice receives plaintext at request time (or upstream the encrypted-store pattern into NoralVoice in a later phase). |

---

## B. Agent identity & ontology

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| B1 | "Agent" term | UI says "Voice Agents" / "Active Agents" / "Agent Runs". DB and URL say `workflow` / `workflow_runs`. SDK exports `Workflow` class. | UI says "Agent" everywhere. DB table `agents`. Adapter-driven autonomous worker. | **COEXIST with naming discipline.** NoralOS = **Worker Agent**, NoralVoice = **Voice Agent**. Pick prefixes and apply across UI + docs. See [uiux-streamlining.md §3](uiux-streamlining.md). |
| B2 | Agent identity object | `WorkflowModel` ([api/db/models.py:353](../../api/db/models.py)) — workflow_uuid, organization_id, name, status, JSON definition, released_definition_id | `agents` table ([packages/db/src/schema/agents.ts:15](../../packages/db/src/schema/agents.ts)) — companyId, name, role, status, adapterType, adapterConfig, reportsTo (self-FK), permissions | **COEXIST + LINK.** Add `voice_agent_uuid` column on NoralOS `agents` (nullable FK → NoralVoice workflow). Bidirectional reverse is optional (NoralVoice doesn't usually need to know it's a Worker Agent). |
| B3 | Agent tier | None — no tier concept at all | Derived per-plugin: `voice-config` has `exec/manager/worker` derived from `agents.role`; NoralSign hardcodes `{ceo, cto, cmo, cfo}` in [noralai-noralsign/src/worker.ts:71](../../packages/plugins/noralai-noralsign/src/worker.ts) | **DEDUPE-INSIDE NoralOS.** Promote to first-class `agents.tier` column or settle on derived-from-role with a single helper. Not a cross-product concern, but a cross-plugin concern in NoralOS. |
| B4 | Agent runtime | Pipecat subprocess per WorkflowRun, transient — handles one call then exits | Long-running heartbeat-driven loop ([server/src/services/heartbeat.ts](../../server/src/services/heartbeat.ts) 7952 LOC) — agent wakes on assignments/timers/on_demand, executes via adapter, persists state | **COEXIST.** Fundamentally different runtimes. Bridge via tool calls: NoralOS agent invokes `noralvoice:run_call` tool → NoralVoice runs a workflow → posts result back via webhook → NoralOS agent wakes up with the result. |

---

## C. Credentials, integrations, secrets

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| C1 | "Integration credentials" registry | **Five unrelated paths** for storing third-party credentials: `api_keys` (own platform), `external_credentials` (webhook auth), `integrations` (Nango OAuth — Slack/Sheets/Gmail), `user_configurations.configuration` (LLM/TTS/STT keys), `telephony_configurations.credentials` (per-org per-provider JSON) | **One unified path**: `integration_credentials` → `company_secrets` → `company_secret_versions` (PR #46, [server/src/routes/integrations.ts](../../server/src/routes/integrations.ts)). Encrypted at rest, masked suffix display, OAuth refresh-token support, assignment to plugin config slots via shallow-merge | **REPLACE-RIGHT then DEDUPE-INSIDE.** NoralOS's model is materially cleaner. Long-term: NoralVoice adopts the same model (encrypted column store + provider registry). Short-term: NoralVoice keeps 5 paths but the **plugin** consolidates the UX so users see one settings surface per credential class. See [uiux-streamlining.md §1](uiux-streamlining.md). |
| C2 | OAuth handshake | Nango-backed for 3 providers (Slack/Sheets/Gmail) — [api/services/integrations/nango.py](../../api/services/integrations/nango.py) | First-party OAuth at [server/src/routes/integrations-oauth.ts](../../server/src/routes/integrations-oauth.ts) — refresh-token-only, validated state, stored in `company_secrets` | **REPLACE-RIGHT** for any future OAuth providers in NoralVoice. NoralOS's OAuth path is the survivor pattern. Existing Nango connections stay alive until rebuilt. |
| C3 | API-key-style platform credentials | `api_keys` table ([api/db/models.py:126](../../api/db/models.py)) + UI at `/api-keys` — Bearer/X-API-Key for calling NoralVoice's own API | `board_api_keys` + `agent_api_keys` ([packages/db/src/schema/](../../packages/db/src/schema/)) — Bearer for calling NoralOS as board or agent | **COEXIST.** Different audiences. NoralOS plugin holds **one NoralVoice API key per company** as a `company-secret` ref. NoralVoice never sees a NoralOS token. |
| C4 | MPS / cloud LLM keys | `/user/service-keys` proxies to **`https://services.dograh.com`** ([api/routes/service_keys.py](../../api/routes/service_keys.py)) for issuing managed LLM/TTS/STT keys | None | **REPLACE-LEFT or REMOVE-FOR-STANDALONE.** MPS is a Dograh cloud dependency that conflicts with "NoralVoice standalone." Either make MPS fully optional (no-MPS graceful path) or migrate the same managed-key pattern to a Noral-owned issuer. Open question. |
| C5 | Webhook outbound credentials | `external_credentials` table ([api/db/models.py:896](../../api/db/models.py)) — credential_uuid per workflow webhook node (api_key, bearer_token, basic_auth, custom_header). **No UI**. | Routine triggers can reference `companySecrets.id` for HMAC signing keys ([packages/db/src/schema/routines.ts](../../packages/db/src/schema/routines.ts)) | **COEXIST.** Different use cases (per-call outbound vs per-trigger inbound signature). Could be unified under one secrets vault later but not pressing. |

---

## D. Auth & tenancy

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| D1 | User identity | `UserModel` ([api/db/models.py:54](../../api/db/models.py)) with `provider_id` from Stack-Auth or local-bcrypt path; selected_organization_id pointer | better-auth `user` + `session` + `account` + `verification` tables; instance_admin flag; CLI device-auth | **COEXIST + SSO BRIDGE.** Both have local-trusted and cloud-auth modes. NoralOS issues an opaque token for the NoralVoice plugin to use as `X-API-Key`. End-users get SSO at the NoralOS layer; NoralVoice's auth becomes service-to-service. |
| D2 | Org / tenant | `OrganizationModel` ([api/db/models.py:83](../../api/db/models.py)) — many-to-many users via `organization_users`; quota fields per org | `companies` table — per-company memberships with roles (owner / admin / operator / viewer / member); `instance_admin` at instance level | **COEXIST + MAP.** Each NoralOS company gets a NoralVoice organization (1:1). Plugin instanceConfig stores the NoralVoice org's API key. Naming: prefer "Company" in unified UI (NoralOS already uses it). |
| D3 | Roles / RBAC | None — single `is_superuser` boolean | Five-role membership + instance_admin + `assertBoard/Authenticated/CompanyAccess/CompanyAdmin` chain ([server/src/routes/authz.ts:1-104](../../server/src/routes/authz.ts)) | **REPLACE-RIGHT** in long term. NoralVoice gains nothing from inventing its own RBAC if all UI-driven access goes through NoralOS. Service-to-service path stays as a single API key. Open question. |
| D4 | Impersonation / superadmin | UI `/superadmin` + `/impersonate` route; backend `superuser.py`; **Stack-Auth-only** path; OSS mode silently broken | Local-trusted mode synthesizes a board admin actor for every request — `actor.source === "local_implicit"` short-circuits all checks ([server/src/middleware/auth.ts:25-32](../../server/src/middleware/auth.ts)) | **REPLACE-RIGHT.** NoralVoice's broken local impersonation gets fixed or removed. NoralOS's pattern (deployment-mode-aware) is the model. |
| D5 | Cross-tenant isolation | Every DB client filter on `user.selected_organization_id` (manual, per query); CORS `allow_origins=["*"]` with `allow_credentials=True` ([api/app.py:88](../../api/app.py)) | `assertCompanyAccess(req, companyId)` gates every route; agent JWTs/keys bound to companyId | **DEDUPE-INSIDE NoralVoice.** NoralOS's pattern is cleaner. NoralVoice already enforces — but per-query filtering is error-prone and CORS is a real issue. See [open-questions.md #4](open-questions.md). |

---

## E. Tools, plugins, extensibility

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| E1 | "Tools" registry | `tools` table ([api/db/models.py:968](../../api/db/models.py)) + UI at `/tools` — HTTP-API tools attached to workflow Agent nodes | Plugin-registered agent tools via `ctx.tools.register(name, decl, executor)` — host dispatches LLM tool calls to plugin worker over JSON-RPC ([packages/plugins/sdk/src/types.ts:730](../../packages/plugins/sdk/src/types.ts)) | **COEXIST.** Different paradigms. NoralOS plugin's `noralvoice:*` tools (the new ones we'll add) wrap NoralVoice's API calls; NoralVoice's `tools` stay attached to its conversational workflow graph. |
| E2 | MCP server | Already exists at `/api/v1/mcp` ([api/mcp_server/](../../api/mcp_server/)) — FastMCP, X-API-Key auth, exposes 10 workflow/tool/document/credential/recording tools | None native | **COEXIST.** NoralVoice's MCP is for external LLMs / Claude Desktop. The new NoralOS plugin can ALSO speak to it, but the cleaner production path is the typed SDK (see [integration-architecture.md](integration-architecture.md) §3). |
| E3 | Plugin system | None | First-class plugin SDK ([packages/plugins/sdk/](../../packages/plugins/sdk/)) — 12 UI slot types, capabilities (51 enum values), apiRoutes, webhooks, tools, jobs, secret refs, per-plugin DB schemas, manifest validation, capability validator at install + at every RPC | **COEXIST.** NoralVoice has no plugins because its surface is narrower. NoralOS plugin is the integration vehicle. |
| E4 | SDK | `dograh-sdk` Python + `@dograh/sdk` TS both at v0.1.5 ([sdk/](../../sdk/)) — spec-driven, fetch NodeSpec catalog at session start, validate every `add()` call | Not published externally | **EXTRACT.** Rename to `noralvoice-sdk` / `@noralai/voice-sdk`. The TS SDK is exactly what the NoralOS plugin imports. Major rebrand surface but mechanical. |
| E5 | Webhook receivers | Nango webhook + per-telephony-provider routes (Twilio status, Telnyx events, etc.) | Plugin `webhooks[]` manifest entries + `POST /api/plugins/:id/webhooks/:endpointKey` ([server/src/routes/plugins.ts](../../server/src/routes/plugins.ts)) | **COEXIST.** Different webhook origins. The NoralOS plugin's webhooks receive NoralVoice events (call-completed, workflow-run-finished) and re-emit on the NoralOS event bus. |

---

## F. Knowledge base & files

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| F1 | Document storage | `knowledge_base_documents` + `knowledge_base_chunks` ([api/db/models.py:1049-1213](../../api/db/models.py)) — full text + pgvector(1536) embeddings + ivfflat index | None | **NoralVoice owns.** No duplication. NoralOS plugin exposes search-only tool. |
| F2 | File / asset storage | `WorkflowRecordingModel` + `EmbedSessionModel` + KB docs — backed by `api/services/filesystem/` (local/minio/s3/null backends) | `assets` + `documents` tables, attached to issues/comments; local-disk fallback + S3 provider ([server/src/storage/](../../server/src/storage/)) | **COEXIST.** Different domains (call recordings/transcripts vs issue attachments). Could share an S3 bucket prefix scheme but not pressing. |

---

## G. Cost, billing, usage

| # | Concept | NoralVoice | NoralOS | Disposition |
|---|---|---|---|---|
| G1 | Per-event cost tracking | `WorkflowRunModel.cost_info` JSON ([api/db/models.py:437](../../api/db/models.py)) + `api/services/pricing/cost_calculator.py` per call | `cost_events` table ([packages/db/src/schema/cost_events.ts](../../packages/db/src/schema/cost_events.ts)) — per-LLM-call with tokens, model, provider, biller, FKs to issueId/projectId/goalId/heartbeatRunId | **MERGE-VIEW.** Don't unify the schemas (different cost shapes — telephony per-minute + STT/TTS + LLM vs LLM token rollups). DO unify the dashboard: NoralOS Costs page consumes NoralVoice cost events via plugin and merges into `cost_events` for display, or shows side-by-side. |
| G2 | Quota / budget windows | `organization_usage_cycles` ([api/db/models.py:585](../../api/db/models.py)) — period-bounded Dograh-token + duration + USD windows | `budget_policies`, `budget_incidents`, window-spend endpoints ([server/src/routes/costs.ts](../../server/src/routes/costs.ts)) | **COEXIST.** Different abstractions (NoralVoice = token quotas, NoralOS = $-windows + incident escalation). Plugin reads both. |

---

## H. Internal duplications (single-product, but worth flagging)

### NoralVoice — within itself

| # | Concept | Detail | Disposition |
|---|---|---|---|
| H-NV-1 | 5+ settings UI surfaces | `/api-keys` (mixes 2 unrelated key systems), `/integrations` (no nav link), `/model-configurations`, `/telephony-configurations`, `/credentials` (no UI), `/settings`, `/turn` ephemeral | **DEDUPE-INSIDE.** Consolidate to one `/settings` with tabs. See [uiux-streamlining.md §1](uiux-streamlining.md). |
| H-NV-2 | Three Alembic heads | `6499c608d0f6_add_campaign_logs_column.py`, `cdcf9f65913b_add_workflow_uuid.py`, `f2e1d0c9b8a7_add_plivo_mode.py` — none merged | **DEDUPE-INSIDE.** Add a merge migration. Structural bug. |
| H-NV-3 | Dead pages | `/automation` (stub no nav), `/looptalk` root (stub but `/looptalk/[id]` works), `/integrations` (works no nav), `/impersonate` (Stack-only, broken local), `/superadmin` (no nav) | **DEDUPE-INSIDE.** Delete or ship; pick one per page. |
| H-NV-4 | Terminology mismatch | "Agent" in UI, "Workflow" in DB/URL/SDK | **DEDUPE-INSIDE.** Pick one for public, alias internally. |
| H-NV-5 | Dograh-brand leftovers | `<title>Dograh</title>`, sidebar logo, `dograh_auth_token` cookie, `window.DograhWidget`, `dograh-sdk` package name, MCP server name, env var prefixes, `app.dograh.com` server URL, `docs.dograh.com` links throughout | **DEDUPE-INSIDE.** Tokenize via theme/branding system. See [migration-plan.md Phase 0](migration-plan.md). |
| H-NV-6 | Unauthenticated `agent_stream` WS | `WS /api/v1/agent-stream/{workflow_uuid}` ([api/routes/agent_stream.py:31](../../api/routes/agent_stream.py)) — workflow UUID is the only identifier | **DEDUPE-INSIDE / SECURITY.** Either add API-key auth or document UUID-as-capability-token. Flag for security review. |
| H-NV-7 | CORS `allow_origins=["*"]` + `allow_credentials=True` | [api/app.py:88](../../api/app.py) — rejected by most browsers; meaningless config | **DEDUPE-INSIDE / SECURITY.** Pin to known origins. |

### NoralOS — within itself

| # | Concept | Detail | Disposition |
|---|---|---|---|
| H-NO-1 | Three-plugin voice split | ORIGINAL: `voice-config` (state, 851 LOC) + `voice-cascade` (TTS, 1334 LOC) + `conference-room-bridge` (Pipecat glue, 1947 LOC) — 4132 LOC across three plugins. NOW: `conference-room-bridge` removed in [#105](https://github.com/Noral-AI/NoralOS/pull/105); `voice-cascade` retiring in Phase 6 PR-3 after PR-2 ([#106](https://github.com/Noral-AI/NoralOS/pull/106)) soaks; `voice-config` retiring in Phase 6 PR-4. | **IN-PROGRESS DEDUPE-INSIDE.** End state: one `noralai.noralvoice` plugin owns all NoralOS-side voice integration. Total Phase 6 LOC delta ≥ -6400 (3900 + 1500 + 1000). |
| H-NO-2 | Adapter manager mounted twice | `/instance/settings/adapters` (instance) + `/:prefix/instance/settings/adapters` (in-company scope) — same component | **DEDUPE-INSIDE.** Remove the company-scope mount; sidebar links to instance-scoped page. |
| H-NO-3 | `/dashboard/live` near-duplicates dashboard | Just shows `ActiveAgentsPanel` with data already on `/dashboard` | **DEDUPE-INSIDE.** Either expand into a real live-ops surface or delete. |
| H-NO-4 | Paperclip-brand leftovers | `__paperclipPluginBridge__` global; localStorage keys `paperclip.*`; JWT issuer/audience `paperclip`/`paperclip-api`; default home `~/.paperclip`; S3 default bucket `paperclip`; embedded-postgres password `paperclip`; volume name `paperclip-data` (intentional for migration safety); `server/package.json` repo URL points at `paperclipai/paperclip` | **DEDUPE-INSIDE.** Some intentional (data volume), most accidental. Rebrand wave is in progress (see recent commit `926a67a3 fix(noralai-brooklyn): finish NoralAI rename`). |
| H-NO-5 | NoralSign single-tenant webhook fan-out TODO | Cross-tenant event emit deferred to "milestone 1D" — [noralai-noralsign/src/worker.ts:567-572](../../packages/plugins/noralai-noralsign/src/worker.ts) | **DEDUPE-INSIDE.** Tracking, not blocking. The new noralvoice plugin should emit per-company directly using `companyResolution` from the API route. |
| H-NO-6 | Brooklyn naming collision | "Brooklyn" = (a) the CEO agent name by convention; (b) the LLM adapter plugin name (RunPod-hosted Qwen3-32B) — unrelated concepts | **DEDUPE-INSIDE.** Rename one. The adapter is the better candidate to rename (e.g. `noralai_llm`) since "Brooklyn the agent" is a customer-visible persona. Recent commit `926a67a3` already started this rename pass. |

---

## I. Surface-by-surface NoralVoice UI verdict

For every NoralVoice UI surface, decide: stays standalone, gets embedded in NoralOS via plugin, or both via a thin wrapper. Drives the table in [integration-architecture.md §6](integration-architecture.md) and the migration sequencing in [migration-plan.md](migration-plan.md).

| NoralVoice page | LOC | Standalone | NoralOS embed | Wrapper? | Notes |
|---|---|---|---|---|---|
| `/overview` | 115 | ✅ | ❌ | — | Welcome / starter page; NoralOS has its own dashboard |
| `/workflow` (list) | 145 | ✅ | ✅ (proxy via plugin) | apiRoutes pass-through | Plugin page slot lists voice agents inside NoralOS |
| `/workflow/create` | 253 | ✅ | partial | possibly iframe | Wizard could iframe; or a NoralOS-native "create voice agent" flow that POSTs to NoralVoice |
| `/workflow/:id` (editor) | 98 (loads RF) | ✅ | ✅ via iframe | yes — embedded iframe | React-Flow builder is NoralVoice-native; iframe inside NoralOS plugin page |
| `/workflow/:id/settings` | **1357** | ✅ | partial | reuse forms via SDK | Could be NoralOS-native settings page using same `@noralai/voice-sdk` types — but iframe is simpler at first |
| `/workflow/:id/runs` + `/run/:runId` | 20 + 355 | ✅ | ✅ (proxy) | apiRoutes pass-through | NoralOS plugin's Runs tab queries NoralVoice via plugin apiRoute |
| `/campaigns` (list/new/detail) | ~2100 total | ✅ | ✅ via iframe | iframe | Operator-heavy UX, NoralVoice-native makes sense |
| `/reports` | 317 | ✅ | partial | aggregate in NoralOS Costs | Mostly subsumed by NoralOS Costs page eventually |
| `/recordings` | 77 | ✅ | ✅ (proxy or iframe) | apiRoutes pass-through | List + download |
| `/files` (KB) | 94 | ✅ | ✅ via thin proxy | mirror UI inside NoralOS | "Knowledge Base" surface in NoralOS plugin; uploads still go to NoralVoice |
| `/tools` | 556 | ✅ | partial | unclear | NoralOS plugin has its own agent tools concept; NoralVoice tools attach to workflow Agent nodes. Keep separate. |
| `/usage` | 638 | ✅ | ✅ (data feeds NoralOS Costs) | data API only | NoralOS Costs page consumes |
| `/api-keys` | 729 | ✅ (operator) | ❌ | — | API key management stays in NoralVoice — different audience |
| `/integrations` (Nango) | 174 | ⚠️ orphan today | ❌ | replaced by NoralOS integrations | Either fix the nav link or kill; NoralOS-driven OAuth replaces |
| `/model-configurations` | 15 | ✅ | partial | absorbed into NoralOS integrations | Per-user LLM/TTS/STT key management. NoralOS plugin shows the configured providers in `/company/settings/integrations`. |
| `/telephony-configurations` | 345+434 | ✅ | partial | absorbed into NoralOS integrations | Per-org provider credentials become NoralOS `integration_credentials` entries; phone number management stays in NoralVoice (telephony-specific) |
| `/settings` (MCP+Langfuse) | 69 | ✅ | partial | data API only | Langfuse creds become NoralOS integration provider; MCP URL is informational |
| `/superadmin` + `/runs` | 768 | ✅ (broken local) | ❌ | — | Fix the local-mode breakage; not surfaced in NoralOS |
| `/looptalk/:id` | 127 | ✅ (dev) | ❌ | — | Agent-to-agent test sessions; dev tool |
| `/automation` | 39 | ❌ delete stub | — | — | Coming Soon placeholder, no nav, nothing wired |

---

## Headline counts

- **Strong overlap rows requiring action**: 14 (A1, A2, A4, A5, A6, A7, A8, C1, C2, C4, E4, G1, plus H-NV-1, H-NO-1) — A2, A4, A6 now **DONE** after Phase 6 retirements.
- **Coexist rows requiring naming/contract discipline**: 9 (A3, B1, B2, B4, C3, C5, D1, D2, E2, E3, E5)
- **Replace-left (NoralOS gives way)**: 6 — voice-cascade (in-flight, PR-3), NoralOS Twilio plugin, voice-config (in-flight, PR-4), `/dashboard/live`, duplicate adapter mount, ~~conference-room-bridge media path~~ (DONE — #105)
- **Replace-right (NoralVoice gives way)**: 4 — auth model, integration_credentials adoption, superadmin/impersonation pattern, OAuth handshake pattern
- **Internal NoralVoice dedupe items**: 7 (5+ settings, 3 Alembic heads, dead pages, terminology, Dograh brand, agent_stream auth, CORS)
- **Internal NoralOS dedupe items**: 6 (three-plugin voice split — Phase 6 in-flight, duplicate adapter mount, dashboard/live, paperclip leftovers, NoralSign cross-tenant TODO, Brooklyn naming collision)

Phase 6 in-flight target: ~-6400 LOC across the three NoralOS voice plugins (conference-room-bridge: ~-3900 done; voice-cascade: ~-1500; voice-config: ~-1000), netting one `noralai.noralvoice` plugin that delegates to NoralVoice for TTS via the new `POST /api/v1/public/embed/synthesize` endpoint.
