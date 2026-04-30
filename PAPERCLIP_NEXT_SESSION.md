# PAPERCLIP_NEXT_SESSION — Pickup notes

Use this file as the kickoff context for the next Claude Code session against this fork. Read `PAPERCLIP_AUDIT.md` for the full Phase 0 recon report; this file is the action-oriented pickup brief.

---

## Re-entry: clone fresh

The audit was performed against a throwaway clone at `/tmp/noralos-audit/NoralOS/`. To re-enter from a clean state:

```bash
# Clean clone
rm -rf /tmp/noralos-audit
mkdir -p /tmp/noralos-audit
cd /tmp/noralos-audit
git clone https://github.com/Noral-AI/NoralOS.git
cd NoralOS

# Add upstream read-only and fetch
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream
```

If you already have a clone and just want the latest:

```bash
cd <your-clone-path>
git fetch origin
git checkout master
git pull --ff-only origin master
git fetch upstream
```

---

## Current branch state

| Field | Value |
|---|---|
| Default branch (origin) | `master` (NOT `main` — both branches exist on origin) |
| Last commit on origin/master at audit time | `f1a312f7` (rebrand: README + UI title + boot banner → Noral) |
| Audit commit (added by this audit) | _to be filled by the commit step — will appear as `chore(audit): phase 0 paperclip recon — internal map + audit report`_ |
| Fork ahead of upstream | 2 commits |
| Fork behind upstream | 13 commits |

---

## Safe to edit next

These are the recommended starting points for follow-on work, ordered by dependency:

1. **Resolve Open Issues #1, #2, #3, #5 from `PAPERCLIP_AUDIT.md`** — clarify or revise the migration plan's assumptions before code work. Specifically:
   - Confirm whether the "7-category skill security scan" exists or if the rejected-list reasoning needs revision (Issue #1).
   - Decide Phase 4's output-filter strategy (Issue #2).
   - Decide if "rebrand at all levels" goes ahead now (Issue #5). _Status as of audit close: Quentin elected Maximum-tier rebrand. See "Pending: full rebrand to NoralOS" below._
2. **Rebase fork onto `upstream/master`** — 13 commits behind, 2 ahead. The CI tweak should rebase clean; the rebrand may conflict on README. **DO BEFORE the rebrand starts** — once the rebrand renames packages and paths, every upstream commit will conflict catastrophically. This is now blocking work for the rebrand phase.
3. **Update `PAPERCLIP_MIGRATION.md` Phase 3 narrative** — the `<TBD>` tags are filled in by this audit, but the decision tree ("PARA sufficient or plugin?") is moot since there's no built-in PARA layer. Rewrite the Phase 3 decision section to reflect "use para-memory-files skill vs build a memory plugin."
4. **Phase 1 (Telegram input adapter)** — once the rebrand stabilizes, build under `packages/plugins/<noral-telegram>/` (or whatever the post-rebrand plugin namespace is). Use `@paperclipai/plugin-sdk` _(or its renamed equivalent post-rebrand — see #6 below)_.

---

## Do NOT touch yet

- **`server/src/services/heartbeat.ts`** — this file is at the center of the upstream's 13-commit drift. Avoid modifying until after the rebase, otherwise expect non-trivial conflicts.
- **`server/src/adapters/registry.ts`** — same reason; upstream is actively evolving the adapter registry pattern.
- **`packages/adapter-utils/src/`** — upstream removed `sandbox-callback-bridge.{ts,test.ts}` (-1,432 lines) in the missing 13 commits; touching adapter-utils before rebasing is asking for pain.
- **The `LICENSE` file** — under MIT, the upstream copyright (`Copyright (c) 2025 Paperclip AI`) **must be preserved** even during the rebrand. This is a legal hard floor. The maximum rebrand target is "no Paperclip references except the LICENSE copyright line and minimal NOTICE attribution to upstream `paperclipai/paperclip`."
- **Live `.env` on the VPS** — never read or commit. This audit was static; runtime audit is a separate task.

---

## Pending: full rebrand to NoralOS (decided after audit close)

After this audit was authored, Quentin directed a Maximum-tier rebrand: everything except the LICENSE copyright line. Phased approach. Scope summary (from audit Open Issue #5 and follow-up survey):

| Tier | What changes | Files affected (approx) |
|---|---|---|
| 1. Visible surface | README, NOTICE (preserve attribution), startup banner, UI titles/breadcrumbs, `docs/`, `doc/`, error/log strings | ~600 |
| 2. Skills + scripts + tests | `skills/paperclip*/` (rename + content), `.agents/skills/*/SKILL.md` content, `scripts/paperclip-*`, `ui/storybook/fixtures/paperclipData.ts`, `ui/src/hooks/usePaperclipIssueRuntime.ts`, `server/src/__tests__/paperclip-*.test.ts` | ~150 |
| 3. Env vars | `PAPERCLIP_HOME` → `NORALOS_HOME` (or chosen name), `PAPERCLIP_CONFIG`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_DEPLOYMENT_MODE`, `PAPERCLIP_DEPLOYMENT_EXPOSURE`, plus all `.env.example`, Dockerfile, docker-compose, ecs-task-definition.json, quadlet | ~30 |
| 4. Filesystem paths | `/paperclip` → `/noralos`. Dockerfile `VOLUME`, `WORKDIR`, scripts, runbooks, docs | ~50 |
| 5. Package names | `@paperclipai/*` → `@noralos/*` (22 packages, 1,176 imports). Touches every `package.json`, every TS/TSX import, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (regenerated) | ~1,200 |

**Order matters.** Phase 5 (package names) MUST be last because it's the most invasive and any inconsistency breaks the build for the entire monorepo. Recommended phase boundaries → separate commits / PRs → each verified with `pnpm typecheck && pnpm test:run` before the next phase starts.

**Prerequisite:** rebase onto `upstream/master` first (item #2 in "Safe to edit next" above). Doing this rebase _after_ the rebrand is impossible — every upstream commit would conflict on package names.

**Forward-compatibility cost:** after this rebrand lands, future `git fetch upstream && git merge` will conflict on virtually every code change upstream makes. Plan to either (a) cherry-pick upstream commits and accept the rename burden each time, (b) maintain a small adapter shim that translates `@paperclipai/*` → `@noralos/*` at build time so source stays mergeable (heroic), or (c) accept the divergence and only pull upstream selectively. Decision deferred.

---

## 3 questions for Quentin to answer before Phase 1 starts

1. **Open Issue #1 — does Paperclip actually ship a "7-category skill security scan"?**
   Static audit found only `plugin-capability-validator.ts` (a manifest-time + runtime capability gate for plugins) and `scanProjectWorkspaces` (project-skill discovery). No 7-category threat scanner. Is the framing in `_HANDOFF.md` and `_FINAL_INSTALL_LIST.md` based on a doc / marketing claim that doesn't match the code? If so, the rejected-list reasoning needs revision.

2. **Open Issue #2 — Phase 4 output-filter approach?**
   No native output-filter hook exists in the plugin SDK or heartbeat pipeline. Three options:
   - (a) per-agent skill that wraps tool calls (not enforced)
   - (b) heartbeat post-processor scanning `heartbeatRunEvents` payloads after a run completes (modify `heartbeat.ts`)
   - (c) propose & contribute upstream hook (slowest, cleanest)

   Which path? Recommend (b) for Phase 4 timing.

3. **Rebrand: target name and namespace?**
   Decided: Maximum-tier rebrand. Open sub-questions:
   - npm package scope: `@noralos/*` or something else? (`@noral-ai/*`, `@noral/*`, `@noralai/*` — pick one.)
   - Env var prefix: `NORALOS_*`, `NORAL_*`, `NOS_*`?
   - Filesystem volume/path: `/noralos`, `/noral`, `/data/noralos`?
   - Database default user/db name in `.env.example`: `noralos:noralos@localhost:5432/noralos` or keep `paperclip` as a generic placeholder for the dev-only example?
   - Repo display name in NOTICE: keep "noralOS" lowercase-O style or "NoralOS" (the GitHub repo name)?

   These are sticky once chosen — let's lock them before any code change.

---

## How to verify after each phase

```bash
# Build hygiene
pnpm install --frozen-lockfile  # if package names changed, drop --frozen-lockfile and regen lockfile
pnpm run preflight:workspace-links
pnpm typecheck

# Test
pnpm test:run

# Lint / forbidden tokens
pnpm run check:tokens  # (note: this script may itself need updating during rebrand)

# Dry-run docker build
docker build -t noralos:dev .

# Spot-check rebrand completeness (after Maximum-tier finishes)
grep -ril 'paperclip' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist | wc -l
# Expected end-state: only LICENSE and NOTICE should match.
```

---

## Audit deliverables in this commit

- `PAPERCLIP_AUDIT.md` — main audit report (subsystems, deltas, open issues, limitations, recommendations)
- `PAPERCLIP_TREE.md` — depth-3 repo tree (substituted for tree(1) since not installed locally)
- `PAPERCLIP_NEXT_SESSION.md` — this file
- `PAPERCLIP_MIGRATION.md` — copy of Quentin's local `/Users/quentin/Documents/NORALAI/NORALOS/noralOS/PAPERCLIP_MIGRATION.md` with all 12 `<TBD: ...>` tags filled in with real paths from this audit. Decision narrative for Phase 3 not rewritten — see "Safe to edit next" item #3.
