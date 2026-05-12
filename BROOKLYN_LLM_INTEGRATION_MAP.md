# Brooklyn LLM → Canonical NoralOS Integration Map

**Repo:** `https://github.com/Noral-AI/NoralOS`  
**Branch:** `master`  
**HEAD at mapping:** `4260516` (`feat(observability): /api/version endpoint with build metadata #50`)  
**Deployed target:** `agent.noral.ai`

> The hyphenated `Noral-AI/Noral-OS` working tree at `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS/` is the **decoy** and does NOT deploy. Everything below targets the canonical repo only.

---

## 1. What is "Brooklyn LLM" in canonical NoralOS?

Inside this architecture, "Brooklyn LLM (Qwen on RunPod)" is **a new agent runtime adapter** — the same kind of thing `claude_local`, `codex_local`, `openclaw_gateway`, etc. are. Agents are picked per-company; each agent already has `adapterType` (text) and `adapterConfig` (jsonb) columns on the `agents` table ([packages/db/src/schema/agents.ts](packages/db/src/schema/agents.ts:27)). An agent saying "use Brooklyn LLM" means setting `adapterType = "noralai_runpod"` (or chosen name) on that one row.

That's the first-class shape. Not a router, not a global mode flag, not a side gateway — an adapter that exposes one (or more) Brooklyn models alongside the existing seven adapters.

---

## 2. What already exists in canonical NoralOS

### Adapter framework
- **`packages/adapter-utils/`** — shared types: `AdapterExecutionContext`, `AdapterExecutionResult`, `AdapterModelProfileDefinition`, `getAdapterSessionManagement`. Server-side helpers: `buildNoralosEnv`, `renderNoralosWakePrompt`.
- **`server/src/adapters/registry.ts`** — built-in adapters wired at module init; external adapters loaded via `buildExternalAdapters()` ([registry.ts:404](server/src/adapters/registry.ts:404)); hot-install path via `registerServerAdapter` ([registry.ts:439](server/src/adapters/registry.ts:439)).
- **`server/src/adapters/builtin-adapter-types.ts`** + `plugin-loader.ts` — split between built-in vs. external.
- **`adapter-plugin.md`** at repo root — documents how to ship an external adapter as a plugin.
- **`packages/adapters/openclaw-gateway/`** is the most relevant reference for a remote/HTTP brain: see [packages/adapters/openclaw-gateway/src/server/execute.ts](packages/adapters/openclaw-gateway/src/server/execute.ts) (1,496 lines) for the full WebSocket-talking adapter pattern.

### Each adapter exports
- `type` (string id), `label`, `models[]`, `modelProfiles[]`, `agentConfigurationDoc` from `src/index.ts`
- `execute`, `testEnvironment`, optional `listSkills`, `syncSkills`, `sessionCodec`, `getQuotaWindows`, `listModels` from `src/server/`
- UI bits (optional) from `src/ui/` — used by `AdapterManager.tsx` etc.

### Integration credentials (PR #46, already shipped)
- **Tables**: `integration_credentials`, `integration_credential_assignments` ([migration 0077](packages/db/src/migrations/0077_integration_credentials.sql), [schema](packages/db/src/schema/integration_credentials.ts)).
- **Service layer**: [server/src/services/integrations/credentials.ts](server/src/services/integrations/credentials.ts), [assignments.ts](server/src/services/integrations/assignments.ts), [provider-tests.ts](server/src/services/integrations/provider-tests.ts).
- **Route**: [server/src/routes/integrations.ts](server/src/routes/integrations.ts) — admin-only auth chain `assertAuthenticated → assertBoard → assertCompanyAccess → assertCompanyAdmin`.
- **UI**: [ui/src/pages/CompanyIntegrations.tsx](ui/src/pages/CompanyIntegrations.tsx) at `/company/settings/integrations`. Sidebar entry at `Plug` icon ([Sidebar.tsx:125](ui/src/components/Sidebar.tsx:125)).
- **Pattern**: secret material lives in `company_secrets`; this table holds non-secret metadata (`provider`, `category`, `display_name`, `masked_suffix`, `last_test_status`). Assignments tie a credential to a `plugin_config` path — today only `noralos.voice-cascade` is allowlisted; **Phase 1 schema deliberately kept `provider`/`category`/`credentialType` as free-text so new providers don't need a migration**.
- **`pluginRegistryService.patchConfig`** ([memory: project_pr46_integrations_phase1.md](memory/project_pr46_integrations_phase1.md)) is the contract: shallow-merge assignments into plugin config without nuking unrelated fields. Locked by 7 unit tests in [integration-assignment-merge.test.ts](server/src/__tests__/integration-assignment-merge.test.ts).
- **Pino redact list** in [server/src/middleware/logger.ts](server/src/middleware/logger.ts) already covers `apiKey`, `authToken`, `bearerToken`, `password`, `clientSecret`, `refreshToken`, etc. Reuse — don't reinvent.

### Costs / usage
- [server/src/services/costs.ts](server/src/services/costs.ts) (`costEvents` table) — columns `costCents`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `companyId`, `agentId`, `occurredAt`. Adapter `execute` results report tokens; `costs.ts` writes the row. Brooklyn adapter must populate this from its OpenAI-compatible `usage` response, with a price table.
- [server/src/services/budgets.ts](server/src/services/budgets.ts) — per-company budgets gate runtime when exceeded.

### LLM / models surface
- [server/src/routes/llms.ts](server/src/routes/llms.ts) — exposes `/llms/agent-configuration.txt` and `/llms/agent-configuration/<adapter>.txt`. Already iterates `listServerAdapters()`. Brooklyn adapter automatically appears here once registered.
- `models[]` per adapter is the canonical model list. The screenshot you sent ("All agents on `claude_local`/`claude-sonnet-4-6`") is the literal current state of the `agents` table.

### Smart-model-routing (planned, not built)
- [doc/plans/2026-04-06-smart-model-routing.md](doc/plans/2026-04-06-smart-model-routing.md) — defines the future cheap-model-vs-primary lane via `modelProfiles`. Upstream commit `a3de1d76` adds cheap profiles to all local adapters. **Brooklyn adapter should ship with a `modelProfiles` array from day one.**

### Approval queue
- `issueApprovals` table + `IssueDetail.tsx` / `Approvals.tsx`. Brooklyn-LLM runtime confirmations would fit here, NOT a new bespoke table. Phase 9 confirmation-store work in the decoy does not transfer.

### LLM Usage Report page (the screenshot)
- **Not in this repo's UI source.** Likely generated by an agent / skill at chat time using `/api/companies/:companyId/dashboard` aggregation, OR rendered by an unmerged downstream PR. Not in `ui/src/pages/`. The natural home is to extend [server/src/services/dashboard.ts](server/src/services/dashboard.ts) and/or to add a UI panel that reads `agents` + their `adapterType`/`adapterConfig.model`.

### Per-company multi-tenancy
- Everything is scoped by `companyId`. The whole architecture is multi-tenant.
- `assertCompanyAccess` + `assertCompanyAdmin` middleware on every credential/route.
- Brooklyn LLM adapter is a *platform* capability; selecting it for an agent is a per-company action that uses per-company credentials from `integration_credentials`.

---

## 3. What from the decoy Phase 1-10 work is worth salvaging

### Salvage as-is into the new adapter
| Decoy file | What it gives us | Canonical destination |
|---|---|---|
| `src/llm/runpod.ts` (the fetch + retry + classifyTwilioError pattern, minus the gateway-mode plumbing) | OpenAI-compatible chat completion HTTP client with categorized errors | `packages/adapters/noralai-runpod/src/server/execute.ts` |
| `src/llm/runpod.ts` retry layer (`isRetryable`, backoff with jitter) | Transient-error retry policy | Same file as above |
| `src/llm/claude.ts` | Anthropic Messages API REST client (kept; in case we want a Brooklyn-Fallback model that uses Claude HTTP) | Either part of the new adapter as a fallback model, OR its own thin adapter `claude_http`. Recommend: **own adapter** so it composes with the existing `claude_local` model picker. |
| `src/llm/branding.ts` (the upstream-token redactor + display constants) | "Brooklyn Core" / "NORALAI" branding, Qwen-token redaction | Adapter manifest (`label`, `models`) plus reuse the existing pino redact list for log scrubbing. |

### Salvage for tests
| Decoy file | Use |
|---|---|
| `src/llm/runpod.test.ts` | Adapt to vitest in `packages/adapters/noralai-runpod/src/server/execute.test.ts`. |
| `src/llm/claude.test.ts` | Same shape for the optional `claude_http` adapter, or drop if we don't ship one. |

### Salvage as patterns only (not file-for-file)
| Decoy idea | What it teaches us, in canonical's shape |
|---|---|
| Gateway context builder (system prompt, project instructions, skills index) | Maps onto canonical's existing `agent-instructions.ts` + onboarding-assets bundle. **The adapter does not own this** — the agent runtime already builds prompts. The adapter just receives the assembled prompt via `AdapterExecutionContext` and forwards it. Drop the gateway-context module entirely. |
| Runtime tool registry, JSON contract, loop | Maps onto canonical's **plugin tool registry** (`server/src/services/plugin-tool-registry.ts`) + the plugin SDK's `definePlugin` / tool surface. Brooklyn runtime tools become plugins, not adapter internals. |
| Confirmation store / sweeper / approval UI | Maps onto canonical's `issueApprovals` + `Approvals.tsx`. The HTML page from Phase 8 does not port. |
| Twilio SMS executor | Plugin under `packages/plugins/noralai-twilio/`. Credentials via `integration_credentials` with `provider: 'twilio'`. |
| Google Calendar executor | Plugin under `packages/plugins/noralai-google-calendar/`. Credentials via `integration_credentials` with `provider: 'google_calendar'`. |

### Do not salvage / port
| Decoy concept | Why not |
|---|---|
| `BROOKLYN_CHAT_MODE` (agent_sdk / gateway / auto) | Canonical agents already pick an adapter per-row. No mode flag needed. |
| `runBrooklynChat` router + auto heuristic | Same reason. |
| `Noral-OS/src/dashboard.ts` + `dashboard-html.ts` add-ons | Different UI stack (React in `ui/`, not inline HTML). |
| SQLite `runtime_confirmations` table + `confirmations.ts` | Postgres + Drizzle + `issueApprovals`. Different schema, different ORM. |
| `BROOKLYN_RUNTIME_TOOLS_ENABLED` global env flags | Per-company plugin-install model. A company that installs `noralai-twilio` plugin has tools; one that doesn't, doesn't. |
| Telegram `/approve` `/deny` commands | No Telegram surface in canonical. |
| `src/llm/tools/confirmations-html.ts` | Replaced by existing `Approvals.tsx`. |
| `tools/integrations/twilio.ts` "client secret + refresh token in `.env`" pattern | Per-company credentials in `integration_credentials`, not in process env. |
| Phase 3 router fallback (RunPod 503 → Claude HTTP) inside one gateway | Canonical handles model fallback via `modelProfiles` + (planned) smart-model-routing. The adapter exposes models; the routing layer picks. Don't embed fallback inside the adapter. |

---

## 4. Required database migrations

**Minimum viable Brooklyn LLM provider (the first PR): zero migrations.** Free-text columns on `integration_credentials` already accept arbitrary `provider`/`category`/`credentialType`. The adapter package + an allowlist update is enough.

Later, when we layer in runtime tools and per-tool confirmations:

| Future migration | Why |
|---|---|
| `0078_brooklyn_provider_registry.sql` (only if needed) | Optional: extend `provider-registry.ts` allowlist; may end up being code-only. |
| Reuse `issueApprovals` | No migration; confirmation-style approvals slot into existing approval flow. |
| Twilio / Calendar plugin migrations | Each plugin already gets its own migrations directory under `packages/plugins/<name>/migrations/` (matches `voice-cascade` and `conference-room-bridge` pattern). |

No `runtime_confirmations`-style new table. The `issueApprovals` queue is the right primitive.

---

## 5. Required server services

| Service | New or existing | Notes |
|---|---|---|
| Brooklyn adapter `execute()` | New, under `packages/adapters/noralai-runpod/src/server/execute.ts` | Calls RunPod, returns `AdapterExecutionResult` with `usage` populated so `costs.ts` can write a `costEvents` row. |
| Brooklyn adapter `testEnvironment()` | New, same package | Used by the Integrations UI "Test" button. |
| Brooklyn adapter session codec / quota windows | Optional | Skip in PR 1; can match `openclaw-gateway` (no session codec) or add later. |
| `integrations/provider-tests.ts` | Existing | Add a `'noralai_brooklyn'` (or whatever provider id we pick) branch so the Integrations UI's "Test" button validates against the RunPod endpoint. |
| `costs.ts` | Existing | No change — adapter populates token counts; the cost service writes the row. Need a per-provider price map: GPU-time-priced RunPod gives `costCents: null` or "estimated" mode, similar to Phase 5's `costKnown=false`. |
| Plugin loader | Existing | Brooklyn adapter can either be built-in (`server/src/adapters/registry.ts` imports it directly, similar to `claude-local`) or external (`adapter-plugin.md`). **Recommend built-in for PR 1** — simpler to ship, smaller surface, matches the existing local adapters. |

---

## 6. Required plugin / provider work

### PR 1 only: one new built-in adapter
- **Package**: `packages/adapters/noralai-runpod/`
  - `package.json` — `@noralos/adapter-noralai-runpod`, version `0.1.0`, license MIT, follows existing adapter package conventions.
  - `src/index.ts` — exports `type = "noralai_runpod"`, `label = "Brooklyn LLM (NORALAI)"`, `models = [{ id: "brooklyn-core", label: "Brooklyn Core" }]`, `modelProfiles = [...]`, `agentConfigurationDoc`.
  - `src/server/index.ts` — re-exports `execute`, `testEnvironment`.
  - `src/server/execute.ts` — RunPod REST client, retry, redacted errors, populates `AdapterExecutionResult.usage`.
  - `src/server/test.ts` — `testEnvironment` impl.
  - `src/ui/` — minimal; can be empty for PR 1.
- **Registry wire-up**: add imports + a `noralaiRunpodAdapter: ServerAdapterModule` to [server/src/adapters/registry.ts](server/src/adapters/registry.ts), include in the registry map. Add `"noralai_runpod"` to [builtin-adapter-types.ts](server/src/adapters/builtin-adapter-types.ts).
- **Integrations allowlist**: extend the provider registry used by [server/src/services/integrations/provider-tests.ts](server/src/services/integrations/provider-tests.ts) and the slot-allowlist gating (currently `noralos.voice-cascade` only) so that `provider: 'noralai_runpod_api_key'` + `category: 'llm_provider'` can be assigned. **Slot path**: `packages/adapters/noralai-runpod/plugin-config` (or its registry equivalent — needs decision; see Open Question 1 below).
- **`pnpm-workspace.yaml`** — already globs `packages/adapters/*`; nothing to add.

### Future PRs (NOT in PR 1)
- `packages/plugins/noralai-twilio/` — runtime tool plugin for `send_sms`. Credentials via `integration_credentials` with `provider: 'twilio'`, `category: 'sms'`. Approval via `issueApprovals`.
- `packages/plugins/noralai-google-calendar/` — runtime tool plugin for availability + booking. Credentials via `integration_credentials` with `provider: 'google_calendar'`, `category: 'calendar'`. Approval via `issueApprovals`.
- `packages/adapters/claude_http/` — only if we decide the Brooklyn-Fallback model from Phase 2 is worth shipping as an adapter (alongside `claude_local`, which spawns the CLI). Likely defer.

---

## 7. Required UI pages / settings

### PR 1
- **Zero new UI pages required.** The new adapter will appear automatically in:
  - `AdapterManager.tsx` — adapter list.
  - `Agents.tsx` / `AgentDetail.tsx` — adapter type dropdown.
  - `CompanyEnvironments.tsx` — the page you screenshotted; new row "Brooklyn LLM (NORALAI)" Local: Yes, SSH: No (or whatever matrix matches the adapter manifest).
  - `CompanyIntegrations.tsx` (`/company/settings/integrations`) — once a credential is created with `provider: 'noralai_runpod_api_key'`, it appears in the credentials list and is assignable.
  - The "LLM Usage Report" page (wherever it actually lives) — each agent's adapter and model are read from `agents.adapterType` / `agents.adapterConfig.model`. When you flip an agent to Brooklyn, that report updates automatically.

### Future PRs
- A "Provider Settings" panel under Company Settings for selecting Brooklyn LLM as the default for new agent hires. Optional UX polish; the underlying adapter selection is the same.
- A "Runtime Tools" panel mirroring the existing `PluginSettings.tsx` once Twilio / Calendar plugins ship.

---

## 8. Required tests

### PR 1
- **`packages/adapters/noralai-runpod/src/server/execute.test.ts`** — vitest. Mock `fetch`. Cover: success → returns `AdapterExecutionResult` with usage; 401 → adapter error category `auth`; 429 → `rate_limited` + retry; 5xx → `server` + retry; malformed body → `malformed`; auth token never appears in error messages or logs.
- **`packages/adapters/noralai-runpod/src/server/test.test.ts`** — `testEnvironment()` returns expected shape.
- **`server/src/__tests__/integrations-provider-registry-noralai-runpod.test.ts`** — new provider id accepted by credential creation; assignment to the new adapter slot path goes through `pluginRegistryService.patchConfig` (matches the 7-test contract from PR #46).
- **`server/src/__tests__/integrations-routes-authz.test.ts`** — extend the 31-case matrix with the new provider id so we get cross-company / unauth / operator coverage for free.

### Future PRs
- Plugin tests for Twilio + Calendar mirroring the existing `voice-cascade` package tests.
- Approval-flow tests for runtime tools, mirroring existing `issueApprovals` tests.

### Pre-existing failures to ignore
Run `pnpm test:run` once after PR 1 lands. Triage any failures against `master` HEAD (`4260516`) before blaming the new adapter — the canonical has its own test history we shouldn't conflate.

---

## 9. Proposed PR sequence

**PR 1 — Brooklyn LLM as a selectable adapter for one agent.**
Scope: new `packages/adapters/noralai-runpod/` package + registry wire-up + provider-registry allowlist for the new credential type + adapter-level tests. **No Twilio. No Calendar. No runtime tools. No confirmation queue.**

Acceptance:
- Admin can save a "RunPod API key" credential via `/company/settings/integrations`.
- Admin can assign that credential to the Brooklyn adapter's config slot.
- Admin can hire / re-configure one agent to `adapterType = "noralai_runpod"`, `model = "brooklyn-core"`.
- That agent's next heartbeat run hits RunPod and returns text via the standard adapter contract.
- Cost event written with token counts; LLM Usage Report (when it renders) shows Brooklyn for that agent.
- `pnpm typecheck && pnpm test:run` green.

**PR 2 — `claude_http` adapter as an additional model lane** (optional, only if we want the Phase 2 fallback shape).
Scope: tiny adapter exposing Anthropic Messages API as a non-CLI alternative to `claude_local`. Same shape as PR 1. Skip if not asked.

**PR 3 — Twilio SMS as a plugin with confirmation.**
Scope: `packages/plugins/noralai-twilio/` plugin, manifest declares an SMS tool, `integration_credentials` provider `twilio`, tool invocations create `issueApprovals` rows. Adapter-side runtime tool registry consumes the plugin tool surface via the existing plugin-tool-registry path.

**PR 4 — Google Calendar plugin (availability + booking).**
Scope: same pattern as PR 3. Availability is read-only (no approval); booking creates an `issueApproval`.

**PR 5 — Approvals UI dedicated card for runtime tool calls.**
Scope: filter `Approvals.tsx` by approval kind so SMS / booking pending requests get a clear sub-view. Same data model, new view.

**PR 6 — LLM Usage Report polish.**
Scope: extend `dashboard.ts` aggregation so the LLM Usage Report breaks out Brooklyn-vs-Claude per-agent traffic and cost.

---

## 10. Open questions before PR 1 can start

1. **Slot path / plugin manifest naming**: the integrations slot allowlist today targets `plugin_id` rows. An adapter isn't a plugin in the canonical's vocab — it's a built-in adapter. Two options:
   - (a) Add a new `target_kind` to `integration_credential_assignments` (e.g. `"adapter_config"`) and a new allowlist path. Requires migrating the `target_kind` text column accepted values and small route changes.
   - (b) Wrap the adapter as an external plugin via the existing `plugin-loader.ts` path, so it shows up under `plugins` and the existing slot allowlist works unchanged.
   - **Recommendation:** (b). Cheaper. Matches `voice-cascade` precedent. Decoupled from the schema. But it does mean the adapter ships as `packages/plugins/noralai-runpod/` with a plugin manifest, not `packages/adapters/noralai-runpod/`. Need your call.

2. **Provider id string**: I've used `noralai_runpod` throughout above. Other candidates: `noralai_brooklyn`, `brooklyn_llm`, `noralai_qwen`. The `provider` column is free-text but the canonical convention seems to be snake_case noun (`google_tts`, `elevenlabs`). **Recommend `noralai_brooklyn`** — keeps Qwen out of every diagnostic surface, matches the branding work from Phase 1 of the decoy.

3. **Cost reporting mode**: RunPod is GPU-time priced, not per-token. Three sub-options:
   - (a) Write `costEvents` with `costCents: 0` and `inputTokens`/`outputTokens` populated. Honest about unknown $.
   - (b) Multiply tokens × a configurable rate stored in `integrationCredentials.metadata`. Estimate.
   - (c) Skip `costEvents` entirely for this adapter. Misleading.
   - **Recommend (a)** as a first cut. Operator can layer (b) in a later PR once a price model is settled.

4. **Built-in vs. external adapter for PR 1**: built-in is simpler and matches the existing seven adapters. External (plugin) is more decoupled and aligns with the audit's "build new adapters as plugins, not fork-internal" recommendation ([NORALOS_NEXT_SESSION.md item 5](NORALOS_NEXT_SESSION.md)). If Open Question 1 lands on plugin, this question collapses into it.

5. **Rebase status**: per [NORALOS_AUDIT.md §6](NORALOS_AUDIT.md), the fork was 13 commits behind upstream at audit time. Current HEAD `4260516` is more recent than the audit's `f1a312f7` but I haven't checked drift against upstream master. **PR 1 should rebase or rebase-merge against current `master` only; don't try to rebase the whole fork onto `upstream/master` as part of this work.**

---

## 11. What this map deliberately does NOT do

- Does not port the ten phases. Each phase concept is mapped to a canonical primitive that may or may not already exist; the line-for-line work isn't worth carrying.
- Does not introduce a parallel LLM system. There is no Brooklyn router, no `BROOKLYN_CHAT_MODE`, no `runBrooklynChat()`, no `gatewayChatComplete()` in the canonical. The adapter `execute()` is the LLM call.
- Does not bypass per-company scoping. Brooklyn LLM credentials are per-company `integration_credentials` rows — never `process.env`.
- Does not add a confirmation queue. The existing `issueApprovals` is the queue.
- Does not modify `heartbeat.ts`, `adapters/registry.ts`'s sandbox bridge, or `packages/adapter-utils/src/` beyond adding the new adapter import — those are the files [NORALOS_NEXT_SESSION.md "Do NOT touch yet"](NORALOS_NEXT_SESSION.md) flagged.

---

## 12. Decisions (locked 2026-05-12)

The five open questions from the prior revision of this map are now answered. This section is the source of truth from here forward; if anything below conflicts with text earlier in the map, **this section wins.**

### 12.1 Plugin-first architecture
Brooklyn ships as a canonical NoralOS **plugin**, not a built-in adapter under `packages/adapters/`.

- **Location**: `packages/plugins/noralai-brooklyn/`
- **Plugin SDK**: `@noralos/plugin-sdk` (`definePlugin` / `runWorker`)
- **Adapter registration**: through the existing `plugin-loader.ts` external-adapter path — `buildExternalAdapters()` already loads `createServerAdapter()` exports from plugins ([registry.ts:404](server/src/adapters/registry.ts:404)). No new built-in import in `registry.ts`.
- **Allowed core touches**: only the minimum hook required by canonical to discover/register the plugin. If `BUILTIN_ADAPTER_TYPES` needs an entry, add it. Otherwise do not touch core registry files.

### 12.2 Provider / internal IDs
| Surface | Value | Notes |
|---|---|---|
| Adapter type (`agents.adapterType`) | `noralai_brooklyn` | snake_case, no `qwen` anywhere. |
| Integration-credentials `provider` | `noralai_brooklyn` | matches the adapter type. |
| Integration-credentials `category` | `llm_provider` | new category; PR #46 left categories as free-text so no migration needed. |
| Integration-credentials `credentialType` | `api_key` | matches the existing `api_key` convention from voice-cascade. |
| npm package name | `@noralos/plugin-noralai-brooklyn` | follows the `@noralos/*` workspace scope (placeholder until the rebrand sub-questions are settled — see NORALOS_NEXT_SESSION.md item 3). |

The string `qwen` must not appear in any user-facing label, adapter id, model id, credential category, log line, or UI element. It is allowed only inside the adapter's `execute()` request body where the upstream model id is sent to RunPod, and inside admin-only diagnostics if explicitly opted into later.

### 12.3 Initial model
| Field | Value |
|---|---|
| Model id | `brooklyn-core` |
| Model label | `Brooklyn Core` |
| Upstream technical model (sent to RunPod) | configurable via plugin config; default `Qwen/Qwen3-32B-FP8` |

The model id `brooklyn-core` is stable across backend changes (Qwen today, anything else tomorrow). The UI never needs to know what's underneath.

### 12.4 PR 1 scope (locked)
**In:**
- New plugin package `packages/plugins/noralai-brooklyn/` exporting `createServerAdapter()` per the external-adapter contract.
- Adapter `execute()` calls the RunPod OpenAI-compatible endpoint and returns an `AdapterExecutionResult`.
- Adapter `testEnvironment()` validates the credential reaches RunPod.
- One model exposed: `brooklyn-core`.
- Integration-credentials registry gets a `noralai_brooklyn` provider entry (category `llm_provider`, type `api_key`) wired into the existing provider-tests path so the Settings → Integrations "Test" button works.
- Plugin migrations directory (empty for PR 1; structure only).
- Plugin manifest + minimal config schema (just where to find the credential).
- Tests for: adapter shape, `execute` happy path, retry classification, secret redaction, credential lookup with company scoping.
- One CHANGELOG / NOTICE update only if the repo conventions require it.

**Out (deferred to later PRs):**
- Twilio, Google Calendar.
- Runtime tools, confirmation queue, approval flow.
- Custom routing or chat-mode flags.
- LLM Usage Report redesign.
- Telegram surfaces.
- Custom HTML confirmation pages.
- Any parallel LLM gateway from the decoy.
- Phase 2 `claude_http` adapter (separate decision later).
- Smart-model-routing modelProfiles (the plan exists at `doc/plans/2026-04-06-smart-model-routing.md`; defer until the canonical merges its own work there).

### 12.5 Credentials
- Use the existing PR #46 `integration_credentials` + `integration_credential_assignments` tables. No new schema.
- Add a `noralai_brooklyn` row to the provider registry consumed by [server/src/services/integrations/provider-tests.ts](server/src/services/integrations/provider-tests.ts) (or wherever the provider-allowlist actually lives — to be confirmed during inspection in PR 1).
- The credential's `category` is `llm_provider`. The PR #46 schema left this column free-text on purpose.
- Assignment targets: `target_kind = 'plugin_config'`, `target_plugin_id = <noralai-brooklyn plugin id>`, `target_config_path = 'runpodApiKeyRef'` (final path name TBD during implementation; must match the plugin manifest's `format: secret-ref` field). Allowlist updated to permit this exact slot.
- Secret material stays in `company_secrets`; the adapter resolves it at `execute()` time via the same secret-ref unwrapping used by `voice-cascade`.
- **No new env vars.** No `BROOKLYN_RUNTIME_*` style globals. The only env vars that may appear are local-development fallbacks consistent with how `voice-cascade` handles dev — to be modeled on, not invented.

### 12.6 Agent selection pattern
| Field | Value |
|---|---|
| `agents.adapterType` | `noralai_brooklyn` |
| `agents.adapterConfig.model` | `brooklyn-core` |
| `agents.adapterConfig` other fields | minimal: `temperature` (optional), `maxTokens` (optional) |

Agent hiring flow picks the adapter from the list returned by `listServerAdapters()`. Once the plugin is loaded, Brooklyn appears in that list automatically because `buildExternalAdapters()` includes it.

### 12.7 Salvage from the decoy
**Bring over:**
- RunPod OpenAI-compatible client (`Noral-OS/src/llm/runpod.ts` lines covering `fetch`, body shape, response parsing). Strip every reference to `gatewayChatComplete`, routing, the Brooklyn router, cost-mode flags, and gateway-context. What lands in canonical is a focused `runpodChatComplete(cfg, messages, opts)` function.
- Retry layer (`isRetryable`, backoff with jitter, status-code classification) from the same file.
- Error-class shape (`RunpodProviderError` with `category`, `status`, `twilioCode`-equivalent removed).
- Phone / token redaction patterns — but reused from the canonical `middleware/logger.ts` pino redact list, not the decoy's hand-rolled regex.
- The `runpod.test.ts` test cases (auth, rate_limit, server, malformed, timeout, secret-not-in-error) adapted to vitest + the canonical's test harness.

**Do not bring over** (re-stating §3 for clarity):
- `gateway-context.ts`, `gateway.ts`, `brooklyn-router.ts`, `routing.ts`, `providers.ts` registry, `branding.ts`, all of `src/llm/tools/`, all confirmation code, all sweeper code, all Telegram bot wiring, all dashboard HTML, all SQLite schemas, all `BROOKLYN_*` env flags, all phase-doc files.

### 12.8 Tests required for PR 1
Minimum set (vitest, matching canonical's test layout):

1. **Plugin discovery**: `buildExternalAdapters()` returns the `noralai_brooklyn` adapter after the plugin is loaded.
2. **Adapter type registration**: `listServerAdapters()` includes `{ type: 'noralai_brooklyn', label: 'Brooklyn LLM (NORALAI)', models: [{ id: 'brooklyn-core', ... }] }`.
3. **Models / profiles exposure**: the `models` array contains `brooklyn-core`; `modelProfiles` is empty or a single safe entry (decide during implementation).
4. **Credential lookup**: when an agent runs, `execute()` resolves the company-scoped `runpodApiKeyRef` and pulls the secret via the canonical secrets service — not from `process.env`.
5. **Company scoping**: an attempt to use a credential from another company is rejected. Reuse the assertion patterns from [integrations-routes-authz.test.ts](server/src/__tests__/integrations-routes-authz.test.ts) where applicable.
6. **OpenAI-compatible request shape**: mocked fetch receives a `POST` to `<baseUrl>/chat/completions` with `Authorization: Bearer <api-key>`, `messages: [...]`, `model: <upstream model id>`. No `Qwen` string appears in any log line captured during the test.
7. **Retry / error classification**: 401 → no retry; 429/5xx → retry up to `maxRetries`; malformed body → no retry; success after one retry.
8. **Secret redaction**: pino captured output during all the above never includes the api key (test against the existing redact list).

### 12.9 UI / surface verification (do not assume "automatic")
For PR 1, verify each surface and only register what's required:

| Surface | What "appearing" requires | PR 1 verification step |
|---|---|---|
| `AdapterManager.tsx` adapter list | Reads from `listServerAdapters()` | Manual: load page, confirm Brooklyn row. Add adapter UI module only if existing pattern (e.g. `claude_local/src/ui/`) requires it. |
| `Agents.tsx` adapter dropdown | Same source | Same. |
| `CompanyEnvironments.tsx` row | Reads from the adapter registry's environment matrix | Verify; if a per-adapter environment declaration is required, supply it. |
| `CompanyIntegrations.tsx` provider list | Reads from the provider registry (PR #46 path) | Add `noralai_brooklyn` provider entry in the provider registry used by this page. |
| LLM Usage Report | Source not in `ui/src/` — likely agent-rendered | No PR 1 work; verify the underlying `agents.adapterType` / `adapterConfig.model` are populated correctly so a downstream rendering picks it up. |

Each row is a small, audited step — not a blanket assumption that registration cascades.

### 12.10 Cost reporting (PR 1 default)
RunPod is GPU-time priced, no per-token USD mapping available at this layer. Therefore for PR 1:

- Populate `costEvents.inputTokens` / `outputTokens` from the RunPod `usage` field when present.
- Populate `costEvents.costCents = 0` (or schema's null equivalent).
- Add a metadata field on the cost event indicating `pricing_model: 'gpu_time_unknown'`.
- A real $/token mapping is a follow-up PR with the operator-provided rate stored in the credential's `metadata`. Out of scope for PR 1.

### 12.11 What this map deliberately does NOT cover

- Rebrand sub-questions (npm scope, env var prefix, fs paths) — still open per [NORALOS_NEXT_SESSION.md](NORALOS_NEXT_SESSION.md). PR 1 uses `@noralos/plugin-noralai-brooklyn` as a placeholder and will rename in a coordinated cutover PR later.
- Upstream rebase — fork is behind `upstream/master`. PR 1 is scoped narrowly to `master` only; do not couple this work to the rebase.
- Phase 2 `claude_http` adapter — defer.
- Phase 4 output-filter approach (Open Issue #2 in `NORALOS_AUDIT.md`) — defer.

---

## 13. PR 1 implementation checklist (binding)

When PR 1 lands, all of these must be true:

- [ ] `pnpm typecheck` green.
- [ ] `pnpm test:run` green on the new plugin package + any touched server files.
- [ ] `buildExternalAdapters()` returns a `noralai_brooklyn` adapter when the plugin is installed.
- [ ] Hiring a new agent with `adapterType = 'noralai_brooklyn'` + `adapterConfig.model = 'brooklyn-core'` succeeds.
- [ ] An admin can save an API key as an `integration_credential` with `provider: 'noralai_brooklyn'`, `category: 'llm_provider'`.
- [ ] The credential can be assigned to the plugin's config path; `pluginRegistryService.patchConfig` preserves unrelated config fields.
- [ ] A test heartbeat run for that agent hits a mocked RunPod endpoint with `Authorization: Bearer <key>` and a body matching the OpenAI-compatible shape.
- [ ] No `qwen` string in any logged output, UI label, credential name, or adapter identifier.
- [ ] No `BROOKLYN_RUNTIME_*` env flags added.
- [ ] No changes to `heartbeat.ts`, `packages/adapter-utils/src/`, or any file flagged "do NOT touch" in `NORALOS_NEXT_SESSION.md`.

Ready to start implementation.

---

## 14. PR 1b — host integration (implementation notes)

PR 1 merged on 2026-05-12 as [#53](https://github.com/Noral-AI/NoralOS/pull/53) (squash → `360b8ebc`). PR 1b is the minimum host work to make the merged plugin actually usable: it (1) auto-registers the workspace plugin so a fresh deployment doesn't need an extra `POST /api/adapters` call, and (2) resolves `company-secret:<credential-id>` references to plaintext immediately before the adapter sees them.

### 14.1 Scope (authorised)

1. Register `@noralos-plugins/noralai-brooklyn` with the adapter plugin store on server start.
2. Resolve `company-secret:<credential-id>` values on `agents.adapterConfig.apiKeyRef` to plaintext before `execute()` runs.
3. Tests covering refusal, leak-free resolution, registration visibility, smoke execute.
4. This map note.

Explicitly **out of scope** (per the merge approval): router behaviour, heartbeat logic, UI redesign, migrations, unrelated adapter packages.

### 14.2 Files added

| Path | Role |
|---|---|
| `server/src/adapters/brooklyn-secret-ref.ts` | `wrapBrooklynAdapter()` (transforms `apiKeyRef → apiKey` on a shallow config copy) + `setBrooklynCredentialResolver()` injection point. |
| `server/src/adapters/auto-register-brooklyn.ts` | `ensureBrooklynRegistered()` — idempotent workspace-local discovery + `loadExternalAdapterPackage` + `registerServerAdapter`. |
| `server/src/adapters/brooklyn-secret-ref.test.ts` | 9 vitest cases: refusal w/ no resolver, refusal on resolver throw, refusal on empty plaintext, successful resolution + config copy semantics, plaintext bypass, no echo of plaintext/credentialId/`company-secret:` in error fields, `testEnvironment` resolve + fallthrough, resolver getter/setter. |
| `server/src/adapters/auto-register-brooklyn.test.ts` | 5 vitest cases: first-call registration, `listServerAdapters` visibility, idempotence, refusal via the active registry, end-to-end smoke with mocked `fetch` confirming `Authorization: Bearer <plaintext>` and no plaintext echo in the result. |

### 14.3 Files modified

| Path | Change |
|---|---|
| `server/src/adapters/registry.ts` | `resolveExternalAdapterRegistration()` applies `wrapBrooklynAdapter()` when `type === "noralai_brooklyn"`. Both the startup IIFE and the hot-install path (`routes/adapters.ts:registerWithSessionManagement`) inherit the wrap. |
| `server/src/index.ts` | Bootstrap, after `waitForExternalAdapters()` and before `server.listen()`: dynamic-imports `setBrooklynCredentialResolver`, `ensureBrooklynRegistered`, and `integrationCredentialService`; injects a `(companyId, credentialId) => integrationCredentialService(db).resolvePlaintext(...)` closure; then awaits `ensureBrooklynRegistered()`. |

No changes to `heartbeat.ts`, `packages/adapter-utils/src/`, migrations, or UI.

### 14.4 Design decisions

- **Wrap at registration, resolve at call time.** The wrap is applied once during registration so the heartbeat dispatch boundary is untouched; the resolver itself is a module-level closure populated by bootstrap, so the wrapper picks it up lazily on each `execute()` call. This is what lets the registry's module-load IIFE run before the `Db` handle exists without blocking.
- **Shallow-copy the config.** The wrapper builds a new object with `apiKey` set and `apiKeyRef` removed before calling the inner adapter. The original `ctx.config` is left intact so the heartbeat layer's persistence / audit / redaction view of `adapterConfig` still shows the reference, never the plaintext.
- **Plugin still refuses unresolved refs.** The wrapper resolves before delegating, so the plugin's `company-secret:` refusal branch never triggers in the normal path. It stays in place as a defence-in-depth check — if a future bug bypasses the wrap, the plugin still refuses to call the upstream service with an unresolved reference.
- **Errors are sanitised at the wrapper boundary.** When the resolver throws or returns an empty value, the wrapper produces `brooklyn_resolve_failed` / `brooklyn_no_resolver` with a hand-written `errorMessage`. The thrown error's `.message` is never copied through, so a `pg`/`drizzle` error string can't leak DB internals into the run log.
- **`integrationCredentialService.resolvePlaintext`, not `secretService.resolveSecretValue`.** The integration-credentials layer enforces the company-scoping check (`credential belongs to another company` → `unprocessable`) and the "credential has no encrypted material" check. Bypassing it would re-implement that authorization layer in the adapter path.

### 14.5 Why a Brooklyn-specific wrap (not a generic one)

The `apiKeyRef` field name and the `company-secret:` ref string are conventions invented for Brooklyn. The PR #46 integration-credentials system does not impose either: other adapters consume credentials through `env`-binding rewriting at agent-edit time (see `secretService.resolveAdapterConfigForRuntime`). A generic resolver here would either (a) duplicate that env-binding path or (b) impose Brooklyn's convention on adapters that don't use it. When PR 2/3 adapters land, the right move is to lift `wrapBrooklynAdapter` into `wrapLlmAdapter` and switch the `type ===` guard to a small set — that's a 5-line follow-up, not a now-decision.

### 14.6 Verification

- `pnpm --filter @noralos/server typecheck` — green.
- `pnpm --filter @noralos-plugins/noralai-brooklyn test` — 56 cases pass (no regressions from PR 1).
- `pnpm exec vitest run src/adapters/brooklyn-secret-ref.test.ts src/adapters/auto-register-brooklyn.test.ts` — 14 cases pass.

### 14.7 What the merge unlocks

After PR 1b lands, the operator path to a working Brooklyn agent is:

1. Settings → Integrations → "Add credential" → provider `noralai_brooklyn` → paste API key. (UI already shipped in PR #46.)
2. Settings → Plugins → Brooklyn → assign credential to slot `apiKeyRef`. (Same UI.)
3. Hire agent → adapter `noralai_brooklyn` → model `brooklyn-core` → set `baseUrl` (and optional `upstreamModel` override). (Same UI; `noralai_brooklyn` is selectable because PR 1b auto-registered the plugin.)
4. First heartbeat run resolves the credential and reaches the upstream service. No further wiring required.

PR 2 (Twilio) can start after this lands.
