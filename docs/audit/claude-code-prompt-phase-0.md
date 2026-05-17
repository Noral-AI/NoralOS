# Claude Code Prompt — Phase 0: Foundation (NoralVoice)

Copy-paste everything below the `---` line into a fresh Claude Code session, run inside `/Users/quentin/Documents/NORALAI/NoralVoice`.

When the resulting PR merges and smoke passes, come back and ask for the Phase 1 prompt.

---

You are working on the **NoralVoice** repo at `/Users/quentin/Documents/NORALAI/NoralVoice`.

- Origin: `github.com/Noral-AI/NoralVoice`
- Base branch for your PR: `rebrand/noralvoice`
- Working branch you will create: `chore/phase-0-foundation`

## Context

A consolidation audit and binding plan live in the **NoralOS** repo at:

```
/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/docs/audit/
  overlap-map.md
  integration-architecture.md
  uiux-streamlining.md
  consolidation-scope.md       ← binding scope (read first)
  consolidation-plan.md        ← binding plan (read second)
  open-questions.md            ← answered; here for reference
  migration-plan.md            ← superseded by consolidation-plan.md
```

**Before you start, read these three files in order:**
1. `consolidation-scope.md` — goal, pillars, hard constraints
2. `consolidation-plan.md` Phase 0 section — your deliverables
3. `NoralVoice/CLAUDE.md` — repo-specific conventions

## Your task: Phase 0 — Foundation

Goal: tidy NoralVoice so the rest of the consolidation has a clean substrate. This phase is **NoralVoice-only**. Do not touch the NoralOS repo.

### Deliverables

#### D1. Brand-tokens module

Create the module in two places, both reading from env at runtime:

**`ui/src/lib/brand.ts`** — exports:
```ts
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "NoralVoice",
  productLine: process.env.NEXT_PUBLIC_BRAND_PRODUCT_LINE ?? "NoralVoice",
  parentBrand: process.env.NEXT_PUBLIC_PARENT_BRAND ?? "Noral AI",
  widgetGlobalName: process.env.NEXT_PUBLIC_WIDGET_GLOBAL ?? "NoralVoiceWidget",
  cookiePrefix: process.env.NEXT_PUBLIC_COOKIE_PREFIX ?? "noralvoice",
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.noral.ai/voice",
  domain: process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? "voice.noral.ai",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@noral.ai",
} as const;
```

**`api/constants.py`** — mirror the same fields, reading from `os.getenv`. Add a `BRAND` namedtuple/dataclass.

**Do not change any callsites yet.** This phase only adds the module. Phase 5 changes callsites. Adding a unit test that proves env overrides work is required.

#### D2. Multi-head Alembic merge

Three heads exist today: `6499c608d0f6_add_campaign_logs_column`, `cdcf9f65913b_add_workflow_uuid`, `f2e1d0c9b8a7_add_plivo_mode`.

Create a merge migration in `api/alembic/versions/` named with today's date + `_merge_three_heads.py`. The migration's `down_revision` is a tuple of the three head IDs. `upgrade()` and `downgrade()` should be `pass` — this is purely a graph merge.

Verify `alembic heads` after the merge returns exactly one head. Verify `alembic upgrade head` (singular, no `s`) succeeds on a fresh DB.

In the migration's module docstring, document which paths users may be coming from and that this merge is safe regardless.

#### D3. CORS pinning

Current state: `api/app.py:88` has `allow_origins=["*"]` + `allow_credentials=True`. Most browsers reject this combo; it also isn't safe.

Change to env-driven allow-list:
- Read `CORS_ALLOWED_ORIGINS` (comma-separated string, e.g. `"http://localhost:3000,http://localhost:8000"`)
- Default in dev: `http://localhost:3000,http://localhost:8000`
- Production `deploy/noral/.env` (or wherever the prod env lives — find it): set to the prod NoralVoice + NoralOS origins
- Keep `allow_credentials=True`
- Keep `allow_methods` and `allow_headers` as they are

Add a test that hits an OPTIONS preflight from a non-allow-listed origin and confirms 400/403.

#### D4. `agent_stream` WS auth

Current state: `api/routes/agent_stream.py:31` — `WS /api/v1/agent-stream/{workflow_uuid}` is authenticated only by knowing the workflow UUID. UUIDs leak in exported React-Flow JSON.

Change:
- Require `?api_key=<value>` query param on the WS upgrade
- Validate via the existing API key auth dependency (look for `_handle_api_key_auth` in `api/services/auth/depends.py`)
- Reject with 401 on missing or invalid key (close code 4401)
- Find every caller of `agent-stream` in `ui/` via grep and update them to append the api_key param (the user's API key is already available client-side via the same auth context the rest of the UI uses)
- Add a test for the auth gate

#### D5. Smoke

After D1–D4 merge in your working branch, run the standalone smoke. Document in the PR body:

- [ ] `docker-compose -f docker-compose-local.yaml up -d` succeeds
- [ ] `alembic upgrade head` (singular) on a fresh DB completes
- [ ] Fresh signup flow works
- [ ] A new workflow can be created via UI
- [ ] A test call can be placed against a configured telephony provider
- [ ] OPTIONS preflight from `http://evil.example.com` is rejected
- [ ] WS `/api/v1/agent-stream/<any-uuid>` without `api_key` returns 401

If a smoke step fails for a non-Phase-0 reason (e.g. a flaky existing test), note it in the PR but don't try to fix it here.

### Branching & PR

- Branch from `rebrand/noralvoice`
- Name: `chore/phase-0-foundation`
- Commit per deliverable (D1, D2, D3, D4) is preferred over one giant commit
- One PR is fine. If you split, link them as dependent PRs.
- PR title: `chore(phase-0): foundation — brand tokens, alembic merge, CORS pin, agent_stream auth`
- PR body: include the smoke checklist with results

### Anti-goals (do NOT do in this phase)

- Do NOT change any `"Dograh"` literals at callsites — only add the brand-tokens module. Phase 5 does the purge.
- Do NOT touch the NoralOS repo at `/Users/quentin/Documents/NORALAI/NORALOS/`.
- Do NOT publish a new SDK version. Phase 1 does the SDK rename.
- Do NOT add new product surfaces or new endpoints beyond D1–D4.
- Do NOT merge in-flight feature work from other branches.
- Do NOT remove or modify the multi-head Alembic migrations themselves — only add the merge migration on top.
- Do NOT change Pipecat submodule or any external dependency versions.

### Stop and report back if

- Smoke fails and the root cause isn't obvious within ~30 minutes of investigation
- A deliverable requires changing more than ~200 lines outside the listed files
- You discover Phase 0 work has already been started on another branch (search remote branches before starting)
- The brand-tokens defaults conflict with values already in `.env.example` — surface the conflict, don't silently override

### Definition of done

Use this as your PR review checklist:

- [ ] `ui/src/lib/brand.ts` and `api/constants.py` exist with the fields above; both env-overridable; unit tests pass; **zero callsites changed**
- [ ] `alembic heads` returns exactly one head; `alembic upgrade head` (singular) succeeds; merge migration documented
- [ ] CORS rejects a preflight from an origin not in the allow-list
- [ ] WS `agent_stream` returns 401 (close code 4401) without `?api_key=`
- [ ] Smoke checklist results posted in PR body
- [ ] `npm run typecheck` (or equivalent for this repo — check `package.json` scripts) passes
- [ ] `python -m pytest` for the API layer passes
- [ ] No changes outside NoralVoice repo

### When you finish

Reply with:
1. PR URL
2. Smoke results (pass/fail per item)
3. Anything you punted on or surfaced as an issue for Phase 1 to know about

Do not start Phase 1. Wait for the next prompt.
