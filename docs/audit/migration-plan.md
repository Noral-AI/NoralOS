# Migration Plan: NoralVoice ↔ NoralOS Consolidation

**Audit date:** 2026-05-14

> Phased steps. Each phase is independently shippable, has a rollback path, and cannot break NoralVoice standalone. Pair with [overlap-map.md](overlap-map.md) (what overlaps), [integration-architecture.md](integration-architecture.md) (how they talk), [uiux-streamlining.md](uiux-streamlining.md) (UI changes).

---

## Cardinal rule

**At no point during this migration may `voice.noral.ai` standalone stop working.** If a phase requires a NoralOS service to be reachable for NoralVoice operation, that phase is wrong. The plugin is the consumer; NoralVoice is the autonomous provider.

A standalone-NoralVoice smoke check runs at the end of every phase: a fresh user can sign up, build a workflow, place a test call. If that breaks, roll back.

---

## Phase 0 — Foundation (1 week)

**Goal:** Tidy NoralVoice so we have a clean substrate to plug into. None of this touches NoralOS.

### Scope

| Item | Source | Why now |
|---|---|---|
| Brand-tokens module ([uiux-streamlining.md §4](uiux-streamlining.md)) | New `ui/src/lib/brand.ts` + `api/constants.py:BRAND_*` | Need this before any rebrand pass so we don't rebrand twice |
| Multi-head Alembic merge ([overlap-map.md H-NV-2](overlap-map.md)) | New merge migration in `api/alembic/versions/` | Blocking for cleanly upgrading any prod that hasn't applied all three heads |
| CORS pinning ([uiux-streamlining.md §12](uiux-streamlining.md)) | [api/app.py:88](../../api/app.py) — `allow_origins` from env | Security; will only get harder to fix once more services depend on it |
| `agent_stream` auth ([uiux-streamlining.md §12](uiux-streamlining.md)) | [api/routes/agent_stream.py:31](../../api/routes/agent_stream.py) — require `?api_key=` | Security |
| Confirm SDK + MCP server work against `voice.noral.ai` end-to-end | Existing tests + manual call | Need this confidence before NoralOS plugin imports the SDK |

### Rollback path

Each item is independently revertable by reverting one PR. Multi-head Alembic merge can be removed; the three heads pre-existed.

### Definition of done

- `voice.noral.ai` deploy applies all migrations in one shot with `alembic upgrade head`
- CORS preflight from `agent.noral.ai` and `voice.noral.ai` succeeds; from `evil.example.com` is rejected
- `WS /agent-stream/<uuid>` without an API key returns 401
- Smoke: SDK roundtrip from a clean dev machine completes

---

## Phase 1 — Plugin scaffold (1–2 weeks)

**Goal:** A minimum-viable `noralai.noralvoice` plugin lands in NoralOS canonical. Three agent tools, one apiRoute, one webhook receiver, sidebar slot. The plugin **does not yet replace voice-cascade / voice-config / conference-room-bridge** — coexists.

### Scope

1. **Scaffold the plugin** via `packages/plugins/create-noralos-plugin`:
   - Path: `packages/plugins/noralai-noralvoice/`
   - Files: `src/manifest.ts`, `src/worker.ts`, `src/index.ts`, `src/ui/{NoralVoiceSidebarLink,NoralVoicePage}.tsx`
   - Manifest skeleton per [integration-architecture.md §4](integration-architecture.md)
2. **Rebrand NoralVoice's TS SDK** to `@noralai/voice-sdk` (keep `@dograh/sdk` as a deprecated alias that re-exports for one release):
   - `sdk/typescript/package.json` name change
   - `scripts/release_sdks.sh` publishes both names
   - Update `ui/src/client/` callers if any (they use the auto-generated client, not the SDK — should be fine)
3. **Plugin worker imports `@noralai/voice-sdk`** for typed NoralVoice calls
4. **First three tools (template-filled, no LLM graph generation yet):**
   - `noralvoice:list_workflows` → `client.workflows.list({ companyId })`
   - `noralvoice:run_call` → `client.workflows.runs.create({ workflowUuid, toNumber, variables })`
   - `noralvoice:get_run` → `client.workflows.runs.get({ workflowUuid, runId })`
5. **One apiRoute** for the board UI: `GET /workflows`
6. **One webhook endpoint:** `run-completed` — receives `{ run_id, status, transcript_url, recording_url, extracted_variables }` and emits `ctx.events.emit("noralai.noralvoice.run.completed", payload)`. NoralVoice needs to **call** that webhook — see below.
7. **NoralVoice side: emit the webhook.** Today NoralVoice has provider-specific telephony webhooks but no "external integration" webhook. Add: when a `WorkflowRun` completes, if the calling org has registered a `webhook_url` (new `OrganizationConfigurationModel.value` entry), POST the payload there.
8. **Auto-register service** `server/src/services/auto-register-noralvoice.ts` modeled on `auto-register-noralsign.ts` — install + activate at server boot, version-bump-aware
9. **Plugin sidebar slot** — just a link with the NoralVoice logo; page slot is an empty shell that says "Configure your NoralVoice connection in Settings > Integrations"
10. **Tier gate** (per NoralSign): only `{ceo, cto, cmo, cfo, manager}` roles may call `run_call` or `run_campaign` tools. (`design_workflow` and `list_*` are open.)

### Dependencies between items
- 1 → 2 (scaffold needs the SDK rename target)
- 2 → 3 (plugin worker imports renamed SDK)
- 3 → 4 (tools need the worker)
- 4 → 5 (apiRoute reuses the same client)
- 6 → 7 (webhook receiver needs NoralVoice to emit)
- 1, 8 → 9 (UI slots need the manifest)

### Rollback path

Each step backs out via the corresponding PR. The auto-register is idempotent and version-aware: if `0.1.0` of the plugin is uninstalled, the next deploy reinstalls it. To fully back out: comment out the `auto-register-noralvoice.ts` import in `server/src/app.ts`, redeploy. Plugin remains in the workspace but isn't loaded.

### Definition of done

- A NoralOS deploy that's freshly built shows "NoralVoice" in the sidebar
- An operator with no NoralVoice API key set sees the empty configure-me state
- A test agent in NoralOS calls `noralvoice:list_workflows` and gets a 401 (no key) — clean error message
- `voice.noral.ai` standalone smoke still passes

### What's NOT yet in Phase 1

- No credential UI in NoralOS — operator hand-edits `plugin_config.config_json` to set baseUrl + apiKeyRef (developer-only at this point)
- No voice-cascade replacement
- No iframe of NoralVoice's workflow builder
- No NoralVoice UI changes

---

## Phase 2 — Credential consolidation (1 week)

**Goal:** NoralVoice API key managed via NoralOS PR #46's integrations system. Plugin instanceConfig wired through `integration_credentials` → `company_secrets`.

### Scope

1. **New entry in `INTEGRATION_PROVIDERS`** ([packages/shared/src/integration-providers.ts:175](../../packages/shared/src/integration-providers.ts)):
   ```ts
   {
     id: "noralvoice",
     category: "voice",
     credentialType: "api_key",
     displayName: "NoralVoice",
     description: "Voice agent platform",
     fields: [
       { key: "value", label: "API Key", type: "secret", required: true },
       { key: "baseUrl", label: "Base URL", type: "string",
         default: "https://voice.noral.ai" },
       { key: "organizationId", label: "NoralVoice Organization ID",
         type: "integer", required: true },
     ],
     test: { kind: "http", method: "GET", pathTemplate: "{baseUrl}/api/v1/health",
       headers: { "X-API-Key": "{value}" }, expectStatus: 200 },
     assignableSlots: [
       { pluginId: "noralai.noralvoice", path: "apiKeyRef" },
     ],
   }
   ```
2. **New entry in `ASSIGNMENT_TARGETS`** ([packages/shared/src/integration-providers.ts:469](../../packages/shared/src/integration-providers.ts)):
   ```ts
   {
     targetPluginId: "noralai.noralvoice",
     targetConfigPath: "apiKeyRef",
     expectsProvider: "noralvoice",
     displayName: "NoralVoice API key",
   }
   ```
3. **Plugin manifest's `instanceConfigSchema`** declares `apiKeyRef` as a `format: "secret-ref"` field — assignment writer (`pluginRegistryService.patchConfig`) will populate it ([server/src/services/integrations/assignments.ts:1-50](../../server/src/services/integrations/assignments.ts))
4. **Plugin worker resolves the secret at request time** via `ctx.secrets.resolve(apiKeyRef)` — already standard SDK pattern
5. **NoralOS UI** — no new code needed; the existing `/company/settings/integrations` page picks up the new provider automatically from `INTEGRATION_PROVIDERS`
6. **OAuth path (deferred to Phase 6 or later)** — NoralVoice today uses simple API keys, not OAuth. Skip the OAuth wiring for v1.

### Rollback path

Revert the `INTEGRATION_PROVIDERS` and `ASSIGNMENT_TARGETS` additions. Plugin reverts to operator-edited `plugin_config.config_json` (developer-only mode of Phase 1).

### Definition of done

- An operator goes to `/company/settings/integrations`, picks NoralVoice from the picker, pastes an API key + base URL + org ID, hits Save
- Assignment to the `noralai.noralvoice / apiKeyRef` slot happens automatically (single-slot provider)
- Plugin worker reads the secret and successfully calls `voice.noral.ai/api/v1/health` — green badge appears
- `voice.noral.ai` standalone smoke still passes (no change to NoralVoice)

---

## Phase 3 — Voice settings unification (2 weeks)

**Goal:** Per-agent voice config in NoralOS writes through to NoralVoice. `voice-config` plugin becomes a thin cache (then deprecated in Phase 6).

### Scope

1. **Plugin gains tools:**
   - `noralvoice:set_agent_voice` — given a NoralOS agent ID + provider + voice ID, calls NoralVoice to update the linked voice agent's settings
   - `noralvoice:list_voices` — returns NoralVoice's provider catalog (the union of all 9 TTS providers' voice lists)
2. **Plugin adds a UI slot:**
   - `detailTab` on Agent: "Voice settings" (replaces voice-config's tab eventually)
   - Reads via plugin apiRoute → NoralVoice; writes via plugin tool → NoralVoice
3. **Bidirectional mapping:**
   - NoralOS `agents.voice_agent_uuid` column (nullable FK) → NoralVoice workflow UUID
   - Provisioning flow: when an NoralOS agent is created with voice enabled, plugin tool `noralvoice:provision_voice_agent` creates a NoralVoice workflow from a default template and writes back the UUID
4. **`voice-config` plugin** continues to own the surface flag (`dashboard | conference_room | slack | phone`) for now — that's a NoralOS-internal concern, not a NoralVoice one
5. **`voice-cascade` plugin** stops being called by anything new. It still exists for the conference-room-bridge media path until Phase 6.

### Migration of existing data

- Read `plugin_voiceconfig_d9257ba961.agent_voice_config` rows
- For each row with a non-null `voice_id`, call `noralvoice:set_agent_voice` to push the value
- Mark the row as `migrated_at = now()`

### Rollback path

Pause writes through the new tools; voice-config tab continues to work against its local table. Already-migrated values stay in both places until the dust settles.

### Definition of done

- A NoralOS user sets a Voice Agent's voice via the new tab → NoralVoice reflects the change
- The same user reloads → sees the value (read-through plugin apiRoute)
- A change made directly in NoralVoice's `/workflow/:id/settings` is visible in the NoralOS tab on next read
- `voice.noral.ai` standalone smoke still passes

---

## Phase 4 — Surfaces (2 weeks)

**Goal:** The NoralOS plugin page becomes a real consumption surface — list, detail, runs, recordings, KB, and the embedded workflow builder.

### Scope

1. **Plugin apiRoutes added** (board auth, company-resolved):
   - `GET /runs` — list workflow runs
   - `GET /runs/:id` — detail
   - `GET /recordings` — list recordings
   - `GET /recordings/:id/download-url` — proxy to NoralVoice presigned URL
   - `POST /kb/search` — knowledge base hybrid search
   - `GET /telephony-numbers` — list configured numbers (read-only mirror)
2. **Plugin page UI:**
   - Tabs: **Voice Agents** (list), **Runs**, **Recordings**, **Knowledge Base**, **Campaigns**
   - Each tab is a native React component using `@tanstack/react-query` calling the plugin apiRoute
3. **Embedded workflow builder:**
   - "Open builder" button on a Voice Agent → opens `voice.noral.ai/workflow/<uuid>` in an iframe inside a NoralOS modal
   - Auth via short-lived exchange token: NoralOS plugin requests `POST /api/v1/embed/exchange-token` (new NoralVoice endpoint — see Phase 4 NoralVoice changes below), gets a one-shot URL `voice.noral.ai/embed-login?token=...`
   - postMessage protocol: child frame announces ready, parent passes theme tokens; child frame fires `unsaved-changes` events; parent intercepts close attempts with unsaved-changes confirmation
4. **NoralVoice side adds `POST /api/v1/embed/exchange-token`:**
   - Accepts an `X-API-Key`, returns a short-lived (90s) one-shot token bound to a target user
   - `/embed-login` page consumes the token, sets a session, redirects to the target URL
5. **NoralOS Costs page** ([ui/src/pages/Costs.tsx](../../ui/src/pages/Costs.tsx)) gains a "Voice cost" row, sourced from plugin apiRoute → NoralVoice usage endpoints

### Rollback path

Plugin page falls back to a "manage in NoralVoice" deep-link button. The iframe is the riskiest part — gate it behind a feature flag (`enableEmbeddedVoiceBuilder`) for safe disable.

### Definition of done

- Board user can view voice agents, runs, recordings, KB documents, costs — all native UI inside NoralOS, all data live from NoralVoice
- "Open builder" opens NoralVoice's workflow editor inside a modal, authenticated, themed
- Standalone NoralVoice smoke passes

---

## Phase 5 — NoralVoice UI consolidation (1–2 weeks)

**Goal:** The Tier 1 items in [uiux-streamlining.md](uiux-streamlining.md) land — settings collapse, brand purge, dead pages handled.

### Scope (NoralVoice only — independent of NoralOS work above)

1. **`/settings` tabbed page** ([uiux-streamlining.md §1](uiux-streamlining.md)):
   - Move `/api-keys`, `/integrations`, `/model-configurations`, `/telephony-configurations`, `/credentials` (new UI), `/settings`, `/usage` into one page with tabs
   - 301-redirect old paths for 1 release
   - Sidebar: drop "Models", "Telephony", "Developers" from BUILD; add "Settings" as a top-level item
2. **Brand text purge** ([uiux-streamlining.md §4](uiux-streamlining.md)):
   - Use the brand-tokens module from Phase 0
   - Replace every `"Dograh"` literal; update OpenAPI title, docs links, cookie names (write both for compat)
3. **Dead pages** ([uiux-streamlining.md §5](uiux-streamlining.md)):
   - Delete `/automation`
   - Ship `/looptalk` root listing (3 days work — backend is live)
   - Wire `/integrations` into the new Settings tab
   - Add "Superadmin" to user dropdown for is_superuser users
   - Fix or 501 the `/impersonate` local path
4. **Terminology** ([uiux-streamlining.md §3](uiux-streamlining.md)):
   - Page headings use "Voice Agent"
   - `/workflow` URL stays for now (rename deferred)

### Rollback path

Each item is a separate PR. Settings collapse is the riskiest; the redirects make rollback a no-op for users.

### Definition of done

- Standalone NoralVoice smoke passes
- No "Dograh" text visible in any user-facing screen
- Sidebar count down from ~10 items to 7
- All previously-orphaned pages are reachable or deleted

---

## Phase 6 — Conference Room re-route (2–3 weeks)

**Goal:** The biggest LOC consolidation. NoralOS's three voice plugins collapse into the `noralai.noralvoice` plugin. The media path moves to NoralVoice's WebRTC signaling.

### Scope

1. **Conference Room media path** moves from `conference-room-bridge`'s external Pipecat dependency to NoralVoice's `WS /ws/public/signaling/{session_token}`:
   - Browser STT loop in `conference-room-bridge` stays (it's a NoralOS-native UX shortcut)
   - Audio playback comes from NoralVoice TTS, not voice-cascade
2. **`voice-cascade` plugin is uninstalled** at the end of this phase:
   - All callers (conference-room-bridge, others) have been redirected to NoralVoice
   - The plugin's two providers (ElevenLabs, Google TTS) are subsumed by NoralVoice's 9-provider catalog
   - The exfiltration scan moves into the `noralai.noralvoice` plugin worker as a pre-flight check before delegating to NoralVoice (alternatively: implemented inside NoralVoice as a server-side option)
3. **`voice-config` plugin** is uninstalled at the end of this phase:
   - The surface flag concept (dashboard/conference_room/slack/phone) moves to `agents.surface_flags` JSONB column on NoralOS or stays in `noralai.noralvoice`'s own table — either way, voice-config the plugin is gone
   - The `agent_voice_config` table is migrated by a one-shot script that calls NoralVoice for each row
4. **`conference-room-bridge` slims down**:
   - Drops the Pipecat HTTP-client protocol layer (~600 LOC)
   - Becomes just: browser STT → POST to plugin apiRoute → plugin pushes user message into agent session → agent response → plugin POSTs to NoralVoice for TTS → audio URL back to browser
5. **Reconsider whether `conference-room-bridge` should be folded into `noralai.noralvoice`** — they're now both NoralVoice consumers. Probably yes, by Phase 7.

### Migration

- Run for several days with both `voice-cascade` and the new path co-existing, feature-flagged
- Smoke: a Conference Room session works end-to-end through the new path
- Drain old sessions; uninstall plugins

### Rollback path

The feature flag flips back; voice-cascade re-takes the TTS path. Plugins are not yet uninstalled. After the dust settles (~2 weeks of green smoke), the cleanup PR removes them.

### Definition of done

- `voice-cascade` is uninstalled in production (`docker exec` checks `plugins` table)
- `voice-config` is uninstalled in production
- Conference Room continues to work for all surfaces (dashboard, in-app voice chat)
- Standalone NoralVoice smoke passes

---

## Phase 7 — Polish & shared schemas (optional, 2 weeks)

**Goal:** Reduce drift surfaces.

### Scope

1. **Extract `@noralai/voice-schemas`** from NoralVoice's OpenAPI spec — TypeScript types for NodeSpec, workflow run shape, provider catalog
2. **NoralOS plugin pins to a `@noralai/voice-schemas` major** — version mismatch at plugin boot is a hard failure with a clear error
3. **NoralOS plugin gains LLM-driven workflow generation** (`noralvoice:design_workflow` upgraded from template-fill to graph-generation with validate-loop)
4. **NoralOS adds `agents.voice_agent_uuid` first-class column** (Phase 3 used a JSON field; promote to a real FK)
5. **Cost aggregation in NoralOS Costs page** becomes the primary view; NoralVoice's `/usage` becomes a deep-link from there

---

## Phase 8 — Standalone NoralVoice independence audit (optional, 1 week)

**Goal:** Verify NoralVoice runs cleanly with NO Noral cloud services attached.

### Scope

1. **MPS dependency** ([overlap-map.md C4](overlap-map.md)) — make `services.dograh.com` fully optional with a graceful no-MPS path. Today some flows assume it exists.
2. **Stack Auth dependency** — local-OSS path covers most surfaces but `/superadmin` impersonation is broken locally ([uiux-streamlining.md §5](uiux-streamlining.md)). Make local-OSS feature-complete or remove Stack-only features.
3. **PostHog/Sentry telemetry** — defaults phone home; make opt-in cleanly per-deploy.
4. **Cloudflared tunnel** — already removed from `deploy/noral/docker-compose.yaml` for the voice.noral.ai deploy. Verify there's no implicit assumption.

---

## Phase summary

| Phase | Duration | Touches | Independently shippable | Cardinal-rule risk |
|---|---|---|---|---|
| 0 — Foundation | 1 week | NoralVoice only | yes | low |
| 1 — Plugin scaffold | 1–2 weeks | NoralOS only; one new NoralVoice endpoint | yes | low |
| 2 — Credential consolidation | 1 week | NoralOS only | yes | low |
| 3 — Voice settings unification | 2 weeks | Both | yes | medium (mapping data) |
| 4 — Surfaces | 2 weeks | NoralOS only; one new NoralVoice embed-exchange endpoint | yes | medium (iframe) |
| 5 — NoralVoice UI consolidation | 1–2 weeks | NoralVoice only | yes | low |
| 6 — Conference Room re-route | 2–3 weeks | Both | yes | high (uninstalls 2 NoralOS plugins) |
| 7 — Polish | 2 weeks | Both | yes | low |
| 8 — Independence audit | 1 week | NoralVoice only | yes | low |

Total: ~12–17 weeks for the core consolidation (Phases 0–6). Phases 7–8 are quality and can run in parallel with normal product work.

---

## Cross-phase dependencies

- Phase 1 depends on Phase 0's SDK rename being available
- Phase 2 depends on Phase 1's plugin existing
- Phase 3 depends on Phase 2's credentials being storable
- Phase 4 depends on Phase 1's plugin manifest having the page slot
- Phase 5 can run **in parallel with Phases 1–4** — it doesn't touch NoralOS
- Phase 6 depends on Phase 3 (voice config in NoralVoice) and Phase 4 (consumer surfaces)
- Phase 7–8 depend on Phase 6 being stable

A team of 2 (1 backend, 1 frontend) can sequence Phases 0 → 1 → 2 → 3 → 4 → 5 → 6 in ~12 weeks. Adding a second pair lets Phase 5 run alongside Phases 3–4, saving 1–2 weeks.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| `voice-cascade` provider quirks lost in translation to NoralVoice's catalog | 6 | A feature-flagged dual path for ≥2 weeks before uninstall |
| Iframe auth bridge drops sessions on parent reload | 4 | One-shot exchange token + post-message ready handshake; document explicit re-auth flow |
| NoralVoice's API key rotation invalidates plugin worker mid-call | 2 | `ctx.secrets.resolve()` re-hits storage every call; rotation is graceful |
| Multi-head Alembic merge breaks an in-flight deploy that's at one head | 0 | Apply the merge migration **before** any new migration after it; document the path-from-each-head |
| Conference Room latency regresses through NoralVoice WebRTC vs in-process Pipecat | 6 | Latency budget measurement before / after; rollback flag stays for 4 weeks |
| Cross-tenant event emit (the NoralSign TODO) bites NoralVoice plugin webhook fan-out | 1, later | Don't replicate the pattern — emit per-company directly from the webhook receiver |
| SDK rename `@dograh/sdk` → `@noralai/voice-sdk` breaks an external consumer | 1 | Publish both names from one source for 1 release; deprecate the old |
| MPS removal leaves OSS users without LLM keys | 8 | Make the no-MPS path the default and well-documented; MPS becomes opt-in |
