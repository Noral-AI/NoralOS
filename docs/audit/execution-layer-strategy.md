# Execution-Layer Strategy — Harness, Model Tiers, and the Memory Moat

**Status:** PROPOSED — pending operator ratification. Once ratified, this doc is binding for execution-layer decisions the way `consolidation-scope.md` is binding for consolidation.
**Execution note:** operator authorized autonomous execution of next-actions 1–3 on 2026-06-10 ("begin and continue autonomously"); §7 open questions remain undecided.
**Date:** 2026-06-10
**Code basis:** `master` @ `e01f82be` (PR #156). File references below are to that revision.
**Scope:** How NoralOS-as-a-commercial-product executes agent runs: which harness ships, how Claude is offered, what happens to Hermes, and where differentiation investment goes. Does NOT cover voice runtime (NoralVoice owns that) or channel surfaces.

---

## 1. Context

NoralOS is an orchestration platform (MIT fork of `paperclipai/paperclip`): it decides **when** agents run (heartbeats, wakeups, routines) and **what work** they get (issues, goals, approvals), but contains no model-calling loop. Every run executes through a pluggable adapter wrapping an external agent harness (`server/src/services/heartbeat.ts` → `adapter.execute(...)`).

The stack, for reference:

| Layer | What it does | Examples |
|---|---|---|
| Model | Generates tokens | DeepSeek V4, Claude, Brooklyn vLLM |
| Harness | The agentic loop: prompt → tools → iterate | OpenCode, Claude Code, Hermes, Codex, Cursor |
| Platform (NoralOS) | Org structure, issues, heartbeats, approvals, budgets, plugins | this repo |

**Current production state (agent.noral.ai):**
- Company `llm_backend_settings.mode = "deepseek_v4"` force-routes EVERY run to `opencode_local` regardless of the agent's stored `adapterType` (`server/src/services/llm-backend-override.ts:15`, PR #143).
- Plugin tools reach OpenCode runs natively via the MCP bridge (PR #145); platform-wide DeepSeek key landed in PR #155.
- Claude Code runs via `CLAUDE_CODE_OAUTH_TOKEN` on the VPS — **dogfood-only** (see Decision D2).
- `hermes_local` is a supported builtin adapter type but not deployed.

**The commercial reframe that motivates this doc:** as an operator you optimize harness choice per-agent; as a vendor the harness is COGS and plumbing. Customers buy agents that work — they must never need harness vocabulary. That collapses the harness question into: what do we bundle, what do we license, what do we support, and where does differentiation actually live.

---

## 2. Decisions

### D1 — Bundle OpenCode as the invisible default execution engine

Ship OpenCode (MIT, `anomalyco/opencode`) inside the product image as the default harness for all customer agents, driven by **platform-managed inference** (platform DeepSeek key today — PR #155 already built this pattern; Brooklyn/self-hosted models later for margin and data-residency positioning).

**Why OpenCode:**
- The only path verified end-to-end in our production: MCP plugin-tools bridge, agent authz on `/api/plugins/tools`, real agentic runs (Sierra → NOR-819 → connected voice call).
- Healthiest OSS harness upstream (most-starred OSS coding agent; weekly releases as of June 2026).
- Model-agnostic: DeepSeek now, Brooklyn vLLM later (first-class vLLM provider support) — model strategy stays decoupled from harness strategy.
- MIT — legally bundleable. Include its license text in `NOTICE` when the image bundles it (same hygiene as the existing upstream-paperclip attribution).

**Product-grade requirements (not optional):**
1. **Pin the OpenCode version in the Dockerfile.** An unpinned harness bump that changes agent behavior is a fleet-wide product regression, not a personal annoyance.
2. **Eval-gate harness upgrades.** Wire the existing `evals/` promptfoo suite (currently CI-only) as a mandatory gate on any OpenCode version bump: run the suite against the new version before it ships. This is also the start of our SLA/reliability story.
3. Container ownership gotcha is already known: OpenCode config/db must be `node`-owned (`/noralos/.config/opencode/`, `/noralos/.local/share/opencode`) or models go hidden and WAL checkpoints fail.

### D2 — Claude is a premium MODEL TIER via the API, never Claude Code OAuth in the product

Claude Code is proprietary and not redistributable; riding consumer Pro/Max OAuth inside a commercial product is exactly the behavior that got OpenCode's Claude login revoked by Anthropic. Therefore:

- **Shippable shapes:** (a) BYO Anthropic API key for enterprise customers, stored in the existing secrets vault; (b) a platform Anthropic key sold as a "premium intelligence" tier with usage-based billing (cost events + `usageJson` already meter per run).
- The current `CLAUDE_CODE_OAUTH_TOKEN` on the VPS remains **internal dogfooding only**. It must never be part of a customer-facing deployment.
- `claude_local` stays in the adapter registry as a BYO option for self-hosted deployments.
- Routing: prefer per-issue adapter/model overrides (already supported: call > issue > agent resolution in `heartbeat.ts`) so premium spend lands only on issues that need it.

### D3 — Do not bundle Hermes; absorb its ideas as platform features

Hermes Agent (Nous Research, MIT) is the only harness with native persistent memory, self-built skills, and a learning loop — which is precisely why it must NOT be the product's memory layer:

- Customer agent memory is the stickiest asset this product can own. Putting it in a third party's format, inside a runtime shipping breaking changes every ~2 weeks (release cadence verified 2026-06), makes our moat someone else's roadmap and their hotfixes our support queue.
- **Instead: build memory/learning into NoralOS** (see §3). Hermes is an MIT design reference — patterns and even code may be borrowed with attribution in `NOTICE`.
- `hermes_local` stays as an enterprise BYO option (it already works: builtin type, adapter-managed session policy, JWT injection tested). An internal dogfood pilot on one coordinator agent is allowed and encouraged; it informs the platform memory design.
- Known integration facts if piloting: company backend must be `native` (the deepseek_v4 override flattens everything to OpenCode); plugin tools are REST-reachable but not MCP-bridged for Hermes; the image needs Python 3.10+ + `pip install hermes-agent`; Hermes's own multi-channel gateway (Telegram/Discord/...) stays OFF — NoralOS owns surfaces, and Telegram is explicitly dropped.

### D4 — Differentiation investment goes to the platform, not the harness portfolio

"Bring your own agent" is upstream Paperclip's pitch, and Paperclip is MIT — anyone can fork it. The defensible layer is what no harness can do, because it happens **between** runs when no harness process is alive:

- Enriched timer wakes (today a bare timer wake builds a NULL payload — `heartbeat.ts` `buildNoralosWakePayload` returns null with no issue/comments — and `HEARTBEAT.md` tells idle agents to exit cleanly).
- Due dates + lead-time wakes; an observations feed from plugin events; predictive (not just reactive) watchdogs; morning-brief routines.
- Platform memory + feedback loop (§3).
- Enforced per-agent budgets (schema exists; enforcement doesn't).

Engineering allocation rule: harness work is maintenance; platform premonition/autonomy/memory work is product.

### D5 — Licensing hygiene

- Upstream paperclip attribution: already correct in `NOTICE` — keep it.
- When the image bundles OpenCode: add its MIT notice to `NOTICE`.
- Any code lifted from Hermes: MIT notice + attribution in `NOTICE`.
- Claude Code: never bundled, so no license exposure — keep it that way.

---

## 3. The absorb-Hermes plan: memory as a platform feature

Phased so each step ships value alone. This is the platform work D3/D4 point at:

**Phase M1 — Per-agent durable memory store.**
Agent-scoped memory (DB table or managed file bundle next to the instructions bundle), written via an agent tool (`remember` / `update_memory`), readable by the platform. Extends the CEO-only `$AGENT_HOME/memory/` + PARA convention (`server/src/onboarding-assets/ceo/HEARTBEAT.md`) to every role, but platform-owned instead of prompt-convention.

**Phase M2 — Wake-digest injection.**
`buildNoralosWakePayload` gains a memory digest + situational block on every wake (assigned issues by status, approaching deadlines, recent observations). Kills the null-payload idle wake. This is where "premonition" starts being felt.

**Phase M3 — Retrieval over owned corpora.**
Search tool over the customer's issues/comments, run summaries, and NoralVoice transcripts (pgvector or equivalent). No external knowledge dependency; the data is already in our DB.

**Phase M4 — Feedback → behavior loop, approval-gated.**
`feedbackVotes` + run outcomes (collected today, applied never — `server/src/services/feedback.ts`) feed a periodic retro routine that proposes instruction-bundle edits, routed through the existing approvals system. Eval suite gates the edits. This is "agents that visibly improve" — the commercial headline.

Each phase works identically across OpenCode, Claude, and any BYO harness — that's the point.

---

## 4. Pricing hooks this unlocks (mechanics already in schema)

| Hook | Mechanism | State |
|---|---|---|
| Seat/usage pricing with hard stops | Per-agent budgets + cost events | Schema exists; enforcement to build |
| Model tier upsell (default vs premium) | Backend/model override matrix | Override exists company-wide; needs per-agent/tier granularity |
| Reliability/SLA story | Eval-gated harness + instruction changes | promptfoo suite exists; gating to wire |
| Enterprise BYO (keys, harness, models) | Secrets vault + adapter registry + `/api/adapters/install` | Exists |
| Data-residency premium | Brooklyn/self-hosted inference | Endpoint exists; productization later |

Implementation note for the tier work: today's `resolveEffectiveAdapterType` is a company-wide flatten (`deepseek_v4` → everything becomes OpenCode). The tier model needs that evolved into per-agent (or per-issue) model selection within the platform-managed default — i.e., the override matrix grows a `premium` row instead of being binary native/deepseek.

---

## 5. Explicitly NOT doing

- **No in-house harness.** Writing our own loop re-invents OpenCode/Claude Code/Hermes inside an orchestration platform and competes with the adapter ecosystem the product benefits from.
- **No Hermes bundling** (D3). No customer-facing multi-harness picker — the default is invisible.
- **No Claude Code OAuth in any customer deployment** (D2).
- **No new third-party memory dependency** — memory is platform-owned (D3/§3).

## 6. Risks

| Risk | Mitigation |
|---|---|
| OpenCode upstream drift / provider disputes (cf. Anthropic login removal) | Version pin + eval gate; adapter abstraction keeps swap cost bounded; we drive it with our own keys, not consumer logins |
| DeepSeek dependency (price/availability/geopolitics) | Model-agnostic harness; Brooklyn vLLM path already proven for Brooklyn agent; OpenRouter fallback exists in adapter |
| Memory platform scope creep | Phased M1–M4; each phase ships alone; Hermes dogfood pilot de-risks design before build |
| Hermes pilot leaking into product expectations | Pilot is internal-only, one agent, explicitly labeled |

## 7. Open questions (operator)

1. Premium tier launch shape: BYO Anthropic key only, or platform key + usage billing from day one?
2. Brooklyn-as-default-inference timeline (margin + residency story) — gate on what eval bar?
3. Run the internal Hermes dogfood pilot before Phase M1 design, or design M1 directly from this doc?
4. Pricing model: per-agent seat, usage-metered, or hybrid? (Determines how hard budget enforcement needs to be in Phase 1.)

## 8. Next actions (in order)

1. Pin OpenCode version in `Dockerfile`; add its MIT notice to `NOTICE`.
2. Wire `evals/` promptfoo as a required gate on harness-version and instruction-bundle changes (CI job + deploy checklist line).
3. Design doc for the override-matrix evolution (per-agent/per-issue tier selection replacing the binary company flatten in `llm-backend-override.ts`).
4. Phase M1 spec (memory store schema + `remember` tool + bundle layout), informed by answers to Q3.
5. Budget enforcement spike: hard-stop a run when the agent/company budget is exhausted (pricing prerequisite).

---

*Cross-references: first-principles platform assessment delivered 2026-06-10 (premonition/autonomy gap analysis); `docs/audit/consolidation-plan.md` (Phase 6 complete); PRs #143 (LLM backend switch), #145 (MCP plugin-tools bridge), #155 (platform DeepSeek key).*
