# Consolidation Scope (binding)

**Date:** 2026-05-15
**Supersedes:** open-questions.md decisions (those answers are now codified here)
**Pairs with:** [consolidation-plan.md](consolidation-plan.md), [integration-architecture.md](integration-architecture.md), [overlap-map.md](overlap-map.md)

---

## 1. Goal

Make NoralOS and NoralVoice work seamlessly together.

- **Outbound:** any NoralVoice action is reachable as a NoralOS agent tool or board apiRoute.
- **Inbound:** NoralVoice events, transcripts, and call state flow back to wake the originating NoralOS agent.
- **Standalone preserved:** `voice.noral.ai` continues to function with no NoralOS attached.

That's the whole goal. Anything that doesn't serve one of those three pillars is out of scope for this consolidation.

---

## 2. Pillars

### Pillar A — NoralOS → NoralVoice (outbound)

A NoralOS agent (CEO Brooklyn, a Voice Director, a director, a manager) can complete **any** published NoralVoice action by tool call. Operators using the NoralOS board UI can view, manage, and edit NoralVoice resources without leaving NoralOS — natively for lists/runs/recordings/KB/costs, iframed for deep editors (workflow builder, campaign builder).

Target tool inventory (~30 tools, full coverage by Phase 7):

| Domain | Tools |
|---|---|
| Voice agents (workflows) | list, get, create, update, clone, publish, archive |
| Runs | create (place call), get, list, cancel, get-transcript |
| Campaigns | create, get, list, start, pause, resume, cancel, get-progress |
| Telephony | list-numbers, list-providers, configure-provider (write-through) |
| Knowledge base | upload, search, list, get, delete |
| Recordings | list, get, get-download-url |
| Webhooks | configure-per-workflow |
| Embed sessions | create (for in-app live calls) |
| Tools (NV-side) | list, attach-to-workflow |
| Usage | get-current-period, get-by-workflow |

### Pillar B — NoralVoice → NoralOS (inbound, the reverse direction)

NoralVoice can talk back. Four channels:

1. **Lifecycle webhooks.** `run.completed`, `run.failed`, `campaign.progress` → plugin webhook receiver → `ctx.events.emit()` → originating agent wakes
2. **Live transcript stream.** During a call, NoralVoice's `agent_stream` WS publishes utterances + extracted variables into the originating NoralOS agent's session context
3. **`noralos://` tool scheme on NoralVoice workflow Agent nodes.** A voice agent mid-call can call back into NoralOS — "look up this customer", "create a task for Brooklyn", "check the project status". Implemented as a new tool URL scheme NoralVoice recognizes; routes through the plugin's reverse RPC
4. **Campaign source lists.** NoralVoice campaigns can pull contact lists from NoralOS (customers, leads) via the plugin's reverse API

### Pillar C — Voice Director agent template (new in NoralOS)

Brooklyn stays the CEO and primary communicator. She does not perform voice operations directly. Instead, a **new manager-tier agent template** owns voice-ops:

- **Name (default):** Voice Director — but the template is generic; users can rename per use case
- **Tier:** `manager` (between executive Brooklyn and worker agents)
- **Reports-to:** CEO (or a Director, depending on company structure)
- **Tools:** full `noralvoice:*` set
- **Surface:** Conference Room + dashboard chat like other agents
- **Wake triggers:** assigned voice tasks, completed call webhooks, scheduled campaigns
- **Multiplicity:** N per company. A real org might have "Outbound Sales VD" + "Inbound Support VD" + "Compliance Calls VD"
- **Tier-gate enforcement:** the plugin's voice tools refuse to be called by agents below manager tier

---

## 3. In scope

- One `noralai.noralvoice` plugin in NoralOS implementing all three pillars
- Voice Director agent template shipped alongside the plugin (auto-registered with the plugin)
- SDK rename (`@dograh/sdk` → `@noralai/voice-sdk`, `dograh-sdk` → `noralai-voice`) with one release of dual-publishing
- NoralVoice rebrand pass via brand-tokens (no more "Dograh" in user-facing surfaces)
- Collapse of NoralOS's three voice plugins (`voice-config`, `voice-cascade`, `conference-room-bridge`) into the new plugin
- Iframed workflow builder + native lists/runs/recordings/KB/cost surfaces in NoralOS board UI
- Bidirectional event bridge (Pillar B items 1 & 2 minimum)
- `noralos://` tool scheme on NoralVoice (Pillar B item 3) — Phase 5+
- MPS rename: `services.dograh.com` → `services.noral.ai`, keep protocol
- NoralVoice settings consolidation (5+ surfaces → 1 tabbed `/settings`)
- NoralVoice security hardening (CORS, agent_stream auth, multi-head Alembic merge)

---

## 4. Out of scope (for v1 consolidation)

- Rebuilding NoralVoice's React-Flow workflow editor natively in NoralOS. **Iframe is the answer.** Revisit only if the iframe UX proves unacceptable after Phase 4.
- Unifying NoralVoice and NoralOS DB schemas. Bridge via `agents.voice_agent_uuid` FK only.
- Bundling NoralVoice into the NoralOS Docker compose (the way NoralSign was). The two products stay separately deployed at `voice.noral.ai` and `agent.noral.ai`.
- Building a NoralOS-issued cloud-credits product (the "option 2" alternative to MPS). Deferred to a post-consolidation product decision.
- Mobile-specific UX work.
- New voice features. This is a consolidation pass, not a feature pass.
- Renaming NoralVoice DB tables (`workflows` → `voice_agents`). UI says "Voice Agent"; DB stays `workflow` until a separate major.

---

## 5. Hard constraints

1. **`voice.noral.ai` standalone must never break.** A fresh-signup → build-workflow → place-test-call smoke must pass at the end of every phase. Real users exist on the standalone product.
2. **No UI duplication.** Where NoralVoice has a deep editor, NoralOS iframes it. Where NoralVoice has a list/detail, NoralOS proxies via plugin apiRoute and renders natively in NoralOS theme.
3. **No logic forks.** Voice provider catalog, telephony plumbing, workflow node schemas, recording storage live in NoralVoice only. NoralOS reads what NoralVoice publishes; never reimplements.
4. **Per-tenant isolation end-to-end.** One NoralOS company → exactly one NoralVoice organization → one API key per company, stored encrypted in `integration_credentials`.
5. **Brooklyn does not call voice tools directly.** Voice Director (or another manager-tier agent) is the canonical caller. Brooklyn delegates.

---

## 6. Success criteria

- A Voice Director agent in any NoralOS company can call every tool in the §2 Pillar A inventory and get a non-error response
- A completed call in NoralVoice wakes the originating NoralOS agent within 5 seconds via webhook, with transcript + extracted variables in the wake payload
- `voice.noral.ai` standalone smoke passes after every phase merges to its respective base branch
- `voice-cascade` and `voice-config` plugins are uninstalled from NoralOS prod by end of Phase 6
- Zero "Dograh" string visible in NoralVoice UI by end of Phase 5
- `services.dograh.com` no longer referenced in NoralVoice code by end of Phase 8
- A NoralVoice workflow Agent node can issue a `noralos://` tool call mid-call and get a response (Phase 5+)
- NoralOS Costs page shows merged voice + non-voice cost data (Phase 4)

---

## 7. Decisions locked

| Question | Decision | Source |
|---|---|---|
| Real standalone users? | Yes | user 2026-05-15 |
| Consolidation driver? | Seamless bidirectional interop | user 2026-05-15 |
| Iframe acceptable for builder? | Yes | user 2026-05-15 |
| Brooklyn's role in voice? | Stays uplevel; new Voice Director template owns it | user 2026-05-15 |
| MPS direction? | Option 1: rename to `services.noral.ai`, keep protocol | inferred from "standalone users exist" + lowest-risk reading |
| External SDK consumers? | Treat as zero. Dual-publish for one release as cheap safety net | inferred from no signal of external usage; verify Phase 1 |
| Local-trusted mode in NoralVoice? | No. NoralVoice keeps bcrypt + JWT for OSS / local-dev | inferred; defer to Phase 8 if friction surfaces |
| Workflow → voice_agent DB rename? | No (UI rename only) | open-questions.md #5; conservative |

---

## 8. Anti-patterns we explicitly reject

- **NoralOS becoming the voice runtime.** NoralVoice is the runtime; NoralOS consumes it.
- **NoralVoice gaining a hard NoralOS dependency.** Plugin is one-way: NoralOS depends on NoralVoice's public API. Reverse direction is via webhooks + a tool URL scheme, never via direct DB or in-process calls.
- **Multiple credential surfaces in NoralOS for the same provider.** `/company/settings/integrations` is the only place a NoralVoice API key gets stored in NoralOS.
- **Per-feature WebSocket connections between products.** The only NoralVoice WS NoralOS consumes is `agent_stream`, and only inside the relevant agent's session.
- **Sharing a database.** Plugin is the contract.

---

## 9. What the user owns vs what the plan owns

**User owns (you, Quentin):**
- Final approval on each phase's merge to its base branch
- Decisions on Voice Director template defaults (name, system prompt, default tools beyond `noralvoice:*`)
- Visual review of the iframed workflow builder when Phase 4 lands
- Sign-off on the `services.noral.ai` rename happening (Phase 8 — operationally separate)

**Plan owns:**
- All technical sequencing
- All file-level changes and PRs
- Smoke-test verification at end of each phase
- Auto-register migration for the Voice Director template
- The Claude Code prompt for each phase (one per phase, delivered as you finish the prior one)
