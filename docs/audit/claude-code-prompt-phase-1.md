# Claude Code Prompt — Phase 1: Plugin scaffold + SDK rename + Voice Director

**Prerequisite:** Phase 0 PR has merged on `rebrand/noralvoice` and standalone smoke passed.

This phase spans **two repos** in sequence. You will open **two PRs**, one per repo. The NoralOS plugin (PR-B) imports the published SDK from PR-A, so PR-A must merge and publish first.

When both PRs merge, smoke passes on each side, and a Voice Director can be created via the plugin page, come back and ask for the Phase 2 prompt.

Copy-paste everything below the `---` line into a fresh Claude Code session, starting in `/Users/quentin/Documents/NORALAI/NoralVoice`.

---

You are executing **Phase 1** of the NoralOS ↔ NoralVoice consolidation. This phase has two parts run sequentially across two repos.

## Binding context (read in this order before starting)

```
/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/docs/audit/
  consolidation-scope.md       ← binding scope
  consolidation-plan.md        ← read Phase 1 section
  overlap-map.md               ← reference for what overlaps
  integration-architecture.md  ← reference for plugin design (§4 manifest sketch)
```

Also read:
- `/Users/quentin/Documents/NORALAI/NoralVoice/CLAUDE.md`
- `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/CLAUDE.md` (when you switch repos for PR-B)
- `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/packages/plugins/noralai-noralsign/` — **this is your template**. The new plugin mirrors this structure exactly.

---

## PR-A — NoralVoice side

**Repo:** `/Users/quentin/Documents/NORALAI/NoralVoice`
**Base branch:** `rebrand/noralvoice`
**Working branch:** `feat/phase-1a-sdk-rename-integration-endpoints`

### A1. SDK rename (Python)

- Rename `sdk/python/` package `dograh-sdk` → `noralai-voice`
- Update `sdk/python/pyproject.toml`: `name = "noralai-voice"`, version `0.2.0`
- Keep all module paths and exported class names identical for this release (we are renaming the *package*, not its public API)
- Update `scripts/release_sdks.sh` to **dual-publish**: publish both `dograh-sdk==0.2.0` (deprecated alias) and `noralai-voice==0.2.0` from the same source. The deprecated alias's `__init__.py` should print a one-line `DeprecationWarning` referencing the new package
- Update any internal references in `api/` that import the SDK by path (should be zero — the API does not import its own SDK — but verify with grep)

### A2. SDK rename (TypeScript)

- Rename `sdk/typescript/` package `@dograh/sdk` → `@noralai/voice-sdk`
- Update `sdk/typescript/package.json`: `name = "@noralai/voice-sdk"`, version `0.2.0`
- Dual-publish: also publish `@dograh/sdk@0.2.0` as a deprecated alias whose `index.ts` re-exports everything and emits a one-line `console.warn` on first import
- Update `scripts/release_sdks.sh` to publish both
- Update `ui/` callers — there should be none directly importing `@dograh/sdk` (the UI uses the auto-generated `ui/src/client/` from `@hey-api/openapi-ts`), but verify with grep

### A3. New endpoint: `POST /api/v1/embed/exchange-token`

For Phase 4's iframe auth bridge — we are staging the contract now.

- File: `api/routes/embed.py` (or wherever the existing `public_embed.py` lives — colocate)
- Auth: standard `X-API-Key`
- Request body: `{ "target_user_email": "<email>", "target_path": "/workflow/<uuid>", "ttl_seconds": 90 }` (clamp ttl 30–300)
- Response: `{ "token": "<opaque>", "expires_at": "<iso8601>", "embed_url": "<base>/embed-login?token=<opaque>&path=<encoded>" }`
- Storage: a new table `embed_exchange_tokens` (uuid, token_hash, organization_id, target_user_id, target_path, expires_at, consumed_at). One-shot — consumed_at set on first use
- Also add `GET /embed-login?token=&path=` page handler that validates the token, sets a session cookie scoped to the NoralVoice domain, and redirects to `path`
- No UI work for the iframe parent side — that's Phase 4
- Tests: token issuance, consumption, expiry, double-consume rejection, cross-org rejection

### A4. Integration webhook registration

For Phase 1B's NoralOS plugin to receive `run.completed` events.

- New table `integration_webhooks` (uuid, organization_id, event_type, target_url, secret, created_at, last_fired_at, last_status). `event_type` is an enum: `run.completed`, `run.failed`, `campaign.progress`
- Endpoints (all `X-API-Key` auth, scoped to caller's org):
  - `POST /api/v1/integration-webhooks` — register
  - `GET /api/v1/integration-webhooks` — list
  - `DELETE /api/v1/integration-webhooks/:id`
- Firing logic: hook into `WorkflowRunModel` completion path (find where `status` transitions to a terminal value — `api/services/workflow/` or `api/services/pipecat/`). On terminal status, look up matching registered webhooks for the org + event, POST the payload with an `X-Signature` HMAC-SHA256 using the per-webhook secret
- Payload shape: `{ "schemaVersion": 1, "event": "run.completed", "run_id": "<uuid>", "workflow_uuid": "<uuid>", "organization_id": <int>, "status": "<terminal>", "transcript_url": "...", "recording_url": "...", "extracted_variables": {...}, "started_at": "...", "ended_at": "...", "cost_info": {...} }`
- Failure mode: fire-and-forget with retry (3 attempts, exponential backoff). Update `last_status`. Do not block the run completion flow on webhook delivery
- Tests: registration CRUD, HMAC verification roundtrip, webhook fires on a mocked run completion

### A5. Alembic migration

Single new migration adding both `embed_exchange_tokens` and `integration_webhooks` tables. Its `down_revision` is the Phase 0 merge migration.

### A6. Smoke

After A1–A5 land in the working branch:

- [ ] `pip install noralai-voice==0.2.0` from local build succeeds; `from noralai_voice import …` works
- [ ] `pip install dograh-sdk==0.2.0` from local build succeeds and emits deprecation warning
- [ ] `npm install @noralai/voice-sdk@0.2.0` from local build succeeds; ESM import works
- [ ] `npm install @dograh/sdk@0.2.0` from local build succeeds and emits deprecation on import
- [ ] `POST /api/v1/embed/exchange-token` returns a valid token; second consumption returns 410 Gone
- [ ] `POST /api/v1/integration-webhooks` + complete a test workflow run → webhook fires with valid HMAC signature
- [ ] Standalone signup → build workflow → place test call still passes

### PR-A meta

- Title: `feat(phase-1a): SDK rename + embed exchange + integration webhooks`
- One commit per item (A1, A2, A3, A4, A5) preferred
- PR body must include the A6 smoke results
- **Do NOT publish to public registries from your PR.** The publish step is gated on user approval after merge. Add `npm publish --dry-run` and `python -m build` to a CI workflow if not already present, so artifacts are validated without push
- Wait for user to publish before starting PR-B

### Anti-goals for PR-A

- Do NOT touch NoralOS repo yet
- Do NOT change SDK public API surface (only package name + version)
- Do NOT delete the deprecated alias packages — they ship for one release
- Do NOT add new SDK methods beyond what already exists
- Do NOT modify the workflow run state machine itself — only hook into the existing terminal transition

### Stop and report if

- The workflow run terminal transition is not centralized (multiple paths) — surface this and propose where to put the hook
- The SDK build has external consumers we don't know about (e.g., references in a downstream private repo)
- A test takes more than 5 minutes to run consistently

---

## PR-B — NoralOS side

**Prerequisite for PR-B:** PR-A merged, both `@noralai/voice-sdk@0.2.0` and `noralai-voice==0.2.0` published.

**Repo:** `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`
**Base branch:** `master`
**Working branch:** `feat/phase-1b-noralvoice-plugin`

### B1. Plugin scaffold

Mirror `packages/plugins/noralai-noralsign/` exactly. Create:

```
packages/plugins/noralai-noralvoice/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts
    manifest.ts
    manifest.test.ts
    worker.ts
    constants.ts
    noralvoice-client.ts          ← thin wrapper around @noralai/voice-sdk
    tools/
      list_workflows.ts
      run_call.ts
      get_run.ts
    server/
      webhooks/run-completed.ts
      apiRoutes/list-workflows.ts
    ui/
      NoralVoiceSidebarLink.tsx
      NoralVoicePage.tsx
```

`package.json` declares `@noralai/voice-sdk` as a runtime dep. Use `^0.2.0`.

### B2. Manifest

Implement per `integration-architecture.md` §4. Key fields:

- `id: "noralai.noralvoice"`
- `version: "0.1.0"`
- `displayName: "NoralVoice"`
- `categories: ["connector", "voice"]`
- Capabilities: `http.outbound`, `secrets.read-ref`, `agent.tools.register`, `activity.log.write`, `agents.read`, `agents.write` (for Voice Director creation), `webhooks.receive`, `events.emit`, `api.routes.register`, `ui.sidebar.register`, `ui.page.register`
- `instanceConfigSchema`: `{ baseUrl, apiKeyRef (format: secret-ref), organizationId }`
- `webhooks: [{ endpointKey: "run-completed", displayName: "Call / workflow run completed" }]`
- `apiRoutes: [{ routeKey: "list_workflows", method: "GET", path: "/workflows", auth: "board", companyResolution: { from: "query", key: "companyId" } }]`
- `tools: [list_workflows, run_call, get_run]` with full `parametersSchema` JSON-schema for each
- UI slots: one sidebar link, one page at `routePath: "voice"`

`manifest.test.ts` validates the manifest schema and tier-gate metadata.

### B3. Plugin worker

- Resolves `apiKeyRef` via `ctx.secrets.resolve()` on each tool call (live storage, no caching beyond request scope)
- Constructs `@noralai/voice-sdk` client with `baseUrl` + `apiKey` per call
- Dispatches tool calls to `tools/*.ts` handlers
- Each tool handler: validate inputs against `parametersSchema`, call SDK, return JSON
- Error handling: distinguishable errors for `NO_API_KEY`, `NORALVOICE_UNREACHABLE`, `NORALVOICE_4XX`, `NORALVOICE_5XX`. Each returns a structured `{ ok: false, error: "<code>", message: "..." }`

### B4. Three starter tools

**`noralvoice:list_workflows`** — `{ companyId? }` → returns array of `{ uuid, name, status, version, lastRunAt }`. Implementation calls `client.workflows.list()` and maps.

**`noralvoice:run_call`** — `{ workflowUuid, toNumber, variables? }` → returns `{ runId, status: "queued", startedAt }`. Implementation calls `client.workflows.runs.create()`. **This is the high-stakes tool — gate it with tier check** (only `manager` tier or higher).

**`noralvoice:get_run`** — `{ runId }` → returns full run shape with transcript URL, recording URL, extracted variables, cost info. Implementation calls `client.workflows.runs.get()`.

Each tool gets a `<name>.test.ts` covering happy path, missing key, NoralVoice 4xx, NoralVoice 5xx.

### B5. Tier gate

Implement in `worker.ts` at the JSON-RPC dispatch boundary, **before** any tool handler runs:

- Look up the calling agent via `ctx.agents.get(callerAgentId)`
- Derive tier: `exec` if `role` is in `{ceo, cto, cmo, cfo, coo}`, `manager` if `role` is `manager` or `director`, `worker` otherwise
- For each tool, check `tool.tierGate.minTier`. If caller's tier is below, return error `{ ok: false, error: "TIER_FORBIDDEN", message: "This tool requires manager tier or above. Delegate to the Voice Director." }`
- Tools' `parametersSchema` description should mention tier requirement
- Tools metadata for tier requirements: `list_workflows` = worker (read-only), `run_call` = manager, `get_run` = worker, `provision_voice_agent` (later) = manager, `design_workflow` (later) = manager

### B6. apiRoute: `GET /workflows`

- Plugin route at `/workflows` (full path: `/api/plugins/noralai.noralvoice/api/workflows`)
- Auth: board user, company-resolved via `?companyId=<uuid>`
- Implementation: resolve company's plugin instance config, get apiKeyRef, call `client.workflows.list()`, return mapped JSON
- Test: 200 happy path, 401 no auth, 403 wrong company, 502 if NoralVoice unreachable

### B7. Webhook receiver: `run-completed`

- Endpoint: `POST /api/plugins/noralai.noralvoice/webhooks/run-completed?company=<uuid>` (companyResolution from query)
- Body: NoralVoice payload from PR-A's `integration_webhooks` firing
- HMAC verification: read `X-Signature` header, verify against per-company webhook secret (stored when the plugin registers the webhook with NoralVoice — see B11 below)
- On valid signature: call `ctx.events.emit("noralai.noralvoice.run.completed", payload)` so the originating agent's task session wakes
- Also write to `ctx.activityLog` for audit trail
- Test: valid signature → event emit, invalid signature → 401, missing signature → 401

### B8. Auto-register service

File: `server/src/services/auto-register-noralvoice.ts`. Mirror `auto-register-noralsign.ts` exactly. At server boot:

- Read manifest version
- Compare to `plugins` table entry for `noralai.noralvoice`
- If missing or older: install/upgrade
- If newer (downgrade scenario): warn but don't auto-downgrade
- Idempotent — running twice is a no-op

Wire into `server/src/app.ts` boot sequence next to the existing `auto-register-noralsign` call.

### B9. Voice Director agent template

File: `server/src/services/agent-templates/voice-director.ts`. Exports:

```ts
export const VOICE_DIRECTOR_TEMPLATE = {
  id: "voice-director",
  displayName: "Voice Director",
  description: "Owns voice operations for the company. Designs, runs, and monitors voice agents.",
  defaultName: "Voice Director",
  defaultRole: "manager",
  defaultReportsTo: "ceo",  // resolved at provision time to the company's CEO agent if one exists
  defaultAdapterType: "<inherit-company-default>",
  defaultSystemPrompt: `You are the Voice Director for this company. You own all voice operations: designing voice agents, running outbound calls, monitoring campaigns, reviewing recordings, and reporting outcomes to the CEO.

You have access to the noralvoice:* tool set. Use list_workflows to inventory the company's voice agents, run_call to place outbound calls, and get_run to review outcomes.

You report to the CEO. When an outcome requires executive judgment (a customer escalation, a large deal moving stage), surface it to the CEO with a clear summary and recommended action.

Be concise. Be operational. Voice is high-stakes — confirm intent before placing any outbound call.`,
  defaultTools: ["noralvoice:list_workflows", "noralvoice:run_call", "noralvoice:get_run"],
} as const;
```

Provisioning function `provisionVoiceDirector(companyId, overrides)` — creates an agent row in `agents`, resolves `reportsTo` to the CEO if one exists, attaches the default tools. Returns the new agent's ID.

### B10. Plugin page UI

`src/ui/NoralVoicePage.tsx`:

- **State A — no API key configured:** Show a card "Connect NoralVoice. Voice Directors will appear here once configured." with a button linking to `/:prefix/company/settings/integrations`
- **State B — API key configured, no Voice Director yet:** Show "Create your first Voice Director" with a button that opens a name/customize modal → calls a plugin apiRoute (add `POST /voice-directors`) → calls `provisionVoiceDirector()`
- **State C — Voice Director(s) exist:** List them with name, status, last activity. Each links to the existing agent detail page.

No deep lists/runs/recordings yet — that's Phase 4.

### B11. Plugin lifecycle hook: register webhook with NoralVoice on config save

When the plugin's `instanceConfig` is first saved (apiKeyRef populated), the plugin worker should:

1. Generate a per-company webhook secret
2. Call NoralVoice's `POST /api/v1/integration-webhooks` (from PR-A) registering `<noralos_base>/api/plugins/noralai.noralvoice/webhooks/run-completed?company=<uuid>` for event `run.completed`
3. Store the returned webhook ID and the secret in the plugin's per-company state
4. On config update or plugin uninstall: delete the registered webhook from NoralVoice

Implement as an `onConfigChange` hook in the plugin manifest.

### B12. Sidebar slot

Simple link to `/:prefix/voice` (the plugin's page route). Icon: a microphone or similar (reuse Lucide icon). Label: "Voice".

### B13. Smoke

- [ ] `pnpm install` resolves `@noralai/voice-sdk@^0.2.0`
- [ ] `pnpm --filter noralai-noralvoice build` succeeds
- [ ] `pnpm dev` boots NoralOS server; `auto-register-noralvoice` runs at startup and installs the plugin
- [ ] Plugin sidebar item appears for a logged-in board user
- [ ] Plugin page in State A renders
- [ ] Paste a NoralVoice API key in `/company/settings/integrations` (assumes Phase 2 hasn't shipped — manually edit `plugin_config.config_json` if integrations picker doesn't yet recognize `noralvoice`)
- [ ] Plugin page transitions to State B
- [ ] Click "Create Voice Director" → agent row appears in `agents` table with role `manager`, tools `[noralvoice:list_workflows, noralvoice:run_call, noralvoice:get_run]`
- [ ] Voice Director agent calls `noralvoice:list_workflows` (via Conference Room or Issue chat) → real data returns
- [ ] A worker-tier agent attempting `noralvoice:run_call` gets `TIER_FORBIDDEN`
- [ ] A test call placed via `noralvoice:run_call` on NoralVoice triggers a webhook → NoralOS plugin emits event → originating agent wakes (verify in heartbeat logs)

### PR-B meta

- Title: `feat(phase-1b): noralai.noralvoice plugin + Voice Director template`
- Commits per major item (B1+B2+B3 scaffold, B4 tools, B5 tier gate, B6 apiRoute, B7 webhook, B8 auto-register, B9 template, B10 page, B11 lifecycle, B12 sidebar)
- PR body includes B13 smoke results
- Add the new plugin to `Dockerfile`'s `pnpm --filter ... build` list (per the `feedback_noralos_plugin_gotchas` memory — missing this fails silently in prod builds)
- Manifest must use `export default` (per same memory)

### Anti-goals for PR-B

- Do NOT change `voice-cascade`, `voice-config`, or `conference-room-bridge` — they stay as-is in Phase 1
- Do NOT build out the iframe surface for the workflow editor — Phase 4
- Do NOT add tools beyond the three named — Phase 7 fills the inventory
- Do NOT touch NoralVoice repo
- Do NOT add credential UI in NoralOS integrations — Phase 2
- Do NOT auto-spawn Voice Directors on plugin install — wait for user click

### Stop and report if

- The NoralSign template uses patterns that don't fit voice (e.g., NoralSign embeds DocuSeal; we don't bundle NoralVoice) — adapt cleanly and note the divergence
- Tier resolution from `agents.role` is ambiguous (e.g., a role we haven't categorized) — propose the mapping, don't guess
- `provisionVoiceDirector` discovers no existing CEO agent in the company — the Voice Director still gets created with `reportsTo = null`, but flag this in the PR description
- `@noralai/voice-sdk@0.2.0` is not yet on npm when you start PR-B — wait, do not vendor

---

## Combined definition of done (both PRs merged)

- [ ] `@noralai/voice-sdk@0.2.0` published; `@dograh/sdk@0.2.0` deprecated alias published
- [ ] `noralai-voice==0.2.0` published on PyPI; `dograh-sdk==0.2.0` deprecated alias published
- [ ] NoralVoice `POST /api/v1/embed/exchange-token` issues and validates one-shot tokens
- [ ] NoralVoice `POST /api/v1/integration-webhooks` register/list/delete works; webhook fires on workflow run completion with HMAC signature
- [ ] `noralai.noralvoice` plugin installed and active on `agent.noral.ai` after deploy
- [ ] A Voice Director agent can be created from the plugin page in any company once the API key is configured
- [ ] Voice Director can call `list_workflows`, `run_call`, `get_run` and receive real NoralVoice data
- [ ] Worker-tier agents are blocked from `run_call` with a clean error
- [ ] Completed call webhook reaches NoralOS plugin → event emitted → originating agent wakes within 5 seconds
- [ ] Both standalone smokes pass (NoralVoice signup→build→call; NoralOS create-company→assign-agent→issue-chat)

## When you finish both PRs

Reply with:
1. PR-A URL and merge status
2. PR-B URL and merge status
3. Combined smoke results
4. Anything punted to Phase 2 (likely: the credential UI integration — that's the explicit goal of Phase 2)
5. Anything that surfaced as a new issue worth noting (e.g., a NoralSign pattern that didn't fit voice cleanly)

Do not start Phase 2. Wait for the next prompt.
