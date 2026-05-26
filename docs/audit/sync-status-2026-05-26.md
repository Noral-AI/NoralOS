# Paperclip Sync Status — 2026-05-26 WIP

**Branch:** `sync/paperclip-v2026.525.0`
**Pairs with:** [paperclip-sync-scope.md](paperclip-sync-scope.md) — see that for the full plan
**State:** Mid-merge. Working tree has unresolved conflict markers in 157 files. Branch is NOT yet buildable.

---

## What's done

| Phase | Status | Notes |
|---|---|---|
| P0 — Branch + base reset | ✅ | Branch at upstream `v2026.525.0` (commit `60efa38f`). Pre-sync tag `pre-sync-2026-05-26` → master `81fed460`. Sync branch pushed. |
| P1 — Bucket A drop-in (attempt 1) | ❌ Discarded | First attempt (commit `9b75f2fb`, preserved at tag `sync-attempt-1-bucket-a-2026-05-26`) hit a strategy wall: 1,013 files diverged between fork and upstream, far more than scope assumed. Bucket B surgical patches not viable at that scale. Decision to pivot. |
| P2 — Strategy pivot to 3-way merge | ✅ | Used `git merge-tree --merge-base=v2026.428.0 v2026.525.0 master` to synthesize the merge git couldn't do with `git merge` (no shared ancestor; graft mechanism didn't work in git 2.50.1). Tree result applied to working tree via `git read-tree`. |
| P3 — Auto-resolve trivial conflicts | ✅ partial | 14 brand-only conflicts (pure `Paperclip` ↔ `Noralos` deltas) auto-resolved to fork-wins. 29 imports-only conflicts auto-resolved by unioning both sides' imports. 34 tiny (≤2 line) conflicts auto-resolved to fork-wins. |
| P4 — Manual conflict resolution | ⏳ Pending | **157 files remain** with unresolved conflict markers. Estimated 15–25 hours of focused work. |
| P5 — Migration renumber | ⏳ Pending | Fork's `0075`–`0078` migrations need rename to `0090`–`0093` + `_journal.json` patch. (Was partially done in attempt 1 — repeat in this attempt.) |
| P6 — Install + typecheck gate | ⏳ Pending | After conflicts resolved + migrations renumbered, `pnpm install` (regen lockfile) + `pnpm typecheck` must pass. |
| P7 — Smoke + deploy | ⏳ Pending | Per scope §6 P6/P7. |

---

## Strategy decision history

Three options were considered for the merge approach. We picked Option 3.

1. **Option 1 — Fork wins, upstream additive only.** Rejected — would lose 168 commits of upstream work.
2. **Option 2 — Surgical Bucket B patches.** Rejected — turned out to be functionally the same as Option 3 at this scale.
3. **Option 3 — Cherry-pick fork PRs onto v2026.525.0.** Picked, but discovered the fork's root commit is a 2,084-file bootstrap (not a real PR). So cherry-picking degenerated into the same merge work.
4. **Option 3 refined — 3-way merge with v2026.428.0 as synthetic base.** What we actually executed.

---

## How to resume the merge

In a fresh session, run:

```bash
cd /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical
git checkout sync/paperclip-v2026.525.0
git pull
```

Then list remaining conflict files:

```bash
grep -rlE '^<<<<<<< ' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='Dockerfile' --include='*.mjs' --include='*.js' . 2>/dev/null | grep -v '/node_modules/'
```

The categorized lists are in `/tmp/conflicts-*.txt` on the local machine but those won't survive a reboot. Re-categorize them in the new session by re-running `/tmp/classify-conflicts.py` and `/tmp/categorize-substantive.py` (preserved in the repo at `scripts/sync-merge-helpers/` — TODO: stash them there).

Conflict files by remaining bucket (counts at 2026-05-26 checkpoint):

| Bucket | Count | Strategy |
|---|---|---|
| lockfile (`pnpm-lock.yaml`) | 1 | Delete + regen via `pnpm install` |
| small (≤10 lines) | 72 | Eyeball each. Fork wins is the right default for most. |
| medium (≤30 lines) | 44 | Per-file review. Often a substantive upstream addition + fork rename. Try to keep both. |
| large (>30 lines) | 41 | Careful review. Includes Dockerfile, SidebarAgents.tsx, CompanySettings.tsx, several test files, server/src/home-paths.ts. |

---

## Authority rules to apply during manual resolution

Reaffirming the scope's §5 rules in the context of merge-tree conflicts:

- **Files where fork added NEW functionality** (new SDK types, new agent tool fields like `triggeredByUserId`, fork-only routes): take fork's side. Upstream's side has no awareness of those features.
- **Files where upstream added new imports/symbols** (icons, new components, new utility fns): merge — keep upstream's additions ALONGSIDE fork's. Don't drop upstream's new symbols.
- **Files with pure brand renames** (`Paperclip` → `Noralos`, `@paperclipai/` → `@noralos/`, `PAPERCLIP_` → `NORALOS_`): fork wins.
- **Dockerfile, package.json, top-level configs** (Bucket D): manual three-way. Fork's version with upstream's additions merged in.
- **Tests** (especially fork-only test files): fork wins. Upstream version of tests for fork-only features doesn't exist.

---

## Known caveats

- The merge created a tree but not a merge commit yet. When we finally commit, it should be a merge commit with two parents: `v2026.525.0` (60efa38f) and `master` (81fed460). Use `git commit -m "..."` after staging all resolutions. (Or use `git merge --continue` if we set it up via a real merge — but we didn't, we used `read-tree`, so `git commit` works as a normal commit unless we manually set up `.git/MERGE_HEAD`.)
- Lockfile policy: per CLAUDE.md, regular PRs can't include `pnpm-lock.yaml`. The sync PR will need to include it (or be exempted), AND a separate `chore/refresh-lockfile` PR may need to land alongside.
- After merge lands, run `pnpm install` (regen lockfile), then `pnpm typecheck`, then `pnpm --filter './packages/plugins/noralai-*' build` to verify all plugins compile against the merged SDK.
- The pre-sync VPS teardown (agents.noral.ai retired, standalone `/opt/proxy/`) is unchanged and unrelated to this merge work.

---

## Rollback path

If anything goes sideways:

```bash
git checkout master
git branch -D sync/paperclip-v2026.525.0
git push origin --delete sync/paperclip-v2026.525.0
```

The pre-sync state lives at tag `pre-sync-2026-05-26`. The first sync attempt (Bucket A drop-in) lives at `sync-attempt-1-bucket-a-2026-05-26`. Both are pushed to origin.
