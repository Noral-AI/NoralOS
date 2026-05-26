# Prompt: Phase 6 cleanup → Phase 7 finish → Phase 8 → end-to-end platform verification

You are closing out the NoralOS ↔ NoralVoice consolidation. Phases 0–7 shipped (partially for 7). Your job: finish every deferred piece, ship Phase 8, then verify the platform works end-to-end. **No bandaids, no shortcuts** — every fix is the proper long-term implementation.

## State of the world (verified 2026-05-17)

**Master state:**
- NoralOS `master` @ `7d464414` (Phase 7 PR-4 merged) — but Docker build is RED because the lockfile is stale after [#110](https://github.com/Noral-AI/NoralOS/pull/110).
- NoralVoice `rebrand/noralvoice` @ `ae7b21f` (Phase 7 PR-2 merged + tag `sdks-v0.3.0-prerelease` cut).
- Production: `agent.noral.ai` (NoralOS), `voice.noral.ai` (NoralVoice).

**The lockfile-bot already prepared the fix** on branch `chore/refresh-lockfile` (commit `1b5e65a1`, single lockfile commit). It's blocked from auto-opening a PR by repo policy.

**Phase 6 left two PRs explicitly deferred** behind a 1-week prod soak that opened today: PR-3 (retire `voice-cascade` plugin) + PR-4 (retire `voice-config` plugin). The plugins still exist in `packages/plugins/` and serve no consumers after [OS#106](https://github.com/Noral-AI/NoralOS/pull/106) shipped.

**Phase 7 shipped 5 of 7 planned PRs.** Deferred work, in order of how it should be tackled:

1. **NV response-model typing pass.** Many routes returning `unknown` in the OpenAPI emit (e.g. `testPhoneCall`, `deleteKbDocument`, `revokePersistentEmbedToken`) because the route handler returns a raw dict instead of a Pydantic model. This blocks the typed-SDK adoption and makes generated SDK methods less safe. Fix this BEFORE the plugin SDK adoption refactor.
2. **Plugin SDK adoption refactor.** `packages/plugins/noralai-noralvoice/src/noralvoice-client.ts` is 1170 LOC of hand-rolled `fetch`. Replace with `DograhClient` from `@noralai/voice-sdk`. Target: shrink the client to ~150 LOC of auth + non-SDK helpers (synthesizeAudio, exchange-token mint, webhook register/delete). Update every tool handler in `src/tools/` to use the SDK directly.
3. **5 deferred read tools.** `get_run_detail`, `list_recordings`, `get_recording_download_url`, `list_kb_documents`, `get_daily_report`. The first three depend on a NEW NV route for recording download URLs (currently missing — only the public `/api/v1/public/download/...` token path exists).
4. **13 write tools.** KB writes (`upload_kb_document`, `delete_kb_document`), campaign lifecycle (`create_campaign`, `start_campaign`, `pause_campaign`, `resume_campaign`, `redial_campaign`), workflow tool defs (`add_workflow_tool`, `update_workflow_tool`, `delete_workflow_tool`), embed-token CRUD (`create_persistent_embed_token`, `get_persistent_embed_token`, `revoke_persistent_embed_token`). Each has specific safety requirements (see "Safety contracts" below).
5. **Schema-sharing package** (`@noralai/voice-schemas`) — defer, NOT in this scope.
6. **`agents.voice_agent_uuid` first-class FK column** — promote from JSON. Drizzle migration + backfill.
7. **LLM-driven workflow generation** — defer, NOT in this scope.

**[OS#109](https://github.com/Noral-AI/NoralOS/issues/109) e2e race** — `signoff-policy.spec.ts` agents share state across tests and runIds invalidate mid-test. Real fix per the issue body: option (a) fresh agents per test via `beforeEach`, OR option (b) explicit teardown that waits for agent async tails. Pick (a) — simpler and the test currently uses `beforeAll` so the migration is mechanical.

**Phase 8** — not started:
1. Rename `services.dograh.com` → `services.noral.ai` everywhere in NV (code + docker-compose + .env.example + docs).
2. Deploy `services.noral.ai` (same backend, new domain).
3. Make managed-keys path **opt-in** — fresh OSS installs default to BYO keys with a "or use managed credits" toggle. Default `MANAGED_KEYS_ENABLED=false`.
4. PostHog/Sentry telemetry: make opt-in per-deploy. Default `TELEMETRY_ENABLED=false` in OSS docker-compose; ON in `agent.noral.ai` deploy.
5. Document the fully-airgapped NoralVoice deploy path in `docs/deploy/airgapped.md`.

**Twilio is a special case the user added to scope.** Today telephony provider configuration is operator-only (board apiRoute, no agent tool). The user wants an agent to be able to **add Twilio credentials and have outbound + inbound calls work end-to-end**. That needs:
- A new agent tool `add_telephony_credential` (manager-tier) that wraps NV's existing `POST /api/v1/organizations/telephony-configs` endpoint.
- Verification that NV's Twilio outbound flow works (`initiate-call` → Twilio API → call placed).
- Verification that NV's Twilio inbound flow works (Twilio POSTs to `/api/v1/telephony/inbound/{workflow_id}` → workflow triggers).
- The phone-number-to-workflow assignment route (`POST /api/v1/organizations/phone-numbers`) needs an agent tool too: `assign_phone_number_to_workflow` (manager-tier).

**Zoho integration** is NoralOS-side via Nango at `server/src/routes/integrations-oauth.ts`. No code changes needed unless smoke surfaces breakage.

## Repos / branching

| Role | Path | Origin | Branch |
|---|---|---|---|
| NoralOS (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` | `github.com/Noral-AI/NoralOS` | `master` |
| NoralVoice | `/Users/quentin/Documents/NORALAI/NoralVoice` | `github.com/Noral-AI/NoralVoice` | `rebrand/noralvoice` |
| NoralOS (decoy — DO NOT PUSH) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` | n/a | n/a |

Work in worktrees under `.claude/worktrees/<phase>-<pr>` to keep canonicals clean. Set local `user.name "Quentin Matthews"` and `user.email "quentin@noralconsulting.com"` per worktree.

**Python venv at** `/Users/quentin/Documents/NORALAI/NoralVoice/venv` was set up in the prior session with Python 3.11. To run codegen: `PATH=/Users/quentin/Documents/NORALAI/NoralVoice/venv/bin:$PATH bash ./scripts/generate_sdk.sh`.

## Order of operations

Each PR self-contained. Open → admin-merge → next.

### PR-A: Lockfile refresh (BLOCKING — must be first)

Open the auto-prepared PR and merge. Wait for Docker workflow to go green on master before any other deploy.

```
gh pr create --repo Noral-AI/NoralOS --base master --head chore/refresh-lockfile \
  --title "chore(lockfile): refresh pnpm-lock.yaml after Phase 7 SDK bump"
```

Admin-merge it. Then verify `gh run list --repo Noral-AI/NoralOS --workflow Docker --branch master --limit 1` shows `success`.

### Deploy gate 1 (manual)

After PR-A merges and Docker is green:
```
ssh root@agent.noral.ai '/opt/noralos/deploy.sh'
```

Then run the smoke from "Smoke A" below before moving on.

### PR-B: Close 6 stale Conference Room PRs

Conference Room was retired in [OS#105](https://github.com/Noral-AI/NoralOS/pull/105). These open PRs target dead code. Close them with a comment pointing to #105.

```
for pr in 28 40 43 44 45; do
  gh pr close $pr --repo Noral-AI/NoralOS \
    --comment "Conference Room retired in #105. Closing as obsolete."
done
```

[OS#60](https://github.com/Noral-AI/NoralOS/pull/60) (Twilio SMS plugin foundation) is unrelated to consolidation — DON'T close it. It's a separate initiative and we'll either land it in PR-J or leave it for later.

### PR-C: Retire `voice-cascade` plugin (Phase 6 PR-3 from original plan)

`packages/plugins/voice-cascade/` no longer has consumers — [#106](https://github.com/Noral-AI/NoralOS/pull/106) migrated `useChatVoiceAutoplay` to NV TTS behind `NEXT_PUBLIC_ENABLE_NV_TTS_AUTOPLAY`. Flag has been ON in dev for 1+ week and just opened the prod soak today.

Steps:
1. Confirm soak: `grep -r "voiceCascade\|voice-cascade" /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/ui /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/server` — any remaining live callers? The PR-2 plan said only the `health` probe in `CompanyIntegrations.tsx` remains. Audit and either migrate or document why it stays.
2. Migrate the health probe: replace with a NV-side health check (or remove if the probe is obsolete post-retirement).
3. `rm -rf packages/plugins/voice-cascade/`.
4. Remove the workspace glob match (none needed — `packages/plugins/*` will just not find it).
5. Remove from `docker-compose.yaml` (if listed).
6. DB cleanup: in the PR description, add the post-merge action: `UPDATE plugins SET status='uninstalled' WHERE plugin_key='noralos.voice-cascade'`.
7. Lockfile policy: PR ships package.json deletions only; `chore/refresh-lockfile` cycle picks up the pnpm-lock change automatically.

PR title: `chore(phase-6): retire voice-cascade plugin (1-week soak passed)`.

### PR-D: Retire `voice-config` plugin (Phase 6 PR-4 from original plan)

`packages/plugins/voice-config/` was the legacy voice-settings plugin. Phase 3 ([#87](https://github.com/Noral-AI/NoralOS/pull/87)) migrated voice settings to `noralai.noralvoice`. The plugin has been a redirect target since.

Steps:
1. Audit live consumers: `grep -rn "voice-config\|voiceConfig\|@noralos-plugins/voice-config" /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/{ui,server,packages}` excluding the plugin's own dir. Any remaining? Migrate or document.
2. `rm -rf packages/plugins/voice-config/`.
3. Same docker-compose + DB cleanup steps as PR-C.

PR title: `chore(phase-6): retire voice-config plugin (Phase 3 migration soak complete)`.

### Deploy gate 2

After PR-C and PR-D merge + Docker green + lockfile refresh PR merged:
```
ssh root@agent.noral.ai '/opt/noralos/deploy.sh'
```

Verify `agent.noral.ai` health endpoint + plugins table no longer lists `voice-cascade` / `voice-config` with `status='ready'`.

### PR-E: NV response-model typing pass

Foundation for the rest of Phase 7. Audit every route tagged with `@sdk_expose` in `api/routes/` and ensure each declares a proper Pydantic `response_model`. Routes currently returning bare dicts emit `response_model: unknown` in the OpenAPI, which means the SDK can't type them.

Specific routes confirmed broken (from PR-1 codegen output `42 operations, 37 schemas reachable` — note 5 operations have no model):

- `POST /embed/initiate-call` → `testPhoneCall(opts: { body: InitiateCallRequest }): Promise<unknown>`. Declare a `InitiateCallResponse` Pydantic model with `run_id: int`, `status: str`, `started_at: datetime | None`.
- `DELETE /knowledge-base/documents/{uuid}` → `deleteKbDocument(documentUuid: string): Promise<unknown>`. Declare `DeleteResponse` with `success: bool`, `message: str`.
- `DELETE /tools/{uuid}` → same pattern.
- `DELETE /recording/{id}` → same pattern.
- `DELETE /workflow/{id}/embed-token` → `revokePersistentEmbedToken(...): Promise<unknown>`. Declare `RevokeEmbedTokenResponse` with `success: bool`, `revoked_token_id: int`.
- `GET /workflow/{id}/embed-token` → `getPersistentEmbedToken(...): Promise<unknown>`. Use the existing `EmbedTokenResponse` but make it `Optional[EmbedTokenResponse]` (route returns `None` when no active token).
- `GET /campaign/{id}/report` → currently returns `StreamingResponse`. This is a CSV download endpoint — keep it streaming but declare `responses={200: {"content": {"text/csv": {}}}}` so the SDK knows it's binary.

For each:
1. Define the Pydantic model in the route file (or in a shared models module if it'll be reused).
2. Add `response_model=<Model>` to the decorator.
3. Update the handler to return an instance of the model, not a bare dict.

After all routes done, regenerate: `bash ./scripts/generate_sdk.sh` and verify the previously-`unknown` returns are now properly typed.

Branch: `feat/phase-7-typed-response-models` against `rebrand/noralvoice`.

### PR-F: SDK release v0.4.0

Bump `sdk/typescript/package.json` and `sdk/python/pyproject.toml` from `0.3.0` → `0.4.0`. Tag `sdks-v0.4.0-prerelease`. Build tarball with `npm pack`. Cut GitHub Release with tarball attached.

The plugin upgrade in PR-G pins to this URL.

### PR-G: Plugin SDK adoption refactor

The 1170-LOC `noralvoice-client.ts` collapses to ~150 LOC. Every existing tool handler under `packages/plugins/noralai-noralvoice/src/tools/` switches from importing legacy helpers to using `DograhClient`.

Implementation:
1. Bump `@noralai/voice-sdk` URL in plugin package.json to PR-F's v0.4.0 tarball.
2. Rewrite `noralvoice-client.ts`:
   - Keep `NoralVoiceClientConfig`, `NoralVoiceErrorCategory`, `NoralVoiceClientError`, `buildHeaders`, `joinUrl`, `request<T>()` (the last three only because some non-SDK helpers still need them).
   - Keep `synthesizeAudio` (uses `/synthesize` endpoint with X-API-Key directly — already in PR-2 of Phase 6).
   - Keep `createEmbedExchangeToken` (one-shot iframe login — not sdk_exposed).
   - Keep `registerIntegrationWebhook` + `deleteIntegrationWebhook` (lifecycle hooks, called by host plugin loader).
   - **Delete** every other exported function. They become `client.X()` calls inline in the tool handlers.
3. For each existing tool in `tools/`, rewrite to construct a `DograhClient` and call the typed method:
   ```ts
   import { DograhClient } from "@noralai/voice-sdk";
   const client = new DograhClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
   const result = await client.listWorkflows({ status: params.status });
   ```
4. Where the SDK return type differs from what the tool exposed, adapt at the tool boundary — don't change the SDK to match (the SDK reflects NV's API surface).
5. Update all vitest files under `packages/plugins/noralai-noralvoice/src/tools/__tests__/` to mock `DograhClient` methods instead of `fetch`. The mocking pattern: `vi.mock("@noralai/voice-sdk", () => ({ DograhClient: vi.fn().mockImplementation(() => ({ listWorkflows: vi.fn().mockResolvedValue([...]) })) }))`.

Stop conditions:
- If `tsc --noEmit` produces NEW errors (beyond the 4 pre-Phase-5d ones) — investigate before merging. The whole point of typed SDK adoption is to gain compile-time safety, not lose it.
- If error category normalization (`NoralVoiceErrorCategory`) doesn't map cleanly onto the SDK's `ApiError`, write a thin adapter rather than changing the SDK.

Branch: `refactor/phase-7-plugin-adopt-sdk`. Bump `PLUGIN_VERSION` 0.3.0 → 0.4.0.

### PR-H: Promote 5 deferred read tools

Add agent-callable wrappers for `get_run_detail`, `list_recordings`, `get_recording_download_url`, `list_kb_documents`, `get_daily_report`. All worker-tier.

`get_recording_download_url` requires a NEW NV route — the current download path is the public token route. Add `GET /api/v1/recording/{recording_id}/download-url` to `api/routes/workflow_recording.py` that mints a 5-minute presigned URL for the recording's storage_key. Authenticated, scoped to organization. Tag with `@sdk_expose(method="get_recording_download_url", description="...")`.

Then regenerate SDK in a follow-on commit on the PR.

Plugin side: add 5 entries to `tools/registry.ts`, 5 manifest entries, 5 `registerTool` blocks in `worker.ts`, 5 handler files under `tools/`. Vitest coverage for each.

Branch: `feat/phase-7-read-tools-complete`. Plugin version 0.4.0 → 0.5.0.

### PR-I: Write tools — 13 of them, grouped by safety contract

**Group 1 (3 tools): Workflow tool defs.** `add_workflow_tool`, `update_workflow_tool`, `delete_workflow_tool`. Manager-tier. Wrap `createTool`, `updateTool`, `deleteTool` SDK methods. Standard pattern, no safety quirks.

**Group 2 (5 tools): Campaign lifecycle.** `create_campaign`, `start_campaign`, `pause_campaign`, `resume_campaign`, `redial_campaign`. Manager-tier. Standard pattern.

**Group 3 (2 tools): KB writes.** `delete_kb_document` (manager-tier, standard). `upload_kb_document` (manager-tier, **needs SSRF threat model**):
   - Body shape: `{ name: string; content_text?: string; source_url?: string }` — must accept ONE of the two, not both.
   - If `source_url`: NoralVoice's `processKbDocument` endpoint must fetch it. SSRF guard required:
     - Reject any URL where the resolved hostname is in RFC1918 / loopback / link-local space.
     - Reject any URL where the resolved hostname matches NV's own backend or any of NV's known internal services.
     - Implement this server-side in NoralVoice (not at the plugin boundary — the plugin can't fully validate post-DNS-resolution).
     - The SSRF guard PR is a NV-side prereq: branch `feat/phase-7-kb-ssrf-guard` against `rebrand/noralvoice`. Land BEFORE the plugin `upload_kb_document` tool ships.
   - If `content_text`: bypass URL fetch entirely; size-limit at 1 MB.

**Group 4 (3 tools): Embed-token CRUD.** Manager-tier.
   - `create_persistent_embed_token`: must NOT return the secret token string in the agent's tool result (agents log returns; that would leak the secret). Return only `{ embed_token_id: number, masked_suffix: string, script_snippet_template: string }` where the snippet has a `<EMBED_TOKEN_HERE>` placeholder. Operators get the secret via a separate UI mint flow.
   - `get_persistent_embed_token` (worker-tier read): same masking.
   - `revoke_persistent_embed_token`: standard.

Each group is a separate commit within the PR for review clarity.

Branch: `feat/phase-7-write-tools`. Plugin version 0.5.0 → 0.6.0.

Vitest coverage for each tool. **Specifically test the secret-non-leak invariant for create_persistent_embed_token**: stub the SDK to return a known secret string and assert it appears in NO field of the tool's return value.

### PR-J: Twilio agent credential management + phone number assignment

User-requested scope addition. Adds agent ability to wire Twilio end-to-end without operator intervention.

**NV-side (separate PR):** Verify the existing routes for telephony-config CRUD are `@sdk_expose`-tagged:
- `POST /api/v1/organizations/telephony-configs` → `create_telephony_config`
- `GET /api/v1/organizations/telephony-configs` → `list_telephony_configs`
- `DELETE /api/v1/organizations/telephony-configs/{id}` → `delete_telephony_config`
- `POST /api/v1/organizations/phone-numbers` → `assign_phone_number`
- `GET /api/v1/organizations/phone-numbers` → `list_phone_numbers`
- `DELETE /api/v1/organizations/phone-numbers/{id}` → `unassign_phone_number`

If any are untagged, tag them. Regenerate SDK. Same release cycle — bump to v0.5.0 if you're stacking, or open a separate v0.5.0 release after PR-H.

**Plugin-side:** Add 3 new agent tools:
- `add_telephony_credential` (manager-tier): wraps `client.createTelephonyConfig({ body: { provider: "twilio", credentials: { account_sid, auth_token } } })`. Validates provider is one of NV's hard-coded supported list (`twilio`, `plivo`, `vonage`, etc.). Secret-handling: credentials passed in must come from a secret reference; reject inline plaintext in the agent's params.
- `list_telephony_credentials` (worker-tier): wraps the list endpoint. Masks `auth_token`/secret fields in the response — never return the raw secret to the agent transcript.
- `assign_phone_number_to_workflow` (manager-tier): wraps `client.assignPhoneNumber({ body: { workflow_id, phone_number, telephony_config_id } })`.

For the Twilio inbound flow:
- Twilio's webhook URL needs to point at `https://voice.noral.ai/api/v1/telephony/inbound/{workflow_id}`. The plugin tool `assign_phone_number_to_workflow` should return the exact webhook URL the user needs to set in their Twilio console (the route returns this in its response — surface it in the tool's `content` field for the agent to relay to the user).

Branch: `feat/phase-7-twilio-credential-management`. Plugin version 0.6.0 → 0.7.0.

### PR-K: Fix [OS#109](https://github.com/Noral-AI/NoralOS/issues/109) e2e race

`tests/e2e/signoff-policy.spec.ts`. The race is shared `ctx.executor/reviewer/approver` agents across all tests via `beforeAll`. Switch to `beforeEach` so each test gets fresh agents.

Steps:
1. Move `setupCompany()` from `beforeAll` to `beforeEach`. Each test gets a fresh company, 3 fresh agents, fresh issue.
2. Move teardown from `afterAll` to `afterEach`: delete issues, agents, company.
3. Confirm no test-shared `ctx.issueIds` state remains (it currently accumulates across tests).
4. Run the full e2e suite locally if possible; if not, push and let CI verify.

Same race may surface in other specs (`onboarding.spec.ts`) but they're not currently failing — investigate only if they start failing post-fix.

Branch: `fix/e2e-signoff-policy-test-isolation`.

### Deploy gate 3

After PR-E through PR-K merge + Docker green:
```
ssh root@agent.noral.ai '/opt/noralos/deploy.sh'
```

Smoke from "Smoke B" below.

### PR-L: `agents.voice_agent_uuid` first-class FK column promotion

Currently JSON. Promote to a proper indexed FK to `noralai.noralvoice`'s side of the integration.

Drizzle migration:
1. Add column `voice_agent_uuid` (uuid, nullable) to `agents` table.
2. Add index on `voice_agent_uuid`.
3. Backfill from the JSON field (whatever Phase 3 stored — likely `agents.attributes->>'voice_agent_uuid'`).
4. Update the plugin's `provision_voice_agent.ts` to write the new column instead of (or in addition to, for one release) the JSON field.
5. Future PR removes the JSON field after a soak.

Branch: `feat/phase-7-voice-agent-uuid-column`. Migration file under `packages/db/src/migrations/`.

### PR-M..Q: Phase 8 — MPS rename + standalone independence

Phase 8 is parallel-safe but it makes sense to land it after Phase 7 cleanup so the final smoke covers everything.

**PR-M: Rename `services.dograh.com` → `services.noral.ai` in code.** Grep + sed. Verify no leftover references via:
```
grep -rn "services\.dograh\.com" /Users/quentin/Documents/NORALAI/NoralVoice
```
Should return 0 results post-PR. Branch: `chore/phase-8-services-rename` against `rebrand/noralvoice`.

**PR-N: Deploy `services.noral.ai`.** DNS + cert + same backend behind the new domain. Old `services.dograh.com` stays alive one release minimum (per Phase 8 plan). This is an INFRA action, not a code PR — document the steps in a runbook at `docs/deploy/services-domain-cutover.md`.

**PR-O: Managed-keys opt-in default.** Currently `MANAGED_KEYS_ENABLED` defaults true. Change OSS docker-compose to default `false`. Add a clear `or use managed credits` toggle in the settings UI. Document in `docs/deploy/byo-keys.md`. Branch: `feat/phase-8-managed-keys-opt-in`.

**PR-P: Telemetry opt-in default.** PostHog + Sentry currently phone home by default. OSS docker-compose: `TELEMETRY_ENABLED=false`. `agent.noral.ai` deploy: keep ON. Add UI toggle. Branch: `feat/phase-8-telemetry-opt-in`.

**PR-Q: Airgapped deploy doc.** `docs/deploy/airgapped.md`. Covers full local-only deploy: BYO keys, telemetry off, no `services.dograh.com`/`services.noral.ai` dependency. Verify by running `docker compose up` on a freshly cloned NoralVoice with `MANAGED_KEYS_ENABLED=false TELEMETRY_ENABLED=false` and placing a test call with operator-supplied Twilio creds.

### Deploy gate 4 (final)

Final deploy + full end-to-end smoke (Smoke C below).

## Safety contracts (apply across all PRs)

- **No secrets in agent tool return values.** Whenever a tool wraps a NV endpoint that returns credentials (telephony, API keys, embed tokens), mask the secret in the tool's return. The plugin's `noralvoice-client.ts` already has examples of this pattern for the apiRoute handlers — apply it consistently.
- **Tier gates enforced server-side, not just client-side.** Even if a manager-tier tool is mis-invoked by a worker-tier agent, the NV endpoint must independently reject it (most do via the X-API-Key scope — verify).
- **SSRF guard runs server-side in NV.** Plugin-side checks are advisory; server is authoritative.
- **Lockfile policy.** Per repo CLAUDE.md: PRs ship `package.json` changes only; never include `pnpm-lock.yaml`. The auto-refresh workflow handles it post-merge.
- **Plugin version bump per manifest change.** Every PR that changes `manifest.ts` (tools, apiRoutes, capabilities, UI slots) bumps `PLUGIN_VERSION` in `constants.ts`. Auto-register only refreshes the DB manifest on version change.

## Smoke A — after first deploy (post lockfile + PR-C/D cleanup)

Manual, with browser + curl:

1. `curl https://agent.noral.ai/api/health` → 200, `{"status": "healthy"}`.
2. Log in to `agent.noral.ai` as your admin user. Voice Director shows in the agent list. Open it.
3. Voice Director's tool list (visible in the agent detail panel) lists ≥10 tools including `list_workflows`, `list_runs`, `list_campaigns`, `get_campaign`, `search_kb`. Plugin version reads `0.3.0`.
4. `psql` into `noralos-db`:
   ```
   SELECT plugin_key, version, status FROM plugins WHERE status='ready' ORDER BY plugin_key;
   ```
   Expected: `noralai.noralvoice | 0.3.0 | ready`. After PR-C/D: `voice-cascade` and `voice-config` either absent or `status='uninstalled'`.
5. Open Dashboard. Have an agent post a comment. Audio autoplays via NV TTS (flag should be ON in prod after this point — flip if needed). Look for `agentEntryId` in NV's `audio/synthesized/` bucket logs.
6. **Zoho smoke**: in `agent.noral.ai` company settings → integrations, the Zoho OAuth flow completes. The token saves. `gh api repos/noral-ai/.../integrations` (or your equivalent) returns the integration_credentials row.

## Smoke B — after Phase 7 finish (post PR-K)

1. All Smoke A checks still pass.
2. Plugin version reads `0.7.0` (after PR-J).
3. Voice Director's tool list now includes ~16-18 tools including all the writes (`create_campaign`, `start_campaign`, `add_telephony_credential`, etc.).
4. **NV pytest** runs clean: `cd /Users/quentin/.../NoralVoice && PATH=.../venv/bin:$PATH python -m pytest api/tests/` — no new failures vs. baseline.
5. **NoralOS verify CI** passes (the e2e race fix should make `signoff-policy.spec.ts` reliable).

## Smoke C — final end-to-end (post Phase 8)

The user-stated requirements verified one by one:

1. **All agents operate.**
   - In `agent.noral.ai`, hire a fresh `engineer`-tier agent. Heartbeats fire. Agent can check out an issue, comment, and complete it.

2. **NoralOS agents operate via voice.**
   - In Brooklyn (or any manager-tier agent), call `provision_voice_agent` for a worker-tier agent. Voice agent UUID writes back to `agents.voice_agent_uuid` (now the proper FK column post PR-L).
   - Call `set_agent_voice` to set the agent's TTS voice. Setting succeeds, shows in the agent detail panel.

3. **Zoho integration works.**
   - From a fresh company in `agent.noral.ai`, connect Zoho via OAuth. Token saves. Agent can read Zoho-sourced data (assuming there's a tool for that — if not, Zoho integration "working" just means the OAuth + token storage works, not that there's an agent surface).

4. **NoralVoice works.**
   - Open `voice.noral.ai` directly. Sign up. Build a workflow with one Agent node. Place a test call. Call completes. Recording + transcript available.

5. **Agent can add Twilio credentials.**
   - In Voice Director, instruct it to "add Twilio credentials with account SID X and auth token Y". Voice Director calls `add_telephony_credential`. Returns success + masked credential.
   - Verify in NV: `GET /api/v1/organizations/telephony-configs` returns the new config with the token masked.

6. **Agent can dial out.**
   - Voice Director calls `run_call` (or `test_phone_call` post-SDK adoption) targeting your cell phone with a test workflow. Phone rings. Conversation completes. Run shows in `list_runs`.

7. **Agent can receive calls.**
   - Voice Director calls `assign_phone_number_to_workflow` with a Twilio number purchased outside the platform. Tool returns the webhook URL to set in Twilio console.
   - You set the webhook URL in Twilio. Call the number. Workflow triggers. Conversation completes. Run shows in `list_runs`.

8. **No part of the platform is non-functional.**
   - `agent.noral.ai/api/health` → 200.
   - `voice.noral.ai/api/health` → 200.
   - All 16+ agent tools dispatchable without errors (call each once via test agent; capture which fail with what error).
   - All board UI pages load (open each top-level nav item in `agent.noral.ai`; nothing 404s or errors).
   - Plugin auto-register completed cleanly (no `status='error'` rows in `plugins` table).

## Definition of Done

The user can:
- Sign up at `voice.noral.ai`.
- Sign up at `agent.noral.ai`.
- Connect Zoho (NoralOS side).
- Have an agent (via chat with Voice Director or Brooklyn) add Twilio credentials, build a voice workflow, place an outbound call to themselves, and receive an inbound call after assigning a phone number.
- Audio autoplay in Dashboard agent chats works end-to-end via NV TTS.
- `agent.noral.ai` is on NoralOS master with the lockfile fresh.
- `voice.noral.ai` is on NoralVoice `rebrand/noralvoice` (or its eventual main merge).
- No `voice-cascade` or `voice-config` plugin rows in `plugins`.
- No CI red on master (verify, e2e, Docker, Refresh Lockfile all green).
- No `services.dograh.com` references in code.

## Stop conditions

Stop and report (don't paper over) if:

- Docker build stays red after the lockfile PR merges. The fix isn't working — investigate before more PRs land.
- Plugin auto-register goes to `status='error'` with "Worker already registered" (CLAUDE.md gotcha #7). Documented recovery: `UPDATE plugins SET status='ready', last_error=NULL WHERE plugin_key='noralai.noralvoice'` + restart. Do this once; if it happens twice in a session, dig into the auto-register bug.
- Twilio outbound call fails. Could be: Twilio account credit, phone number not purchased, webhook URL wrong, NV's Twilio adapter regressed. Surface all four hypotheses.
- Twilio inbound webhook returns 401 from NV. Likely cause: signature validation. NV's `_validate_inbound_request` (`api/routes/telephony.py:293`) is the relevant code.
- Any of the 13 write tools surfaces a NV bug (response shape mismatch, missing field, 500). Land a NV fix PR before continuing.
- The SSRF guard PR rejects a URL that should have been allowed (e.g. customer-controlled public CDN). Loosen the guard with a clear allowlist mechanism — don't just remove the check.

## When you finish

Reply with:

1. All PR URLs + merge SHAs (NoralOS + NoralVoice).
2. Final plugin version (target: `0.7.0`).
3. Final SDK release URL (target: `sdks-v0.4.0-prerelease` or later).
4. Final agent-callable tool count (target: ~18-20).
5. `noralvoice-client.ts` LOC delta (target: ~-1000, ending around 150 LOC).
6. Smoke C verification: pass/fail per item 1-8.
7. Plugin inventory: `psql` query result confirming `voice-cascade` + `voice-config` are gone and `noralai.noralvoice@0.7.0` is `ready`.
8. The single sentence that summarizes whether the platform is fully functional or not, with any caveats.

## Verification this plan covers everything

| User requirement | Covered by | How |
|---|---|---|
| All agents operate | Existing platform + PR-K (e2e fix) | Smoke C step 1; agents path was already working |
| NoralOS agents via voice | PR-G (SDK adoption), PR-L (voice_agent_uuid FK) | Smoke C step 2; Voice Director template + provision_voice_agent + set_agent_voice |
| Zoho works | No code changes; verify only | Smoke A step 6, Smoke C step 3 |
| NoralVoice works | PR-E (typing), PR-G (refactor), Phase 8 PRs | Smoke C step 4 |
| Agent adds Twilio creds | PR-J (`add_telephony_credential`) | Smoke C step 5 |
| Agent dials out | PR-G refactor of `run_call` to typed SDK + PR-J for credential flow | Smoke C step 6 |
| Agent receives calls | PR-J (`assign_phone_number_to_workflow` + Twilio inbound webhook) | Smoke C step 7 |
| No non-functional parts | All PRs + every smoke check | Smoke C step 8 |
| Long-term, no bandaids | Each PR addresses root cause: typing pass before SDK adoption, FK column before deprecation, SSRF guard server-side, fresh agents per test (option a, not delay-based option b) | — |

If any requirement isn't traceable to a specific PR + smoke step above, STOP and revise this plan before executing.
