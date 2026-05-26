# Integration Architecture: NoralOS → NoralVoice

**Audit date:** 2026-05-14

> Goal: decide how a NoralOS agent (Brooklyn the CEO, a director, a worker) invokes NoralVoice — design, create, run, monitor voice agents and workflows — without UI duplication, without forking logic, and without breaking NoralVoice's standalone product. Companion to [overlap-map.md](overlap-map.md) (what overlaps) and [migration-plan.md](migration-plan.md) (how to get there).

---

## 1. Constraints / non-negotiables

1. **NoralVoice must remain fully usable on its own** — no NoralOS service is required to log in, build workflows, place calls, manage telephony, or view recordings.
2. **Every NoralVoice capability must be invokable from a NoralOS agent** — design a workflow, run a single call, run a campaign, search the knowledge base, look up a recording, query call cost.
3. **Single clean integration surface** — one transport, one auth pattern, one place to add a new capability. No N+1 surfaces drifting apart.
4. **No logic forks** — voice provider catalogs, workflow node schemas, telephony provider plumbing live in exactly one place. NoralOS reads what NoralVoice publishes; never reimplements.
5. **No UI duplication** — if NoralVoice already has a deep editor surface (workflow builder, telephony config), NoralOS embeds it rather than reskinning.
6. **Per-tenant isolation enforced end-to-end** — a NoralOS company → exactly one NoralVoice organization, with one API key. Cross-company leakage is fail-closed.

---

## 2. Options considered

Five candidate transports / patterns. Each evaluated against the constraints.

### Option A — Shared npm/pip package

**Idea:** Both products import shared TypeScript or Python definitions (DTOs, validation, common utilities) from a published package.

| Pro | Con |
|---|---|
| Type safety end-to-end | NoralVoice is Python, NoralOS is TypeScript — no single shared library spans both |
| Code reuse for validation | Would need parallel Python + TS publishes; drift between them |
| | Doesn't actually move data — still need a transport layer underneath |

**Verdict:** Useful as a *complement* (shared schemas), not a primary transport. Recommendation #4 below covers the schema-share variant.

### Option B — Internal REST API + auto-generated typed SDK

**Idea:** NoralOS calls NoralVoice's existing HTTP API directly, using a typed client.

| Pro | Con |
|---|---|
| Transport already exists — NoralVoice's FastAPI surfaces `/api/v1/*` with OpenAPI spec | Generic HTTP — no agent-tool semantics out of the box |
| Generated client already exists: `dograh-sdk` (Python, v0.1.5), `@dograh/sdk` (TS, v0.1.5) | Need to rebrand the SDK packages |
| Spec-driven SDK — fetches NodeSpec catalog at session start, validates `add()` calls against live schema | Network latency (single-digit-ms locally, 50–150ms over LAN/internet) |
| OpenAPI generator on UI side proves the codegen pattern works in TS | |

**Verdict:** This is the **transport layer**. Stays. The SDK is the lingua franca for NoralOS plugin → NoralVoice calls.

### Option C — MCP server

**Idea:** NoralVoice exposes an MCP server (it already does at `/api/v1/mcp`); NoralOS agents call MCP tools directly via their adapter's MCP client.

| Pro | Con |
|---|---|
| Already implemented — FastMCP server with X-API-Key auth at [api/mcp_server/](../../api/mcp_server/) | MCP is shaped for LLM tool calls, not for general API operations |
| 10 tools already exposed: `list_workflows`, `get_workflow`, `create_workflow`, `save_workflow`, `get_workflow_code`, `list_node_types`, `get_node_type`, `list_tools`, `list_documents`, `list_credentials`, `list_recordings` ([api/mcp_server/server.py](../../api/mcp_server/server.py)) | Doesn't cover ops that aren't agent-tool-shaped (UI proxy calls, webhooks, billing aggregation) |
| TS-encoded workflow definition + AST validation gives LLMs a constrained grammar to edit graphs | Two transports to maintain if both MCP and REST are exposed |
| Standard, future-proof (any MCP-compatible LLM agent works) | Authentication is per-key — still need company-resolution at the SDK layer |

**Verdict:** Keep MCP for LLM-driven agent workflows. **Not** the primary transport for the NoralOS plugin (which needs much more than tools — UI proxies, webhooks, lifecycle). MCP is a complementary surface for any LLM that prefers it.

### Option D — NoralOS plugin (NoralSign pattern)

**Idea:** Build a `noralai.noralvoice` plugin in NoralOS that wraps NoralVoice's API. Plugin uses NoralSign's proven architecture: manifest with capabilities, agent tools, apiRoutes for board UI, webhook receivers, secret refs, sidebar+page UI slots.

| Pro | Con |
|---|---|
| First-class in NoralOS — auto-register, capability validation, manifest schema enforcement | One more code-owned surface (the plugin itself) |
| Per-company isolation via `integration_credentials` (PR #46) | Plugin lifecycle (install, upgrade, restart) adds operational steps |
| Agent tools, board apiRoutes, webhooks, sidebar, page slots all in one bundle | Plugin worker JSON-RPC has small protocol overhead |
| Proven end-to-end by NoralSign Phase 1 — DocuSeal bundled, 8 tools, webhook fan-out, dashboard surface, executive-tier gate | |
| Plugin worker imports the typed NoralVoice SDK — clean dependency direction | |
| Plugin owns the tier-gating logic (NoralSign-style) — voice campaigns are high-stakes and need executive-tier ceiling | |

**Verdict:** **This is the right pattern.** The plugin is the cohesive vehicle that combines all the other transports cleanly.

### Option E — Iframe / embed

**Idea:** Where NoralVoice's UI is deep and operator-heavy (workflow builder, campaign manager), embed it via iframe inside the NoralOS plugin page rather than recreate the UI.

| Pro | Con |
|---|---|
| Zero UI duplication for the workflow builder, telephony config, campaign editor | Iframes are clunky for modals, deep-linking, theme integration |
| Reuses NoralVoice's React-Flow builder, undo stack, validation | Auth must bridge cleanly — NoralOS session ↔ NoralVoice X-API-Key |
| Internal iframe + postMessage allows tight integration when needed | Need parent → child theming so iframed UI matches NoralOS surrounds |

**Verdict:** Yes, for **the workflow builder specifically** and possibly campaign editor. Use sparingly — high-frequency operations (lookups, list views, tool calls) should use REST/SDK, not iframes.

---

## 3. Recommendation

**Build one `noralai.noralvoice` plugin in NoralOS (Option D) that uses NoralVoice's typed SDK (Option B) as its transport, exposes MCP-shaped tools to NoralOS agents, and embeds NoralVoice's UI (Option E) for the deep builder surfaces. Optional shared schema package (Option A variant) if drift becomes painful.**

That's:

```
┌──────────────────────────  NoralOS  ──────────────────────────┐
│                                                                │
│  Brooklyn (CEO agent)                                          │
│      │                                                         │
│      │  ctx.tools.call("noralvoice:run_call", {…})             │
│      ▼                                                         │
│  noralai.noralvoice plugin worker (Node)                       │
│   ├─ ctx.config.get() → instanceConfig (NoralVoice base URL)   │
│   ├─ ctx.secrets.resolve(apiTokenRef) → NoralVoice API key     │
│   ├─ @noralai/voice-sdk client (renamed from @dograh/sdk)      │
│   └─ NoralVoice REST/MCP call                                  │
│                                                                │
│  Board UI                                                      │
│   └─ /:prefix/voice → plugin page slot                         │
│        ├─ Native list/detail (apiRoutes pass-through)          │
│        └─ Workflow builder (iframe → voice.noral.ai/workflow)  │
│                                                                │
└────────────────┬───────────────────────────────────────────────┘
                 │  HTTPS, X-API-Key
                 ▼
┌──────────────────────────  NoralVoice  ──────────────────────────┐
│                                                                  │
│  FastAPI · /api/v1/*  ·  /api/v1/mcp  ·  /public/embed/*         │
│  Pipecat runtime  ·  Telephony providers  ·  KB (pgvector)       │
│  PostgreSQL · Redis/ARQ · MinIO                                  │
│                                                                  │
│   ──── Webhooks: call.completed, run.finished ─────────►         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                 │  Webhook callbacks
                 ▼
        POST /api/plugins/noralai.noralvoice/webhooks/run.completed
        → emit on NoralOS event bus → originating agent wakes up
```

---

## 4. Plugin manifest sketch (`noralai.noralvoice`)

Reference template: `packages/plugins/noralai-noralsign/src/manifest.ts`.

```ts
export const manifest: NoralosPluginManifestV1 = {
  id: "noralai.noralvoice",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "NoralVoice",
  description: "Voice agent platform — design, run, and monitor voice workflows.",
  author: "Noral AI",
  categories: ["connector", "voice"],

  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "activity.log.write",
    "agents.read",
    "webhooks.receive",
    "events.emit",
    "api.routes.register",
    "ui.sidebar.register",
    "ui.page.register",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  ui: {
    slots: [
      { type: "sidebar", id: "noralvoice-sidebar-link",
        exportName: "NoralVoiceSidebarLink" },
      { type: "page",    id: "noralvoice-page",
        exportName: "NoralVoicePage", routePath: "voice" },
    ],
  },

  instanceConfigSchema: {
    type: "object",
    required: ["baseUrl", "apiKeyRef"],
    properties: {
      baseUrl: { type: "string", format: "uri",
        description: "NoralVoice base URL, e.g. https://voice.noral.ai" },
      apiKeyRef: { type: "string", format: "secret-ref",
        description: "NoralVoice X-API-Key (one per company)" },
      organizationId: { type: "integer",
        description: "NoralVoice org id this NoralOS company maps to" },
    },
  },

  webhooks: [
    { endpointKey: "run-completed",
      displayName: "Call / workflow run completed" },
    { endpointKey: "campaign-progress",
      displayName: "Campaign progress update" },
  ],

  apiRoutes: [
    { routeKey: "list_workflows", method: "GET", path: "/workflows",
      auth: "board",
      companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "get_workflow", method: "GET", path: "/workflows/:uuid",
      auth: "board",
      companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "list_runs", method: "GET", path: "/runs",
      auth: "board",
      companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "list_recordings", method: "GET", path: "/recordings",
      auth: "board",
      companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "search_kb", method: "POST", path: "/kb/search",
      auth: "board-or-agent",
      companyResolution: { from: "body", key: "companyId" } },
  ],

  tools: [
    { name: "design_workflow",   displayName: "Design a voice workflow",
      description: "…", parametersSchema: { /* … */ } },
    { name: "run_call",          displayName: "Run an outbound call",
      description: "…", parametersSchema: { /* … */ } },
    { name: "run_campaign",      displayName: "Run a calling campaign",
      description: "…", parametersSchema: { /* … */ } },
    { name: "get_run",           displayName: "Get a workflow run result",
      description: "…", parametersSchema: { /* … */ } },
    { name: "list_workflows",    displayName: "List voice workflows",
      description: "…", parametersSchema: { /* … */ } },
    { name: "clone_workflow",    displayName: "Clone an existing workflow",
      description: "…", parametersSchema: { /* … */ } },
    { name: "search_kb",         displayName: "Search the knowledge base",
      description: "…", parametersSchema: { /* … */ } },
  ],
};
```

---

## 5. Auth contract

Single transport, one credential, one mapping per company.

```
┌── NoralOS ──┐                              ┌── NoralVoice ──┐
│             │                              │                │
│ companies   │                              │ organizations  │
│  id: <uuid> │   ─── one-time mapping ───→  │  id: <int>     │
│             │                              │                │
│ integration │   stores NoralVoice API key  │ api_keys       │
│ _credentials│   (provider="noralvoice",    │  org-bound     │
│             │    type=api_key)             │                │
│             │                              │                │
└─────────────┘                              └────────────────┘
       │
       │  plugin instanceConfig.apiKeyRef =
       │     "company-secret:<uuid>"
       ▼
ctx.secrets.resolve(apiKeyRef) → plaintext at request time
       │
       ▼
HTTP X-API-Key header → NoralVoice routes resolve to org
```

- NoralVoice's existing `_handle_api_key_auth` already sets `user.selected_organization_id` from the key's org ([api/services/auth/depends.py:163-198](../../api/services/auth/depends.py)). No new code on NoralVoice side.
- One NoralVoice API key per NoralOS company. Rotation goes through `POST /integrations/credentials/:id/rotate` on the NoralOS side; the plugin worker reloads on the next call (no restart needed because `ctx.secrets.resolve()` always hits live storage).
- For agents calling tools, the plugin worker injects the API key — agents never see it.
- For board UI calling apiRoutes, the plugin proxies through the same key. Browser never holds the NoralVoice key.

---

## 6. Surface-by-surface routing

For every operation the NoralOS plugin needs to perform, decide which transport. (Cross-references rows in [overlap-map.md §I](overlap-map.md).)

| Operation | Path | Notes |
|---|---|---|
| Agent calls `noralvoice:run_call` | Plugin worker → SDK → `POST /workflows/:id/runs` | Synchronous; returns `run_id`; webhook arrives later |
| Agent calls `noralvoice:design_workflow` | Plugin worker → SDK template-based creation → `POST /workflows` + `/validate` + `/publish` | Phase 1: template-fill only. Phase 2: LLM-graph-generation with validate-loop |
| Agent calls `noralvoice:search_kb` | Plugin worker → SDK → `POST /knowledge-base/search` | pgvector hybrid search |
| Board UI lists voice workflows | Browser → plugin apiRoute `/list_workflows` → SDK → `GET /workflows` | Plugin proxies; browser never sees NoralVoice URL |
| Board UI opens workflow builder | Browser → plugin page slot → iframe `voice.noral.ai/workflow/:id` | Iframe with auth bridge (one-shot token exchange) |
| Board UI views call recording | Browser → plugin apiRoute `/list_recordings` → SDK → `GET /workflow-recordings` | List+download URLs |
| Board UI sees billing | Browser → NoralOS `/costs` page → plugin apiRoute `/usage` → SDK → `GET /organizations/usage/current-period` | NoralOS Costs page aggregates |
| Call lifecycle event fires | NoralVoice → `POST /api/plugins/noralai.noralvoice/webhooks/run-completed` → plugin worker → `ctx.events.emit("noralai.noralvoice.run.completed", {…})` | Originating agent's task session wakes up |
| KB document upload | Browser → plugin apiRoute → SDK → presigned URL pattern (`POST /knowledge-base/upload-url`) | Same KB; UI inside NoralOS, storage in NoralVoice |

---

## 7. Why not just iframe everything?

| Why iframes alone fail | Why we keep iframes for the builder |
|---|---|
| Agent tool calls can't be iframes | The workflow builder is a deep, stateful, idiosyncratic UI — recreating it is a huge investment for marginal UX gain |
| Webhooks → originating agent loop needs server-to-server | NoralVoice already maintains it; iframe means zero drift |
| Authn handoff via postMessage is brittle | A NoralOS-issued one-shot exchange-token → NoralVoice session is clean enough |
| Lists / search / costs are better as native NoralOS UI for accessibility, theming, deep-linking | |

The split is: **fast paths native** (lists, search, agent tools, webhook receivers) + **deep editors via iframe** (workflow builder, campaign builder). Most user time is in the fast paths; iframes are escape hatches for the heavy editors.

---

## 8. Why NOT make NoralOS the orchestrator-of-record

A tempting alternative: make NoralOS the source-of-truth (it has the integrations vault, the auth, the company model), and reduce NoralVoice to a stateless voice runtime that NoralOS pushes config into per-call. Rejected because:

1. **NoralVoice is a standalone product first.** Constraint #1. It must function with no NoralOS attached.
2. **NoralVoice has 82 migrations of accumulated domain state** — workflow versions, runs, transcripts, recordings, embed sessions, KB documents+chunks, telephony configs, phone numbers, campaign queues. Hoisting that into NoralOS is a year-long rebuild.
3. **NoralVoice's product surface (operator UX) is real and shipped.** Customers use `voice.noral.ai` directly.
4. **Plugin pattern preserves both products.** NoralVoice doesn't change. NoralOS adds one plugin. No migration risk to the existing NoralVoice deploy.

The plugin pattern keeps NoralVoice's product autonomy and lets NoralOS *consume* it. Reverse direction is the wrong invariant.

---

## 9. Schema sharing (optional)

After the plugin is shipped and stable, consider extracting shared TypeScript types into `@noralai/voice-schemas`:
- NodeSpec catalog (mirror of `api/services/workflow/node_specs/`)
- Workflow run shape (transcript, disposition codes, extracted variables)
- Provider catalog (TTS/STT/LLM/telephony enum + capabilities)

The plugin's SDK pulls these from a published package, generated from NoralVoice's OpenAPI spec on release. Avoids manual drift when NoralVoice adds a node type or a provider. **Not required for v1** — Option B's SDK already exposes types from the live spec via `@hey-api/openapi-ts`.

---

## 10. Versioning & contract evolution

- **NoralVoice publishes a stable major** of its OpenAPI spec. SDK consumers (the plugin) pin to a major (e.g. `^v1.x.x`).
- **Plugin advertises a `noralvoiceMinVersion`** in its instanceConfig schema. Plugin worker probes `GET /version` at boot and refuses to load if mismatched.
- **Webhook payloads versioned** by a `schemaVersion` field; plugin worker switches per version.
- **Breaking changes in NoralVoice** require: (a) a major bump on the SDK, (b) a corresponding plugin version, (c) `auto-register-noralvoice.ts` (analogue to `auto-register-noralsign.ts`) handles upgrade detection.

---

## 11. What this rules in / what this rules out

**Rules in:**
- Build the `noralai.noralvoice` plugin first. Everything else hangs off it.
- Rebrand `dograh-sdk`/`@dograh/sdk` → `@noralai/voice-sdk` (Python: `noralai-voice`). Plugin imports `@noralai/voice-sdk` from npm or a workspace path.
- Reuse the NoralSign auto-register pattern (`server/src/services/auto-register-noralvoice.ts`).
- Add `noralvoice` as a new `INTEGRATION_PROVIDERS` entry (api_key category), plus assignment-target slots for the plugin.
- One iframe surface: workflow builder. Authenticate via short-lived exchange token (one-shot, single-use).

**Rules out:**
- NoralOS reimplementing voice providers, telephony plumbing, recording storage, KB embeddings.
- NoralVoice gaining a hard NoralOS dependency (no NoralOS account = NoralVoice still works).
- Per-feature WebSocket connections between products — the only NoralVoice WS NoralOS would consume is the embed signaling, and only inside the iframe.
- Maintaining the NoralOS `voice-cascade` provider catalog past Phase 2 (replaced by NoralVoice's catalog).
- The NoralOS Twilio plugin merging from its unmerged branch.
- Sharing a database. The two products have totally different schemas; the plugin is the contract.
