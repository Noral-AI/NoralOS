You are executing **Phase 6 (re-scoped)** of the NoralOS ↔ NoralVoice consolidation —
"consolidate the Dashboard voice path." Conference Room has been retired (#105) so
the original Phase 6 plan no longer applies. This prompt is the corrected scope.

## What changed from the original Phase 6 prompt

The original Phase 6 assumed Conference Room was a critical surface to migrate
through NoralVoice's signaling + TTS. That turned out to be wrong:

- **Conference Room had zero production reach.** Already removed in
  [NoralOS #105](https://github.com/Noral-AI/NoralOS/pull/105) (~-3900 LOC).
  `packages/plugins/conference-room-bridge/` is GONE.
- **The actual remaining consumer of voice-cascade + voice-config is the Dashboard
  agent-voice autoplay** (`ui/src/hooks/useChatVoiceAutoplay.ts`), which speaks
  agent-authored Issue chat comments via TTS.
- **NV has no public TTS synth endpoint.** Design doc + scaffolded skeleton live
  in [NoralVoice PR #9](https://github.com/Noral-AI/NoralVoice/pull/9) (`feat/phase-6-nv-tts-synthesize`).
  Real implementation is PR-1 below.

Phase 6 collapses from 5 coupled PRs into 5 independent PRs gated by the NV TTS
endpoint shipping first. Total win across the remaining work: ~-2500 LOC on top
of #105's -3900.

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md       ← §3 (collapse voice plugins) + §5 (hard constraints)
  consolidation-plan.md        ← §Phase 6 is STALE (described old plan); read for context only
  overlap-map.md               ← §B1 (TTS provider catalogs) + §C1 (was Conference Room — now stale)
  uiux-streamlining.md         ← Tier 1 #2 (collapse three voice plugins; conference-room-bridge already gone)

NoralVoice repo:
  docs/design/phase-6-nv-tts-synthesize.md  ← BINDING. The NV TTS endpoint contract.
                                              Implement against this, not against the
                                              old Phase 6 prompt's flow sketches.
```

Also read:
- `CLAUDE.md` at both repo roots
- `packages/plugins/voice-cascade/` — what you're retiring (1545 LOC; exfiltration scan +
  ElevenLabs/Google providers + serial fallback)
- `packages/plugins/voice-config/` — what you're retiring (977 LOC; per-agent voice
  settings + tier derivation + surface visibility flags)
- `ui/src/hooks/useChatVoiceAutoplay.ts` — the surviving consumer of both. THIS is what
  migrates.
- `ui/src/api/voiceCascade.ts` — the client-side wrapper around voice-cascade's
  /synthesize. Either retired or rewritten to call NV.

## Repos / branching

| Role | Path | Origin | Branch |
|---|---|---|---|
| NoralOS (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` | `github.com/Noral-AI/NoralOS` | `master` |
| NoralVoice | `/Users/quentin/Documents/NORALAI/NoralVoice` | `github.com/Noral-AI/NoralVoice` | `rebrand/noralvoice` |
| NoralOS (decoy — DO NOT PUSH) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` | (hyphenated) | n/a |

Working branches:
- PR-1: `feat/phase-6-nv-tts-impl` (NoralVoice, on top of PR #9's branch
  `feat/phase-6-nv-tts-synthesize` — stack)
- PR-2: `feat/phase-6-dashboard-autoplay-nv` (NoralOS)
- PR-3: `chore/phase-6-retire-voice-cascade` (NoralOS, after PR-2 soak)
- PR-4: `feat/phase-6-retire-voice-config` (NoralOS, includes Drizzle migration)
- PR-5: `docs/phase-6-audit-doc-refresh` (NoralOS — small)

## Prerequisites

Before starting PR-1:

1. **NoralVoice deploy state.** `rebrand/noralvoice` is 12 commits ahead of `main`
   and not yet pushed to main. PR #9's design doc lives on `rebrand/noralvoice`
   but the endpoint doesn't exist anywhere yet. PR-1 builds on PR #9's skeleton
   branch (NOT directly on `rebrand/noralvoice` — keep the stack so #9's review
   comments still apply).
2. **NoralOS #105 merged + deployed.** Conference Room must actually be gone in prod;
   if it's not, this whole re-scope is premature. Verify:
   - `docker exec noralos-db psql -c "SELECT plugin_key, status FROM plugins WHERE plugin_key='noralos.conference-room-bridge'"` returns either zero rows or `uninstalled`.
   - `/api/health` 200 on `agent.noral.ai` with the new image.
3. **NV PR #7's alembic migration applied.** PR-7 added `reverse_rpc_url` + `reverse_rpc_secret`
   columns to `integration_webhooks`. Not strictly needed for Phase 6 but
   blocks anything that calls back into NV with the noralos:// scheme.
   `alembic upgrade head` against the `voice.noral.ai` DB.

## Goal

After Phase 6 (re-scoped):

- NoralVoice exposes a real, multi-provider `POST /api/v1/public/embed/synthesize`
  endpoint that returns audio for any of NV's 9 TTS providers, with HMAC-equivalent
  embed-token auth, MinIO-backed storage, and pre-signed URLs. Per the design doc
  in PR #9.
- The exfiltration-scan security pre-flight (currently inside voice-cascade) is
  ported INTO the NV TTS endpoint as a chokepoint check. Vitest coverage added at
  port time (zero tests exist today).
- `useChatVoiceAutoplay` calls NV's endpoint instead of voice-cascade's
  `/synthesize`. `ui/src/api/voiceCascade.ts` is renamed (or replaced) by an
  NV-flavored client. Dashboard agent-voice still works end-to-end.
- `voice-cascade` is uninstalled from prod (no more callers).
- `voice-config` is uninstalled from prod. Its state migrates per the hybrid
  design the prior session committed to:
    - `agents.surface_flags` JSONB (dashboard/slack/phone — conference_room dropped)
    - `agents.tier_override` nullable enum column
    - `agents.visibility_override` nullable enum column
    - `agents.tts_replies_enabled` boolean
    - `agents.voice_enabled` derived from `voice_agent_uuid IS NOT NULL` (column dropped)
    - `CompanyVoiceDefaults` → plugin-owned `noralai.noralvoice` schema
      (`company_voice_defaults` table)
- Audit docs (`consolidation-plan.md` §Phase 6, `overlap-map.md` §C1,
  `uiux-streamlining.md` Tier 1 #2, `BROOKLYN_LLM_INTEGRATION_MAP.md`) updated
  to reflect the re-scope.

Standalone `voice.noral.ai` smoke (signup → build → place test call) must pass at
the end of every PR. Dashboard agent-voice autoplay must work end-to-end at the
end of every PR (with the flag flipped appropriately for the in-flight state).

---

## PR-1 — NV TTS endpoint: real implementation (NoralVoice)

### Scope

Implement the synth helper + storage + route handler against the design doc.

Build on PR #9's branch. The skeleton's docstrings + signatures + Pydantic models
are stable; this PR fills in the bodies and replaces the 501 handler with the
real flow.

### Implementation

1. `api/services/pipecat/tts_one_shot.py`:
   - Replace `synthesize()`'s `NotImplementedError` with the real flow:
     - Build `AudioConfig` with `sample_rate_hz` (default 16000).
     - Call `service_factory.create_tts_service(user_config, audio_config)`.
     - `async for frame in service.run_tts(text):` collect bytes from
       `TTSAudioRawFrame.audio`.
     - Per-provider normalization: pass-through for MP3 (ElevenLabs, OpenAI);
       WAV-wrap for raw PCM (others). Per the design doc §5 table.
   - Implement `_provider_native_content_type()` and `_wrap_pcm_as_wav()` helpers.

2. `api/services/audio/synth_storage.py`:
   - Implement `upload_synth_audio()` via the existing `S3FileSystem`:
     `acreate_file()` + `aget_signed_url(expiration=PRESIGNED_URL_TTL_SECONDS)`.
   - Implement `_extension_for_content_type()` for `audio/wav` and `audio/mpeg`.

3. `api/routes/embed.py`:
   - Replace the 501 handler with the real synth flow:
     - Validate embed_token (re-use existing `db_client.get_embed_token_by_token`).
     - Domain-check `Origin` header (re-use `validate_origin` from `public_embed.py`).
     - Resolve token → user → `user_configurations.tts` (re-use `get_user_configurations`).
     - Overlay `voice_override` if present.
     - Run exfiltration scan (see PR-1.5 below).
     - Call `tts_one_shot.synthesize()`.
     - Call `synth_storage.upload_synth_audio()`.
     - Return `SynthesizeResponse`.
   - Remove `status_code=501` from the route decorator.

### PR-1.5 (inside PR-1) — port the exfiltration scan

Port `packages/plugins/voice-cascade/src/exfiltrationGuard.ts` (65 LOC) into
NoralVoice as `api/services/audio/exfiltration_guard.py`. Same regex pattern set
(`anthropic_key`, `generic_sk_key`, `slack_token`, `github_token`, `aws_key`,
`long_hex`). Add the scan as a pre-flight INSIDE the synth route handler — if it
matches, return 422 with code `text_blocked_exfiltration` and the match types
(NOT the matched text — never log secrets).

**Vitest equivalent (pytest) tests required.** From the prior session's design:

> Add a pytest suite that covers all 6 pattern types (`anthropic_key`,
> `generic_sk`, `slack_token`, `github_token`, `aws_key`, `long_hex`) plus
> negative cases. ~80-120 LOC of test code.

### Tests

Replace the 3 skipped tests in `api/tests/test_synthesize_endpoint.py`:
- `test_synthesize_happy_path_returns_audio_url` — mock both `tts_one_shot.synthesize`
  and `synth_storage.upload_synth_audio`; assert response shape + provider attribution.
- `test_synthesize_rejects_invalid_token` — mock `get_embed_token_by_token` → None;
  assert 401.
- `test_synthesize_rejects_unallowed_origin` — mock token with non-matching
  `allowed_domains`; assert 403.

Add new tests:
- Exfiltration scan match → 422 `text_blocked_exfiltration` (one test per pattern type).
- Exfiltration scan miss → happy path proceeds.
- WAV-wrap helper: known PCM bytes → known WAV bytes (deterministic).
- Provider content-type lookup: every supported provider in the registry produces
  a non-None content type.

Also: at LEAST one real-provider integration test, gated by
`@pytest.mark.skipif(os.getenv("ELEVENLABS_API_KEY") is None)`. Document in the PR
body whether you ran it.

### Smoke

- [ ] `python3 -m pytest api/tests/test_synthesize_endpoint.py api/tests/test_exfiltration_guard.py -v` passes (no skips, except real-provider tests when keys absent).
- [ ] `tsc`-equivalent (mypy / pyright) clean on touched files.
- [ ] Local: `uvicorn api.app:app --reload` + `curl POST /api/v1/public/embed/synthesize` with a known-good token returns 200 with an audio URL that plays in a browser.
- [ ] Standalone NV smoke passes.

### Meta

- Title: `feat(phase-6): implement NV /embed/synthesize endpoint (multi-provider TTS)`
- Base: `feat/phase-6-nv-tts-synthesize` (stack on PR #9) OR `rebrand/noralvoice` if
  you decide to merge PR #9 first
- Bump nothing — this is a NoralVoice change

### STOP and report if

- `service.run_tts(text)` doesn't yield the expected frame sequence
  (`TTSStartedFrame` → `TTSAudioRawFrame`(s) → `TTSStoppedFrame`) for any provider.
- `TTSAudioRawFrame` exposes audio bytes via a different attribute than `.audio`.
- MinIO writes succeed but the pre-signed URL doesn't play in a browser (CORS, signing,
  Content-Type mismatch).
- A provider needs API credentials beyond `user_configurations.tts` (e.g., AWS
  Bedrock signing) that aren't already supplied.

---

## PR-2 — Migrate Dashboard autoplay to NV (NoralOS)

### Scope

Switch `useChatVoiceAutoplay` from calling voice-cascade's `/synthesize` to calling
NV's `/embed/synthesize`. After this PR ships + deploys, voice-cascade has zero
production callers.

### Implementation

1. New `ui/src/api/noralVoiceTts.ts` — client for the NV `/embed/synthesize`
   endpoint. Pulls the embed token from the company's `integration_credentials`
   (the `noralai.noralvoice` plugin already has it). One-shot POST with the JSON
   body per PR #9's design doc.

2. `ui/src/hooks/useChatVoiceAutoplay.ts` — swap `voiceCascadeApi.synthesize` for
   the new NV client. Preserve all the existing behavior (markdown stripping,
   audio-blocked fallback, dedup-on-id, single-clip-at-a-time semantics).

3. Feature flag: `enable_nv_tts_autoplay` per `noralai.noralvoice` plugin instance.
   Default ON in dev, OFF in prod. Operator flips it after smoke.

4. `ui/src/api/voiceCascade.ts` — LEAVE in place but mark `// @deprecated` with a
   comment pointing at `noralVoiceTts.ts`. Retire in PR-3.

### Smoke

- [ ] With flag ON: agent comment on Issue → audio auto-plays via NV TTS.
- [ ] With flag OFF: existing voice-cascade path still works (regression guard).
- [ ] Audio-blocked fallback ("Enable audio" pill) still works.
- [ ] Exfiltration trigger in a comment → no audio plays (scan in NV catches it).
- [ ] Standalone NV smoke passes.

### Meta

- Title: `feat(phase-6): route Dashboard agent-voice autoplay through NoralVoice TTS`
- Base: `master`
- Bump `PLUGIN_VERSION` of `noralai.noralvoice` (0.2.0 → 0.3.0) if the plugin needs
  manifest changes for the new client; otherwise leave.

### STOP and report if

- The embed token the plugin holds is wrong scope / can't authenticate to `/synthesize`.
- Latency p95 regresses by >30% compared to voice-cascade baseline (NV TTS is HTTP +
  S3 upload; voice-cascade was in-process).
- Dashboard autoplay breaks for any reason with the flag flipped ON in dev.

---

## PR-3 — Retire voice-cascade (NoralOS, DEFERRED 1 week)

**Do NOT open PR-3 until PR-2 has soaked in prod with `enable_nv_tts_autoplay=true`
for at least 1 week.** During the soak:

- Monitor: Dashboard autoplay error rate, NV `/synthesize` p50/p95/p99, exfiltration
  trigger count, S3 upload error rate.
- If any metric regresses, flip the flag back; investigate before retrying.

After soak:

1. Remove `packages/plugins/voice-cascade/` from the workspace.
2. Remove the `pnpm --filter @noralos-plugins/voice-cascade build` + `test -f
   .../dist/worker.js` lines from the Dockerfile.
3. Remove `ui/src/api/voiceCascade.ts` + any straggling references.
4. After deploy: `UPDATE plugins SET status='uninstalled' WHERE plugin_key='noralos.voice-cascade'`.

LOC delta: ~-1500.

### STOP and report if

- Any production code path still imports from voice-cascade after PR-2 (audit before
  deleting).
- The integration-credentials assignment system has a hard reference to
  `noralos.voice-cascade` as a target plugin id (search `server/src/services/integrations/`).

---

## PR-4 — Retire voice-config + Drizzle migration (NoralOS)

### Scope

Move voice-config's state to the agents table + a small plugin-owned table.
voice-config gets uninstalled.

### Implementation

1. New Drizzle migration `packages/db/src/migrations/<NNNN>_voice_config_consolidation.sql`:
   ```sql
   ALTER TABLE "agents" ADD COLUMN "surface_flags" jsonb;
   ALTER TABLE "agents" ADD COLUMN "tier_override" text;
   ALTER TABLE "agents" ADD COLUMN "visibility_override" text;
   ALTER TABLE "agents" ADD COLUMN "tts_replies_enabled" boolean DEFAULT true;

   CREATE INDEX "agents_surface_flags_gin_idx" ON "agents" USING GIN ("surface_flags");
   CREATE INDEX "agents_tier_override_idx" ON "agents" ("tier_override") WHERE "tier_override" IS NOT NULL;
   ```
   Plus a `noralai.noralvoice` plugin migration creating `company_voice_defaults`
   (one row per company).

2. Update `_journal.json` (CLAUDE.md gotcha #6).

3. Data backfill (in the same migration or a follow-up script):
   - For each row in `plugin_voiceconfig_<hash>.agent_voice_config`, set the
     corresponding `agents.surface_flags` JSON: `{"dashboard": dashboardVoiceEnabled,
     "slack": slackVoiceEnabled, "phone": phoneVoiceEnabled}` (`conference_room`
     intentionally dropped).
   - Copy `tier_override`, `visibility_override`, `tts_replies_enabled`.
   - For each row in `plugin_voiceconfig_<hash>.company_voice_defaults`, insert
     into the new plugin-owned table.

4. Update `agents` typescript schema in `packages/db/src/schema/agents.ts`.

5. Reader update: `useChatVoiceAutoplay` reads `agents.surface_flags.dashboard`
   instead of voice-config's `dashboardVoiceEnabled`.

6. Remove `packages/plugins/voice-config/` from the workspace.

7. Remove the Dockerfile lines.

8. After deploy: `UPDATE plugins SET status='uninstalled' WHERE plugin_key='noralos.voice-config'`.

LOC delta: ~-1000.

### Smoke

- [ ] Drizzle migration applies cleanly on a copy of prod DB (test against `pg_dump`).
- [ ] After backfill: row counts match. `SELECT COUNT(*) FROM agents WHERE surface_flags IS NOT NULL`
      equals the row count in `plugin_voiceconfig_<hash>.agent_voice_config`.
- [ ] Dashboard autoplay still works (reads from new source).
- [ ] Editing surface flags via whatever UI exists writes to the new column.
- [ ] Standalone NV smoke passes.

### STOP and report if

- Row-count mismatch after backfill.
- Any non-test reader of voice-config still exists after PR-2 + PR-3 land.
- The plugin's own migration (creating `company_voice_defaults`) conflicts with the
  `noralai.noralvoice` plugin's existing schema (the plugin's `PLUGIN_VERSION` needs
  bumping for the migration to fire — CLAUDE.md gotcha #6).

---

## PR-5 — Audit-doc refresh (NoralOS — small)

Update these docs to reflect the re-scope:
- `docs/audit/consolidation-plan.md` §Phase 6 — rewrite to match the actual roadmap
- `docs/audit/overlap-map.md` §C1 — Conference Room is gone; update accordingly
- `docs/audit/uiux-streamlining.md` Tier 1 #2 — three plugins → two retired (one
  already gone)
- `BROOKLYN_LLM_INTEGRATION_MAP.md` — strip Conference Room references

No code changes; just markdown. Small PR.

### Meta

- Title: `docs(phase-6): refresh audit docs after Conference Room retirement`
- Base: `master`

---

## Anti-goals (all PRs)

- Do NOT touch the auto-register-* race condition (CLAUDE.md gotcha #7). It's a
  real bug, separate fix.
- Do NOT re-introduce conference-room-bridge concepts (the surface flag set is
  three: `dashboard`, `slack`, `phone` — `conference_room` is gone).
- Do NOT extend NV with anything beyond the `/embed/synthesize` endpoint described
  in PR #9's design doc. Per-provider quirks live in the synth helper; do not
  add new endpoints.
- Do NOT bundle NoralVoice as a sidecar container.
- Do NOT skip PR-3's soak window. The Dashboard autoplay is lower-stakes than
  Conference Room was, but it's still user-visible.

## Stop and report if (cross-PR)

- NoralVoice's `service_factory.create_tts_service` signature has changed since
  PR #9's design was written. If `user_config` shape diverges, propose the
  minimum-diff and ask before extending.
- voice-cascade has a consumer that didn't surface in the prior session's
  audit (`useChatVoiceAutoplay`, `api/voiceCascade.ts`, `api/plugins.ts`,
  `CompanyIntegrations.tsx`, integration assignment/credential paths). Grep
  again before PR-3.
- Standalone NV smoke fails. Roll back.
- Dashboard autoplay error rate spikes during PR-2's soak. Flip the flag back.

## When you finish (all 5 PRs)

Reply with:
1. PR URLs + merge statuses
2. Smoke results per PR
3. 1-week soak summary for PR-2 before PR-3 landed
4. Final LOC delta across voice-cascade + voice-config (target: ≥ -2400)
5. Combined Phase 6 win including the already-shipped #105: target ≥ -6300 LOC
6. Final plugin inventory:
   `docker exec noralos-db psql -c "SELECT plugin_key, version, status FROM plugins
    WHERE status='ready' ORDER BY plugin_key"`
7. Whether the real-provider integration test in PR-1 was actually run, and against
   which provider(s)
8. Anything punted (likely: per-provider integration tests with all 9 providers;
   org-quota / rate-limiting for the synth endpoint; bucket lifecycle policy for
   24h auto-deletion)

Do not start Phase 7. Wait for the next prompt.
