# Handoff — NoralOS ↔ NoralVoice consolidation

Paste this at the start of a fresh Claude Code session. The new agent should be able to pick up without re-reading prior chats.

## Repo paths

- **NoralVoice** (voice runtime): `/Users/quentin/Documents/NORALAI/NoralVoice` — Python FastAPI + Next.js. Standalone product at `voice.noral.ai`.
- **NoralOS** (agent control plane): `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` — TS monorepo (pnpm + Drizzle + Vite). Hosts the `noralai.noralvoice` plugin.

## Read these first

```
/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/docs/audit/
  HANDOFF.md                          ← user-maintained, read FIRST
  consolidation-scope.md              ← binding: pillars, goals, hard constraints
  consolidation-plan.md               ← binding: per-phase deliverables
  integration-architecture.md         ← reference: plugin manifest sketch, surface routing
  overlap-map.md                      ← reference: what voice-config / voice-cascade do
  claude-code-prompt-phase-{0,1,2,3,4}.md  ← per-phase prompts (use these to drive each phase)
```

Also: `CLAUDE.md` at each repo root (project-level instructions).

## Phase status

| Phase | What it does | Status | PRs |
|---|---|---|---|
| 0 | Brand tokens, Alembic merge, CORS pin, agent_stream WS auth | NoralVoice PR open ([NV#1](https://github.com/Noral-AI/NoralVoice/pull/1)) | — |
| 1A | SDK rename `dograh-sdk`→`noralai-voice` + `@dograh/sdk`→`@noralai/voice-sdk` (dual-publish aliases) + embed exchange-token + integration webhooks | NoralVoice PR open ([NV#2](https://github.com/Noral-AI/NoralVoice/pull/2)) — **SDKs not yet on npm/PyPI** | — |
| 1B | `noralai.noralvoice` plugin scaffold + Voice Director template | **MERGED** ([NoralOS#83](https://github.com/Noral-AI/NoralOS/pull/83)) + user fix PRs #88-92 | — |
| 2 | NoralVoice credential consolidation via `INTEGRATION_PROVIDERS` | **MERGED** (#86) | — |
| 3 | Voice settings unification — provision + read/write through NV | **MERGED** (#87) | — |
| 4 | Browse surfaces (PR-A) + iframed builder + transcript pump + Costs merge (PR-B) | Both open ([NoralOS#93](https://github.com/Noral-AI/NoralOS/pull/93), [NoralOS#97](https://github.com/Noral-AI/NoralOS/pull/97)) | — |
| 5 | NV UI consolidation + brand purge + `noralos://` reverse-tool scheme | Not started | — |
| 6 | Conference Room re-route + uninstall voice-cascade + voice-config | Not started | — |
| 7 | Full tool coverage + shared schemas | Not started | — |
| 8 | MPS rename `services.dograh.com` → `services.noral.ai` + standalone independence audit | Not started | — |

**Plugin test suite** (`cd packages/plugins/noralai-noralvoice && npx vitest run`): **68/68 passing** at PR-A+PR-B head.

## Working pattern the user has established

- **User drives merges + publishes + deploys.** They merge each PR themselves, sometimes opening fix-up PRs (#88-92 are theirs on top of prior Phase 1B/3 work). They have not delegated the autonomous merge loop — they tried that prompt once and stopped at the prereq check (no npm/twine/SSH creds on this machine).
- **The user is concurrently editing the same files.** Inline edits to preserve (don't revert):
  - `packages/plugins/noralai-noralvoice/package.json` — `@noralai/voice-sdk` resolves from a GitHub release tarball URL, not the npm registry, because the SDK isn't published yet.
  - `NoralVoiceSidebarLink.tsx` + `NoralVoicePage.tsx` — `MouseEvent` / `VoiceDirector` typing tightened.
- **Branch hygiene risk.** During the last session a PR-B commit initially landed on the user's concurrent `docs/handoff` branch — cherry-picked across cleanly. Be aware that the user may be on a different branch at any moment; always check `git branch --show-current` before committing.
- **The user explicitly wants forward progress over autonomous deploy.** When they say "proceed" they mean "build the next phase's code" — not "merge and deploy."

## Known gaps + carry-overs

### Cross-phase architectural

1. **Plugin worker is RPC-shaped** (confirmed Phase 4). No long-lived outbound WS subscriptions. Phase 4 PR-B's transcript pump lives in `server/src/services/voice-transcript-pump.ts`, not the worker.
2. **`PluginApiRequestInput.actor` carries `userId` but not `email`.** Phase 4's embed-token route queries better-auth's `"user"` table via `ctx.host.queryHostDb`. Could be promoted to a typed SDK accessor.
3. **NV iframe CSP is unverified.** `/workflow/<uuid>` redirects to `/auth/login` for unauthed requests with no `frame-ancestors`. The authenticated page wasn't testable from the sandbox. Phase 4 PR-B ships the builder feature-flagged off until live smoke confirms `agent.noral.ai` is an accepted ancestor.

### Phase-specific carry-overs (called out in PR bodies)

- **Phase 2 → Phase 3:** the assignment writer only writes `apiKeyRef` shallow-merge; `baseUrl` + `organizationId` need a separate path. Operator workaround: hand-edit `plugin_config.config_json`. Phase 3 should have addressed but the prompt scoped it to a follow-up.
- **Phase 3 → Phase 6:** voice-config provider CHECK admits `(elevenlabs, google_tts, default)`; NV has 6 providers. Mirror writes everything non-elevenlabs as `default`. Phase 6 either expands the CHECK or retires the column.
- **Phase 4 PR-B → Phase 5:** webhook-dedup probe URL `/internal/voice-transcript-pump/emitted-keys` is assumed to be host-exposed; if absent, follow-up PR needs to wrap `getPumpEmittedVariableKeys` in an HTTP route.

### Prereqs missing on this machine (for autonomous merge loop)

- `npm whoami` → not logged in to `@noralai` + `@dograh` orgs
- `twine` → not installed; no `~/.pypirc`
- SSH to `voice.noral.ai` + `agent.noral.ai` → not configured (host key + key auth both fail)
- `gh auth status` is OK

## What NOT to do

- **Don't autonomously merge/publish/deploy.** The user owns these. Surface them as next steps.
- **Don't revert the user's inline edits** to plugin files (see "concurrent editing" above).
- **Don't change NoralVoice in NoralOS-side phases.** Phases 2/3/4 are explicitly NoralOS-only. NV changes ship in Phase 0/1A/8 only.
- **Don't extend NV unilaterally to fix shape mismatches** — surface and stop (Phase 3's stop-and-report on NV's PATCH-vs-PUT, Phase 4's stop on iframe CSP).
- **Don't skip the Dockerfile `pnpm --filter` addition** for new plugins (silent prod failure — the user has hit this).

## Immediate possible next actions (pick one)

1. **Phase 5** — NV UI consolidation, brand purge, `noralos://` reverse-tool scheme. Spans both repos. Prompt at `docs/audit/claude-code-prompt-phase-5.md` (verify the file exists first — it may not be drafted yet).
2. **Phase 4 follow-ups** — host-side route for `/internal/voice-transcript-pump/emitted-keys`; wire `appender` at server startup; smoke the iframe modal once `enableEmbeddedVoiceBuilder` is flipped.
3. **Backfill smoke** — if the user wants real end-to-end validation of Phase 1B+2+3+4 before Phase 5, they'd need to either grant the missing creds (npm, twine, SSH) or run the smoke themselves and report.
4. **Stop and re-plan** — if the user wants to consolidate the open PRs (NV#1, NV#2, NoralOS#93, #97 still un-merged) before more code lands.

## Useful one-liners for the new session

```bash
# State check
cd /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical && git status -sb && git log --oneline -5
cd /Users/quentin/Documents/NORALAI/NoralVoice && git status -sb && git log --oneline -5

# PR status
gh pr list --repo Noral-AI/NoralOS --limit 10
gh pr list --repo Noral-AI/NoralVoice --limit 10

# Plugin tests
cd /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/packages/plugins/noralai-noralvoice && npx vitest run

# Standalone NV smoke
curl -s https://voice.noral.ai/api/v1/health
```

## Last session's working branch

NoralOS HEAD: `feat/phase-4b-noralvoice-interact-surfaces` at `d40feb17`. The user may have switched to `docs/handoff-phase-4-update` or another concurrent branch — verify before committing anything.

NoralVoice working branches from earlier phases: `feat/phase-1a-sdk-rename-integration-endpoints` (PR-A) and `chore/phase-0-foundation` (PR-0). Neither has been merged.
