# PAPERCLIP_AUDIT — Phase 0 Recon

**Repo:** `Noral-AI/NoralOS` (fork of `paperclipai/paperclip`)
**HEAD:** `f1a312f7` — `rebrand: README + UI title + boot banner → Noral`
**Default branch:** `master` (NOT `main` — both branches exist on origin)
**Audited:** 2026-04-30 (read-only)
**Auditor brief:** `PAPERCLIP_NEXT_SESSION.md` (companion file)

This audit fills in Phase 0 of `PAPERCLIP_MIGRATION.md` — the internal map of the Paperclip fork that the rest of the migration depends on. No code was changed; only the four deliverable docs were added.

---

## 1. Repo / git state

| Field | Value |
|---|---|
| Origin | `https://github.com/Noral-AI/NoralOS.git` |
| Upstream | `https://github.com/paperclipai/paperclip.git` (added read-only during this audit) |
| Default branch (origin) | `master` |
| Default branch (upstream) | `master` |
| HEAD | `f1a312f7` |
| Latest upstream master | `ad5432fe` |
| Fork ahead of upstream | **2 commits** |
| Fork behind upstream | **13 commits** |
| Latest tag (any) | `v2026.428.0` (upstream release; reachable) |

### Fork-only commits (since fork point)

| SHA | Author | Subject | Scope |
|---|---|---|---|
| `c93fe58d` | Noral-AI <quentin@noralconsulting.com> | `ci: amd64 only + 60min timeout (Noral-AI fork)` | `.github/workflows/docker.yml` (4 ins / 3 del) |
| `f1a312f7` | Noral-AI <noreply@noral-ai.local> | `rebrand: README + UI title + boot banner → Noral` | 5 files (83 ins / 413 del) — README, NOTICE, startup-banner.ts, ui/index.html, BreadcrumbContext.tsx |

The rebrand commit body is explicit about what was deliberately **not** rebranded: `@paperclipai/*` workspace package names, `PAPERCLIP_*` env var prefix, `/paperclip` filesystem paths, DB / table names, test fixtures using `Paperclip` as a company name string. Quoting the commit author: "high-risk for low brand value right now."

### Upstream-only commits (fork is missing these — last 5 of 13)

```
ad5432fe [codex] Harden issue recovery reliability (#4875)
a3de1d76 Add cheap model profiles for local adapters (#4881)
1fe10673 Polish board settings and skills workflow (#4863)
c4269bab Add workflow interaction cancellation and issue cost summaries (#4862)
87f19cd9 Improve issue thread scale and markdown polish (#4861)
```

The `+1,612 / -13,346` line count in `git diff upstream/master HEAD` looks alarming but is mostly upstream work the fork is missing, not fork-side deletions. Excluding lockfiles, 195 files differ; the bulk of the deltas are in upstream-side adapter and UI files the fork hasn't pulled in.

---

## 2. Static config inspection

(Key NAMES only — never values.)

### Runtime requirements
- **Node:** `>=20` (per top-level `package.json` `engines`)
- **Package manager:** `pnpm@9.15.4` (monorepo with `pnpm-workspace.yaml`)
- **Patched dependency:** `embedded-postgres@18.1.0-beta.16` via `patches/embedded-postgres@18.1.0-beta.16.patch`
- **Database:** Postgres (Drizzle ORM at `@paperclipai/db`); embedded mode for dev, real Postgres in prod

### Top-level scripts (selected)
`dev`, `dev:watch`, `dev:once`, `dev:server`, `dev:ui`, `build`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:backup`, `release`, `release:canary`, `release:stable`, `release:rollback`, `secrets:migrate-inline-env`, `smoke:openclaw-join`, `smoke:openclaw-docker-ui`, `smoke:openclaw-sse-standalone`, `test:e2e`, `evals:smoke`.

### `.env.example` keys
(Key names only, per audit rule. See `.env.example` in the repo for placeholder values.)

| Key | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. Default points at local Postgres on port 5432. |
| `PORT` | No | HTTP listen port. Default 3100. |
| `SERVE_UI` | No | Whether the server serves the built UI. Default false (UI runs separately in dev). |
| `BETTER_AUTH_SECRET` | Yes (auth) | Used by the better-auth library for session signing. |
| `DISCORD_WEBHOOK_URL` | No | Commented out by default. Optional Discord daily-digest webhook. |

### Additional env vars set in production Dockerfile
`NODE_ENV`, `HOME`, `HOST=0.0.0.0`, `PORT=3100`, `SERVE_UI=true`, `PAPERCLIP_HOME=/paperclip`, `PAPERCLIP_INSTANCE_ID=default`, `PAPERCLIP_CONFIG=/paperclip/instances/default/config.json`, `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=private`, `OPENCODE_ALLOW_ALL_MODELS=true`, plus `USER_UID` / `USER_GID` for filesystem ownership.

No real `.env` file was found anywhere in the clone (good — no leaks).

### Containers / runtime
- **Dockerfile:** multi-stage Node 20 LTS Trixie slim. Production image globally installs `@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`. Volume `/paperclip`, exposes `EXPOSE 3100`, runs as `node` user.
- **Docker compose configs:** `docker/docker-compose.yml`, `docker/docker-compose.quickstart.yml`, `docker/docker-compose.untrusted-review.yml`. Plus `Dockerfile.onboard-smoke`, `ecs-task-definition.json` (AWS ECS), `quadlet/` (systemd-quadlet).
- **No** systemd `.service` files, **no** PM2 `ecosystem.*` files, **no** launchd plists. Runtime is container-first.

### Default port
**3100** (per `PORT` in `.env.example` and Dockerfile env). Notable for the migration: ClaudeClaw runs on 3141, so the cutover plan can keep both running on different ports during Phase 7 staging.

---

## 3. Subsystem map (Phase 0 `<TBD>` answers)

All paths are relative to the repo root.

| # | Subsystem | Primary path | Notes |
|---|---|---|---|
| 1 | **Plugin / extension entry point** | `packages/plugins/sdk/` (`@paperclipai/plugin-sdk`) + `packages/plugins/create-paperclip-plugin/` | Worker-side plugin runtime via `definePlugin` / `runWorker`. Plugin host integration in `server/src/services/plugin-worker-manager.ts`, plugin tool registry in `server/src/services/plugin-tool-registry.ts`. Plugin manifests declare capabilities; gating in `server/src/services/plugin-capability-validator.ts`. |
| 2 | **Adapter registry (mutable, runtime-extensible)** | `server/src/adapters/registry.ts` + `server/src/adapters/index.ts` (with `registerServerAdapter` / `unregisterServerAdapter` / `requireServerAdapter`) | Documented in top-level `adapter-plugin.md`. Built-in adapters live under `packages/adapters/` (claude-local, codex-local, cursor-local, gemini-local, opencode-local, pi-local, **openclaw-gateway**). Each exposes `execute`, `listSkills`, `syncSkills`, `testEnvironment`, `sessionCodec`. |
| 3 | **Input adapter layer (Telegram-style channel hook)** | **No native equivalent** | Upstream Paperclip is web-driven; zero references to Telegram or any messaging-channel adapter exist in the codebase. The Phase 1 input adapter must be built from scratch — recommended path is a Paperclip plugin under `packages/plugins/<noralai-telegram>/` (using `@paperclipai/plugin-sdk`) that posts an `issue.created` event for each inbound message and calls a tool to deliver outbound text/files. |
| 4 | **Skill loader (DB-backed registry)** | `server/src/services/company-skills.ts` (writes `companySkills` table) | Routes: `server/src/routes/company-skills.ts`. Native source types supported: `github`, `skills_sh`, `url`, `local_path` (sub-kind `managed_local`), `catalog`. **paperclipskills.com URLs are NOT a native source type** (matches upstream issue #2766 noted in handoff). Adapter-side skill sync into adapter-specific skill homes is at `packages/adapters/<adapter>/src/server/skills.ts` (e.g. claude-local syncs to `~/.claude/skills/`). |
| 5 | **Agent runtime / heartbeat** | `server/src/services/heartbeat.ts` (factory `heartbeatService(db, options)` at line 1981) | Heartbeats are routine-driven (cron) plus on-demand wake-ups (`agentWakeupRequests`). Tables: `agents`, `agentRuntimeState`, `agentTaskSessions`, `agentWakeupRequests`, `heartbeatRuns`, `heartbeatRunEvents`. Companion services: `services/heartbeat-stop-metadata.ts`, `services/heartbeat-run-summary.ts`, `services/issue-liveness.ts`, `services/issue-assignment-wakeup.ts`. |
| 6 | **Routines (cron / scheduled work)** | `server/src/services/routines.ts` + `server/src/services/cron.ts` | Tables: `routines`, `routineTriggers`, `routineRuns`. Drives scheduled heartbeats. |
| 7 | **Memory subsystem (PARA)** | `skills/para-memory-files/SKILL.md` (a SKILL, not core platform code) | Per `doc/memory-landscape.md`, NoralOS is **not** an opinionated memory engine — it's a "control-plane memory surface" intended to wrap plugin-provided memory providers. PARA is a single skill that uses `$AGENT_HOME/life/{projects,areas,resources,archives}/<entity>/{summary.md,items.yaml}`. The Phase 3 decision in MIGRATION.md ("PARA sufficient or plugin?") simplifies: there's no built-in PARA layer to keep — the choice is between (a) using the para-memory-files skill as-is, or (b) building a memory plugin. |
| 8 | **Task / mission system** | `server/src/services/issues.ts` + `server/src/routes/issues.ts` | "Issue" is the NoralOS vocabulary for what NoralAI calls a task / mission. Tables: `issues`, `issueApprovals`, `issueAttachments`, `issueComments`, `issueDocuments`, `issueLabels`, `issueRelations`, `issueReadStates`, `issueThreadInteractions`, `issueWorkProducts`, `issueInboxArchives`. Lifecycle statuses: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled` (per `routines.ts`). |
| 9 | **Cost / budget tracker** | `server/src/services/costs.ts` (table `costEvents`) + `server/src/services/budgets.ts` | `costEvents` columns include `costCents`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `companyId`, `agentId`, `occurredAt`. Billing types: `metered_api`, `subscription_included`, `subscription_overage`. Routes: `server/src/routes/costs.ts`. |
| 10 | **Dashboard backend API** | `server/src/routes/dashboard.ts` + `server/src/services/dashboard.ts` | Currently a single endpoint: `GET /companies/:companyId/dashboard` returning a summary aggregating agents, heartbeat runs (last 14 days), approvals, and cost totals. Sparse — most UI panels query other routes (`/issues`, `/agents`, `/costs`, etc.) directly. |
| 11 | **Dashboard UI components** | `ui/src/components/` + `ui/src/pages/` | Major panels: `IssuesList.tsx`, `IssueDetail.tsx`, `IssueChatThread.tsx`, `IssueRunLedger.tsx`, `Agents.tsx`, `CompanySettings.tsx`, `Routines.tsx`, `PluginSettings.tsx`, `AdapterManager.tsx`. Storybook at `ui/storybook/`. |
| 12 | **Security: plugin capability validator** (NOT a 7-category skill scanner) | `server/src/services/plugin-capability-validator.ts` | Manifest-time + runtime gating. Maps operations (e.g. `companies.list`, `issues.read`) to required capabilities (e.g. `companies.read`); rejects worker→host bridge calls that lack declared capabilities. **This is a plugin capability model, not a skill threat-classification scanner.** See Open Issue #1. |
| 13 | **Agent prompt assembly** | `server/src/services/agent-instructions.ts` + `server/src/services/default-agent-instructions.ts` + `server/src/onboarding-assets/{ceo,default}/` | "Instruction bundles" per agent — managed (NoralOS-controlled) or external (user file path). Default templates: `default` agent loads `AGENTS.md`; `ceo` agent loads `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`. Prompt content is assembled at heartbeat time. Memory-context injection (Phase 3) plugs in here, not as an output filter. |
| 14 | **Config layer** | `server/src/config.ts` + `server/src/config-file.ts` | Loads JSON from `PAPERCLIP_CONFIG=/paperclip/instances/<id>/config.json`; sensitive material via `server/src/services/secrets.ts` and the `secrets/` dir. |
| 15 | **Data / instance dir** | `/paperclip/instances/<instance-id>/` (per Dockerfile envs) | Paperclip data root is `PAPERCLIP_HOME=/paperclip`; the default instance is `/paperclip/instances/default/`. Suggested location for migrated SQLite: `/paperclip/instances/default/data/noralai.db`. |

---

## 4. Customization delta from upstream

Two fork commits, both narrow:

### `c93fe58d` — `ci: amd64 only + 60min timeout (Noral-AI fork)`
- **What:** restricts `.github/workflows/docker.yml` build to `linux/amd64`, drops arm64, raises `timeout-minutes` to 60.
- **Why:** lower CI cost / faster feedback for a single-platform deploy. Noral isn't shipping arm64 images.
- **Risk:** low. Self-contained CI tweak that may merge-conflict if upstream evolves the same workflow file.

### `f1a312f7` — `rebrand: README + UI title + boot banner → Noral`
- **What:** five files changed. README rewritten as a Noral pitch with upstream attribution. NOTICE added for MIT compliance. `server/src/startup-banner.ts` ASCII art replaced (NORAL). `ui/index.html` and `ui/src/context/BreadcrumbContext.tsx` window/page title set to Noral.
- **Why:** front-of-house brand only. The commit body explicitly enumerates what was NOT rebranded (package names, env var prefix, paths, DB tables, test-fixture company names) and labels them "high-risk for low brand value right now."
- **Risk:** low. Most likely to merge-conflict against upstream README updates (which are frequent — see upstream commits like `Add Twitter/X link to READMEs`).

### Files changed vs upstream/master (excluding lockfile)
195 files differ. The 2 fork commits account for 5+1 = 6 of these. The other ~189 are files where upstream/master moved forward and the fork is behind. Examples of upstream-only churn the fork is missing: `packages/adapter-utils/src/sandbox-callback-bridge.{ts,test.ts}` (-1,432 lines) was removed upstream; `server/src/services/heartbeat.ts` rewritten (-293 lines); UI components polished across `IssueChatThread`, `IssueRunLedger`, `IssuesList`, `MarkdownEditor`, `NewIssueDialog`.

Recommended: **rebase the fork onto `upstream/master` before starting Phase 1.** Two fork commits should rebase cleanly except possibly the README rebrand, which will need conflict resolution against any upstream README changes in the 13-commit window. See "Recommended next moves" §8.

---

## 5. Skills & agents currently configured

### Bundled skills (in the fork repo, not user-installed at runtime)

**`skills/` (top-level — NoralOS platform skills, ship with the fork):**
- `paperclip` — Interact with the NoralOS control plane API (task management, governance)
- `paperclip-converting-plans-to-tasks` — Plan → executable task breakdown
- `paperclip-create-agent` — Create new agents with governance-aware hiring
- `paperclip-create-plugin` — Scaffold new Paperclip plugins via the SDK
- `paperclip-dev` — Operate a local Paperclip instance (start/stop, build, test, worktrees, backup)
- `para-memory-files` — File-based PARA memory (3 layers: knowledge graph, daily notes, tacit knowledge)

**`.agents/skills/` (NoralOS-internal dev/release skills, used by maintainers):**
- `company-creator`, `create-agent-adapter`, `deal-with-security-advisory`, `doc-maintenance`, `pr-report`, `prcheckloop`, `release`, `release-changelog`

**`.claude/skills/` (Claude Code skills for working in this repo):**
- `company-creator`, `design-guide`, `paperclip`

### Onboarding agent templates (seeded into new companies)
- `ceo` — bundle: `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`. Pure delegator: must NOT do IC work, must hire/delegate.
- `default` — bundle: `AGENTS.md`. Generic agent template.

There is **no static "agent / org chart config" file** in the repo — agents are created at runtime per company via the API, stored in the `agents` table. Static templates above are only the seed bundles.

### Cross-check vs curated bundles

| Bundle | Pre-installed in fork? | Conflict? |
|---|---|---|
| ClawHub bundle (36 skills at `/Users/quentin/Documents/NORALAI/NORALOS/noralOS/clawhub-bundle/`) | None | None |
| paperclipskills.com bundle (3 skills at `.../paperclip-bundle/`) | None | None |

The fork is a clean NoralOS install with only platform-native skills. None of the 39 curated NoralAI skills are present — they'll be installed as part of Phase 1+ via the skill loader.

### Bundle state verification (responding to user prompt's "36 ClawHub skills" framing vs `_HANDOFF.md`'s "31 final picks")

- **On disk:** 36 directories under `clawhub-bundle/` ✓
- **Per `_FINAL_INSTALL_LIST.md`:** 36 install + 3 dropped (deleted from disk) = 39 originals
- **Per `_HANDOFF.md` ("31 final picks"):** stale — written before the Google scan added 5 more skills (`gemini-deep-research`, `gemini-citation`, `gemini-computer-use`, `youtube-data`, `meeting-prep`). `_FINAL_INSTALL_LIST.md` is the current source of truth.

No actual bundle drift. The user's "36" is correct.

---

## 6. Drift from upstream

| Metric | Value |
|---|---|
| Fork ahead | 2 commits |
| Fork behind | 13 commits |
| Last upstream pull | Unknown (no merge commit since fork point) |
| Mergeability of 2 fork commits onto upstream/master | Likely clean for the CI tweak; README rebrand has conflict risk |

No breaking changes detected in the 2 fork commits (CI workflow restriction + cosmetic rebrand). The 13 upstream commits the fork is behind include:
- adapter sandbox-callback-bridge removal (large refactor, but not in code the fork modified)
- heartbeat service polish
- UI component polish across issue threads, markdown rendering, run ledger
- "Add cheap model profiles for local adapters" (`a3de1d76`) — adds new capability to claude/codex/cursor/gemini/opencode local adapters
- `[codex] Harden issue recovery reliability` (`ad5432fe`)

**Recommendation:** rebase before Phase 1. The longer the fork stays behind, the harder it gets — especially when adapter or skill-loader code is touched upstream.

---

## 7. Open issues

### #1 — Migration plan's "7-category skill security scan" is not a real NoralOS feature

The `clawhub-bundle/_HANDOFF.md` and `paperclip-bundle/_FINAL_INSTALL_LIST.md` both reference a "7-category skill security scan" as a Paperclip platform feature whose overlap should be avoided.

**Reality:** NoralOS ships `server/src/services/plugin-capability-validator.ts`, which is a **plugin capability model** (least-privilege gating on worker→host bridge calls based on declared manifest capabilities). It is not a skill threat-classification scanner. The "scan" function in `services/company-skills.ts` (`scanProjectWorkspaces`) discovers existing skill files in the user's project workspaces — not a security scan.

The hard-rule list in `_HANDOFF.md` rejected `@paperclip-skills/skill-security` from paperclipskills.com on the basis that "Paperclip already ships a 7-category skill security scan." That premise appears to be incorrect. The rejection may still be correct on other grounds (skill-security is described in the marketplace as a per-install scanner — possibly redundant with the plugin capability model), but the stated reason needs re-examination.

**Action:** confirm with Quentin whether (a) the 7-category scanner exists in a NoralOS code path I missed, (b) the framing came from an external doc / marketing page that doesn't match the code, or (c) it was conflated with the plugin capability validator. If the scan does not exist, the hard-rule list should be revised.

### #2 — Phase 4 has no clean output-filter hook in upstream

The migration plan calls for the NoralAI exfiltration guard to be wired in as "a NoralOS output filter at `<TBD: paperclip output filter path>`." The plugin SDK exposes events, jobs, data registration, and state — but no agent-output post-processing slot. There is no `output_filter`, `response.filter`, `postProcess`, or similar hook in the codebase.

**Impact:** Phase 4 design needs revisiting before implementation. Three options:
1. **Per-agent skill** that wraps the agent's tool/output calls — would require the agent to invoke it, not enforced.
2. **Heartbeat post-processor** — scan `heartbeatRunEvents` payloads after the run completes, redact / quarantine before the event surfaces in the UI. Requires modifying `heartbeat.ts`.
3. **Upstream contribution** — propose a plugin hook (e.g. `events.beforeRunDeliver`) and contribute it to upstream; carry a small fork-side patch until it lands.

Option 3 is cleanest but slowest. Option 2 is the most pragmatic for a near-term Phase 4. Recommend deciding before starting Phase 4.

### #3 — paperclipskills.com URLs are not a native skill source

The skill loader supports `github`, `skills_sh`, `url`, `local_path`, `catalog` source types. paperclipskills.com URL import is open as upstream issue #2766 (per `clawhub-bundle/_HANDOFF.md`).

**Impact:** the 3 skills in `paperclip-bundle/` (`git-commit-review`, `code-simplifier`, `create-skill`) cannot be installed by URL — they must come in via `local_path` (drop the `.md` files in a watched dir) or `url` pointed at a raw file URL hosted somewhere the fork controls.

**Action:** when Phase 1 installs the bundles, plan for `local_path` import for the paperclipskills.com files. Optionally watch upstream for #2766 to land.

### #4 — Fork is 13 commits behind upstream master

Routine drift, not a defect. Becomes a defect if not addressed before code-modifying phases. See §6 and §8.

### #5 — Rebrand is incomplete by design

Per the rebrand commit body, package names (`@paperclipai/*`), env var prefix (`PAPERCLIP_*`), filesystem paths (`/paperclip`), DB / table names, and test fixtures still say Paperclip. Quentin's earlier "rebrand at all levels" goal is not yet realized. The author flagged this as deferred ("high-risk for low brand value right now").

**Action:** if "all levels" is still the goal, plan a separate Phase X for it. Lowest risk to highest:
- (1) test-fixture company name strings — search & replace in test files only
- (2) DB / table names — requires a migration; Drizzle schema lives in `packages/db/`
- (3) `/paperclip` paths and `PAPERCLIP_*` env vars — touches Dockerfile, scripts, configs, deployment runbooks
- (4) `@paperclipai/*` package names — touches every package.json, every import, lockfile, pnpm workspace config

Order matters: if you do (4) before (3), a halfway state breaks builds. If you do (2) before (3), env vars still mention paperclip but DB doesn't — confusing for ops. Suggest doing all four as one coordinated cutover.

### #6 — Default branch is `master`, not `main`

The migration's task spec said "push to main" but caveated "check `git symbolic-ref refs/remotes/origin/HEAD` first." Confirmed: origin default is `master`. Both branches exist on origin (likely a transitional state). The audit was committed to `master`. If you want to switch to `main` as default, that's a separate one-time cutover.

### #7 — Bundled top-level skill `paperclip` is a NoralOS-native skill, NOT the operations skill of the same name from ClawHub

`clawhub-bundle/_HANDOFF.md` lists `paperclip` (operations skill) in the rejected list. The fork's `skills/paperclip/SKILL.md` is the in-repo "interact with the Paperclip control plane" skill — completely different despite the slug collision. No conflict at install time as long as the install path doesn't try to overwrite the fork's bundled skill.

---

## 8. Limitations of this audit

This pass was static / read-only against the cloned fork. The following could not be determined without runtime access to a live NoralOS install:

1. **Real `.env` values** — none read by design. Whether the live install has `DATABASE_URL`, `BETTER_AUTH_SECRET`, etc. populated is unknown from this audit.
2. **Service health** — whether the bot is currently running, what port it's actually listening on, whether the Postgres backend is up, whether heartbeats are scheduled and firing.
3. **Live data** — number of companies / agents / issues / heartbeat runs / cost events currently in the DB. The audit knows the schema, not the contents.
4. **Adapter session state** — which adapter sessions exist (`agentTaskSessions`), whether they're stale, how much disk space `/paperclip/instances/<id>/` is using.
5. **Storage backend** — `services/storage/` was not opened; whether it's local-disk, S3, or another driver in production is unknown.
6. **Live skill installs** — the `companySkills` table contents on the running instance. Whether any of the 39 NoralAI-curated skills have already been installed at runtime is unknown from the repo alone.
7. **Plugin worker pool** — whether plugins are running, what they are, whether any are misbehaving.
8. **Memory landscape choice** — `doc/memory-landscape.md` is a survey doc dated 2026-03-17, not a settled decision. Whether the live instance has chosen a memory provider is unknown.
9. **Ports actually open** — Dockerfile says `EXPOSE 3100` but a runtime audit might find different (`HOST` / `PORT` overrides).
10. **Open PRs / branches on origin** — only `master` and `main` were inspected. Other origin branches not enumerated.
11. **Issue tracker state** — no inspection of GitHub issues / PRs on `Noral-AI/NoralOS` or `paperclipai/paperclip`.
12. **CI status** — `.github/workflows/` exists but no live check against GitHub Actions runs.

A follow-up runtime audit (executed on the VPS where the fork is deployed) is recommended before starting any code-modifying phase.

---

## 9. Recommended next moves (ranked)

**1. Resolve Open Issue #1 with Quentin.**
Before installing skills, confirm whether the "7-category skill security scan" is a real platform feature or a misunderstanding. The hard-rule rejected list may need revision. (5 minutes of confirmation; no code work.)

**2. Rebase fork onto upstream/master.**
13 commits behind is the right time — manageable conflicts, only 2 fork commits to replay. Doing it later, after Phase 1+ adds adapter / config code, will be much harder.
```
cd /tmp/noralos-audit/NoralOS  # or wherever you check out
git fetch upstream
git rebase upstream/master
# expect possible README conflict from rebrand commit
git push --force-with-lease origin master
```
(30–60 minutes.)

**3. Decide on "rebrand at all levels."**
If still wanted, plan it now as a coordinated cutover (Open Issue #5). If deferred, document it as deferred so future audits don't re-flag it. (Decision only — no code yet.)

**4. Run a runtime audit on the VPS.**
Capture the unknowns from §8 — env vars set, services running, DB stats, installed skills. Should be under an hour with read-only DB access. Output should be a short companion to this static audit.

**5. Begin Phase 1 (Telegram input adapter).**
Per the new plan: build it as a Paperclip plugin under `packages/plugins/<noralai-telegram>/` rather than a fork-internal modification, using `@paperclipai/plugin-sdk`. This keeps the Telegram adapter merge-friendly with upstream and aligns with the platform's plugin-first direction. Telegram message arrives → plugin tool creates an `issue` assigned to the right agent → heartbeat picks it up → agent response delivered back through the plugin.

**6. Decide Phase 4's output-filter strategy.**
Option 2 (heartbeat post-processor) is the recommended near-term path given upstream lacks a hook (Open Issue #2). Confirm before writing code.

**7. Update the migration plan's Phase 3 ("memory") decision-tree.**
Per finding §3.7: there's no built-in PARA layer, so the choice is "use the para-memory-files skill" vs. "build a memory plugin," not "is PARA sufficient?" Edit MIGRATION.md accordingly. (This audit's `PAPERCLIP_MIGRATION.md` already filled the tags but did not rewrite the decision narrative — that's a separate edit Quentin should make.)
