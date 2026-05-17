You are executing **Phase 7** of the NoralOS ↔ NoralVoice consolidation —
"full tool coverage + typed SDK adoption."

## State of the world (verified 2026-05-16)

**Phase 6 in flight** — assume nothing past these is shipped:

- [NoralOS #105](https://github.com/Noral-AI/NoralOS/pull/105) MERGED `8f2b9076` — Conference Room retired.
- [NoralVoice #9](https://github.com/Noral-AI/NoralVoice/pull/9) OPEN — `/synthesize` skeleton.
- [NoralVoice #10](https://github.com/Noral-AI/NoralVoice/pull/10) OPEN, stacked on #9 — real impl + dual-auth.
- [NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106) OPEN — Dashboard autoplay flag-gated through NV TTS.
- [NoralOS #107](https://github.com/Noral-AI/NoralOS/pull/107) OPEN — audit-doc refresh.
- Phase 6 PR-3 (voice-cascade retire) and PR-4 (voice-config retire) **DEFERRED** behind a 1-week prod soak of #106. Will land in parallel with Phase 7.

**`noralai.noralvoice` plugin current state** (verified by grep):

- **6 agent-callable tools** (`tools/registry.ts` `TOOL_MIN_TIER_V3` + `manifest.ts` `tools[]`):
  - `list_workflows` (worker), `get_run` (worker), `run_call` (manager)
  - `list_voices` (worker), `set_agent_voice` (manager), `provision_voice_agent` (manager)
- **19 board-callable apiRoutes** (`manifest.ts` `apiRoutes[]` — for operator UI, NOT agent-callable):
  - `list_workflows`, `create_voice_director`, `get_agent_voice_config`, `set_agent_voice_config`, `provision_voice_for_agent`, `list_voices_board`, `list_runs`, `get_run_detail`, `list_recordings`, `get_recording_download_url`, `search_kb`, `list_kb_documents`, `list_campaigns`, `get_campaign`, `list_telephony_numbers`, `list_telephony_providers`, `get_usage_current`, `create_workflow_embed_token`, `transcript_pump_control`, `synthesize` (Phase 6 PR-2)
- **Plugin code size**: `noralvoice-client.ts` 1036 LOC + `worker.ts` 1610 LOC + `manifest.ts` 604 LOC = ~3250 LOC total.
- **`@noralai/voice-sdk` dependency declared but NOT imported anywhere.** Plugin's `noralvoice-client.ts` header says "thin wrapper around `@noralai/voice-sdk`" — that's aspiration, not reality. The file is hand-rolled `fetch` against NV REST endpoints.

**NoralVoice SDK pipeline already exists** (this is the key finding):

- `api/sdk_expose.py` — opt-in marker. Routes tagged with `@router.METHOD(path, **sdk_expose(method="...", description="..."))` get included in the SDK.
- `scripts/generate_sdk.sh` — walks the FastAPI app's OpenAPI schema, filters to `x-sdk-method`-tagged operations, generates `sdk/typescript/src/_generated_client.ts` + `_generated_models.ts` + Python equivalents.
- Published as GitHub Release tarball: `sdks-v0.2.0-prerelease` (`noralai-voice-sdk-0.2.0.tgz`).
- **18 `sdk_expose` calls across 7 route files** → **11 generated SDK methods** (some routes have multiple HTTP methods).

**SDK coverage gap by route file:**

| Route file | Endpoints | `sdk_expose` tags |
|---|---|---|
| `campaign.py` | 12 | **0** ← entire campaign surface invisible to SDK |
| `organization.py` | many (telephony-configs CRUD, phone numbers CRUD) | **0** |
| `reports.py` | 3 | **0** |
| `workflow_embed.py` | 3 (POST/GET/DELETE persistent embed-token) | **0** |
| `workflow.py` | many | 5 |
| `knowledge_base.py` | 6 | 2 |
| `tool.py` | 6 | 2 |
| `telephony.py` | 5 | 2 (`/initiate-call` only) |
| `workflow_recording.py` | 6 | 2 |
| `credentials.py` | 5 | 2 |
| `node_types.py` | 3 | 3 |

## What Phase 7 actually is

Two parallel surface expansions, both in `noralai.noralvoice` plugin:

1. **NV SDK coverage expansion** — add `sdk_expose` tags to NV routes that should be plugin-callable; regenerate the SDK; cut a new SDK release; bump the plugin's SDK dependency. NV-side work.
2. **Plugin agent-tool expansion** — both promote existing-apiRoutes to also-agent-callable tools (where the read makes sense for an agent) and add genuinely-new write tools. NoralOS-side work.

Plus a migration that should happen before-or-during expansion:

3. **Plugin's `noralvoice-client.ts` adopts the generated SDK.** Today it's 1036 LOC of hand-rolled `fetch`. The SDK exists and is wired as a dependency but not imported. This is the cleanest moment to migrate — otherwise every new tool perpetuates the hand-rolled pattern.

## Binding context (read in this order)

```
NoralOS-canonical:
  CLAUDE.md                                                ← all 7 plugin gotchas
  docs/audit/consolidation-plan.md §Phase 7                ← original plan (notes shared-schema package)
  packages/plugins/noralai-noralvoice/src/
    constants.ts                                           ← PLUGIN_VERSION, tool-name constants
    manifest.ts                                            ← tools[] (6) + apiRoutes[] (19) + capabilities + UI slots
    tools/registry.ts                                      ← TOOL_MIN_TIER_V3 (the tier gate the worker reads at dispatch)
    tools/*.ts                                             ← existing tool handlers (pattern to copy)
    noralvoice-client.ts                                   ← hand-rolled client (target for SDK migration)
    worker.ts                                              ← onApiRequest router (19 route handlers today)
  package.json (plugin)                                    ← @noralai/voice-sdk dependency line

NoralVoice:
  api/sdk_expose.py                                        ← the SDK marker
  scripts/generate_sdk.sh                                  ← codegen entry point
  api/routes/                                              ← target routes for sdk_expose expansion
  sdk/typescript/src/_generated_client.ts                  ← what the plugin will consume
  sdk/typescript/src/_generated_models.ts                  ← typed request/response models
```

Also read:
- The Phase 6 PR descriptions (#10, #106) for the auth model the new tools follow.
- The plugin's existing `tools/run_call.ts` + `tools/list_workflows.ts` to copy the handler pattern.

## Repos / branching

| Role | Path | Origin | Branch |
|---|---|---|---|
| NoralOS (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` | `github.com/Noral-AI/NoralOS` | `master` |
| NoralVoice | `/Users/quentin/Documents/NORALAI/NoralVoice` | `github.com/Noral-AI/NoralVoice` | `rebrand/noralvoice` |
| NoralOS (decoy — DO NOT PUSH) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` | (hyphenated) | n/a |

Working branches:
- PR-1: `feat/phase-7-sdk-expose-expansion` (NoralVoice)
- PR-2: `chore/phase-7-sdk-release-v0.3` (NoralVoice, tag + release)
- PR-3: `feat/phase-7-plugin-adopt-sdk` (NoralOS)
- PR-4: `feat/phase-7-agent-read-tools` (NoralOS)
- PR-5: `feat/phase-7-agent-write-tools-kb-campaign` (NoralOS)
- PR-6: `feat/phase-7-agent-write-tools-workflow-tooldefs` (NoralOS)
- PR-7: `docs/phase-7-audit-doc-refresh` (NoralOS)

## Prerequisites

Verify before starting PR-1 (these are STOP conditions):

1. **Phase 6 PR-1 ([NV #10](https://github.com/Noral-AI/NoralVoice/pull/10)) merged + deployed.** Some Phase 7 work touches the same NV branch (`rebrand/noralvoice`); merging that first avoids stacking.
2. **Phase 6 PR-2 ([NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106)) merged + deployed.** Plugin worker changes from #106 are the proxy pattern Phase 7's read/write tools follow.
3. **`scripts/generate_sdk.sh` works locally.** Run it against the current NV state and confirm `sdk/typescript/src/_generated_client.ts` regenerates with the existing 11 methods, no diff. If it doesn't, NV's codegen tooling is broken — fix that first.
4. **Optional check**: Phase 6 PR-3 / PR-4 status. They can run in parallel with Phase 7 (different plugins). If they're still open mid-Phase-7, ensure no rebase pain on the audit docs PR (PR-7).

## Goal

After Phase 7:

- Every NV route that makes sense as a plugin entry point has an `sdk_expose` tag. SDK methods grow from 11 to roughly 30-35.
- The plugin's `noralvoice-client.ts` is gone or reduced to a thin auth wrapper around the typed SDK. The hand-rolled `fetch` pattern is retired.
- Agent-callable tool count grows from 6 to ~16. New tools cover:
  - **Read tools** (promote 9 existing read-only apiRoutes to be agent-callable too): `list_runs`, `get_run_detail`, `list_recordings`, `get_recording_download_url`, `search_kb`, `list_kb_documents`, `list_campaigns`, `get_campaign`, `get_daily_report`.
  - **Write tools** (genuinely new — covering NV routes that have no apiRoute yet):
    - KB: `upload_kb_document`, `delete_kb_document`
    - Campaigns: `create_campaign`, `start_campaign`, `pause_campaign`, `resume_campaign`, `redial_campaign`
    - Workflow tool definitions: `add_workflow_tool`, `update_workflow_tool`, `delete_workflow_tool` (these are the NV "tools" registry — `api/routes/tool.py`, not workflow nodes)
    - Embed sessions: `create_persistent_embed_token` (the `/workflow/{id}/embed-token` POST, distinct from the existing exchange-token mint)
- Audit docs reflect the actual final scope.

## What is **explicitly NOT** in Phase 7 scope

- Workflow CRUD agent tools (`create_workflow`, `publish_workflow`, etc.) — the NV API has them but the use case is operator UI, not agent ops. Could be a Phase 8 if a real need emerges.
- Telephony provider configuration writes — provider list is hard-coded in NV (`api/services/telephony/registry.py`); per-org telephony-configs CRUD already exists as a board apiRoute. Promoting it to an agent tool isn't useful — operators do this once at setup.
- Credential CRUD agent tools — credentials are operator territory, not agent ops.
- LLM-driven workflow generation (the Phase 7 audit doc mentions "upgrade `noralvoice:design_workflow` from template-fill to graph-generation") — out of scope; this is a separate research-y phase.
- `agents.voice_agent_uuid` promotion to a first-class indexed FK column — minor and orthogonal to the SDK/tool work.

The executing session may suggest moving items in or out of scope, but should ask first.

Standalone `voice.noral.ai` smoke (signup → build → place test call) must pass at the end of every PR.

---

## PR-1 — NV SDK coverage expansion (NoralVoice)

### Scope

Add `sdk_expose` tags to NV routes that Phase 7's plugin tools will call. NO behavior change to any handler — purely metadata.

### Implementation

Add `**sdk_expose(method="...", description="...")` to:

**`api/routes/campaign.py` (all 12)** — current 0 tags:
- `POST /create` → `create_campaign`
- `GET /` → `list_campaigns`
- `GET /{id}` → `get_campaign`
- `POST /{id}/start`, `/pause`, `/resume`, `/redial` → `start_campaign` / `pause_campaign` / `resume_campaign` / `redial_campaign`
- `PATCH /{id}` → `update_campaign`
- `GET /{id}/runs` → `list_campaign_runs`
- `GET /{id}/progress` → `get_campaign_progress`
- `GET /{id}/source-download-url` → `get_campaign_source_url`
- `GET /{id}/report` → `get_campaign_report`

**`api/routes/workflow_embed.py` (3)** — current 0 tags:
- `POST /{workflow_id}/embed-token` → `create_persistent_embed_token`
- `GET /{workflow_id}/embed-token` → `get_persistent_embed_token`
- `DELETE /{workflow_id}/embed-token` → `revoke_persistent_embed_token`

**`api/routes/knowledge_base.py` (the 4 currently untagged)** — current 2 tags (already `list_documents` + `listDocuments`):
- `POST /upload-url` → `create_kb_upload_url`
- `POST /process-document` → `process_kb_document`
- `GET /documents/{uuid}` → `get_kb_document`
- `DELETE /documents/{uuid}` → `delete_kb_document`
- `POST /search` → `search_kb`

**`api/routes/tool.py` (the 4 currently untagged)** — current 2 tags (already covers `list_tools`):
- `POST /` → `create_tool`
- `GET /{uuid}` → `get_tool`
- `PUT /{uuid}` → `update_tool`
- `DELETE /{uuid}` → `delete_tool`
- `POST /{uuid}/unarchive` → `unarchive_tool`

**`api/routes/reports.py` (3)** — current 0 tags:
- `GET /daily` → `get_daily_report`
- `GET /workflows` → `list_report_workflows` (skip if too granular — operator-only)
- `GET /daily/runs` → `list_daily_runs`

**`api/routes/workflow_recording.py` (the 4 currently untagged)** — current 2 tags:
- Add the remaining 4 (the prompt-writer should grep + verify; the headline pattern is "metadata reads + per-recording detail").

Then run `./scripts/generate_sdk.sh` and confirm:
- `sdk/typescript/src/_generated_client.ts` has the new methods (~25-30 net new methods).
- `sdk/typescript/src/_generated_models.ts` has all the new request/response interfaces.
- `tsc --noEmit` in `sdk/typescript/` is clean.
- The python SDK regenerates without error.

### Tests

- The codegen test (`scripts/generate_sdk.sh` is idempotent — running twice produces zero diff) should pass.
- If NV has a `pre-pr-drift-check.yml` workflow that asserts the SDK is in sync with `sdk_expose` tags, it'll run on the PR.

### Smoke

- [ ] `./scripts/generate_sdk.sh` from a clean state produces a diff containing the new methods + zero unrelated changes.
- [ ] Standalone NV smoke passes (signup → build workflow → call).
- [ ] `pre-pr-drift-check.yml` passes.

### Meta

- Title: `feat(phase-7): expand sdk_expose coverage for plugin-callable routes`
- Base: `rebrand/noralvoice` (or `main` if rebrand has finalized — verify before pushing)
- The diff is mostly +1 line per route (the kwarg), plus the regenerated SDK files.

### STOP and report if

- A route's response model isn't a proper Pydantic class — `datamodel-code-generator` produces `Any` or a broken model. Either fix the route's response_model annotation in NV first, or skip that route from sdk_expose with a note in the PR description.
- The campaign endpoints' response models include nested types that recursively expand into the SDK and cause `tsc` errors. Surface and ask before working around.
- The codegen script needs `python` in a specific conda env (`dograh`) that may not be set up locally. The script's header documents the requirement — if the env isn't present, ask the user how they want to run codegen.

---

## PR-2 — NV SDK release v0.3 (NoralVoice)

### Scope

Cut a new SDK release tarball + GitHub release so the NoralOS plugin can pin to it.

### Implementation

1. Bump `sdk/typescript/package.json` version from `0.2.0` to `0.3.0`.
2. Bump `sdk/python/pyproject.toml` to match.
3. Tag the PR-1 merge commit as `sdks-v0.3.0` (or `sdks-v0.3.0-prerelease` per the existing convention).
4. Build the tarball: `cd sdk/typescript && pnpm pack`.
5. Create a GitHub Release with the tarball attached at:
   `https://github.com/Noral-AI/NoralVoice/releases/download/sdks-v0.3.0/noralai-voice-sdk-0.3.0.tgz`

### Smoke

- [ ] Tarball downloads + installs cleanly: `npm install <url>` in a scratch dir.
- [ ] `import { DograhClient } from "@noralai/voice-sdk"` resolves with the expected method count (~30-35 generated methods + any hand-rolled extensions).

### STOP and report if

- The existing `release-automation.yml` workflow auto-runs on tag push and does this for you — skip the manual steps and just push the tag.
- The naming convention has changed (e.g. dropped the `-prerelease` suffix). Match the most recent release.

---

## PR-3 — Plugin adopts typed SDK (NoralOS)

### Scope

Replace `noralvoice-client.ts`'s hand-rolled fetch with calls into the SDK. Net result: the file shrinks from ~1036 LOC to a thin auth-config layer (~150 LOC) that constructs the `DograhClient` and exposes a couple of hand-written wrappers for cases the SDK doesn't cover (e.g. multipart uploads, webhook registration).

### Implementation

1. Bump `@noralai/voice-sdk` URL in `package.json` to the PR-2 tarball URL.
2. `pnpm install` to pick up the new version.
3. Refactor `noralvoice-client.ts`:
   - Keep `NoralVoiceClientConfig` + the error-category enum.
   - Keep the per-call `buildHeaders` for the `X-API-Key` auth.
   - Keep `synthesizeAudio` (PR-2 from Phase 6 — NV's `/synthesize` endpoint uses `X-API-Key` directly, no SDK method exists).
   - Keep `createEmbedExchangeToken` (uses `/embed/exchange-token` which is unlikely to ever be sdk_exposed — it's a one-shot iframe-login flow).
   - Keep `registerIntegrationWebhook` + `deleteIntegrationWebhook` (used by the plugin's lifecycle hook).
   - **Delete** the rest — `listWorkflows`, `runCall`, `getRun`, `setWorkflowVoiceSettings`, etc. Their callers now go through `client.listWorkflows()`, `client.testPhoneCall()`, etc.
4. Update every tool handler under `src/tools/` to use the SDK:
   - `list_workflows.ts` calls `client.listWorkflows({status})`.
   - `run_call.ts` calls `client.testPhoneCall({body})`.
   - `get_run.ts` — needs SDK coverage of `GET /workflow/{id}/runs/{run_id}`. Verify PR-1 added it; if not, surface to ask.
   - etc.
5. Tests: existing vitest files will mostly still pass because they mock the underlying HTTP. Update mocks to mock the SDK methods instead.

### Smoke

- [ ] `pnpm --filter @noralos-plugins/noralai-noralvoice typecheck` shows only the 4 pre-existing Phase-5d errors.
- [ ] `pnpm --filter @noralos-plugins/noralai-noralvoice test` passes all current vitest tests.
- [ ] LOC of `noralvoice-client.ts` drops by ~70%.

### Meta

- Title: `refactor(phase-7): migrate noralvoice plugin client to typed @noralai/voice-sdk`
- Base: `master`
- Bump `PLUGIN_VERSION` 0.2.0 → 0.3.0 — even though no new tool ships in this PR, the manifest reference changes (some tool handlers' module ids).
- **CLAUDE.md gotcha #6 applies**: bump triggers auto-register `upgradePlugin` on next deploy.

### STOP and report if

- The SDK method names don't match what PR-1 generated (e.g. `client.listWorkflows()` vs `client.workflow_list()`). Either fix the codegen naming convention in NV (a config in `generate_sdk.sh`) or adapt the tool handlers.
- The SDK doesn't surface all the request/response fields the plugin uses (e.g. plugin needs a `last_run_at` field on workflow summaries that the SDK omits). Either expand the route's response model in NV or extract the field a different way.
- The plugin's hand-rolled error categories (`HTTP_4XX`, `HTTP_5XX`, `UNREACHABLE`) don't map cleanly onto whatever the SDK throws. May need a thin adapter.

---

## PR-4 — Agent read tools (NoralOS)

### Scope

Promote 9 existing read-only apiRoutes to also be agent-callable tools. Each is a thin handler that calls the same SDK method the apiRoute calls.

### Implementation

For each tool, follow the existing pattern:

1. Add `<TOOL>_TOOL_NAME = "<tool>"` to `tools/registry.ts`.
2. Add the tool to `ALL_TOOL_NAMES` and `TOOL_MIN_TIER_V3: "worker"`.
3. Create `tools/<tool>.ts` with the handler function (use `tools/list_workflows.ts` as the canonical pattern).
4. Add the tool spec to `manifest.ts` `tools[]` — name, displayName, description, parametersSchema.
5. Wire the tool name into `worker.ts`'s tool dispatch in `onToolCall`.

The 9 tools:

| Tool name | NV SDK method | NoralOS apiRoute it parallels |
|---|---|---|
| `list_runs` | `client.listRuns({workflow_id?, status?, limit?})` | `list_runs` |
| `get_run_detail` | `client.getRun(run_id)` | `get_run_detail` |
| `list_recordings` | `client.listRecordings({workflow_id?, tts_provider?, ...})` | `list_recordings` |
| `get_recording_download_url` | `client.getRecordingDownloadUrl(uuid)` | `get_recording_download_url` |
| `search_kb` | `client.searchKb({query, ...})` | `search_kb` |
| `list_kb_documents` | `client.listDocuments({status?, limit?, offset?})` | `list_kb_documents` |
| `list_campaigns` | `client.listCampaigns()` | `list_campaigns` |
| `get_campaign` | `client.getCampaign(id)` | `get_campaign` |
| `get_daily_report` | `client.getDailyReport({date?, workflow_id?})` | (new — no apiRoute parallel; reports.py was 0% sdk-exposed before PR-1) |

### Tests

- One vitest file per tool exercising the JSON-schema parameter validation + the success/failure paths.
- Existing vitest helpers (`mockClient` etc.) should cover the SDK mocking.

### Smoke

- [ ] All 9 tools dispatchable via the agent runtime (`ctx.tools.list()` returns them).
- [ ] Tier gate: a worker-tier agent can call all 9.
- [ ] Plugin builds clean.

### STOP and report if

- The agent-tool param schema and the SDK method signature drift (e.g. agent passes `workflowUuid: string`, SDK expects `workflow_id: number`). Document the translation layer in the tool handler — don't push it back into the SDK.

---

## PR-5 — Agent write tools: KB + campaigns (NoralOS)

### Scope

Genuinely new write tools — manager-tier.

### Tools

**KB** (2):
- `upload_kb_document` (manager) — Body: `name`, `content_text` (for inline text) OR `source_url` (for fetch-from-URL — security review needed). For binary uploads, callers use the pre-signed PUT URL flow via `client.createKbUploadUrl({...})` + the existing s3 path; the tool returns the upload URL + a separate "process this once uploaded" step.
- `delete_kb_document` (manager) — Calls `client.deleteKbDocument(uuid)`.

**Campaigns** (5):
- `create_campaign` (manager) — `client.createCampaign({...})`.
- `start_campaign` (manager) — `client.startCampaign(id)`.
- `pause_campaign` (manager) — `client.pauseCampaign(id)`.
- `resume_campaign` (manager) — `client.resumeCampaign(id)`.
- `redial_campaign` (manager) — `client.redialCampaign(id)`. (NV's `/redial` re-attempts unanswered calls.)

### Implementation

Same pattern as PR-4 — registry entry, handler, manifest entry, worker dispatch wiring. Each handler does parameter validation, calls the SDK, returns a structured `ToolResult`.

### Tests

- Vitest per tool.
- Tier-gate tests: worker-tier agent calling any of these returns the delegate-up error.

### STOP and report if

- The `upload_kb_document` URL-fetch security review hasn't happened. The "let NV fetch a URL the agent provides" pattern is SSRF-exposed. Document the threat model, pick one of: (a) only inline text, (b) URL fetch but with a strict allowlist of domains, (c) defer to a separate hardening PR.
- Campaign create has required fields the schema doesn't surface clearly. Read `api/routes/campaign.py` carefully.

---

## PR-6 — Agent write tools: workflow tool defs + embed sessions (NoralOS)

### Scope

**Workflow tool definitions** (the `tool` entity from `api/routes/tool.py` — NOT the same as agent tools; these are HTTP tools wired INTO a workflow that the voice agent calls during a call):

- `add_workflow_tool` (manager) — `client.createTool({...})`.
- `update_workflow_tool` (manager) — `client.updateTool(uuid, {...})`.
- `delete_workflow_tool` (manager) — `client.deleteTool(uuid)`.

This is the surface that lets Brooklyn / Voice Director **author end-to-end voice workflows** via NoralOS agents — the original "agents author NoralVoice workflows" promise from the audit docs.

**Embed sessions** (the persistent `embed_tokens` table for embed widgets, distinct from one-shot exchange-tokens):

- `create_persistent_embed_token` (manager) — `client.createPersistentEmbedToken(workflow_id, {allowed_domains, usage_limit?, expires_in_days?})`. Returns the integer id + masked display + the embed script snippet. **NEVER returns the secret token in the tool's return value** — agents log return values; this would leak. The secret is shown once in the operator-facing UI, not in the agent transcript.
- `get_persistent_embed_token` (worker) — read-only.
- `revoke_persistent_embed_token` (manager) — `client.revokePersistentEmbedToken(workflow_id)`.

### Implementation

Pattern as before. For `create_persistent_embed_token`, structure the return value to exclude the secret string — return `{embed_token_id, masked_suffix, script_snippet_template}` where the script snippet is a string the operator embeds in their site with a `<EMBED_TOKEN_HERE>` placeholder they fill from a different UI flow.

### Tests

- Standard vitest coverage.
- **Test the invariant**: `create_persistent_embed_token` return value never contains the actual secret string. Use a SDK mock that returns a known secret and assert it doesn't appear in any field of the tool result.

### STOP and report if

- The persistent embed_token API in NV requires fields the SDK doesn't surface clearly (e.g. `settings` JSONB blob for widget customization). Decide whether to expose to the agent or hardcode.
- The "secret never in return value" pattern conflicts with the existing tool-result schema (e.g. `ToolResult` has a `details` field that gets logged but agents need to see the token somewhere). Either route the secret out-of-band (e.g. via an event the operator UI listens to) or punt the feature to PR-8.

---

## PR-7 — Audit-doc refresh (NoralOS — small)

Update:

- `docs/audit/consolidation-plan.md` §Phase 7 — rewrite the "Plugin tool additions: ~20 more tools" to match what actually shipped (10 new tools: 9 reads in PR-4 + 5 KB/campaign writes in PR-5 + 3 tool-def writes + 3 embed-session tools in PR-6 = 20 net; verify by greping `TOOL_MIN_TIER_V3`). Document the SDK strategy chosen (extension of existing `sdk_expose` pattern, no new shared-types package needed).
- `docs/audit/overlap-map.md` §E — update the tool-inventory delta.
- `docs/audit/consolidation-scope.md` §2 Pillar A — strike through items now shipped.

No code change.

### Meta

- Title: `docs(phase-7): refresh audit docs after tool coverage + SDK adoption`
- Base: `master`

---

## Anti-goals (all PRs)

- Do NOT touch the auto-register-* race condition (CLAUDE.md gotcha #7). It's a real bug; separate fix.
- Do NOT modify `voice-cascade` or `voice-config` plugins — they're retiring in Phase 6 PR-3/PR-4 (deferred).
- Do NOT modify the Phase 6 apiRoutes (`synthesize`, `transcript_pump_control`). Only ADD.
- Do NOT add new plugin capabilities to the manifest unless a tool genuinely needs one not already declared. The current capability list covers everything Phase 7 will need.
- Do NOT bump NV's API major version — `sdk_expose` additions are pure additions, backwards compatible.
- Do NOT add agent tools for credential CRUD, telephony provider configuration, or workflow CRUD. Out of scope; operator territory.

## Stop and report if (cross-PR)

- The SDK codegen (`scripts/generate_sdk.sh`) produces broken TypeScript — `tsc` errors in `_generated_client.ts` after running. The codegen tooling is the foundation; fix upstream before continuing.
- Plugin tool count crosses 20 — refactor `tools/` into domain subdirectories (`tools/runs/`, `tools/campaigns/`, etc.) before adding more.
- Any new tool collides with an existing tool name (the worker dispatch table uses tool name as the lookup key). Rename rather than collide.
- Phase 6 PR-4 (voice-config retire + Drizzle migration) lands mid-Phase-7 and adds columns to `agents`. If any tool handler reads/writes `agents`, rebase and re-test.
- `pnpm typecheck` grows error categories beyond the 4 pre-existing Phase-5d errors. Stop and fix.

## When you finish (all 7 PRs)

Reply with:

1. PR URLs + merge statuses (NoralOS + NoralVoice).
2. Final SDK method count (before: 11; after: target ~30-35).
3. Final agent-callable tool count (before: 6; after: target ~16-18).
4. `noralvoice-client.ts` LOC delta (target: ~-700 to -800 from PR-3's SDK migration; offset by PR-4/5/6 additions to the auth wrapper, net ~-500).
5. Plugin inventory: `docker exec noralos-db psql -c "SELECT plugin_key, version, status FROM plugins WHERE status='ready' ORDER BY plugin_key"` — should show `noralai.noralvoice` at version `0.3.0`.
6. SDK release URL (the PR-2 tarball location).
7. Smoke results per PR.
8. Anything punted (likely: SSRF hardening on `upload_kb_document` if that came up; `agents.voice_agent_uuid` first-class column promotion; LLM-driven workflow design).

Do not start Phase 8. Wait for the next prompt.
