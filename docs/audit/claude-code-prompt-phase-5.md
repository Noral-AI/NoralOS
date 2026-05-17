You are executing **Phase 5** of the NoralOS ↔ NoralVoice consolidation. Most of the work is in NoralVoice; one PR touches both repos. Phases 0–4 are merged and deployed (see `project_phase4_done` memory).

## Binding context (read in this order)

```
docs/audit/
  consolidation-scope.md       ← binding scope. §2 Pillar B item 3 (noralos:// scheme), §6 success criterion "Zero Dograh string by end of Phase 5"
  consolidation-plan.md        ← §Phase 5 section
  uiux-streamlining.md         ← Tier 1 items #1 (settings collapse), #4 (Dograh purge), #5 (dead pages)
  integration-architecture.md  ← §7 reverse-direction tooling
```

Also read:
- `CLAUDE.md` at both repo roots
- The Phase 0 PR that introduced the brand-tokens module on the NoralVoice side (`ui/src/lib/brand.ts` + `api/constants.py`) — that module is the source of truth for the purge, not raw string replaces
- `packages/plugins/noralai-noralvoice/` — your plugin from Phases 1–4 (you'll register a reverse-tool dispatcher here)

## Repos / branching

This phase spans BOTH repos. Verify `git remote -v` before any push.

| Role | Path | Origin | Branch |
|---|---|---|---|
| NoralVoice (primary) | `/Users/quentin/Documents/NORALAI/NoralVoice` | `github.com/Noral-AI/NoralVoice` | `rebrand/noralvoice` |
| NoralOS (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` | `github.com/Noral-AI/NoralOS` | `master` |
| NoralOS (decoy — DO NOT PUSH) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` | (hyphenated) | n/a |

Working branches (NoralVoice unless noted):
- PR-A: `feat/phase-5a-settings-collapse`
- PR-B: `feat/phase-5b-dograh-brand-purge`
- PR-C: `feat/phase-5c-orphan-page-dispositions`
- PR-D: `feat/phase-5d-noralos-tool-scheme` (NoralVoice side) + `feat/phase-5d-reverse-rpc` (NoralOS side, stacked: NoralVoice merges first)

Open the NoralVoice PRs against `rebrand/noralvoice` (the rebrand-finalization branch — see `project_noralvoice_relationship` memory). Open the NoralOS PR against `master`.

## Goal

After Phase 5:
- A NoralVoice operator visiting any of `/api-keys`, `/integrations`, `/model-configurations`, `/telephony-configurations`, `/credentials`, `/settings`, `/usage` lands on a single tabbed `/settings` page. The old paths 301-redirect for one release.
- The sidebar loses three items (Models, Telephony, Developers) and gains one top-level "Settings" link. The user dropdown loses "Platform Settings" and "Usage" (now tabs).
- `git grep -i dograh` in the NoralVoice repo returns zero user-facing hits. Brand tokens drive every label, cookie name, widget global, OpenAPI title, docs link, and Axiom dataset.
- `/automation` deleted. `/looptalk` root has a sessions listing. `/superadmin` is reachable from the user dropdown (gated on `is_superuser`). `/impersonate` either works under local or 501s with a clear message.
- A NoralVoice voice agent can issue a `noralos://noralvoice/<tool>` call mid-conversation and get a response routed through the NoralOS plugin's reverse-RPC endpoint. v1 reverse-tools: `get_agent_status`, `create_task_for_agent`, `lookup_customer`.

Standalone `voice.noral.ai` smoke (signup → build workflow → place test call) must pass at end of EACH PR — this is the cardinal rule from `consolidation-plan.md`.

---

## PR-A — NoralVoice settings collapse

NoralVoice repo. Single PR. ~6 page files → 1 orchestrator + tabs.

### A1. Route consolidation

Create `ui/src/app/settings/page.tsx` (or rebuild the existing one) as a tabbed orchestrator. Tabs and their sources:

| Tab | Source | Backend |
|---|---|---|
| Profile | new — current user info | `/user` |
| Organization | new — org name, members, branding | `/organizations/current` |
| Integrations | move `/integrations/page.tsx` (Nango — Slack/Sheets/Gmail) | `/integration` |
| Telephony | move `/telephony-configurations` list + detail | `/organizations/telephony-configs/*` |
| Models | move `/model-configurations/page.tsx` + `ServiceConfiguration` component | `/user/configurations/user` |
| Webhook auth | NEW UI — surface the existing `/credentials` table | `/credentials` |
| API keys | move left tab of `/api-keys` (NoralVoice's own API keys) | `/user/api-keys` |
| Cloud services | move right tab of `/api-keys` (MPS keys). Hide entire tab if `MANAGED_KEYS_ENABLED=false` | `/user/service-keys` |
| Platform | move `/settings/page.tsx` (Langfuse, MCP info, telemetry) | `/organizations/langfuse-credentials` |
| Usage & billing | move `/usage/page.tsx`. Keep `/run/:id` → "View usage" deep-link working | existing |

### A2. Redirects

Add 301 redirects for one release from old paths to `/settings?tab=<tabId>`. Implement via Next.js middleware or `redirects` in `next.config.mjs`. Document the deprecation banner shown on the tab pages.

### A3. Sidebar trim

`ui/src/components/layout/AppSidebar.tsx` — drop the three nav items (Models, Telephony, Developers) and add "Settings" as a top-level item below OBSERVE. Reorder so BUILD has only what's left (Voice Agents, Campaigns, Tools, Files, Recordings). Drop "Platform Settings" + "Usage" from the user dropdown (they're tabs now).

### A4. PR-A smoke

- [ ] Each of the 10 tabs renders without console errors
- [ ] Switching tabs preserves the URL (`?tab=integrations` is bookmarkable)
- [ ] Old paths (`/api-keys`, `/integrations`, `/model-configurations`, `/telephony-configurations`, `/settings`, `/usage`) 301 to the right tab
- [ ] `/run/:id` → "View usage" still resolves to the Usage tab
- [ ] Sidebar shows the trimmed nav; "Settings" is reachable as a top-level link
- [ ] Hide-when-disabled works: with `MANAGED_KEYS_ENABLED=false`, the "Cloud services" tab is not rendered
- [ ] Standalone smoke (signup → build → place call) passes

### PR-A meta

- Title: `feat(phase-5a): collapse settings surfaces into single /settings with tabs`
- Open against `rebrand/noralvoice`
- Commits: one per tab move + one for redirects + one for sidebar trim + one for smoke fixes

---

## PR-B — Dograh brand purge

NoralVoice repo + the small NoralOS test-fix. Driven by the brand-tokens module from Phase 0.

### B1. Brand-tokens module (sanity check)

`ui/src/lib/brand.ts` and `api/constants.py` should already exist from Phase 0 with: `name`, `productLine`, `widgetGlobalName`, `cookiePrefix`, `docsUrl`, `domain`, `supportEmail`. Confirm. If a field is missing, add it (env-overridable). Do NOT add a constant module on top of a constant module — extend the existing one.

### B2. Replace user-facing hits

Replace every hardcoded `"Dograh"` string with a brand-token read. The full hit-list is in `uiux-streamlining.md` Tier 1 #4 — at minimum:

| File | Today | After |
|---|---|---|
| `ui/src/app/layout.tsx` | `<title>Dograh</title>` | `<title>{BRAND.name}</title>` |
| `ui/src/components/layout/AppSidebar.tsx` | sidebar logo `Dograh` text | `{BRAND.name}` |
| `ui/src/app/overview/page.tsx` | `Welcome to Dograh` | `Welcome to {BRAND.name}` |
| `ui/src/middleware.ts` | `dograh_auth_token` cookie | `${BRAND.cookiePrefix}_auth_token` — write BOTH for one release (read-fallback the old) |
| `ui/.../EmbedDialog.tsx` | `window.DograhWidget`, `<div id="dograh-inline-container">` | `window.{BRAND.widgetGlobalName}Widget`, `<div id="{BRAND.widgetGlobalName.toLowerCase()}-inline-container">` |
| `api/app.py` | `title="Dograh API"`, `servers: [https://app.dograh.com]` | from `BRAND.name`, `BRAND.domain` |
| `api/mcp_server/` | server name `Dograh MCP` | `{BRAND.name} MCP` |
| `/api-keys` page | "Dograh Service Keys" label | "Managed cloud services" (or `BRAND.managedCredentialsLabel` if you want it env-driven) |
| `/usage` page | "Dograh Tokens" label | "Cloud credits" or similar generic |
| Multiple pages | `docs.dograh.com` URLs | `BRAND.docsUrl` (env-tokenized) |
| `ui/.../superadmin/runs/page.tsx` | hardcoded Axiom URL `app.axiom.co/dograh-of6c/...` | use existing `NEXT_PUBLIC_AXIOM_LOG_DATASET` env |

Do NOT leave dual-publish artifacts in the brand-tokens module. The cookie-migration window is the only dual write; everything else is a direct cutover.

### B3. Cookie migration

`ui/src/middleware.ts` and any login/logout handler:
1. On login: set BOTH `noralvoice_auth_token` (or whatever `BRAND.cookiePrefix` resolves to) AND `dograh_auth_token`.
2. On any auth check: try the new cookie first, fall back to the old.
3. On logout: clear both.

This stays in for ONE release. After Phase 5 merges and a follow-up window passes, a small follow-up PR deletes the dual-write. Mark the call sites with a `// PHASE-5 COOKIE-MIGRATION` comment so the cleanup is mechanical.

### B4. NoralOS cli-auth-routes rebrand fix

Bundle the small NoralOS-side rebrand miss into PR-B (or split if it's cleaner — but it's the same brand-purge logical change). On NoralOS-canonical:

- `server/src/routes/access.ts:3161` — `if (skillName !== "paperclip") throw notFound(...)` → `if (skillName !== "noralos") throw notFound(...)`
- `readSkillMarkdown(skillName)` callers — confirm the skill markdown source file is `noralos.md` (or equivalent) and not `paperclip.md`. Look at line 2864 (`{ name: "paperclip", path: "/api/skills/noralos" }`) — this is wired half-and-half. Pick one canonical name (`noralos`) and apply it through the chain. The test at `server/src/__tests__/cli-auth-routes.test.ts:169` already expects `noralos` and the response body `"# NoralOS Skill"` — make the route handler match.
- Also check `server/src/routes/access.ts:2864` and `:2871-2875` — paperclip-prefixed paths under `/api/skills/`. Decide: keep them as legacy or rename. Recommended: rename to `/api/skills/noralos*` to match the new canonical name; keep a 301 from the old paths for one release.

This is the file the `verify` CI job has been failing on since the Phase 4 typecheck unblock — turning master green again is a Phase 5 side-effect.

### B5. PR-B smoke

- [ ] `git grep -i dograh` in NoralVoice returns zero hits in `ui/src/` and `api/` outside the cookie-migration block (`PHASE-5 COOKIE-MIGRATION` comments are the explicit allow-list)
- [ ] Browser tab title is "NoralVoice" on every page
- [ ] Login + logout works against the new cookie name; pre-existing sessions on the old cookie don't get bounced
- [ ] Embed widget loads with `window.NoralVoiceWidget` on the embedder page
- [ ] OpenAPI JSON (`GET /openapi.json`) has `info.title = "NoralVoice API"`
- [ ] NoralOS: `cli-auth-routes.test.ts:169` ("serves the invite-scoped noralos skill anonymously for active invites") passes locally and in CI
- [ ] Standalone NV smoke passes

### PR-B meta

- Title: `feat(phase-5b): purge Dograh brand surfaces; route everything through brand-tokens`
- Two PRs technically (NV + NoralOS), opened in parallel since neither depends on the other
- NoralVoice PR base: `rebrand/noralvoice`. NoralOS PR base: `master`
- PR body lists the hit-count before and after (`git grep -i dograh -- ui api`)

---

## PR-C — Dead-page dispositions

NoralVoice repo. Small, surgical.

| Page | Disposition | Notes |
|---|---|---|
| `/automation/page.tsx` | DELETE | Stub since who-knows-when, never wired. If a real feature comes, recreate fresh. |
| `/looptalk/page.tsx` (root) | SHIP listing UI | Backend `/looptalk/[id]` is fully wired (live test sessions, WS audio). Build a directory listing: query the existing `looptalk_sessions` table (or whatever the backend uses), paginated, with status badges + a "Start new session" CTA. |
| `/integrations` | KEEP (re-homed) | Already merged into PR-A as a `/settings?tab=integrations` tab. Confirm the old route 301s. |
| `/superadmin` | EXPOSE | Add a "Superadmin" entry to the user-dropdown, gated client-side on `user.is_superuser`. Server still gates the route itself. |
| `/impersonate` | FIX OR 501 | Stack-only path. Under `local` auth provider, either implement the impersonation flow OR return 501 with a clear message ("Impersonation is not supported under local auth. Use the Stack provider."). Silent no-op is unacceptable. |

### PR-C smoke

- [ ] `/automation` returns 404 (or its directory is gone)
- [ ] `/looptalk` (no id) renders the sessions listing; clicking a row goes to `/looptalk/<id>` and the existing live-session UI works
- [ ] Superadmin link visible in the user dropdown when logged in as a superuser; hidden otherwise; clicking it lands on the working `/superadmin` page
- [ ] `/impersonate` under local auth returns either a working flow or a 501 with the canned message
- [ ] Standalone smoke passes

### PR-C meta

- Title: `feat(phase-5c): orphan-page dispositions (delete /automation, ship /looptalk listing, expose superadmin)`
- Base: `rebrand/noralvoice`

---

## PR-D — `noralos://` reverse-tool scheme

The biggest mechanism in this phase. Spans both repos; NoralVoice side merges first, then NoralOS.

### D1. NoralVoice tool executor

A NoralVoice workflow's Agent node can today reference tools by URL (e.g. `https://...` for an HTTP tool). Add a new scheme `noralos://<plugin_id>/<tool_name>`. When the tool executor sees this scheme:

1. Resolve the calling workflow's owning organization → look up the registered "reverse-rpc" callback URL (added by the NoralOS plugin during Phase 1's `integration-webhooks` registration — extend that record with a new `reverse_rpc_url` field, or reuse the same record's base URL convention)
2. POST to `<reverse_rpc_url>` with body `{ plugin_id, tool_name, args, run_id, workflow_uuid, organization_id }` and an HMAC signature
3. Wait up to 10s for a response. Expected response shape: `{ ok: true, result: ... }` or `{ ok: false, error: "...", code: "..." }`
4. Return the result to the Agent node as the tool's output

Implementation:
- `api/tools/executors/noralos_url_executor.py` — new file
- `api/tools/dispatcher.py` — register the new scheme
- Auth: HMAC-SHA256 over the body with the per-organization integration-webhook secret (same secret already used for outbound `run.completed` webhooks). Header: `X-Noralos-Signature`.
- Timeout, retry policy: one attempt, 10s timeout, no retry inside the call — Voice Agent can re-call if it wants
- Failures: surface as a tool error to the Agent node ("noralos://… returned 500: …"); do NOT crash the run

### D2. NoralOS reverse-RPC endpoint

NoralOS-canonical, inside the `noralai.noralvoice` plugin:

1. Add an apiRoute `POST /reverse-tool` to the plugin manifest:
   - Auth: HMAC verification using the per-company integration-webhook secret (the plugin already verifies HMAC for run-completed webhooks — reuse that path)
   - Body: `{ plugin_id, tool_name, args, run_id, workflow_uuid, organization_id }`
   - Company resolution: from `organization_id` → look up the company that owns that NoralVoice org (the `integration_credentials` row links them)
2. Inside the handler, dispatch to a registered reverse-tool handler:
   - `noralos://noralvoice/get_agent_status` → return summary of the originating Voice Director agent's state (last activity, current task, can-talk-now boolean)
   - `noralos://noralvoice/create_task_for_agent` → call `ctx.tasks.create(...)` with the args (target_agent_id, title, body)
   - `noralos://noralvoice/lookup_customer` → call a registered customer-lookup service if one exists in the company's workspace; otherwise return `{ ok: false, error: "NOT_CONFIGURED" }`
3. Register the reverse-tool dispatchers as a new registry pattern in the plugin SDK (`packages/plugins/sdk/src/define-plugin.ts`):
   - Add `reverseTools?: PluginReverseToolDeclaration[]` to the manifest type
   - Add `onReverseTool?(input: PluginReverseToolInput): Promise<PluginReverseToolResult>` lifecycle hook
   - This is a new SDK capability — bump the SDK version (`packages/plugins/sdk/package.json`)

### D3. NoralVoice → NoralOS registration

When the NoralOS plugin registers an integration-webhook in NoralVoice (existing Phase 1 flow), include `reverse_rpc_url: "<noralos_base>/api/plugins/noralai.noralvoice/api/reverse-tool"` and `reverse_rpc_secret: "<hmac_secret>"`. NoralVoice persists these on the existing integration record.

If the existing `POST /api/v1/integration-webhooks` schema doesn't have these fields, add them in this PR.

### D4. v1 reverse-tools

Register the three named in the goal. Each has tests:

| Tool | Args | Returns |
|---|---|---|
| `noralos://noralvoice/get_agent_status` | `{ agent_id }` | `{ ok, status: "active" \| "idle" \| "offline", last_seen_at, can_be_paged }` |
| `noralos://noralvoice/create_task_for_agent` | `{ agent_id, title, body, priority? }` | `{ ok, task_id }` or `{ ok: false, error: "...", code: "..." }` |
| `noralos://noralvoice/lookup_customer` | `{ identifier }` (email, phone, or customer_id) | `{ ok, customer: {...} }` or `{ ok: false, error: "NOT_FOUND" }` |

### D5. PR-D smoke

- [ ] NoralVoice integration webhook record stores `reverse_rpc_url` + secret after a fresh plugin install
- [ ] A NoralVoice workflow with an Agent node referencing `noralos://noralvoice/get_agent_status` completes one round-trip in <2s and the tool output is visible in the run log
- [ ] HMAC mismatch returns 401 from the NoralOS endpoint
- [ ] Unknown tool name returns `{ ok: false, error: "UNKNOWN_REVERSE_TOOL" }`
- [ ] Standalone NV smoke passes (no reverse-tool needed for the smoke; just verify nothing broke)
- [ ] After D's deploy: run a real call where Voice Director places an outbound call, the called workflow uses `noralos://noralvoice/create_task_for_agent` to log a task back to NoralOS, and the task appears in the inbox

### PR-D meta

- TWO PRs, stacked: NoralVoice merges first, NoralOS follows
- NoralVoice PR title: `feat(phase-5d-nv): noralos:// tool scheme executor for Agent nodes`
- NoralOS PR title: `feat(phase-5d-os): reverse-tool RPC endpoint + 3 v1 handlers`
- The NoralOS PR is stacked on the NoralVoice PR's contract (URLs and request shape). If the contract changes during NV review, the NoralOS PR rebases.

---

## Anti-goals (all PRs)

- Do NOT introduce a second brand-tokens module. The Phase 0 module is the single source of truth.
- Do NOT rename NoralVoice DB tables (`workflows` → `voice_agents`). Scope §4 explicitly defers this.
- Do NOT drop the cookie-migration dual-write inside Phase 5 — the second write lives for one release post-merge, removed in a follow-up.
- Do NOT add new reverse-tools beyond the three named v1 ones. Phase 7 owns "full tool coverage" — that's where breadth gets added on both directions.
- Do NOT fold the NoralOS Conference Room re-route here. Phase 6 owns that.
- Do NOT bundle NoralVoice into NoralOS's Docker compose. Scope §4.
- Do NOT touch the auto-register-* race condition we observed in Phase 4 (`unloadSingle` → `loadSingle` "Worker already registered"). That's a real bug worth filing as a follow-up but it's not Phase 5 scope. See `feedback_auto_register_version_reader_bug` memory.

## Stop and report if

- NoralVoice's settings tabs require a backend endpoint that doesn't exist (e.g., a unified org-members API the new Organization tab needs). Stop and propose the smallest backend addition.
- The brand-tokens module from Phase 0 is missing a field you need for a literal you're replacing. Extend the module — don't introduce a sibling constants file.
- The `integration_webhooks` table doesn't have a place to persist `reverse_rpc_url` + secret. Add the column in PR-D's NV side; do NOT silently shoehorn it into the existing `secret` field.
- The HMAC reuse from Phase 1's `run-completed` webhook is incompatible with the reverse direction (e.g., the secret is per-event-type). Propose a per-direction secret scheme and stop.
- A reverse-tool needs cross-company data (the call is in org X but the tool needs data from org Y). Hard-stop — this is a privilege boundary violation; reverse-tools are strictly same-company.
- `voice.noral.ai` standalone smoke fails at the end of any PR. Roll back the PR before merging.

## When you finish (all four PRs)

Reply with:
1. PR URLs and merge statuses (all NoralVoice PRs against `rebrand/noralvoice`; NoralOS PRs against `master`)
2. Smoke results for each PR (A4, B5, C smoke, D5)
3. Before/after `git grep -i dograh` hit counts in NoralVoice
4. Sidebar item count before/after (target: 10 → 7)
5. List of any reverse-tools you added beyond the named v1 set (should be zero)
6. Anything punted to Phase 6 (conference-room re-route, plugin uninstalls) or to a separate follow-up (cookie-migration cleanup, auto-register race fix)
7. NoralVoice standalone smoke status at end of each PR

Do not start Phase 6. Wait for the next prompt.
