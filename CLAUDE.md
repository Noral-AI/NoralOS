# NoralOS — Claude Code rails

Practical context every Claude Code session needs before touching this repo. Read end-to-end the first time; skim on resumes.

## Identity

- **Canonical repo:** `github.com/Noral-AI/NoralOS` (no hyphen). The hyphenated `Noral-OS` repo elsewhere on disk is a **decoy** — do not push to it. Verify with `git remote -v` before any prod-bound change.
- **Default branch:** `master` (not `main`).
- **Local path:** `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`.
- **Workspace deps:** pnpm 9.15.4 + Node 24. Monorepo with workspaces under `packages/` and a top-level `server/`.

## Tech stack (corrects common assumptions)

- **Express 5** + **React 19** + **Vite 6** (NOT Next.js — there is no `ui/src/app/` dir, routing is `<Routes>` declarative in `ui/src/App.tsx`).
- **React Router v7** declarative routes.
- **Drizzle 0.38** (NOT Drizzle 0.41+ — `better-auth` peer warning is known).
- **Postgres 17** via Docker.
- **better-auth 1.4.18** (NOT NextAuth).

## Branch / merge model

- **`master` is NOT branch-protected.** Merges go through even with failing CI checks. Mergeable state `UNSTABLE` just means non-required checks failed.
- **Squash-merge** is the convention. Look at recent PRs (`gh pr list --state merged --limit 5`) to confirm.
- **Stacked PRs auto-close** when their base branch is deleted on squash-merge. If you have a PR stack (B → A → master), after A merges, B closes with `CONFLICTING` state. Recovery: rebase B onto new master, force-push, **create a new PR** (closed PRs with rewritten heads cannot be reopened).
- **Tip:** when you find yourself rebasing a stacked PR, the new PR title should note "reopened from #N" so the audit trail survives.

## Lockfile policy (DO NOT trip this)

- **PRs cannot include `pnpm-lock.yaml` changes.** Policy CI step `Block manual lockfile edits` fails the PR if `pnpm-lock.yaml` is in the diff. Exempt branch: `chore/refresh-lockfile`.
- **Don't commit lockfile changes.** Make `package.json` changes only; CI's `Validate dependency resolution when manifests change` step verifies the dep tree resolves cleanly via `pnpm install --lockfile-only`.
- **After merging a PR that adds deps:** the `Refresh Lockfile` workflow runs on `master` push and updates `pnpm-lock.yaml` on the `chore/refresh-lockfile` branch. It tries to auto-open a PR but is blocked by repo policy ("Allow GitHub Actions to create and approve pull requests" is off). **Open the lockfile PR manually:** `gh pr create --base master --head chore/refresh-lockfile --title "chore(lockfile): refresh pnpm-lock.yaml"`. Merge it after policy passes.

## Deploy

### Auto-deploy (currently broken — secrets missing)

`.github/workflows/deploy.yml` triggers on `Docker` workflow success on `master` and pushes to the VPS via SSH. Requires repo secrets:
- `VPS_HOST` (e.g. `agent.noral.ai`)
- `VPS_USER` (e.g. `root`)
- `VPS_SSH_KEY` (private ed25519, matching pubkey in `~/.ssh/authorized_keys` on VPS)
- Optional: `VPS_SSH_PORT`, `VPS_DEPLOY_DIR`, `PUBLIC_HEALTH_URL`, `GHCR_USERNAME`, `GHCR_READ_TOKEN`

**Until those secrets are set, auto-deploy fails at the pre-flight check.** Manual deploy works.

### Manual deploy (the canonical path right now)

```sh
ssh root@agent.noral.ai '/opt/noralos/deploy.sh'
```

The script (5 steps): `docker compose pull` → `docker compose up -d` → wait for `server` health → reload `deploy-proxy-1` nginx → curl `https://agent.noral.ai/api/health` and fail if non-200.

**Known warning during step 4:** the shared nginx proxy still references a deleted cert (`platform.noral.ai/fullchain.pem`) — non-fatal. Cleanup belongs in `/opt/noralagent/deploy/proxy/nginx.conf`, out of scope for most NoralOS work.

### Image pipeline

- `.github/workflows/docker.yml` builds + pushes `ghcr.io/noral-ai/noralos:latest` (and a `sha-<8>` tag).
- Both the api server and the plugins are built into one image. Plugin builds happen inside the Dockerfile via `pnpm --filter <pluginPackageName> build`.

## Plugin gotchas (silent prod failures)

When adding a new plugin under `packages/plugins/<name>/`:

1. **Add it to the Dockerfile.** The image's build stage has `pnpm --filter @noralos-plugins/<name> build` calls. Missing this means the plugin's `dist/` is empty, the host fails to load the manifest, and the server logs `Failed to install workspace <Name> plugin; server continuing without it` — but **doesn't crash**. Easy to miss.

2. **Manifest must `export default`.** The plugin loader does `mod.default ?? mod` when importing. Named-only export silently produces "no manifest found" — same silent-fail class. Pattern:
   ```ts
   export const manifest: NoralosPluginManifestV1 = { ... };
   export default manifest;
   ```

3. **Manifest validation is strict at install time.** Capability list must include the registrar capability for every UI slot type:
   - `sidebar` slot → `ui.sidebar.register`
   - `page` slot → `ui.page.register`
   - `detailTab` slot → `ui.detailTab.register` (AND `entityTypes: ["agent" | ...]` is required)
   - `settingsPage` → `ui.settingsPage.register`
   - …etc

4. **apiRoute `capability` field is narrow.** The route registration capability is always `"api.routes.register"`. Other capabilities (`agents.write`, `agent.tools.register`, etc.) are declared in the top-level `capabilities[]` array and gate tool dispatch / `ctx.*` access inside the worker, not the route registration itself.

5. **`PluginApiRequestInput` vs `PluginWebhookInput`:**
   - apiRoute handler `input.params` (path params) + `input.body` (parsed JSON)
   - webhook handler `input.parsedBody` (parsed JSON) + `input.query` (query string params) + `input.rawBody`

## Persistent state / secrets

- `/opt/noralos/docker-compose.yml` on the VPS sometimes diverges from this repo's `docker-compose.yml` (env passthroughs added over time, e.g. `CLAUDE_CODE_OAUTH_TOKEN`, `GOOGLE_CLIENT_ID`). **Diff before any wholesale replacement.**
- `NORALOS_SECRETS_MASTER_KEY_FILE` MUST point at a persistent volume (currently `/noralos/instances/default/secrets/master.key`). If the file isn't persistent, every container recreate generates a new key and silently corrupts every encrypted secret.

## Plugin worker debugging

- Worker logs come through the host's logger with `service: "plugin-worker"` and the plugin's `pluginId`. Use `docker logs noralos-server 2>&1 | grep <pluginKey>` on the VPS.
- Worker errors don't always crash the host — the host catches and continues. Look for `ERROR: Failed to install workspace …` for install failures and `service: "plugin-worker-manager"` for runtime crashes.

## Memory invariants (from past incidents)

These are codified rules from prior incidents. Do not relitigate them without a strong reason.

- **`master` is the canonical default branch** — both repos (NoralVoice's is `rebrand/noralvoice` until rebrand finalizes). Verify before pushing.
- **No telegram** — user dropped Telegram as a channel for Noral-OS. Don't propose it as an input adapter.
- **Conference Room + Dashboard chat** are the two surfaces, both already on the VPS.
- **Agent hierarchy gating:** voice access (the `noralvoice:*` tools) restricted to `director/manager/exec` tiers. Worker/specialist tiers are text-only.

## Consolidation work (active)

A multi-phase consolidation between NoralOS and NoralVoice is in flight. Binding docs:

```
docs/audit/
  consolidation-scope.md          ← binding scope
  consolidation-plan.md           ← phased plan
  overlap-map.md                  ← what overlaps
  integration-architecture.md     ← how they talk
  uiux-streamlining.md            ← UI consolidation
  open-questions.md               ← decided
  claude-code-prompt-phase-{0..4}.md  ← per-phase execution prompts
  claude-code-prompt-phases-0-to-3.md ← autonomous merge loop (0–3 done)
```

**State as of 2026-05-15:** Phases 0–3 merged and deployed (NV PRs #1, #3, #4 on `rebrand/noralvoice`; NoralOS PRs #83, #86, #87 on `master`, plus #88–92 follow-up fixes). Phase 4 prompt is ready.

**SDK publish deferred:** `@noralai/voice-sdk@0.2.0` is NOT on npm. The plugin installs it from a GitHub release tarball (`https://github.com/Noral-AI/NoralVoice/releases/download/sdks-v0.2.0-prerelease/noralai-voice-sdk-0.2.0.tgz`). Swap the package.json dep to a normal semver range once the user publishes to npm at the end of consolidation.

## When in doubt

- Read `docs/audit/consolidation-scope.md` for binding rules.
- Search `/Users/quentin/.claude/projects/-Users-quentin-Documents-NORALAI-NORALOS/memory/` for prior incident notes.
- The `feedback_*` memory entries are codified rules from past mistakes — respect them.
