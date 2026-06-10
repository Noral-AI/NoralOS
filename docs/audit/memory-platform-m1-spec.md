# Platform Memory — Phase M1 Spec (DRAFT)

**Status:** DRAFT — pending operator answer to `execution-layer-strategy.md` §7 Q3 (Hermes dogfood pilot before/instead of direct build). Written so either answer only adjusts, not restarts, this spec.
**Date:** 2026-06-10
**Code basis:** `master` @ `e01f82be`.
**Parent:** `execution-layer-strategy.md` §3 (absorb-Hermes plan, D3/D4).

## 1. Goal

Per-agent durable memory as a **platform feature** — owned by NoralOS, identical across harnesses (OpenCode, Claude, BYO), injected by the scheduler, written via tools. Replaces the current state where memory is a prompt convention only the CEO role gets (`server/src/onboarding-assets/ceo/HEARTBEAT.md` §7, `$AGENT_HOME/memory/` + PARA `life/`) and every other agent forgets everything that isn't an issue comment.

M1 delivers the store + tools + minimal injection. Digest quality (M2), retrieval/RAG (M3), and the feedback loop (M4) build on it.

## 2. Schema

New table `agent_memories` (Drizzle, `packages/db/src/schema/agent_memories.ts`):

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `companyId` | uuid FK → companies | tenancy; all queries company-scoped (same pattern as issues) |
| `agentId` | uuid FK → agents | owner |
| `kind` | text enum | `fact` \| `preference` \| `lesson` \| `summary` |
| `title` | text | short slug-like handle, unique per (agentId) for upsert-by-title |
| `body` | text | the memory; cap 4 KB (mirrors wake-payload truncation constants) |
| `weight` | int default 0 | bumped on access; digest ranking input |
| `sourceRunId` | uuid FK → heartbeat_runs, nullable | provenance |
| `supersededById` | uuid self-FK, nullable | corrections keep history instead of destructive update |
| `createdAt` / `updatedAt` | timestamptz | |

Indexes: `(companyId, agentId, updatedAt desc)`; partial index on `supersededById IS NULL` (live memories).

Caps (constants next to the wake-payload caps in `heartbeat.ts`): max 200 live memories per agent; writing past the cap requires superseding or deleting — surfaced to the agent in the tool error so curation is the agent's job, not silent eviction.

## 3. Agent tools

Dispatched through the existing core tool path (NOT a plugin — memory is platform core; plugins keyed tool dispatch via worker UUIDs is the wrong layer):

- `memory.remember({ kind, title, body, supersedesTitle? })` — insert or supersede-by-title.
- `memory.recall({ query?, kind?, limit? })` — M1: trigram/ILIKE match on title+body, recency+weight ranked. (Vector search is M3; keep the tool signature stable so M3 is a backend swap.)
- `memory.forget({ title })` — soft-delete (supersede with tombstone).

Authz: an agent reads/writes ONLY its own memories. Humans get read access in the agent detail UI (observability + trust); operator delete is allowed (right-to-curate, and the GDPR-ish story customers will ask about).

These follow the same 6-layer completeness path as `ctx.agents.*` additions (SDK `METHOD_CAPABILITY_MAP` is the real capability gate — lesson from PR #153).

## 4. Injection

`buildNoralosWakePayload()` (`server/src/services/heartbeat.ts`) gains a `memoryDigest` block on **every** wake, including bare timer wakes (which today return `null` payload when no issue is attached — fixing that null is the point):

- Top N=10 live memories by `weight desc, updatedAt desc`, title + first 200 chars each, hard cap 2 KB total.
- `fallbackFetchNeeded`-style flag when truncated, so the agent knows to `memory.recall` for more.

Instruction-bundle line (default `AGENTS.md` for all roles, not just CEO): what the digest is, when to `remember` (durable facts, preferences, lessons — not task state, which belongs in issue comments), and that memory survives across issues.

## 5. Migration / compatibility

- CEO file-convention memory (`$AGENT_HOME/memory/YYYY-MM-DD.md`, PARA `life/`) keeps working — it's workspace files. M1 adds the platform store alongside; HEARTBEAT.md §7 gets updated to write durable facts via `memory.remember` and keep daily timeline notes in files. No import required for M1 (optional later: one-shot import of `life/` facts).
- DB migration is additive (`0096_agent_memories.sql` or next free number — **check `_journal.json` at implementation time**, and remember the plugin-migration validator rules do NOT apply since this is a core migration, but DO run `pnpm db:migrate` against a scratch Postgres 17 before PR).

## 6. Acceptance (M1 done means)

1. Worker-tier agent on a bare timer wake receives a non-null payload containing its memory digest.
2. Agent A's `memory.recall` can never return agent B's rows (test the company AND agent scoping).
3. `remember` → next wake's digest includes it; `supersedesTitle` replaces without losing history.
4. Run detail UI shows memory reads/writes for the run (event stream entries, same pattern as tool-call events).
5. Eval: one promptfoo case asserting the heartbeat skill instructs memory use (extends Phase 0 suite — the eval gate from next-action 2 then covers regressions).

## 7. Deliberately out of scope (M1)

- Embeddings/pgvector, cross-agent or company-wide memory, automatic summarization into memory, memory TTL/decay, feedback-driven instruction edits (M4), Conference-Room-specific memory UX.

## 8. Estimate

Schema + tools + dispatch wiring + payload injection + bundle text + tests: comparable to a mid-size phase PR (the `ctx.agents.setVoiceAgentUuid` 6-layer RPC bridge in #153 is the closest precedent for the tool plumbing).
