# Paperclip Upstream Sync Scope (binding)

**Date:** 2026-05-26
**Target:** sync NoralOS from upstream pin `v2026.428.0` → `v2026.525.0`
**Pairs with:** [NORALOS_AUDIT.md](../../NORALOS_AUDIT.md), [consolidation-scope.md](consolidation-scope.md)

---

## 1. Goal

Bring NoralOS forward to upstream paperclip `v2026.525.0` (released 2026-05-25) **without losing any of the 75 fork-only commits** that define NoralOS as a product. After the sync:

- Fork base = `v2026.525.0`
- All 13 NoralOS plugins build, load, and register
- All 19 NoralOS routes work
- Branding (logs, cookies, UI title, README, NOTICE, banner) stays NoralOS
- Drizzle migrations apply cleanly on a fresh DB and on `agent.noral.ai` prod data
- agent.noral.ai smoke passes (NoralSign + NoralVoice + Brooklyn + integrations UI)
- `/api/version` reports the new upstream pin

Anything beyond that is out of scope.

---

## 2. Current state

| Metric | Value |
|---|---|
| Current upstream pin | `v2026.428.0` (2026-04-28) |
| Target upstream pin | `v2026.525.0` (2026-05-25) |
| Upstream commits to absorb | **168** |
| Stable releases skipped | 4 (`v2026.512.0`, `.513.0`, `.517.0`, `.525.0`) |
| Fork-only commits | 75 (since bootstrap; root = PR #50) |
| Fork-touched files | 1,456 |
| Upstream-touched files (same window) | 1,129 |
| Files touched on **both sides** (conflict candidates) | **488** |
| New upstream Drizzle migrations | 15 (`0075` → `0089`) |
| New fork Drizzle migrations | 4 (`0075` → `0078`, **collision**) |

The fork has **no shared git ancestry** with upstream (canonical repo was bootstrapped without preserving history), so this is not a `git merge upstream/master`. It is a re-apply: bump the base to `v2026.525.0`, replay the NoralOS delta on top.

---

## 3. Customizations to preserve

Grouped by conflict risk. Every item below ships in the post-sync tree.

### Bucket A — Additive, zero-conflict (drop-in copy)

These touch paths that upstream doesn't own. The sync mechanic is `cp -R` from current `HEAD`.

| Item | Path | Source PR(s) |
|---|---|---|
| NoralSign plugin | `packages/plugins/noralai-noralsign/` | Phase 1 |
| NoralVoice plugin | `packages/plugins/noralai-noralvoice/` | Phase 3–4 |
| Brooklyn LLM adapter | `packages/plugins/noralai-brooklyn/` | #53, #54 |
| Slack plugin | `packages/plugins/noralai-slack/` | Phase 6 |
| Zoho CRM plugin | `packages/plugins/noralai-zoho/` | tip (`7f656f69`) |
| Google Sheets plugin | `packages/plugins/noralai-google-sheets/` | tip (`7f656f69`) |
| Twilio plugin | `packages/plugins/noralai-twilio/` | Phase 6 |
| Voice cascade / config | `packages/plugins/voice-{cascade,config}/` | Phase 3 (collapses in consolidation-plan Phase 5) |
| Create-noralos-plugin scaffold | `packages/plugins/create-noralos-plugin/` | tooling |
| NoralOS skills | `skills/noralos/`, `skills/noralos-create-agent/` | Phase 7 |
| Audit docs | `docs/audit/` (22 files) | this work |
| Smoke scripts | `scripts/smoke/` (5 files) | Phase 7.5 |
| Deploy guides | `docs/deploy/`, `docs/guides/` | Phase 5–7 |
| `.agents/skills/` | `.agents/skills/` (7 files) | tooling |

### Bucket B — Surgical patches (small, mechanical, replay per-file)

Each is ≤10 lines and lives in a file upstream also touches. Re-apply by hand or as a focused patch.

| Item | Files | Notes |
|---|---|---|
| Log prefix `[paperclip]` → `[noralos]` | `server/src/startup-banner.ts`, ~3 boot files | PR #128 |
| Cookie prefix `paperclip-` → `noralos-` | `server/src/auth/*` (cookie set/read sites) | PR #117 |
| UI title + banner | `ui/index.html`, `ui/src/BreadcrumbContext.tsx` | original rebrand commit `f1a312f7` |
| README + NOTICE rebrand | `README.md`, `NOTICE` | original rebrand commit |
| Docker workflow (amd64-only + 60min timeout) | `.github/workflows/docker.yml` | `c93fe58d` |
| Auto-register identifier-ref resolver | `packages/plugins/plugin-loader/*` | PR #103 |

### Bucket C — Cross-cutting feature work (cherry-pick by PR)

These span many files and intermix with upstream code. Replay as individual cherry-picks against the new base; resolve conflicts per PR.

| PR(s) | Surface | Estimated overlap with upstream |
|---|---|---|
| #46 Integrations Phase 1 | `/company/settings/integrations`, `patchConfig` preserving `ttsMode`, 31-case authz matrix | **High** — `server/src/integrations/*`, `ui/src/settings/*` |
| #56 Permanent company delete | Danger Zone cascade | Low |
| Phase 4 (#94/#99–#103) | 19 routes, iframed builder, live transcript stream, Costs merge | **Medium** — `server/src/routes/*`, `ui/src/routes/*` |
| Phase 4b — auto-register version reader | plugin loader DB manifest refresh | Low |
| Phase 5 — voice plugin collapse | merges `voice-config` + `voice-cascade` + `conference-room-bridge` into `noralai-noralvoice` | Low (lives inside Bucket A paths) |
| Phase 7 — agent tools wave | NoralVoice + NoralSign tool registrations | Low |
| Phase 9 — Tier 3 campaign lifecycle + embed-token secret refs | server + plugin glue | Medium |

### Bucket D — Top-level config files (three-way merge required)

Always conflict. Resolve manually in a single pass.

| File | What fork added | What upstream may have changed |
|---|---|---|
| `package.json` | NoralOS plugin workspace globs | engines / scripts / deps |
| `pnpm-lock.yaml` | regenerate after deps reconcile | regenerate |
| `Dockerfile` | nothing significant (audit shows fork-side unchanged in spirit) | upstream build tweaks |
| `.gitignore` | NoralOS-side ignores (audit dirs etc.) | upstream additions |

---

## 4. Upstream changes coming in

The 168 commits are not enumerated here — see `git log v2026.428.0..v2026.525.0`. Categories that matter for our preservation work:

### 4.1 Schema (highest risk)

15 new upstream migrations `0075` → `0089`. Fork has its own `0075`–`0078`. **Numbering collides.** Per-side filenames:

| Number | Upstream | NoralOS |
|---|---|---|
| 0075 | `cultured_sebastian_shaw.sql` | `quick_shiver_man.sql` |
| 0076 | `useful_elektra.sql` | `harsh_centennial.sql` |
| 0077 | `unusual_karnak.sql` | `integration_credentials.sql` |
| 0078 | `white_darwin.sql` | `agents_voice_agent_uuid.sql` |

**Resolution:** fork migrations renumber to `0090`–`0093`. Drizzle journal (`packages/db/src/migrations/meta/_journal.json`) must be hand-edited to insert the upstream 15 ahead of the four fork ones, with snapshot files regenerated. Any prod DB that already ran the fork's `0075`–`0078` needs a one-shot fixup script to record the new identifiers without re-running the SQL.

### 4.2 Upstream feature highlights (what the 168 commits bring)

User-facing:
- **i18n foundation.** Minimal i18next runtime (#5943), UI runtime packages (#6058), full locale catalog (#6070), multilingual issue preservation (#6069). Lays groundwork for non-English UI; no locale is shipped on by default.
- **Blocked-inbox attention view** (#5603) — surfaces blocked issues prominently.
- **Mobile board UI polish** (#6550) and **nested issue inbox polish** (#4959).
- **Workspace routine run tab** (#4958), **live run comment context** (#3257).
- **Issue document live updates + locking** (#6005, #6009).
- **Workspace diff polish + dedicated viewer plugin** (#6383, #6071).

Plugin / extensibility:
- **Modal sandbox provider plugin** (#6245) — new option in `packages/plugins/`.
- **LLM Wiki plugin host + package** (#5597, #5716), with Docker build fix (#5714).
- **Local Cloud Upstream sync** (#6548) — the new upstream-sync mechanism (deferred — see §9.1).
- **Local plugin development workflow improvements** (#5821).

Secrets / auth:
- **`SecretBindingPicker` wired into JsonSchemaForm** (#6339) — UI picker for secret-ref fields. Overlaps our master-key work; adopt picker, keep our resolver.
- **Provider vault secrets UX** (#6381).
- **Routine env secrets support** (#6212).
- **Resource membership controls** (#6677) — post-`v2026.525.0`, not in this sync.

Adapters:
- **Grok adapter canary publishing** (#6154).
- **Cheap model profiles for local adapters** (#4881).
- **Cursor-cloud, cloudflare, exe.dev release packages** (#5728).

Reliability / runtime:
- **Plugin runtime invocation scope hardening** (#6547).
- **Runtime control-plane fixes** (#6380).
- **Source-scoped recovery actions** (#5599), **issue recovery reliability** (#4875).
- **Issue monitor liveness controls** (#4988), **heartbeat retry on max-turn exhaust** (#5096).
- **Hardened DB backup schemas for non-system DBs** (#4960).
- **Agent permissions & controls plan** (#6386) — docs only.

Cloud / import:
- **Async tenant import jobs + polling cleanup**.
- **Cloud tenant import mutations without browser origin** (#6378).

### 4.3 Features that touch our customizations (interaction map)

| Upstream change | Impacts |
|---|---|
| `SecretBindingPicker` (#6339) | Overlaps NoralOS secret-ref work (master key, embed tokens). Adopt picker; keep our resolver semantics. |
| Modal sandbox plugin (#6245) | Sits alongside `sandbox-providers/` and `noralos-plugin-fake-sandbox`. Decision §9.4: adopt as-is. |
| Cloud Upstreams (migration `0089`) | New upstream-sync mechanism. Decision §9.1: defer. |
| i18n runtime + locale catalog | Adds strings to UI files we also rebranded. Re-check Bucket B grep sweep for any rebrand patches that landed on now-localized strings. |
| Plugin runtime invocation scope hardening (#6547) | May affect how our 13 plugins are invoked. Plugin build sweep in P5 will catch breaks. |
| Issue recovery + workflow polish | Mostly UI; rebrand patches in Bucket B may re-conflict if upstream renamed nearby strings. |

### 4.3 Plugin SDK

`@noralos/sdk` and `@noralos/adapter-utils` see 19 + 24 upstream file changes. If signatures changed, the 13 NoralOS plugins compile against the new SDK and may need updates. **Build all plugins under `--filter` before declaring sync complete.**

---

## 5. Strategy

Three viable mechanics; choosing **Option C** (hybrid).

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A — Cherry-pick every PR onto fresh `v2026.525.0` | Cleanest history, per-PR conflict isolation | ~75 cherry-picks, slow | Reject |
| B — Single bulk patch | One pass, fast | Massive diff, no rollback granularity | Reject |
| **C — Hybrid by bucket** | Copy A wholesale, patch B per-file, cherry-pick C, manual-merge D | Different mechanic per bucket | **Adopt** |

### Mechanic, in order

1. **Branch.** From current `master` create `sync/paperclip-v2026.525.0`. Tag pre-sync HEAD as `pre-sync-2026-05-26`.
2. **Replace base.** Reset working tree to `upstream/v2026.525.0` content while keeping `.git/`. Verify `upstream/master` build is green out of the box.
3. **Bucket A drop-in.** Copy additive paths from `pre-sync-2026-05-26` over the upstream tree. Single large commit: `chore(sync): restore NoralOS-only paths`.
4. **Bucket D merges.** Reconcile `package.json`, `pnpm-lock.yaml`, `Dockerfile`, `.gitignore` manually. Run `pnpm install` to regenerate lockfile. Commit.
5. **Bucket B patches.** Re-apply rebrand + log prefix + cookie prefix patches per-file. Commit as `chore(rebrand): re-apply NoralOS surface patches`.
6. **Bucket C cherry-picks.** Replay PR-by-PR in topological order (#46 first since other PRs depend on Integrations). Resolve conflicts using upstream as the authoritative base for any non-NoralOS file.
7. **Migrations renumber.** Move fork's `0075`–`0078` to `0090`–`0093`. Rebuild journal. Test on a throwaway DB.
8. **Plugin build sweep.** `pnpm --filter './packages/plugins/noralai-*' build`. Fix any SDK signature breaks.
9. **Smoke.** Local: full server boot + plugin registration. Stage VPS: deploy to a staging compose + run `scripts/smoke/`. Then prod cutover with the chown gotcha applied.

### Authority rules during conflict resolution

For any file modified by both sides:

- If the file is in Bucket A (NoralOS-only path) → fork wins.
- If the file is in Bucket B (rebrand surface) → upstream wins for code, fork wins for branded strings only.
- If the file is in Bucket C scope → fork wins for the feature being replayed; otherwise upstream wins.
- If the file is in Bucket D → manual three-way.
- Anywhere else → upstream wins (we have no fork-side stake).

---

## 6. Phase plan

| Phase | Output | Exit criterion |
|---|---|---|
| P0 — Branch + base reset | `sync/paperclip-v2026.525.0` branch at upstream tip, with pre-sync tag for rollback | Clean `upstream/v2026.525.0` builds & boots locally |
| P1 — Bucket A | NoralOS-only paths restored | Plugin dirs all present; nothing else changed |
| P2 — Bucket D + B | Top-level configs + rebrand patches re-applied | `pnpm install` succeeds; server boots with `[noralos]` banner |
| P3 — Bucket C | Cross-cutting PR cherry-picks complete | TypeScript checks pass; all 19 NoralOS routes resolve |
| P4 — Migrations | Renumber + journal repair + DB fixup script | Throwaway DB applies all 89+4 migrations clean; existing fork DB upgrade tested against a `agent.noral.ai` data snapshot |
| P5 — Plugin sweep | All 13 NoralOS plugins build against new SDK | `pnpm --filter` all green |
| P6 — Smoke | Local + staging smoke pass | `scripts/smoke/` green on staging compose |
| P7 — Prod cutover | Deploy to `agent.noral.ai` with chown + proxy reload | Smoke + manual UI walkthrough green, `/api/version` reports `v2026.525.0` |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration renumber breaks prod data | Test against a fresh dump of `agent.noral.ai` first; ship a one-shot journal-rewrite script that does not re-execute the SQL. **Mandatory dry-run.** |
| Plugin SDK signature drift breaks 13 plugins silently | Build every plugin explicitly with `pnpm --filter`. CI gate must include this; current Dockerfile does it but verify. (See `feedback_noralos_plugin_gotchas.md`.) |
| Rebrand patches reconflict in unexpected files (upstream renamed nearby strings) | After Bucket B, grep tree for `paperclip` (case-insensitive) and audit each remaining hit. |
| `SecretBindingPicker` upstream feature conflicts with our secret-ref resolution | Adopt upstream picker; verify our master-key resolver still wins for `secret://` URIs. (See `feedback_secrets_master_key_path.md`.) |
| Compose env-var passthroughs on the VPS diverge from repo (historical drift) | Diff `/opt/noralos/docker-compose.yml` against `docker-compose.yml` in repo before redeploy. (See `feedback_compose_env_passthroughs.md`.) |
| `deploy-proxy-1` 502 after container recreate | Reload nginx in `deploy-proxy-1` as the last step of prod cutover. (See `feedback_proxy_stale_dns_on_recreate.md`.) |
| Auto-register version reader doesn't refresh DB manifest after sync | Bump every NoralOS plugin's `PLUGIN_VERSION` constant. (See `feedback_auto_register_version_reader_bug.md`.) |
| Sync diverges from `consolidation-plan.md` Phase 5+ that's currently in-flight | Pause Phase 5+ work for the sync window; rebase any open Phase-5 PRs onto post-sync `master`. |

---

## 8. Success criteria

The sync is done when all of the following are true:

- [ ] `master` of `Noral-AI/NoralOS` contains commit `Sync upstream → v2026.525.0` and `/api/version` reports `v2026.525.0`
- [ ] All 13 NoralOS plugins build and load (server boot logs show all registrations)
- [ ] `/company/settings/integrations` renders, save+reload preserves `ttsMode` (PR #46 contract intact)
- [ ] All 19 NoralOS routes resolve with 2xx (or expected 4xx) under a smoke test
- [ ] Migrations apply cleanly on (a) a fresh DB and (b) a recent `agent.noral.ai` dump
- [ ] `agent.noral.ai` prod responds and Brooklyn answers
- [ ] NoralSign sample flow + NoralVoice place-call flow both work end-to-end
- [ ] No `paperclip` user-visible string anywhere except the upstream attribution in README/NOTICE
- [ ] Rollback path tested: `git reset --hard pre-sync-2026-05-26` plus a re-deploy returns to known-good state

---

## 9. Decisions (closed)

1. **Cloud Upstreams (migration `0089`)** — **defer**. Don't adopt as our sync channel this cycle.
2. **Voice-plugin collapse (`voice-config` + `voice-cascade` + `conference-room-bridge` → `noralai-noralvoice`)** — **after sync**. This is the immediate next step once the sync ships; tracked in §11.
3. **Staging VPS** — verified 2026-05-26. The VPS now runs the `noralos` compose project (agent.noral.ai) and a small standalone `proxy` compose at `/opt/proxy/` for ingress. `agents.noral.ai` was retired pre-sync (see §12) to de-risk ingress and free ~500MB. No dedicated staging compose exists. P6 plan: stage locally + on an ephemeral side container on the same VPS using different ports + a throwaway DB; do not stand up a parallel staging tree just for this sync.
4. **Modal sandbox provider (#6245)** — **adopt as-is**. Land alongside our existing `sandbox-providers` and `noralos-plugin-fake-sandbox`; do not merge them.

---

## 10. Not in scope (this sync)

- Pulling any canary tag (`canary/v2026.525.1-canary.0` etc.) — stable only
- New features beyond what upstream brings
- Refactoring NoralOS plugins for the new SDK beyond what's needed to compile
- Adopting `noralvoice` consolidation-plan Phase 5+ steps (deferred to §11)

---

## 11. Post-sync follow-ups (next, in order)

1. **Voice-plugin collapse.** Merge `voice-config`, `voice-cascade`, and `conference-room-bridge` into `noralai-noralvoice` per `consolidation-plan.md` Phase 5. Cannot happen until sync lands because it builds on the new upstream plugin SDK.
2. **Legacy tree cleanup on disk.** Remove the two stale local copies that have caused canonical-confusion in prior sessions:
   - `/Users/quentin/Documents/NORALAI/NORALOS/Noral-OS/` — the decoy hyphenated repo (per memory `project_noralos_repo_state.md`)
   - `/Users/quentin/Documents/NORALAI/NORALOS/noralOS/` — the legacy lowercase tree
   Verify nothing local-only lives in either (uncommitted branches, stashes, unsynced notes) before deletion. After cleanup, only `NoralOS-canonical/` remains.
3. **DNS retirement for agents.noral.ai** — the A record was deferred during teardown (§12). Decide whether to remove it from the noral.ai registrar.
4. **Decide on Cloud Upstreams adoption** for the next sync cycle (deferred from §9.1).

---

## 12. Pre-sync work completed 2026-05-26

**agents.noral.ai retired.** Tore down the `noralagent` application to de-risk the upstream sync (eliminated the shared-proxy entanglement flagged in `feedback_proxy_stale_dns_on_recreate.md`, freed ~500 MB on the VPS, simplified P6 staging).

Sequence executed:

1. Built standalone `/opt/proxy/` compose (nginx + certbot, joined to external `noralos` network, dedicated `proxy_letsencrypt` + `proxy_certbot_webroot` volumes with cert/webroot contents copied from the old `deploy_*` volumes).
2. Cutover (~4s outage): `docker compose down` on the old `deploy` stack → `docker compose up -d` on the new `/opt/proxy/`.
3. Verified agent.noral.ai serving HTTP 200 on `/` and `/api/version`.
4. Removed `deploy_postgres_data`, `deploy_n8n_data`, `deploy_letsencrypt`, `deploy_certbot_webroot` volumes and the `/opt/noralagent/` directory.
5. DNS A record left alone (decision deferred — see §11.3).

Memory updated: `project_vps_three_apps.md` and `feedback_proxy_stale_dns_on_recreate.md`.
