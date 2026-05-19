# Consolidation Plan (binding)

**Date:** 2026-05-15
**Supersedes:** [migration-plan.md](migration-plan.md). Read this one; keep the original for archaeology.
**Binding scope:** [consolidation-scope.md](consolidation-scope.md)

---

## Cardinal rule

`voice.noral.ai` standalone must pass the signup → build-workflow → place-test-call smoke at the **end of every phase**. If a phase requires NoralOS to be reachable for NoralVoice to work, that phase is wrong.

---

## Phase map at a glance

| # | Phase | Repo(s) | Weeks | Independently shippable | Risk |
|---|---|---|---|---|---|
| 0 | Foundation (NoralVoice) | NoralVoice | 1 | yes | low |
| 1 | Plugin scaffold + SDK rename + Voice Director template | both | 2 | yes | low |
| 2 | Credential consolidation via PR #46 | NoralOS | 1 | yes | low |
| 3 | Voice settings unification | both | 2 | yes | medium |
| 4 | Surfaces (board UI + iframed builder + Costs merge) | both | 2 | yes | medium |
| 5 | NoralVoice UI consolidation + brand purge + `noralos://` tool scheme | NoralVoice | 2 | yes | low |
| 6 | Conference Room re-route + uninstall 2 NoralOS plugins | both | 3 | yes | high |
| 7 | Full tool coverage + shared schemas | both | 2 | yes | low |
| 8 | MPS rename + standalone independence audit | NoralVoice | 1 | yes | low |

Total: **~16 weeks** core consolidation (Phases 0–6). Phases 7–8 can run in parallel with normal product work.

---

## Phase 0 — Foundation (NoralVoice only)

**Goal:** Substrate cleanup. Nothing in this phase touches NoralOS.

**Deliverables:**
1. Brand-tokens module (`ui/src/lib/brand.ts` + `api/constants.py`) — defines `name`, `productLine`, `widgetGlobalName`, `cookiePrefix`, `docsUrl`, `domain`, `supportEmail`. Env-overridable. **No callsite changes yet.**
2. Multi-head Alembic merge (consolidates `6499c608d0f6`, `cdcf9f65913b`, `f2e1d0c9b8a7`)
3. CORS pinning ([api/app.py:88](../../api/app.py)) — env-driven allow-list, no more `["*"]` + `allow_credentials=True`
4. `agent_stream` WS auth ([api/routes/agent_stream.py:31](../../api/routes/agent_stream.py)) — require `?api_key=`
5. Standalone smoke documented in PR

**Rollback:** revert single PR.

**DoD:** `alembic upgrade head` (singular) succeeds; CORS preflight from `evil.example.com` is rejected; WS `agent_stream` returns 401 without key; smoke passes.

---

## Phase 1 — Plugin scaffold + SDK rename + Voice Director template

**Goal:** Minimum-viable `noralai.noralvoice` plugin lands in NoralOS canonical with 3 starter tools. A "Voice Director" agent template ships alongside it. SDK rename completes.

**NoralVoice side:**
1. Rename `dograh-sdk` (Python) → `noralai-voice`. Dual-publish for one release.
2. Rename `@dograh/sdk` (TypeScript) → `@noralai/voice-sdk`. Dual-publish for one release.
3. Add `POST /api/v1/embed/exchange-token` endpoint (one-shot, 90s, for Phase 4's iframe — staging the contract early)
4. Add `POST /api/v1/integration-webhooks/register` so an external integration (NoralOS plugin) can register a callback URL for `run.completed` / `run.failed` / `campaign.progress` events

**NoralOS side:**
1. Scaffold `packages/plugins/noralai-noralvoice/` per NoralSign pattern (manifest, worker, UI slots, types)
2. Manifest declares: capabilities, `instanceConfigSchema` (`baseUrl`, `apiKeyRef`, `organizationId`), webhooks (`run-completed`, `campaign-progress`), sidebar + page slots, tools list
3. Worker imports `@noralai/voice-sdk`, resolves `apiKeyRef` via `ctx.secrets.resolve()`
4. **First 3 tools:** `noralvoice:list_workflows`, `noralvoice:run_call`, `noralvoice:get_run`
5. **One apiRoute:** `GET /workflows` (board UI list)
6. **One webhook receiver:** `run-completed` — receives NoralVoice payload, calls `ctx.events.emit("noralai.noralvoice.run.completed", payload)` so the originating agent wakes
7. Auto-register service `server/src/services/auto-register-noralvoice.ts` modeled on `auto-register-noralsign.ts`
8. **Voice Director agent template** — new file `server/src/services/agent-templates/voice-director.ts`:
   - Tier: `manager`
   - Default reports-to: CEO
   - System prompt: "You own voice operations for this company. You design, run, and monitor voice agents using the `noralvoice:*` tools."
   - Default tools: all `noralvoice:*` (filtered by tier-gate)
   - One-click "Create Voice Director" CTA on the plugin page once `apiKeyRef` is set
9. **Tier gate:** plugin worker refuses tool calls from agents below `manager` tier. Returns a clean error message naming the Voice Director template as the recommended caller.

**Rollback:** comment out `auto-register-noralvoice.ts` import; redeploy. Plugin stays in workspace but isn't loaded. SDK aliases stay published.

**DoD:** Operator with no API key sees configure-me state in NoralOS sidebar; with key + Voice Director created, agent can call `noralvoice:list_workflows` and get real data; standalone smoke passes.

**Anti-goals:** No credential UI (Phase 2). No voice-cascade replacement (Phase 6). No iframe (Phase 4). No NoralVoice UI changes.

---

## Phase 2 — Credential consolidation

**Goal:** NoralVoice API key managed via NoralOS's `/company/settings/integrations` (PR #46's system).

**NoralOS side only:**
1. New entry in `INTEGRATION_PROVIDERS` ([packages/shared/src/integration-providers.ts](../../packages/shared/src/integration-providers.ts)): `id: "noralvoice"`, category `voice`, fields `value` (api key), `baseUrl` (default `https://voice.noral.ai`), `organizationId` (integer)
2. New entry in `ASSIGNMENT_TARGETS`: `{ targetPluginId: "noralai.noralvoice", targetConfigPath: "apiKeyRef", expectsProvider: "noralvoice" }`
3. `test` probe: `GET {baseUrl}/api/v1/health` with `X-API-Key`, expect 200
4. Manifest's `instanceConfigSchema.apiKeyRef` already declares `format: "secret-ref"` — assignment writer (`pluginRegistryService.patchConfig`) populates it shallow-merge-preserving

**Rollback:** revert `INTEGRATION_PROVIDERS` and `ASSIGNMENT_TARGETS` additions. Operator falls back to hand-editing `plugin_config.config_json`.

**DoD:** Operator pastes API key in NoralOS integrations UI; assignment to plugin slot happens automatically; plugin worker reads the secret and calls `voice.noral.ai/api/v1/health`; green badge appears.

---

## Phase 3 — Voice settings unification

**Goal:** Per-agent voice settings written through the plugin to NoralVoice. NoralOS's `voice-config` plugin becomes a thin read-cache.

**Plugin gains tools:** `noralvoice:set_agent_voice`, `noralvoice:list_voices`, `noralvoice:provision_voice_agent` (creates a NoralVoice workflow from a default template and writes back the UUID)

**NoralOS schema:**
- Add `agents.voice_agent_uuid` (nullable VARCHAR, indexed) on the `agents` table

**Plugin UI:**
- New `detailTab` on Agent: "Voice settings" — reads via plugin apiRoute, writes via plugin tool
- The Voice Director template UX exposes a one-click "Provision Voice Agent" for any agent in the company

**Data migration:**
- Read `plugin_voiceconfig_d9257ba961.agent_voice_config` rows
- For each row with `voice_id != null`, call `set_agent_voice` to push the value to NoralVoice
- Mark `migrated_at`

**Rollback:** pause writes through new tools; `voice-config` tab continues against local table. Already-migrated values stay in both places until the dust settles.

**DoD:** Change a voice in NoralOS → reflected in NoralVoice `/workflow/:id/settings`; reload NoralOS → reads from NoralVoice; standalone smoke passes.

---

## Phase 4 — Surfaces

**Goal:** Plugin page becomes a real consumption surface. Iframed workflow builder. Costs page merges voice cost data.

**Plugin apiRoutes (board auth, company-resolved):**
- `GET /runs`, `GET /runs/:id`, `GET /recordings`, `GET /recordings/:id/download-url`
- `POST /kb/search`, `POST /kb/upload-url`
- `GET /campaigns`, `GET /campaigns/:id`
- `GET /telephony/numbers`, `GET /telephony/providers`
- `GET /usage/current-period`

**Plugin page UI (native, NoralOS theme):**
- Tabs: **Voice Agents** · **Runs** · **Recordings** · **Knowledge Base** · **Campaigns** · **Telephony** · **Settings**
- Each tab uses `@tanstack/react-query` against the plugin apiRoutes
- "Open builder" on a Voice Agent opens an iframed modal at `voice.noral.ai/workflow/<uuid>`
- Auth via the one-shot exchange token endpoint added in Phase 1
- postMessage protocol: child announces ready, parent passes theme tokens; child fires `unsaved-changes`; parent intercepts close with confirmation

**Live transcript stream (Pillar B item 2):**
- During an active call, plugin worker subscribes to `WS /api/v1/agent-stream/<workflow_uuid>?api_key=…`
- Inbound utterances are forwarded as `ctx.session.append` events to the originating Voice Director agent's session
- Voice Director can react to extracted variables mid-call (Phase 7 feature)

**NoralOS Costs page:**
- New "Voice cost" row sourced from plugin → NoralVoice usage endpoints
- Unified time-window selector

**Rollback:** Iframe modal feature-flagged (`enableEmbeddedVoiceBuilder`). Live transcript stream feature-flagged separately.

**DoD:** Board user can view all NoralVoice resources natively in NoralOS; "Open builder" works authed + themed; standalone smoke passes.

---

## Phase 5 — NoralVoice UI consolidation + brand purge + `noralos://` tool scheme

**Goal:** Tier 1 items from [uiux-streamlining.md](uiux-streamlining.md) ship. The `noralos://` tool scheme (Pillar B item 3) is added so NoralVoice voice agents can call back into NoralOS mid-call.

**NoralVoice UI:**
1. `/settings` tabbed page absorbs `/api-keys`, `/integrations`, `/model-configurations`, `/telephony-configurations`, `/credentials` (new UI), `/settings`, `/usage`. 301-redirect old paths for 1 release.
2. Sidebar: drop "Models", "Telephony", "Developers"; add "Settings" as a top-level item
3. Brand purge — use the brand-tokens module from Phase 0:
   - Replace every hardcoded `"Dograh"` literal
   - Update OpenAPI title, docs links
   - Cookie migration: write both `noralvoice_auth_token` and `dograh_auth_token` for 1 release
4. Dead pages: delete `/automation`; ship `/looptalk` root listing; add Superadmin to user dropdown for `is_superuser`; fix or 501 `/impersonate` local path

**`noralos://` tool scheme:**
- New tool executor in NoralVoice that recognizes URLs starting with `noralos://<plugin_id>/<tool_name>`
- Routes through the plugin's reverse RPC: NoralVoice POSTs to `<noralos_base>/api/plugins/noralai.noralvoice/reverse-tool` with the tool name + args
- NoralOS plugin worker dispatches to a registered reverse-tool handler that calls back into NoralOS internal services
- v1 reverse tools: `noralos://noralvoice/get_agent_status`, `noralos://noralvoice/create_task_for_agent`, `noralos://noralvoice/lookup_customer`

**Rollback:** Each item is a separate PR. Settings collapse is the riskiest; redirects make rollback a no-op for users.

**DoD:** No "Dograh" visible in any user-facing screen; sidebar count down from ~10 to 7; previously-orphaned pages reachable or deleted; a NoralVoice workflow with a `noralos://` tool node successfully completes one round-trip.

---

## Phase 6 — re-scoped: Dashboard voice path consolidation

**Re-scoped 2026-05-16.** The original Phase 6 plan above assumed Conference Room was a critical surface to migrate through NoralVoice's signaling + TTS. That turned out to be wrong:

- **Conference Room had zero production reach.** Removed in [NoralOS #105](https://github.com/Noral-AI/NoralOS/pull/105) (merged `8f2b9076`, ~-3900 LOC).
- **The actual remaining consumer of voice-cascade is `ui/src/hooks/useChatVoiceAutoplay.ts`** (Dashboard agent-voice autoplay for Issue chat comments).

Phase 6 collapses to 5 independent PRs gated by the NV TTS endpoint shipping first.

**PR-1 — NoralVoice `POST /api/v1/public/embed/synthesize`.** Multi-provider TTS endpoint with dual auth (X-API-Key for server-to-server, embed_token for browser widgets), exfiltration pre-flight (ported from voice-cascade), MinIO/S3 storage with pre-signed URLs, 9-provider audio normalization (MP3 pass-through for ElevenLabs/OpenAI, WAV-wrap for the 7 PCM providers). Ships on top of [NoralVoice #9](https://github.com/Noral-AI/NoralVoice/pull/9) (skeleton). PR: [NoralVoice #10](https://github.com/Noral-AI/NoralVoice/pull/10).

**PR-2 — Dashboard autoplay → NoralVoice TTS.** New `synthesize` route on the noralai.noralvoice plugin worker (proxies to NV with the plugin's apiKey, never exposing it to the browser). New `ui/src/api/noralVoiceTts.ts` browser client. `useChatVoiceAutoplay` gains a `NEXT_PUBLIC_ENABLE_NV_TTS_AUTOPLAY` flag-gated dual path with a `playAudioFromUrl` helper (NV returns pre-signed URLs, no base64 round-trip). `voiceCascade.ts` marked `@deprecated`. PR: [NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106).

**PR-3 — Retire voice-cascade (DEFERRED 1 week after PR-2 deploys with flag ON).** Removes `packages/plugins/voice-cascade/` from the workspace, Dockerfile lines, and `voiceCascadeApi.synthesize` from the UI. Updates the plugins row to `status='uninstalled'`. ~-1500 LOC.

**PR-4 — Retire voice-config (after PR-3).** Drizzle migration adds `agents.surface_flags` (jsonb), `agents.tier_override` (text), `agents.visibility_override` (text), `agents.tts_replies_enabled` (bool); `agents.voice_enabled` derived from `voice_agent_uuid IS NOT NULL`. `CompanyVoiceDefaults` moves to a plugin-owned `company_voice_defaults` table under `noralai.noralvoice`. Backfill copies existing voice-config state. `useChatVoiceAutoplay` reads `agents.surface_flags.dashboard`. Plugin removed from workspace + Dockerfile; plugins row → `uninstalled`. ~-1000 LOC.

**PR-5 — Audit-doc refresh (this PR).** Rewrites this §, [overlap-map §C1](overlap-map.md), [uiux-streamlining Tier 1 #2](uiux-streamlining.md), and [BROOKLYN_LLM_INTEGRATION_MAP](../../BROOKLYN_LLM_INTEGRATION_MAP.md) to reflect the re-scope.

**Surface flag set** is now three (`dashboard`, `slack`, `phone`). `conference_room` is intentionally dropped after #105.

**Rollback:** Each PR is independently revertable. PR-2's flag flips off restores voice-cascade autoplay until PR-3 lands.

**DoD:** `voice-cascade` + `voice-config` both `status='uninstalled'` in prod; Dashboard agent-voice autoplay works end-to-end via NV; standalone NoralVoice smoke passes.

**Combined Phase 6 win (incl. #105):** ≥ -6400 LOC.

---

## Phase 7 — Full tool coverage + typed SDK adoption

**Status (2026-05-17):** Partially shipped — see "Shipped vs Deferred" below.

**Goal:** Bring the `noralai.noralvoice` plugin onto a typed SDK foundation and expand the agent-callable tool surface so Voice Director / Brooklyn can act on more of NoralVoice's API without hand-rolled HTTP.

### Shipped

1. **NV SDK coverage expansion** ([Noral-AI/NoralVoice#11](https://github.com/Noral-AI/NoralVoice/pull/11)):
   - Added `@sdk_expose` tags to 24 NV routes (campaigns ×12, embed-token CRUD ×3, KB writes/reads ×5, tool-def CRUD ×5, daily reports ×2, recording management ×4, minus the `/transcribe` multipart endpoint).
   - SDK operations: 11 → 42. TS generated methods: 11 → 43.
   - Drive-by: 5 files patched from `typing.TypedDict` → `typing_extensions.TypedDict` for Pydantic v2 + Python 3.11 compat (CI runs 3.12 so masked the issue).

2. **SDK v0.3.0 release** ([Noral-AI/NoralVoice#12](https://github.com/Noral-AI/NoralVoice/pull/12) + tag [`sdks-v0.3.0-prerelease`](https://github.com/Noral-AI/NoralVoice/releases/tag/sdks-v0.3.0-prerelease)):
   - Tarball: `https://github.com/Noral-AI/NoralVoice/releases/download/sdks-v0.3.0-prerelease/noralai-voice-sdk-0.3.0.tgz`

3. **Plugin pins to v0.3.0** ([Noral-AI/NoralOS#110](https://github.com/Noral-AI/NoralOS/pull/110)):
   - `noralai-noralvoice/package.json` SDK URL bumped to v0.3.0.
   - Plugin code does **not** yet import from `@noralai/voice-sdk` (the 1170-LOC hand-rolled `noralvoice-client.ts` still serves all tools). The SDK is ready for new tools.

4. **4 new agent read tools** ([Noral-AI/NoralOS#111](https://github.com/Noral-AI/NoralOS/pull/111)):
   - `list_runs`, `list_campaigns`, `get_campaign`, `search_kb` — all worker-tier.
   - Reuses the legacy `noralvoice-client.ts` helpers that the board apiRoutes already call.
   - Plugin tool count: 6 → 10. `PLUGIN_VERSION`: 0.2.0 → 0.3.0.

### Deferred (out of Phase 7 scope, queued as follow-ups)

- **Plugin SDK adoption refactor.** `noralvoice-client.ts` (1170 LOC of hand-rolled `fetch`) still mediates every tool. Migrating handlers to `client.X()` requires several NV routes to upgrade their `response_model` annotations first — many currently emit `response_model: unknown` in the OpenAPI schema. Tracked as a NV-side cleanup.
- **More read tools.** `get_run_detail`, `list_recordings`, `get_recording_download_url`, `list_kb_documents`, `get_daily_report` — same response-model gap blocks clean typing.
- **Write tools.** All 13 originally planned: KB writes (`upload_kb_document`, `delete_kb_document`), campaign lifecycle (`create_campaign`, `start_campaign`, `pause_campaign`, `resume_campaign`, `redial_campaign`), workflow tool defs (`add_workflow_tool`, `update_workflow_tool`, `delete_workflow_tool`), embed-token CRUD (`create_persistent_embed_token`, `get_persistent_embed_token`, `revoke_persistent_embed_token`). Highest-value pair (`create_campaign` + `start_campaign`) gates on the SDK adoption being well-typed; `upload_kb_document` needs an SSRF threat-model decision; `create_persistent_embed_token` needs a secret-never-in-tool-return contract.
- **Schema sharing (`@noralai/voice-schemas`)**, **`agents.voice_agent_uuid` first-class column**, **LLM-driven workflow generation** — all still future work.

**Rollback:** Each shipped PR is independently revertable. Plugin version bumps trigger `upgradePlugin` on next deploy, so reverting the plugin manifest is a deploy event, not a code change.

**DoD (revised):** Agents can list runs, campaigns, and the KB without operator UI; SDK foundation in place for the next tool wave.

---

## Phase 7.5 — Cross-system attribution

**Status (2026-05-19):** NV-side shipped; UI surface deferred.

**Goal:** Every record NoralVoice creates as a result of a NoralOS agent action carries first-class attribution that the NoralVoice UI can display to humans inspecting that record. Closes the half of the parity equation that the original Phase 7 didn't touch — visibility.

Source memo: `noralOS/PARITY_AND_VISIBILITY_PLAN.md` §3 (working memo, retire after Phase 9 completes).

### Shipped

1. **NV migration + middleware + event listeners** ([Noral-AI/NoralVoice#17](https://github.com/Noral-AI/NoralVoice/pull/17)):
   - New `external_actors` table — append-only roster of non-human identities (NoralOS agents today), keyed by `(integration_id, external_actor_id)`.
   - `ExternalAttributionMixin` adding six nullable columns to each of the eight user-authored tables: `workflows, workflow_runs, campaigns, knowledge_base_documents, tools, telephony_configurations, workflow_recordings, embed_tokens`. NULL means human-authored — existing rows preserved exactly.
   - HTTP middleware reads five `X-Noralos-Actor-*` headers on POST/PUT/PATCH/DELETE, upserts the actor row, stashes the row id + run id + display label in a request-scoped ContextVar.
   - SQLAlchemy `before_insert` / `before_update` listeners on the eight attributed models stamp the columns from the ContextVar. No-op when unset.
   - Kill switch: `EXTERNAL_ACTOR_HEADERS_ENABLED=false` short-circuits the middleware. Best-effort attribution — DB failure during upsert falls through with no ContextVar set; the user's write completes as human-attributed rather than being blocked.
   - 11/11 unit tests pass. Integration test against real DB lands separately.

### Deferred (queued as 7.5-UI)

- **NV UI attribution rendering** — depends on PR #17 deployed *and* the NoralOS plugin sending the headers (Phase 9-B below). After both, render:
  - "Acted by" badge wherever NV UI shows `created_by` / `modified_by` (workflow editor breadcrumbs, run-history list rows, run-detail panel, campaign detail header, KB document list, telephony config audit panel).
  - "Acted by → [Human users / NoralOS agents / All]" filter on run-history and audit pages, persisted in localStorage, default "All".

**Rollback:** `EXTERNAL_ACTOR_HEADERS_ENABLED=false` is the fast disable. Full rollback: revert PR #17, run `alembic downgrade -1`. Migration columns are nullable, so app code on the previous commit reads/writes existing rows fine.

**DoD (per source memo §3.5):**
- ✓ A write with the 5 headers populates `external_actors` + the FK columns on the target table.
- ✓ A write without the headers persists unchanged.
- (deferred) Human in `voice.noral.ai` sees the badge and can filter by it.

---

## Phase 9 — Full tool parity

**Status (2026-05-19):** 9-A shipped; 9-B in flight.

**Goal:** Close the rest of the parity equation's part (a). Bring the plugin to a point where there is no operator action in NoralVoice that a NoralOS agent cannot also perform. Bundles all the Phase 7 "Deferred" items under a new phase name so the work has its own owner, rollback, and DoD.

Source memo: `noralOS/PARITY_AND_VISIBILITY_PLAN.md` §4 (working memo, retire after this phase completes).

### Shipped

1. **9-A — NV response_model fixups** ([Noral-AI/NoralVoice#16](https://github.com/Noral-AI/NoralVoice/pull/16)):
   - Annotated `response_model=` (or `responses=` for the one CSV-streaming endpoint) on every NV route tagged with `**sdk_expose(...)` that previously emitted `unknown` in OpenAPI. 29 routes across 8 files. Plan estimated 12 — actual was 29, the plan was stale because Phase 7 had already widened `@sdk_expose` coverage further.
   - Five new tiny response schemas defined where handlers were returning raw dicts: `DeleteKbDocumentResponse`, `DeleteToolResponse`, `InitiateCallResponse`, `RevokeEmbedTokenResponse`, `DeleteRecordingResponse`.
   - OpenAPI regen confirms 45/45 sdk_expose ops typed. Unblocks 9-B's SDK migration.

### In flight

- **9-B — Plugin SDK adoption + actor headers** (this PR, NoralOS side): migrate `packages/plugins/noralai-noralvoice/src/noralvoice-client.ts` off hand-rolled `fetch` onto `@noralai/voice-sdk` typed methods. In the same pass, inject the five `X-Noralos-Actor-*` headers from `ctx.agent`, `ctx.run`, `ctx.company`, `ctx.task` on every outbound call. Public tool signatures unchanged. `PLUGIN_VERSION` bumps in this PR.

### Deferred (queued)

- **9-C — Tier 1 + Tier 2 tools (13 new):** writes — `create_workflow`, `save_workflow`, `create_campaign`, `start_campaign`, `upload_kb_document` (raw bytes only, no SSRF), `add_workflow_tool`, `update_workflow_tool`, `delete_workflow_tool`. Reads — `get_run_detail`, `list_recordings`, `get_recording_download_url`, `list_kb_documents`, `get_daily_report`.
- **9-D — Tier 3 tools + embed-token contract:** `pause_campaign`, `resume_campaign`, `redial_campaign`, plus `create_persistent_embed_token` / `get_persistent_embed_token` / `revoke_persistent_embed_token` returning a NoralOS secret ref (never the raw token).

**Rollback:** Each PR cluster (9-A through 9-D) is independently revertable. Plugin version bumps trigger `upgradePlugin` on next deploy.

**DoD (per source memo §4.4):** Pick three sample human-only workflows in NoralVoice (build a workflow from scratch, run a small campaign, upload + reference a KB doc). For each, a Voice Director agent executes end-to-end via NoralOS tools, and the resulting NoralVoice records carry full Phase-7.5 attribution.

---

## Phase 8 — MPS rename + standalone independence

**Goal:** No more `services.dograh.com`. Verify NoralVoice runs cleanly with no Noral-cloud services attached, except the renamed managed-key issuer.

**Scope:**
1. Rename `services.dograh.com` → `services.noral.ai` in NoralVoice code; deploy `services.noral.ai` (same backend, new domain)
2. Make the managed-keys path **opt-in** — fresh OSS installs default to BYO-keys with a clear "or use managed credits" toggle
3. PostHog/Sentry telemetry: defaults phone home; make opt-in cleanly per-deploy
4. Verify cloudflared tunnel removal (already done) has no residual assumption
5. Document the "fully airgapped NoralVoice" deploy path

**Rollback:** DNS revert. Old domain stays alive for one release minimum.

**DoD:** A fresh `docker-compose up` of NoralVoice with `MANAGED_KEYS_ENABLED=false` and `TELEMETRY_ENABLED=false` boots and serves a test call with operator-supplied keys.

---

## Cross-phase dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 6 ──► Phase 7
                                                    │
                                                    ▼
                                                 Phase 5 (parallel-safe)
                                                    │
                                                    ▼
                                                 Phase 8 (parallel-safe)
```

Phase 5 can start as soon as Phase 0 ships (brand-tokens exist). Phase 8 can start anytime after Phase 5. Phases 0–4 are strictly sequential.

---

## Delivery cadence

One Claude Code prompt per phase. Each prompt is self-contained — read the scope, read the relevant phase section here, execute, open PR, document smoke. Next prompt is delivered after the prior PR merges and smoke is green.

The Phase 0 prompt is in [claude-code-prompt-phase-0.md](claude-code-prompt-phase-0.md).

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| `voice-cascade` provider quirks lost translating to NoralVoice catalog | 6 | 1-week feature-flagged dual path (`NEXT_PUBLIC_ENABLE_NV_TTS_AUTOPLAY`) |
| Iframe auth bridge drops sessions on parent reload | 4 | One-shot exchange token + ready handshake; explicit re-auth flow documented |
| API key rotation invalidates plugin mid-call | 2 | `ctx.secrets.resolve()` hits live storage every call |
| Multi-head Alembic merge breaks in-flight deploy stuck at one head | 0 | Apply merge migration **before** any new migration after it; document path-from-each-head |
| Conference Room latency regresses through NoralVoice WebRTC | ~~6~~ | OBSOLETE — Conference Room removed in #105 before Phase 6 |
| SDK rename breaks an external consumer | 1 | Dual-publish for one release; deprecation banner |
| `noralos://` tool scheme abused to escalate privilege | 5 | Tools registry server-side; agent JWT required; tier-gate at plugin boundary |
| Voice Director template ships with too-narrow tools, users add more ad-hoc, drift | 1, 7 | Template is the curated default; user-customized tools allowed via existing agent.tools.register |
| `services.noral.ai` not ready for Phase 8 | 8 | Phase 8 can slip; not a critical-path dependency |
