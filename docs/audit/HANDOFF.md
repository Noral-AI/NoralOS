# Handoff — NoralOS ↔ NoralVoice consolidation

**Date:** 2026-05-15
**Status:** Phases 0–3 merged + deployed. Phase 4 ready to run.

Paste this into a fresh Claude Code or Claude session to bootstrap context.

---

## What this project is

Two products owned by the same team that need to work together:

- **NoralVoice** (`voice.noral.ai`) — voice-AI workflow runtime. Python/FastAPI + Pipecat. Fork of `dograh-hq/dograh`, rebranding in progress. The voice runtime: TTS/STT/LLM providers, telephony, recordings, KB. **Used by paying users today; must not break.**
- **NoralOS** (`agent.noral.ai`) — multi-agent orchestration platform. TypeScript/Express 5 + Vite 6 + React 19 + Drizzle + Postgres. The "operating system" for AI agents (issues, projects, goals, plugins).

A multi-phase consolidation makes NoralOS agents call NoralVoice through a `noralai.noralvoice` plugin (NoralSign pattern). Phase plan + scope are in `docs/audit/` of the NoralOS repo.

## Where things live

| What | Path |
|---|---|
| NoralOS repo (canonical) | `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical` (origin: `github.com/Noral-AI/NoralOS`, branch `master`) |
| NoralOS repo (decoy — do not push) | `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS` |
| NoralVoice repo | `/Users/quentin/Documents/NORALAI/NoralVoice` (origin: `github.com/Noral-AI/NoralVoice`, branch `rebrand/noralvoice`) |
| Binding docs | `NoralOS-canonical/docs/audit/` — read `consolidation-scope.md` + `consolidation-plan.md` + `CLAUDE.md` first |
| Memory | `/Users/quentin/.claude/projects/-Users-quentin-Documents-NORALAI-NORALOS/memory/` — `MEMORY.md` is the index |

## Prod state (verified 2026-05-15)

**voice.noral.ai** (server `129.121.101.154`, root SSH works):
- Image: `noralvoice-api:rebrand-v3` (built locally on server from `rebrand/noralvoice` tip)
- Alembic head: `a1b2c4d6e8f0`
- New tables: `embed_exchange_tokens`, `integration_webhooks` ✅
- New endpoints: `/api/v1/embed/exchange-token`, `/api/v1/integration-webhooks` (both return 401 without auth — correctly gated)
- `/api/v1/health` → 200

**agent.noral.ai** (server `129.121.84.139`, root SSH works):
- Image: `ghcr.io/noral-ai/noralos:latest` (auto-built via `Docker` workflow on master push)
- Plugin `noralai.noralvoice` installed, status: **ready**, 6 tools registered
- Tools: `list_workflows`, `run_call`, `get_run`, `list_voices`, `set_agent_voice`, `provision_voice_agent`
- 1 webhook endpoint declared (`run-completed`)
- Public `/api/health` → 200

## Phases — done vs next

| Phase | Status | What it shipped |
|---|---|---|
| 0 — Foundation | ✅ merged + deployed | NV brand-tokens module, multi-head Alembic merge, CORS pin, agent_stream WS auth |
| 1A — SDK rename | ✅ merged + deployed | NV SDK rename `dograh-sdk` → `noralai-voice`, `@dograh/sdk` → `@noralai/voice-sdk`. New endpoints: embed exchange-token + integration_webhooks |
| 1B — Plugin scaffold | ✅ merged + deployed | NoralOS `noralai.noralvoice` plugin, Voice Director agent template, SDK `agents.create` extension, 3 starter tools, webhook receiver, sidebar/page UI |
| 2 — Credential consolidation | ✅ merged + deployed | NoralVoice provider in `INTEGRATION_PROVIDERS`, `pairedFields` mechanism for multi-field metadata propagation |
| 3 — Voice settings unification | ✅ merged + deployed | 3 new plugin tools (`list_voices`, `set_agent_voice`, `provision_voice_agent`), `agents.voice_agent_uuid` column, Voice Settings detail tab on Agent |
| **4 — Surfaces** | **ready** | apiRoutes + tabbed plugin page, iframed workflow builder, live transcript stream, Costs page merge |
| 5 — UI consolidation + brand purge + `noralos://` scheme | pending prompt | NV `/settings` collapse, full Dograh → NoralAI brand purge, reverse-direction tool scheme |
| 6 — Conference Room re-route + uninstall 2 NoralOS plugins | pending prompt | The big LOC win — `voice-cascade` + `voice-config` retired |
| 7 — Full tool coverage + shared schemas | pending prompt | Remaining ~20 tools |
| 8 — MPS rename + independence audit | pending prompt | `services.dograh.com` → `services.noral.ai` |

**Next prompt to run:** [claude-code-prompt-phase-4.md](claude-code-prompt-phase-4.md). NoralOS-only, two PRs (PR-A browse surfaces, PR-B interact surfaces).

## Open threads / things the next session should know

1. **SDK publish deferred per user request.** `@noralai/voice-sdk@0.2.0` is NOT on npm; `noralai-voice==0.2.0` is NOT on PyPI. The NoralOS plugin installs it from a GitHub release tarball:
   ```
   https://github.com/Noral-AI/NoralVoice/releases/download/sdks-v0.2.0-prerelease/noralai-voice-sdk-0.2.0.tgz
   ```
   At the END of consolidation (after all phases ship), the user will run `cd NoralVoice && ./scripts/release_sdks.sh 0.2.0` (interactive, 2FA). Then swap `packages/plugins/noralai-noralvoice/package.json` dep back to a semver range.

2. **Auto-deploy is broken (missing secrets).** `.github/workflows/deploy.yml` needs `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Until set, manual deploy is canonical: `ssh root@agent.noral.ai '/opt/noralos/deploy.sh'`.

3. **Dograh brand surface still in code.** Phase 5 owns this. Remaining in-code references: `DOGRAH_API_KEY` env var, `dograh_auth_token` cookie, `<title>Dograh</title>`, `app.dograh.com` URLs, `docs.dograh.com` links, `services.dograh.com` (MPS — Phase 8 owns this one), Axiom dataset.

4. **nginx proxy warning (non-fatal).** `/opt/noralagent/deploy/proxy/nginx.conf` references a deleted `platform.noral.ai/fullchain.pem` cert. Nginx logs a warning during `deploy.sh` step 4 reload. Does not affect `agent.noral.ai`. Worth cleaning up in a separate maintenance pass.

5. **VoiceVoice prod postgres password drift.** During this session's deploy, the api couldn't auth against postgres until I ran `ALTER USER postgres WITH PASSWORD 'postgres'` to re-sync with the compose env var. The cause is unclear (maybe a prior aborted deploy). If voice.noral.ai api fails to start with `InvalidPasswordError`, that's the recovery.

## Operational gotchas (codified, do not relitigate)

### Stacked-PR cascade

When PR-A merges via squash + `--delete-branch`, any PR-B stacked on top **auto-closes** as `CONFLICTING`. Recovery:
1. `git checkout phase-B && git rebase --onto origin/master <old-A-tip>`
2. `git push --force-with-lease`
3. `gh pr create --base master --head phase-B --title "... (re-opened)"` (closed PRs with rewritten heads cannot be reopened)
4. Merge as usual

This happened 3 times this session (PR #2 → #3, #84 → #86, #85 → #87).

### Lockfile policy

PRs **cannot** modify `pnpm-lock.yaml`. The `policy` CI job's "Block manual lockfile edits" step fails if you do. Exempt branch: `chore/refresh-lockfile`.

After a dep-changing PR merges, the `Refresh Lockfile` workflow updates the lockfile but **cannot create the PR** (GitHub Actions PR-creation is disabled). Open the PR manually:
```sh
gh pr create --base master --head chore/refresh-lockfile --title "chore(lockfile): refresh pnpm-lock.yaml"
```
Wait for policy to pass, then `gh pr merge <N> --squash --delete-branch`.

### Plugin manifest validator

Three classes of silent failure:
- **Missing capability for slot type** — `detailTab` needs `ui.detailTab.register`, etc.
- **Missing `entityTypes` on `detailTab` slot** — required field
- **Wrong `capability` value on apiRoute** — must be exactly `"api.routes.register"` (other capabilities go in top-level `capabilities[]`)
- **Missing `export default manifest`** in manifest.ts — silently fails in prod Docker image
- **Plugin missing from `Dockerfile`'s `pnpm --filter ... build`** — silent prod-only fail

### PluginApiRequestInput vs PluginWebhookInput

- apiRoute handler: `input.params` (path params), `input.body` (parsed JSON), `input.query`
- webhook handler: `input.parsedBody` (parsed JSON), `input.rawBody`, `input.query` (added in PR-A)

## Credentials state on this machine

| Tool | Status |
|---|---|
| `gh` CLI | ✅ logged in as Noral-AI |
| SSH `root@agent.noral.ai` | ✅ works (id_ed25519) |
| SSH `root@voice.noral.ai` | ✅ works (host key in `~/.ssh/known_hosts`) |
| `npm login` | ❌ not configured (only needed for SDK publish at end) |
| `twine` + `~/.pypirc` | ❌ not configured (only needed for SDK publish at end) |
| GitHub repo secrets (`VPS_*`) | ❌ not configured (only needed for auto-deploy) |

## How to run Phase 4

```sh
cd /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical
# Paste the contents of docs/audit/claude-code-prompt-phase-4.md into Claude Code
```

The Phase 4 prompt drives two PRs. After PR-A merges, PR-B's base will auto-close (stacked-PR cascade above) — the next session handles that via the rebase-and-recreate pattern.

## Memory pointers

Read on resume (auto-loaded into `MEMORY.md`):

- `project_audit_2026_05_14.md` — audit + consolidation scope summary
- `project_noralos_repo_state.md` — canonical vs decoy repo
- `feedback_noralos_plugin_gotchas.md` — Dockerfile + manifest export default
- `feedback_compose_env_passthroughs.md` — `/opt/noralos/docker-compose.yml` env drift
- `feedback_secrets_master_key_path.md` — `NORALOS_SECRETS_MASTER_KEY_FILE` must be persistent
- `feedback_proxy_stale_dns_on_recreate.md` — nginx reload after server recreate
- `project_vps_three_apps.md` — agent.noral.ai (NoralOS), agents.noral.ai, platform.noral.ai (DELETED)
- `project_voice_settings_split.md` — what lives where between NV and NoralOS
- `feedback_complete_admin_tasks_dont_ask.md` — standing authz for prod admin work

## When in doubt

1. Read `docs/audit/consolidation-scope.md` — that's the binding scope.
2. Read `CLAUDE.md` at repo root — the operational rails.
3. Check `gh pr list --state merged --limit 10` to see recent activity pattern.
4. The user owns final decisions on anything not codified in scope or memory. Ask before doing reversible-but-noisy things (force pushes to master-adjacent branches, npm publishes, etc.).
