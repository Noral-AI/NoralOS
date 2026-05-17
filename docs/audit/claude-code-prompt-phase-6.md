You are executing **Phase 6** of the NoralOS ↔ NoralVoice consolidation — the highest-risk phase and the largest LOC win. Conference Room moves to NoralVoice's media path; `voice-cascade` and `voice-config` get retired. Phases 0–5 are merged and deployed.

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md       ← binding scope. §2 Pillar A (Conference Room re-route), §3 in-scope: collapse 3 voice plugins, §5 hard constraints (#1 standalone, #2 no UI duplication, #3 no logic forks)
  consolidation-plan.md        ← §Phase 6 section. Note: "RISK: high" in the phase map
  overlap-map.md               ← §A4 Pipecat overlap, §B1 TTS provider catalogs, §C1 Conference Room
  uiux-streamlining.md         ← Tier 1 item #2 (collapse three voice plugins, ~3000 LOC savings)
  integration-architecture.md  ← §4 Conference Room flow diagrams
```

Also read:
- `CLAUDE.md` at both repo roots
- `packages/plugins/voice-cascade/` — what you're retiring (1334 LOC; TTS execution + exfiltration scan + ElevenLabs/Google providers + serial fallback)
- `packages/plugins/voice-config/` — what you're retiring (851 LOC; per-agent voice settings + tier derivation + surface visibility)
- `packages/plugins/conference-room-bridge/` — what you're slimming (1947 LOC; will drop the Pipecat HTTP-client protocol layer ~600 LOC, possibly fold entirely)
- `packages/plugins/noralai-noralvoice/` — your plugin from Phases 1–5. Absorbs both the exfiltration scan AND the surface-flag concept
- On the NoralVoice side: `api/routes/signaling.py` (or equivalent — find the actual `WS /ws/public/signaling/<session_token>` endpoint), `api/services/tts.py` (the 9-provider catalog)

## Repos / branching

| Role | Path | Origin | Branch |
|---|---|---|---|
| NoralOS (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` | `github.com/Noral-AI/NoralOS` | `master` |
| NoralVoice | `/Users/quentin/Documents/NORALAI/NoralVoice` | `github.com/Noral-AI/NoralVoice` | `rebrand/noralvoice` |
| NoralOS (decoy — DO NOT PUSH) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` | (hyphenated) | n/a |

Working branches:
- PR-A: `feat/phase-6a-conf-room-nv-signaling` (NoralOS) + `feat/phase-6a-conf-room-signaling-contract` (NoralVoice, if any NV side-changes are needed — likely none)
- PR-B: `feat/phase-6b-absorb-exfiltration-scan` (NoralOS)
- PR-C: `feat/phase-6c-absorb-surface-flags` (NoralOS, includes Drizzle migration)
- PR-D: `chore/phase-6d-uninstall-voice-cascade-and-config` (NoralOS — DEFERRED until soak window passes)
- PR-E: `feat/phase-6e-fold-conf-room-bridge` (NoralOS — optional; default = fold)

**Order matters.** PR-A ships dual-path (feature-flagged old + new). PRs B and C migrate the data/concerns voice-cascade and voice-config owned, but the plugins stay INSTALLED. After a 2-week soak with the flag flipped to "new path" in prod, PR-D uninstalls the two retired plugins. PR-E folds conference-room-bridge into noralai.noralvoice as the final consolidation.

## Goal

After Phase 6:
- Conference Room sessions on `agent.noral.ai` route audio through NoralVoice's WebRTC signaling, not Pipecat directly. TTS comes from NV's 9-provider catalog. Browser STT loop stays in the browser as a UX shortcut.
- `voice-cascade` is uninstalled from prod (`SELECT * FROM plugins WHERE plugin_key='noralos.voice-cascade'` returns zero rows). The exfiltration-scan pre-flight check moved into the `noralai.noralvoice` plugin worker.
- `voice-config` is uninstalled from prod. The surface-flag concept (`dashboard`/`conference_room`/`slack`/`phone` visibility per agent) moved either to `agents.surface_flags` (JSONB column on the agents table) or into a table owned by `noralai.noralvoice`.
- `conference-room-bridge` either (a) lives on as a thin ~400-LOC glue layer (browser STT → plugin apiRoute → agent session → NV TTS) or (b) is folded entirely into `noralai.noralvoice`. **Default: fold.** Justify if you keep it as a sibling.
- Net code reduction: ~3000 LOC across the three retired/slimmed plugins.

Standalone `voice.noral.ai` smoke (signup → build → place test call) MUST pass at the end of every PR. This is non-negotiable per `consolidation-plan.md` cardinal rule. Conference Room on `agent.noral.ai` MUST work end-to-end at the end of every PR (with the flag flipped appropriately for the in-flight state).

---

## PR-A — Conference Room → NoralVoice signaling (dual-path, flag-gated)

### A1. Inventory the current path

Before writing any code, document the current Conference Room flow as it exists today. Read `packages/plugins/conference-room-bridge/src/worker.ts` end-to-end and the UI page (`ConferenceRoomPage.tsx`). Produce a short flow note in the PR description:

```
Today's path:
  Browser <─ WebRTC ─> Pipecat (external) <─ HTTP ─> conference-room-bridge worker
                                                  └─> voice-cascade (TTS) ─> ElevenLabs/Google
```

Then propose the target flow:

```
Target path:
  Browser <─ WebRTC ─> NoralVoice signaling ws://voice.noral.ai/ws/public/signaling/<session_token>
                                          └─> NoralVoice TTS (9-provider catalog)
  Browser STT (Web Speech API) ─> POST <plugin apiRoute>/conference-room/message
                                  └─> agent session ──> agent response ──> NV TTS ──> audio URL back to browser
```

If the actual current flow differs from the sketch above, document the actual one; the sketch is best-effort from `consolidation-plan.md` Phase 6.

### A2. Plugin-side wiring (NoralOS)

In `packages/plugins/noralai-noralvoice/`:

1. Add an apiRoute `POST /conference-room/session` — issues a NoralVoice signaling session token via NV's `POST /api/v1/embed/exchange-token` (Phase 1 contract; or whatever the signaling-equivalent is — check NV). Returns `{ session_token, signaling_url }` to the browser.
2. Add an apiRoute `POST /conference-room/message` — browser POSTs the user's transcribed utterance here; plugin worker:
   - Resolves the calling user → originating agent (lookup via existing session state)
   - Calls `ctx.session.append(agentId, { type: "user_message", text })` so the agent wakes
   - Awaits the agent's response (or returns 202 + polls — match the existing conference-room-bridge contract)
   - For each agent reply, calls NV's `POST /workflows/<uuid>/tts` (or whatever the synth endpoint is — check NV) and returns `{ text, audio_url }` to the browser
3. Add an apiRoute `POST /conference-room/end` — closes the NV signaling session.
4. Reuse the existing `noralai.noralvoice` plugin tier-gate: Conference Room access requires the calling agent be `director`/`manager`/`exec` tier (the same gate from Phase 1; verify it still trips correctly here).

### A3. UI flip-over

`packages/plugins/conference-room-bridge/src/ui/ConferenceRoomPage.tsx` (or wherever the UI lives — confirm path):

Add a feature flag check at the top of the component. When `enableNvSignaling` is true:
- WebRTC client connects to `wss://voice.noral.ai/ws/public/signaling/<session_token>` (the URL returned by `POST /conference-room/session`)
- Browser STT loop POSTs to `/conference-room/message` instead of conference-room-bridge's old endpoint
- TTS audio comes from the `audio_url` in the message-response payload, played via the browser's `<audio>` element (NOT through Pipecat)

When `enableNvSignaling` is false: the existing path runs unchanged.

Flag source: read from the plugin's instance config (`enable_nv_signaling: boolean`), with a per-instance toggle visible in NoralVoicePage's Settings tab (or wherever — match Phase 4A's pattern). Default off in production. ON in dev.

### A4. Standalone-mode preserved

`voice.noral.ai` standalone smoke must still pass. The new signaling endpoint (`/ws/public/signaling`) already exists in NoralVoice today (or did, per the plan) — confirm. If it doesn't exist or has changed shape, STOP and report; do NOT extend NV in Phase 6 without surfacing the gap first.

### A5. PR-A smoke

Run with `enableNvSignaling = true` in dev:

- [ ] Open Conference Room as a director/manager/exec-tier agent → audio session establishes, no Pipecat HTTP calls in network panel
- [ ] User speaks → browser STT transcribes → agent receives message in session → agent replies → TTS audio plays back via NV
- [ ] Latency: end-to-end utterance-to-audio under 2.5s (matches the Phase 4 Voice Director SLO from `consolidation-scope.md` §6)
- [ ] Worker/specialist-tier agents are denied access (tier-gate)
- [ ] With `enableNvSignaling = false` (or flag absent), the old Pipecat path still works
- [ ] Standalone NV smoke passes (signup → build workflow → place test call)
- [ ] `voice-cascade` and `voice-config` are still installed and untouched (PRs B/C/D handle them)

### PR-A meta

- Title: `feat(phase-6a): route Conference Room audio through NoralVoice signaling (dual-path, flagged)`
- Base: `master`
- Commits per logical step: apiRoutes, UI flip-over, feature flag, smoke
- PR body includes A1's flow note (before/after diagram) and A5 smoke results

---

## PR-B — Absorb voice-cascade's exfiltration scan into the plugin

### B1. Inventory

Read `packages/plugins/voice-cascade/src/worker.ts` end-to-end. Find:
- The exfiltration scan logic (what content gets scanned, what triggers a block, what's logged)
- The ElevenLabs / Google TTS provider abstractions (these are getting RETIRED — NV's 9-provider catalog supersedes them)
- The serial fallback logic (also retired)

Document in the PR description: "voice-cascade owned X, Y, Z. We're keeping X (exfiltration scan) and dropping Y, Z (replaced by NV's catalog)."

### B2. Port the scan

Move the exfiltration-scan code into `packages/plugins/noralai-noralvoice/src/`. It runs as a pre-flight check inside the `run_call` tool handler and inside the new `/conference-room/message` apiRoute. Same trigger semantics, same log shape.

If the scan touched a `voice-cascade`-owned table, migrate the data (or recreate the table inside the noralvoice plugin's schema — bump `PLUGIN_VERSION` so auto-register's `upgradePlugin` runs the Drizzle migration on the new schema; see CLAUDE.md gotcha #6).

### B3. Wire the scan into Conference Room

After PR-A, the new `/conference-room/message` apiRoute is the chokepoint for user→agent messages in Conference Room. Add the scan there. Match the block/allow behavior of the old voice-cascade integration.

### B4. PR-B smoke

- [ ] A message containing a known exfiltration trigger (use whatever test fixture voice-cascade had) is blocked in both Conference Room and `run_call`
- [ ] A clean message passes through
- [ ] The scan log entry shape matches the pre-Phase-6 format (don't break dashboards/queries that depend on it)
- [ ] `voice-cascade` is still installed (untouched by this PR) — its TTS code is just no longer called by the new Conference Room path
- [ ] Standalone NV smoke passes

### PR-B meta

- Title: `feat(phase-6b): absorb voice-cascade exfiltration-scan into noralai.noralvoice`
- Base: `master`
- Bump `PLUGIN_VERSION` in `packages/plugins/noralai-noralvoice/src/constants.ts` (0.2.0 → 0.3.0) so the manifest refresh fires on deploy

---

## PR-C — Absorb voice-config's surface flags

### C1. Inventory

Read `packages/plugins/voice-config/src/worker.ts` and types. The surface-flag concept: each agent has 0..N "surfaces" it's visible on (`dashboard`, `conference_room`, `slack`, `phone`). Voice-config owns a table for this.

### C2. Decide the new home

Two options:
- **Option A:** `agents.surface_flags` JSONB column on the existing `agents` table (NoralOS-canonical). Pros: surface visibility is an agent property, naturally lives there. Cons: schema change on the most-touched table.
- **Option B:** New table in the `noralai.noralvoice` plugin's schema (`plugin_noralvoice_<hash>.agent_surfaces`). Pros: keeps the agents table untouched; isolates voice concerns. Cons: surface flags conceptually broader than voice (slack/dashboard aren't voice surfaces).

**Default: Option A.** The surface-flag concept is agent-wide, not voice-specific. Surface flags can be NULL for non-voice agents (existing behavior).

If you pick Option B, justify in the PR.

### C3. Migration

If Option A:
1. New Drizzle migration `packages/db/src/migrations/<NNNN>_agents_surface_flags.sql`:
   ```sql
   ALTER TABLE "agents" ADD COLUMN "surface_flags" jsonb;
   CREATE INDEX "agents_surface_flags_gin_idx" ON "agents" USING GIN ("surface_flags");
   ```
2. Update `_journal.json` (see CLAUDE.md branch/merge gotcha — Phase 4 hit this).
3. Data backfill: `INSERT INTO ... SELECT FROM plugin_voiceconfig_d9257ba961.agent_surface_visibility` (or whatever the source table is — verify) → `UPDATE agents SET surface_flags = ...`.
4. Update `agents` typescript schema in `packages/db/src/schema/agents.ts`.

### C4. Plugin-side reads

Update `packages/plugins/noralai-noralvoice/`:
- Tier-gate / visibility checks read from `agents.surface_flags` instead of voice-config's table
- Add an apiRoute `PATCH /agents/:id/surface-flags` (board auth) so the UI can edit them

Voice-config still has its UI tab; gracefully fall back to reading from the new column. Voice-config's writes get redirected to the new column (so during the soak window, edits work via either plugin).

### C5. PR-C smoke

- [ ] Drizzle migration applies cleanly on a copy of prod DB (test locally against a `pg_dump`)
- [ ] After backfill, every existing agent with surface flags in `plugin_voiceconfig_*.agent_surface_visibility` has an equivalent value in `agents.surface_flags`
- [ ] Read path: an agent's surface visibility resolves correctly from `agents.surface_flags`
- [ ] Write path: editing surface flags via voice-config's tab updates the new column too
- [ ] `voice-config` is still installed (untouched by this PR) — just no longer the source of truth
- [ ] Standalone NV smoke passes

### PR-C meta

- Title: `feat(phase-6c): migrate surface-flag ownership to agents.surface_flags`
- Base: `master`
- Bump `PLUGIN_VERSION` again (0.3.0 → 0.4.0) so the auto-register reads the new manifest

---

## PR-D — Uninstall voice-cascade + voice-config (DEFERRED 2 weeks)

**Do NOT open PR-D until PRs A/B/C have soaked in prod with `enableNvSignaling=true` for at least 2 weeks.** During the soak:

- Monitor: Conference Room session error rate, agent reply latency p50/p95/p99, NV TTS error rate, the exfiltration-scan trigger count
- If any metric regresses materially, flip `enableNvSignaling=false` (reverts to the old Pipecat path) and investigate
- The two retired plugins stay installed but unused; the surface-flag table stays as a fallback read source

After the soak passes, PR-D:

1. Remove `packages/plugins/voice-cascade/` from the workspace
2. Remove `packages/plugins/voice-config/` from the workspace
3. Remove the `pnpm --filter @noralos-plugins/voice-cascade build` and `@noralos-plugins/voice-config build` lines from the `Dockerfile`
4. Remove their auto-register hooks (if they have any in `server/src/services/`)
5. After deploy: manually uninstall the DB rows via `UPDATE plugins SET status='uninstalled' WHERE plugin_key IN ('noralos.voice-cascade', 'noralos.voice-config')`. (Or add a small one-off cleanup script in `server/src/scripts/` if there are running workers to drain first.)

### PR-D smoke

- [ ] After deploy: `docker exec noralos-db psql -c "SELECT plugin_key, status FROM plugins WHERE plugin_key IN ('noralos.voice-cascade', 'noralos.voice-config')"` returns either zero rows or both `status='uninstalled'`
- [ ] Conference Room still works
- [ ] Surface flags still resolve from `agents.surface_flags`
- [ ] Exfiltration scan still triggers in both Conference Room and `run_call`
- [ ] Standalone NV smoke passes
- [ ] `docker logs noralos-server | grep "voice-cascade\|voice-config"` shows zero plugin-loader entries on next startup

### PR-D meta

- Title: `chore(phase-6d): uninstall voice-cascade and voice-config plugins`
- Base: `master`
- PR body includes the 2-week soak metrics summary

---

## PR-E — (Optional) Fold conference-room-bridge into noralai.noralvoice

**Decision: default = fold.** If you fold, this PR happens after PR-D. If you keep conference-room-bridge as a sibling, write a one-paragraph justification in the consolidation-scope.md update.

### E1. If folding

1. Move `ConferenceRoomPage.tsx` (UI), the browser-STT helpers, and any thin glue from `packages/plugins/conference-room-bridge/src/` into `packages/plugins/noralai-noralvoice/src/ui/`. Register the page slot in noralvoice's manifest.
2. Remove `packages/plugins/conference-room-bridge/` from the workspace
3. Remove the Dockerfile build line
4. Bump `PLUGIN_VERSION` (0.4.0 → 0.5.0)
5. After deploy: `UPDATE plugins SET status='uninstalled' WHERE plugin_key='noralos.conference-room-bridge'`

### E2. If keeping as a sibling

Slim `conference-room-bridge` to ~400 LOC by:
1. Dropping the Pipecat HTTP-client protocol layer (~600 LOC)
2. Removing the duplicated session-state code that's now in noralvoice's apiRoutes
3. Keeping ONLY: the browser-STT UI glue and the page-slot registration

### E3. PR-E smoke

- [ ] If folded: Conference Room is accessible from noralvoice's sidebar entry; conference-room-bridge no longer appears in the plugin list on `/plugins`
- [ ] If kept as sibling: conference-room-bridge LOC count is ≤500; Conference Room still works
- [ ] Standalone NV smoke passes
- [ ] Net LOC delta across the three originally-targeted plugins is ≤ -2500 (target was ~-3000)

### PR-E meta

- Title (fold): `feat(phase-6e): fold conference-room-bridge into noralai.noralvoice`
- Title (keep): `refactor(phase-6e): slim conference-room-bridge to thin glue layer`
- Base: `master`

---

## Anti-goals (all PRs)

- Do NOT touch NoralVoice unless you discover the signaling endpoint contract has drifted from what `consolidation-plan.md` Phase 6 assumes. If you do touch NV, it's a contract patch only — no new endpoints.
- Do NOT extend the surface-flag concept. Same four surfaces (`dashboard`, `conference_room`, `slack`, `phone`) as voice-config had.
- Do NOT roll PR-D forward early. The 2-week soak is the bug-mitigation strategy; skipping it is the highest-impact way to break Conference Room for real users.
- Do NOT bundle NoralVoice as a sidecar container. Scope §4: NV stays separately deployed at `voice.noral.ai`.
- Do NOT re-implement TTS providers inside the plugin. NV's 9-provider catalog is the source of truth.
- Do NOT touch the auto-register-* race condition (the "Worker already registered" issue from CLAUDE.md gotcha #7). It's a real bug but Phase 6 work doesn't make it worse; fix in a separate follow-up.

## Stop and report if

- NoralVoice's signaling WS endpoint contract doesn't match Phase 6's assumption (different URL path, different auth shape, different message protocol). STOP. Propose the minimum-diff NV-side change and ask for approval before extending NV.
- The exfiltration-scan trigger fixtures from voice-cascade don't exist or are stale. STOP. The scan is a security feature; do NOT port it without verified test coverage.
- The data backfill in PR-C produces row-count mismatch (`voice-config` had N agents with surface flags; after migration `agents.surface_flags IS NOT NULL` shows M ≠ N). STOP. Don't ship a lossy migration.
- Latency p95 regresses by more than 30% during PR-A's dev smoke. STOP. The NV signaling path needs investigation before prod soak.
- Conference Room breaks during any PR (even with the flag flipped to the old path). STOP. Roll back the offending PR; the Pipecat fallback must always work during the soak window.
- Standalone NV smoke fails at the end of any PR. Roll the PR back.

## When you finish (all five PRs, or four if you keep PR-E pending)

Reply with:
1. PR URLs and merge statuses (all on `master`)
2. Smoke results for each PR
3. 2-week soak summary for PRs A/B/C before PR-D landed: session error rate, latency p50/p95, NV TTS error rate, exfiltration trigger count
4. LOC delta across `voice-cascade` + `voice-config` + `conference-room-bridge` (target: ≥ -2500 net)
5. Final plugin inventory on prod: `docker exec noralos-db psql -c "SELECT plugin_key, version, status FROM plugins WHERE status='ready' ORDER BY plugin_key"`
6. Fold-vs-sibling decision for conference-room-bridge, with rationale if you kept it
7. Anything punted to Phase 7 (likely: rebroker the noralvoice plugin into modular feature tags now that it's grown large) or to a hot-fix follow-up

Do not start Phase 7. Wait for the next prompt.
