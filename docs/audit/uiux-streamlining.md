# UI/UX Streamlining

**Audit date:** 2026-05-14

> Ranked highest-impact-first. Each item: where it lives today, what's wrong, the specific change. Bias toward **deleting things** and **renaming things**; structural redesigns are flagged but deprioritized.

---

## Ranking criteria

1. **User confusion potential** — how often do users get stuck or pick the wrong surface
2. **Implementation cost** — pages of code, migration risk
3. **Visibility** — whether it's seen on first session vs deep in admin
4. **Blocker status** — does it block the consolidation plan?

---

# Tier 1 — Blockers / high-confusion (do first)

## 1. NoralVoice: collapse the 5+ settings surfaces into one `/settings` with tabs

**Current state — six overlapping surfaces, four with poor discoverability:**

| Surface | Backend | Audience | Nav |
|---|---|---|---|
| `/api-keys` (729 LOC, [ui/src/app/api-keys/page.tsx](../../ui/src/app/api-keys/page.tsx)) | `/user/api-keys` + `/user/service-keys` (2 unrelated tables in one tabbed page) | Operator | BUILD > Developers |
| `/integrations` (174 LOC) | `/integration` (Nango — Slack/Sheets/Gmail) | Operator | **none** (orphan) |
| `/model-configurations` (15 LOC + ServiceConfiguration component) | `/user/configurations/user` | Operator | BUILD > Models |
| `/telephony-configurations` (345 LOC list + 434 LOC detail) | `/organizations/telephony-configs/*` | Operator | BUILD > Telephony |
| `/settings` (69 LOC) | `/organizations/langfuse-credentials` + MCP info | Operator | **user dropdown only** |
| `/credentials` (no UI) | `/credentials` (webhook outbound auth) | (none) | **N/A — no UI** |

**Problem:** "api-keys" and "integrations" sound interchangeable but aren't. `/api-keys` itself bundles two unrelated key systems (NoralVoice's own API keys vs MPS-cloud LLM keys). `/integrations` has a working Nango flow with no nav link. Operators ask "where do I add my Twilio creds?" — answer is in a fourth page (`/telephony-configurations`). Webhook outbound auth has a table and an API but no UI at all.

**Target:** One `/settings` route with tabs, accessed from the sidebar (not just the user dropdown).

```
/settings
  ├─ tab: Profile         (current /user info)
  ├─ tab: Organization    (org name, members, branding)
  ├─ tab: Integrations    (Nango OAuth + first-party OAuth, ex-/integrations)
  ├─ tab: Telephony       (current /telephony-configurations)
  ├─ tab: Models          (current /model-configurations)
  ├─ tab: Webhook auth    (currently no UI — surface /credentials table)
  ├─ tab: API keys        (current /api-keys left tab — for callers of NoralVoice)
  ├─ tab: Cloud services  (current /api-keys right tab — MPS keys; rename, hide if MPS disabled)
  ├─ tab: Platform        (current /settings — Langfuse, MCP info, telemetry)
  └─ tab: Usage & billing (current /usage — keep deep /usage links from `/run/:id`)
```

Implementation note: keep old paths as 301 redirects for 1 release to preserve bookmarks.

**Before / after:**

```
BEFORE                          AFTER
─────────────────────────       ───────────────────────────
Sidebar:                        Sidebar:
  BUILD                           BUILD
    Voice Agents                    Voice Agents
    Campaigns                       Campaigns
    Models     ← gone               Tools
    Telephony  ← gone               Files
    Tools                           Recordings
    Files                         OBSERVE
    Recordings                      Agent Runs
    Developers ← gone               Reports
  OBSERVE                         SETTINGS  (← new top-level)
    Agent Runs
    Reports
  (no Settings top-level)
  user dropdown:
    Platform Settings ← gone
    Usage             ← merged
```

Saves: ~4 sidebar items moved out of nav, 5+ page files merged into one orchestrator.

---

## 2. NoralOS: collapse `voice-config` + `voice-cascade` + ~~`conference-room-bridge`~~ into one `noralai.noralvoice` plugin

**Status — IN PROGRESS (Phase 6 re-scoped).** Conference Room turned out to have zero production reach (only 2 test-file references); the plan collapsed once it was retired.

**Original state — 4132 LOC across three plugins for one logical surface:**

| Plugin | LOC | Owns | Status |
|---|---|---|---|
| `voice-config` | 851 (manifest 111 + worker 615 + types 65 + constants 58) | Per-agent voice settings table, tier derivation, surface visibility | **Retiring in Phase 6 PR-4** (state moves to `agents.surface_flags` JSONB + `agents.tier_override`; CompanyVoiceDefaults moves to a `noralai.noralvoice`-owned `company_voice_defaults` table). |
| `voice-cascade` | 1334 (worker 834 + providers 252 + manifest 162 + types 147) | TTS execution: exfiltration scan, ElevenLabs + Google TTS providers, serial fallback | **Retiring in Phase 6 PR-3** (after PR-2 1-week soak). TTS path moves to NoralVoice's new `/api/v1/public/embed/synthesize` endpoint ([NV #10](https://github.com/Noral-AI/NoralVoice/pull/10)) via the noralai.noralvoice plugin proxy ([NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106)). Exfiltration scan ported into NV at port time. |
| ~~`conference-room-bridge`~~ | ~~1947~~ | ~~Pipecat session ↔ NoralOS agent-session glue, browser STT loop, ConferenceRoomPage UI~~ | **REMOVED in [NoralOS #105](https://github.com/Noral-AI/NoralOS/pull/105)** (merged `8f2b9076`, ~-3900 LOC). Had zero production callers. |

**Target:** Single `noralai.noralvoice` plugin. Owns:
- Sidebar link → Voice page slot
- Agent tools that delegate to NoralVoice via SDK (list_workflows, run_call, etc.)
- apiRoutes that proxy NoralVoice for the board UI — including the new `/synthesize` proxy (PR-2) and the migrated voice-settings reader/writer (PR-4)
- Webhook receivers for NoralVoice call-lifecycle events
- Per-agent voice settings written via the `agents.surface_flags` + `agents.tier_override` columns + `company_voice_defaults` plugin-owned table (PR-4)

**Realized LOC win** (incl. #105): ≥ -6400 across the three plugins after netting the work that lands in `noralai.noralvoice` + NoralVoice's TTS endpoint.

**Surface flag set** is now three (`dashboard`, `slack`, `phone`) — `conference_room` is intentionally dropped.

---

## 3. Both: settle the "Agent" terminology collision

**Current state:**
- **NoralVoice UI** says "Voice Agents", "Active Agents", "Agent Runs". DB and URL say `workflow` / `workflow_runs`. SDK exports `Workflow` class.
- **NoralOS UI** says "Agent" everywhere. DB table `agents`. Means "autonomous LLM worker."

**Problem:** A user with both products sees "Agent" in two unrelated places. Internally the products use different terms (NoralVoice: workflow; NoralOS: agent). Cross-product talk ("the CEO agent should make a call using a voice agent") gets confusing fast.

**Target naming:**

| Concept | Product surface | Public name | Internal name |
|---|---|---|---|
| Autonomous worker that does heartbeat-driven tasks (Brooklyn, etc.) | NoralOS | **Worker Agent** (or just "Agent" inside NoralOS) | `agent` |
| Conversational persona that runs voice calls | NoralVoice | **Voice Agent** (consistent across UI, URL, DB-eventually) | `workflow` for now, rename to `voice_agent` in a later major |
| The intersection where a Worker Agent invokes a Voice Agent | both | "voice agent invocation" | tool call `noralvoice:run_call` |

**Concrete changes:**
- NoralVoice: page headings say "Voice Agent" not "Active Agents." `/workflow` URL stays for now; eventually `/voice-agents` with redirect. Sidebar already says "Voice Agents" — keep.
- NoralOS: when surfacing voice-side concepts, label them "Voice Agent" (the plugin page slot: "NoralVoice" with a sub-heading "Voice agents in [NoralVoice]"). Native NoralOS "Agent" terminology stays.
- Open question: rename NoralVoice DB columns over time. Optional — not urgent — flagged in [open-questions.md #5](open-questions.md).

---

## 4. NoralVoice: kill the Dograh-brand surface text

**Current state — verified instances:**

| Where | Today | Should be |
|---|---|---|
| `<title>` ([ui/src/app/layout.tsx:32](../../ui/src/app/layout.tsx)) | `Dograh` | `NoralVoice` |
| Sidebar logo text ([ui/src/components/layout/AppSidebar.tsx:268](../../ui/src/components/layout/AppSidebar.tsx)) | `Dograh` | `NoralVoice` (from theme tokens) |
| Welcome heading ([ui/src/app/overview/page.tsx:22](../../ui/src/app/overview/page.tsx)) | `Welcome to Dograh` | `Welcome to NoralVoice` |
| Cookie name ([ui/src/middleware.ts:4](../../ui/src/middleware.ts)) | `dograh_auth_token` | `noralvoice_auth_token` (set both during migration window) |
| Embed widget global ([ui/.../EmbedDialog.tsx](../../ui/src/app/workflow)) | `window.DograhWidget` + `<div id="dograh-inline-container">` | `window.NoralVoiceWidget` + `<div id="noralvoice-inline-container">` |
| SDK package names ([sdk/python/pyproject.toml](../../sdk/python/pyproject.toml), [sdk/typescript/package.json](../../sdk/typescript/package.json)) | `dograh-sdk`, `@dograh/sdk` | `noralai-voice`, `@noralai/voice-sdk` |
| MCP server name ([api/mcp_server/](../../api/mcp_server/)) | `Dograh MCP` (or similar) | `NoralVoice MCP` |
| API title ([api/app.py:75](../../api/app.py)) | `Dograh API` | `NoralVoice API` |
| `openapi.servers` ([api/app.py:79](../../api/app.py)) | lists `https://app.dograh.com` | `https://voice.noral.ai` |
| Docs links | `docs.dograh.com` in `/settings`, `/tools`, `/recordings`, `/files`, `/telephony-configurations`, EmbedDialog, sidebar update-banner | `docs.noral.ai/voice` (or wherever) — env-tokenized |
| "Dograh Service Keys" label in `/api-keys` | `Dograh Service Keys` | `Managed cloud services` or similar generic |
| "Dograh Tokens" in `/usage` | `Dograh Tokens` | `Cloud credits` / `NoralVoice credits` |
| Axiom dataset URL ([ui/.../superadmin/runs/page.tsx](../../ui/src/app/superadmin/runs/page.tsx)) | hardcoded `https://app.axiom.co/dograh-of6c/...` | env-driven `NEXT_PUBLIC_AXIOM_LOG_DATASET` already exists — use it |

**Per memory `feedback_rebrand_depth.md`:** "rebrand" means apply the brand system across both themes. Surface-level color swap is insufficient. Plan:

1. Create a `BRAND` constants module: `name`, `widgetGlobalName`, `cookiePrefix`, `docsUrl`, `domain`, `productLine` (e.g. NoralVoice / NoralOS / Noral AI).
2. Replace every hard-coded `"Dograh"` with the constant.
3. Make `BRAND` swappable at deploy time via env (or build-time inlining for the static fields).
4. Cookie migration: write both `noralvoice_auth_token` and `dograh_auth_token` for one release; read both; then drop the old.

---

## 5. NoralVoice: delete `/automation` and `/looptalk` root stubs (or ship them)

**Current state:**
- `/automation/page.tsx` (39 LOC) — `Coming Soon` placeholder. No nav link. Nothing wired.
- `/looptalk/page.tsx` (40 LOC) — `Coming Soon` placeholder. No nav link. But `/looptalk/[id]` is fully wired and works (live test sessions, WS audio stream, 316 LOC of routes).
- `/integrations` is wired but has no nav link.
- `/superadmin` works but has no nav link.
- `/impersonate` is Stack-only — silently does nothing under `local` provider.

**Target — for each dead/orphan page, pick a disposition:**

| Page | Decision |
|---|---|
| `/automation` | **Delete.** Stub since who-knows-when, never wired. If a real automation feature comes, recreate fresh. |
| `/looptalk` (root) | **Add the listing UI** — the backend exists, `/looptalk/[id]` works. A directory of live/historical test sessions is two days of work. |
| `/integrations` | **Add a "Integrations" nav item** under SETTINGS tab (Tier 1 #1) and keep working as-is. |
| `/superadmin` | **Add a "Superadmin" entry to the user dropdown**, gated on `user.is_superuser`. Already-superusers want this. |
| `/impersonate` | **Either** fix the local-mode path **or** return 501 with a clear message under local. Silent failure is the worst option. |

---

# Tier 2 — High-impact but non-blocking

## 6. NoralOS: integrate the "Integrations" page as the primary credential surface for both products

**Current state:** PR #46 shipped a polished integrations page at `/:prefix/company/settings/integrations` ([ui/src/pages/CompanyIntegrations.tsx](../../ui/src/pages/CompanyIntegrations.tsx) 1473 LOC) with credential CRUD, OAuth flows, assignment to plugin slots, test probes, masked suffix display, rotation. NoralVoice's 5 credential paths (item #1) reinvent a subset.

**Target:**
- After the plugin lands (item #2), every credential a NoralOS-using customer cares about lives in NoralOS `/company/settings/integrations`.
- The NoralVoice-standalone customer continues to use NoralVoice's local credential surfaces (item #1).
- The two coexist; same encrypted secret can't be assigned to both. A "Managed by NoralOS" badge on NoralVoice credentials prevents accidental edits in NoralVoice when NoralOS holds the canonical.

---

## 7. NoralVoice: a "What is this?" empty state on every list page

**Current state:** Most list pages (`/campaigns`, `/tools`, `/files`, `/recordings`, `/workflow`) drop a new user into an empty table. No onboarding inside the product.

**Target:** Empty-state pattern: 1-sentence what-this-is + a primary CTA + a "see an example" / "import a template" secondary action. Cost: ~5 components, ~200 LOC total.

---

## 8. NoralOS: deduplicate the adapter manager mount

**Current state:** `AdapterManager.tsx` is mounted at `/instance/settings/adapters` AND `/:prefix/instance/settings/adapters` ([ui/src/App.tsx:191](../../ui/src/App.tsx) area).

**Target:** Remove the company-scoped duplicate mount. The sidebar links to the instance-scoped page directly.

---

## 9. NoralOS: `/dashboard/live` — flesh out or delete

**Current state:** Shows `ActiveAgentsPanel` and not much else; same data as `/dashboard` already shows. Half-implemented.

**Target:** Either expand into a real live-ops surface (running tasks, queued wakeups, watchdog decisions, recent costs) or remove the route and link.

---

## 10. NoralVoice: terminology in code

Bookkeeping items that don't surface to users but cause developer friction:

| Code path | Today | Recommended |
|---|---|---|
| Migration name `workflow_uuid` rollout (one of three Alembic heads at `cdcf9f65913b`) | column added; some routes still use `workflow_id` | Finish the rollout — every public surface uses `workflow_uuid` |
| `WorkflowRunModel.mode` is a VARCHAR for telephony provider name | implicit enum | Use a real enum (would need alembic) — low priority |

---

# Tier 3 — Cleanups (do as time allows)

## 11. NoralVoice: fix multi-head Alembic

Three heads: `6499c608d0f6`, `cdcf9f65913b`, `f2e1d0c9b8a7`. Add a merge migration. Verify `alembic upgrade heads` works on `voice.noral.ai` today (the deploy might be using `upgrade heads` already).

## 12. NoralVoice: tighten `agent_stream` and CORS

- [api/routes/agent_stream.py:31](../../api/routes/agent_stream.py): `WS /agent-stream/{workflow_uuid}` is auth'd only by UUID. Either add `?api_key=` enforcement, OR document explicitly that UUIDs are capability tokens (and prevent them from leaking into the React-Flow editor's exported JSON).
- [api/app.py:88](../../api/app.py): `allow_origins=["*"]` + `allow_credentials=True` — pin to an env-driven allow-list.

## 13. NoralOS: kill Paperclip leftovers

Recent commit `926a67a3` started the rename pass. Continue:

- `globalThis.__paperclipPluginBridge__` → `__noralosPluginBridge__` (UI ↔ plugin bridge — breaking for plugins, gate behind plugin SDK major)
- localStorage keys `paperclip.theme`, `paperclip:panel-visible`, `paperclip.selectedCompanyId` — migrate via one-shot read-and-rewrite on next load
- `server/src/agent-auth-jwt.ts:35` JWT issuer `paperclip` + audience `paperclip-api` — keep backward-compat for issued tokens, but new tokens use `noralos` / `noralos-api`
- Default home `~/.paperclip` → `~/.noralos` (with fallback read)
- S3 default bucket `paperclip` → configurable, no implicit default
- `server/package.json` repo URL points at `paperclipai/paperclip` — update
- Volume `paperclip-data` — keep (intentional migration-safety)

## 14. NoralOS: rename "Brooklyn the LLM adapter" to disambiguate from "Brooklyn the CEO agent"

The recent commit `fix(noralai-brooklyn): finish NoralAI rename` already moved toward this. Suggest renaming the adapter slug `noralai_brooklyn` → `noralai_llm` (or `noralai_managed_llm`) so users don't see "Brooklyn" twice. The CEO agent's name stays "Brooklyn" — that's a customer-facing persona.

## 15. NoralVoice: empty-state for `/integrations` and `/superadmin` once they're nav-visible

After items #5 & #6: the integrations page should explain what Nango integrations do; the superadmin page should explain who has access and why.

---

# Negative recommendations — what NOT to do

1. **Don't iframe `/files` into NoralOS** — implement it as a thin React proxy that calls NoralVoice's KB API. The KB UI is simple enough; iframes invite drift.
2. **Don't move the React-Flow workflow builder out of NoralVoice into NoralOS** — too much state, undo stack, validation. Iframe it.
3. **Don't unify the NoralOS `agent` and NoralVoice `workflow` DB schemas** — they're materially different. Bridge via `voice_agent_uuid` FK on NoralOS agents (item #B2 in [overlap-map.md](overlap-map.md)).
4. **Don't add NoralOS-specific features (tiers, hierarchy) into NoralVoice** — those are NoralOS concerns and don't apply to NoralVoice standalone users.
5. **Don't ship more than one credential-management UI in NoralVoice itself** — Tier 1 #1 is the corrective move. Adding a 7th surface compounds the problem.

---

# Implementation order

A separate document [migration-plan.md](migration-plan.md) sequences these into phases with rollback paths. High-level:

| Phase | Includes |
|---|---|
| **P0 — Foundation** | Brand-token module, NoralVoice multi-head Alembic merge, NoralVoice security hardening (CORS, agent_stream auth) |
| **P1 — Plugin scaffold** | `noralai.noralvoice` plugin manifest + worker + auto-register + first 3 tools (`list_workflows`, `run_call`, `get_run`) |
| **P2 — Credential consolidation** | New `noralvoice` integration provider in NoralOS; plugin instanceConfig wired; credentials flow live |
| **P3 — Voice settings unification** | voice-config writes through plugin; voice-cascade deprecated |
| **P4 — Surfaces** | Plugin sidebar + page; iframe workflow builder; Costs page aggregation |
| **P5 — NoralVoice UI consolidation** | Collapse 5+ settings into one; brand text purge; delete `/automation` etc. |
| **P6 — Dashboard voice consolidation (re-scoped)** | Conference Room retired in [#105](https://github.com/Noral-AI/NoralOS/pull/105). NV ships TTS endpoint ([NV #10](https://github.com/Noral-AI/NoralVoice/pull/10)). Dashboard autoplay migrated ([NoralOS #106](https://github.com/Noral-AI/NoralOS/pull/106)). voice-cascade + voice-config retired in follow-up PRs after soak. |

Each phase is independently shippable — standalone NoralVoice continues to work between every phase.
