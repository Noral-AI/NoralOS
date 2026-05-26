You are executing **Phase 3** of the NoralOS ↔ NoralVoice consolidation. NoralOS-only.

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md     ← binding scope, see §2 Pillar A
  consolidation-plan.md      ← Phase 3 section
  overlap-map.md             ← §A5 "per-agent voice config"
```

Also read:
- `CLAUDE.md`
- `packages/plugins/noralai-noralvoice/` — your plugin from Phase 1/2
- `packages/plugins/voice-config/` — the plugin you're partially replacing. **Do not uninstall it.** Phase 6 does that. Phase 3 just routes new writes through the noralvoice plugin; voice-config stays alive as a legacy reader.
- `packages/db/src/schema/agents.ts`

## Repo / branching

- Repo: `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`
- Base branch: `master`
- Working branch: `feat/phase-3-voice-settings-unification`

## Goal

After this phase, an operator sets an agent's voice from inside NoralOS:

1. Opens an Agent detail page
2. Clicks a new **Voice settings** tab
3. If the agent has no `voice_agent_uuid` yet → clicks "Provision Voice Agent" → plugin creates a NoralVoice workflow from a default template and writes the UUID back to the agent row
4. Sees current provider + voice fetched from NoralVoice via plugin apiRoute
5. Changes provider/voice → plugin pushes the change to NoralVoice via tool call
6. Reload → reads back from NoralVoice (NV is source of truth)

NoralOS's `voice-config` plugin's local table stops being the source of truth for new writes. It continues to own the surface-flag concept (`dashboard | conference_room | slack | phone`) until Phase 6 retires it.

## Deliverables (one PR)

### D1. Three new plugin tools

In `packages/plugins/noralai-noralvoice/src/tools/`:

**`list_voices.ts`** — `noralvoice:list_voices`
- Params: `{ provider?: "elevenlabs"|"openai"|"cartesia"|"deepgram"|"rime"|"sarvam"|"speaches"|"camb"|"dograh" }` (optional filter; the union of NV's 9 TTS providers)
- Returns: `Array<{ provider: string, voiceId: string, name: string, language?: string, gender?: string, previewUrl?: string }>`
- Implementation: call NoralVoice's voice catalog endpoint (find it via grep on `voices` in `api/routes/`; likely `/api/v1/configurations/voices` or part of `/user/configurations/user`). If SDK doesn't expose it, hit directly via fetch with the apiKey
- Tier: `worker` (read-only)

**`set_agent_voice.ts`** — `noralvoice:set_agent_voice`
- Params: `{ noralosAgentId: string, provider: string, voiceId: string, voiceOptions?: Record<string, unknown> }`
- Implementation:
  1. Resolve `agents.voice_agent_uuid` for the given agent
  2. If null → return `{ ok: false, error: "NO_VOICE_AGENT", message: "Agent has no linked voice agent. Call provision_voice_agent first." }`
  3. Call NoralVoice `PATCH /workflows/<uuid>/settings` (verify the actual endpoint — may be `/workflows/<uuid>/model-overrides` or similar; pick the one that updates the workflow's TTS provider + voice)
  4. After success: mirror the new value to voice-config's local table (D5)
  5. Return `{ ok: true, voice_agent_uuid, provider, voiceId }`
- Tier: `manager`

**`provision_voice_agent.ts`** — `noralvoice:provision_voice_agent`
- Params: `{ noralosAgentId: string, displayName?: string, template?: "blank" | "conversational" }`
- Implementation:
  1. Verify the agent doesn't already have a `voice_agent_uuid` — if it does, return `{ ok: false, error: "ALREADY_PROVISIONED", voice_agent_uuid }`
  2. Call NoralVoice `POST /workflows` with the requested template (default: a minimal conversational workflow — confirm a default template exists or build the simplest possible NodeSpec graph)
  3. Set the workflow's display name to `displayName ?? "<agent.name> voice"`
  4. Write the returned UUID to `agents.voice_agent_uuid`
  5. Return `{ ok: true, voice_agent_uuid, workflow_name }`
- Tier: `manager`

Each tool gets a `.test.ts` covering: happy path, tier-forbidden, NV 4xx (treat as user error), NV 5xx (treat as transient — surface), and the specific edge cases above (`NO_VOICE_AGENT`, `ALREADY_PROVISIONED`).

### D2. NoralOS schema: `agents.voice_agent_uuid` column

- New Drizzle migration: `packages/db/migrations/0078_agents_voice_agent_uuid.sql`
  - `ALTER TABLE agents ADD COLUMN voice_agent_uuid VARCHAR(36) NULL;`
  - `CREATE INDEX agents_voice_agent_uuid_idx ON agents(voice_agent_uuid) WHERE voice_agent_uuid IS NOT NULL;` (partial index)
- Update `packages/db/src/schema/agents.ts` type with the new column
- Run `pnpm db:generate` to refresh types

Nullable column for now. Phase 7 may promote to an enforced FK (deferred because the target lives in a different DB).

### D3. Plugin apiRoute: `GET /agents/:agentId/voice-config`

New plugin apiRoute that aggregates current voice config for an agent:

- Path: `GET /api/plugins/noralai.noralvoice/api/agents/:agentId/voice-config?companyId=<uuid>`
- Auth: board, company-resolved from the `agents` row (verify caller has access to the agent's company)
- Resolves `voice_agent_uuid`
- If set: calls NV `GET /workflows/<uuid>/settings`
- Returns `{ voice_agent_uuid, provider, voice_id, voice_name, provider_options?, surface_flags? }` or `{ voice_agent_uuid: null }`

Also add `POST /api/plugins/noralai.noralvoice/api/agents/:agentId/provision-voice` (board auth) that wraps the `provision_voice_agent` tool for UI use.

### D4. Plugin UI: Voice settings detail tab

Add to the plugin manifest's UI slots:

```ts
{ type: "agent-detail-tab",
  id: "noralvoice-voice-settings",
  exportName: "VoiceSettingsTab",
  displayName: "Voice settings" }
```

Component `src/ui/VoiceSettingsTab.tsx`:

- Fetches current config via the D3 apiRoute
- **No voice_agent_uuid yet:** shows a "Provision Voice Agent" CTA. Click → POSTs the provision-voice apiRoute → on success refreshes
- **Has voice_agent_uuid:** shows
  - Provider dropdown (populated via `list_voices` with provider filter)
  - Voice dropdown (filtered by selected provider)
  - Preview button (calls NV's voice-sample endpoint if available; otherwise hide)
  - Save button → calls plugin tool `noralvoice:set_agent_voice` via a new `POST /agents/:agentId/voice-config` apiRoute
- Reuse existing `shadcn/ui` primitives to match other agent detail tabs

### D5. Backward-compat write to `voice-config`

When `set_agent_voice` succeeds, also write the value to `voice-config`'s `agent_voice_config` table so legacy readers (voice-cascade, Conference Room) keep working until Phase 6.

Implementation options (pick the cleanest):
- Call voice-config's existing internal API if it has a write tool/route
- Direct DB write to `plugin_voiceconfig_d9257ba961.agent_voice_config` (acceptable here since both plugins are in the same NoralOS instance)

Set `agent_voice_config.migrated_to_noralvoice_at = now()` on the row.

### D6. Data migration script

File: `server/scripts/migrate-voice-config-to-noralvoice.ts`

For each row in `plugin_voiceconfig_d9257ba961.agent_voice_config` where `voice_id IS NOT NULL` and `migrated_to_noralvoice_at IS NULL`:

1. Resolve company → plugin instance → NoralVoice API key (skip if company has no NoralVoice integration configured)
2. Resolve agent — if `voice_agent_uuid IS NULL`, call `noralvoice:provision_voice_agent` first
3. Call `noralvoice:set_agent_voice` to push the existing value
4. Set `migrated_to_noralvoice_at = now()` on success

Idempotent. Rerunnable. Log per-agent outcomes to stdout (and to `activityLog` if the script context exposes it).

Run manually after deploy (no auto-run on boot — too risky for a one-shot migration).

### D7. Tier-gate verification

Confirm Phase 1's tier gate catches `set_agent_voice` and `provision_voice_agent` at the JSON-RPC dispatch boundary. `list_voices` is worker-tier (read-only).

If the tier-gate metadata structure on Phase 1's tools doesn't extend cleanly to the new tools, normalize it now. Add a `tools/registry.ts` if it doesn't exist that exports tool-tier mappings centrally.

### D8. Smoke

- [ ] `pnpm db:migrate` adds the `voice_agent_uuid` column
- [ ] Open an Agent detail page → new "Voice settings" tab is visible
- [ ] Agent without `voice_agent_uuid` → tab shows "Provision Voice Agent" → click → provisions → tab refreshes with provider/voice dropdowns
- [ ] Provider dropdown populates from NoralVoice via `list_voices`
- [ ] Voice dropdown filters by selected provider
- [ ] Change voice + click Save → NoralVoice's workflow settings reflect the change (verify via `voice.noral.ai` UI or direct API hit)
- [ ] Reload Agent detail → tab reads the new voice back from NV
- [ ] Worker-tier agent attempting `set_agent_voice` via chat → `TIER_FORBIDDEN` error
- [ ] Run migration script on a test row → row gets `migrated_to_noralvoice_at`; NV has the value; agent has `voice_agent_uuid`
- [ ] `voice-config` plugin still works for legacy readers (Conference Room TTS plays correctly with the new voice)
- [ ] Standalone NoralVoice smoke passes (no NV changes in this phase)

## PR meta

- Title: `feat(phase-3): voice settings unification — provision + read/write through NoralVoice`
- Commits per logical group: D1 tools (one commit), D2 schema, D3 apiRoutes, D4 UI, D5 compat, D6 migration script, D7 tier-gate, D8 tests
- PR body includes D8 smoke results and migration outcomes (X rows migrated / Y skipped / Z failed)

## Anti-goals

- Do NOT uninstall `voice-config` — Phase 6 owns that
- Do NOT touch the workflow editor UI in NoralVoice — Phase 4 iframes it
- Do NOT migrate the surface-flag concept (`dashboard | conference_room | slack | phone`) — that stays in voice-config until Phase 6
- Do NOT change NoralVoice. NV's existing `/workflows/<uuid>/settings` (or equivalent) is the contract; if it doesn't fit, surface that and stop, don't extend NV
- Do NOT remove or rename voice-config's existing tools or table — legacy readers still depend on them

## Stop and report if

- NoralVoice's `/workflows/<uuid>/settings` doesn't have the shape needed for per-provider per-voice updates — surface this as a Phase 1/2 gap, don't extend NV
- voice-config's `agent_voice_config` schema has fields that don't map cleanly to NV's settings model (e.g., a `tier_override` field NV doesn't represent) — flag the discrepancy; migrate what maps cleanly, document what's dropped
- The default workflow template for `provision_voice_agent` doesn't exist in NV and can't be constructed minimally — surface and propose either (a) shipping a template into NV in a separate PR or (b) requiring operators to pre-create one workflow as a template
- Tier-gate metadata structure from Phase 1 needs significant reshaping — do it but call it out in the PR description

## When you finish

Reply with:
1. PR URL and merge status
2. D8 smoke results
3. Migration outcome (X migrated / Y skipped / Z failed, with reasons for skips/failures)
4. Anything punted to Phase 6 (likely: surface-flag column move, voice-config uninstall, conference-room-bridge media path)
5. Anything that surfaced as a new issue worth noting

Do not start Phase 4. Wait for the next prompt.
