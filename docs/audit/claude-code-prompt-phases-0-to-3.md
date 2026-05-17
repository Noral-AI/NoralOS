You are driving phases 0 through 3 of the NoralOS ↔ NoralVoice consolidation **autonomously**, including PR merges, SDK publishes, prod deploys, and smoke validation between every phase. No human approval between phases — only at the end, or on hard failure.

## Prerequisites (verify once before starting; abort if any are missing)

- `gh auth status` is logged in with write access to `Noral-AI/NoralVoice` and `Noral-AI/NoralOS`
- `npm whoami` resolves with publish access to the `@noralai` scope (and `@dograh` for the deprecated alias)
- `twine --version` works and PyPI credentials are configured (`~/.pypirc` or `TWINE_USERNAME` + `TWINE_PASSWORD`)
- SSH access to `agent.noral.ai` and `voice.noral.ai` per each repo's deploy docs
- Baseline standalone smoke is currently green: `curl https://voice.noral.ai/api/v1/health` returns ok

If anything is missing, stop and report exactly what's missing. Do not start the sequence.

## Binding context (read first)

```
docs/audit/
  consolidation-scope.md
  consolidation-plan.md
  claude-code-prompt-phase-0.md
  claude-code-prompt-phase-1.md
  claude-code-prompt-phase-2.md
  claude-code-prompt-phase-3.md
```

Each phase prompt is self-contained. You execute each one in full, then merge, publish (if applicable), deploy, smoke, and proceed to the next without pausing.

## Cardinal rule

`voice.noral.ai` standalone must pass smoke at the end of every phase. **If a smoke fails, roll back that phase's merge and abort the entire sequence.** Do not proceed.

Rollback paths:
- Phase 0: revert merge on `rebrand/noralvoice`; redeploy NoralVoice
- Phase 1 PR-A: revert merge; publish `0.2.1` of both SDK packages reverted to 0.1.5 source with a "rolled back" notice (npm/PyPI don't allow unpublishing reliably after the grace window)
- Phase 1 PR-B: revert merge on NoralOS `master`; redeploy; auto-register service handles uninstall
- Phase 2: revert merge; redeploy NoralOS
- Phase 3: revert merge; redeploy NoralOS; unset `migrated_to_noralvoice_at` on touched `agent_voice_config` rows

## Execution sequence

### Step 1 — Phase 0

1. `cd /Users/quentin/Documents/NORALAI/NoralVoice`
2. Read `/Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical/docs/audit/claude-code-prompt-phase-0.md`
3. Execute Phase 0 in full per its prompt — branch, deliverables D1–D4, smoke D5
4. Open the PR via `gh pr create` with the smoke results in the body
5. Wait for CI green (poll `gh pr checks --watch` until pass or fail; on fail, treat as smoke-fail and roll back)
6. Merge: `gh pr merge --squash --delete-branch` (use `--merge` if the repo convention is non-squash; check existing PRs first)
7. Pull `rebrand/noralvoice`; deploy NoralVoice to prod per the repo's standard deploy path (`deploy/noral/README.md` or equivalent)
8. Prod smoke: confirm CORS rejects an arbitrary origin, agent_stream WS returns 401 without `?api_key=`, `alembic upgrade head` is at the merge revision
9. Log `[PHASE 0] merged: <url> | deploy: ok | prod smoke: ok` to stdout
10. Proceed immediately to Step 2

### Step 2 — Phase 1 PR-A

1. Stay in `/Users/quentin/Documents/NORALAI/NoralVoice`
2. Read `claude-code-prompt-phase-1.md` (PR-A section only)
3. Execute PR-A in full
4. Open PR with A6 smoke results
5. Wait for CI green
6. Merge
7. **Publish SDKs immediately after merge** (the Phase 1 prompt's "do not publish" anti-goal applies only during PR; merge step lifts it):
   - `cd sdk/typescript && npm publish` for `@noralai/voice-sdk@0.2.0`
   - `npm publish` for the deprecated `@dograh/sdk@0.2.0` alias
   - `cd sdk/python && python -m build && twine upload dist/*` for `noralai-voice==0.2.0`
   - `python -m build && twine upload dist/*` for `dograh-sdk==0.2.0` alias
8. Verify: `npm view @noralai/voice-sdk@0.2.0 version` returns `0.2.0`; `pip index versions noralai-voice` lists `0.2.0`
9. Deploy NoralVoice to prod so the new `embed/exchange-token` + `integration-webhooks` endpoints are live (PR-B depends on them)
10. Prod smoke: POST `voice.noral.ai/api/v1/integration-webhooks` with a dummy callback; verify it persists
11. Log result; proceed to Step 3

### Step 3 — Phase 1 PR-B

1. `cd /Users/quentin/Documents/NORALAI/NORALOS/NoralOS-canonical`
2. Read `claude-code-prompt-phase-1.md` (PR-B section)
3. Execute PR-B in full
4. **Add the new plugin to the Dockerfile's `pnpm --filter ... build` list** (mandatory per `feedback_noralos_plugin_gotchas` — silent failure in prod if missed)
5. Verify `pnpm install` resolves `@noralai/voice-sdk@^0.2.0` from npm (not a workspace fallback)
6. Open PR with B13 smoke results
7. Wait for CI green
8. Merge
9. Deploy NoralOS to prod (`agent.noral.ai`)
10. After deploy: verify auto-register installed the plugin (`select * from plugins where id = 'noralai.noralvoice'`)
11. Prod smoke: on a real prod company, configure the NoralVoice apiKeyRef by editing `plugin_config.config_json` (Phase 2 fixes this), create a Voice Director from the plugin page, place a test call via `noralvoice:run_call`, verify the webhook fires and `noralai.noralvoice.run.completed` event emits on the bus
12. Log result; proceed to Step 4

### Step 4 — Phase 2

1. Stay in NoralOS-canonical
2. Read `claude-code-prompt-phase-2.md`
3. Execute Phase 2 in full
4. Open PR with D8 smoke
5. Wait for CI green
6. Merge
7. Deploy NoralOS to prod
8. Prod smoke: the existing prod company's manually-edited NoralVoice credential now appears in `/company/settings/integrations`; edit via UI; verify the apiKeyRef shallow-merges into plugin config and the plugin reads it correctly
9. Log result; proceed to Step 5

### Step 5 — Phase 3

1. Stay in NoralOS-canonical
2. Read `claude-code-prompt-phase-3.md`
3. Execute Phase 3 in full
4. **Dry-run the data migration script against a prod-data snapshot first** — flag any rows that would fail before opening the PR; if non-trivial failures exist, abort and report
5. Open PR with D8 smoke + dry-run outcome
6. Wait for CI green
7. Merge
8. Deploy NoralOS to prod (deploy runs `pnpm db:migrate` adding the `voice_agent_uuid` column)
9. **Run the migration script for real on prod:** `pnpm tsx server/scripts/migrate-voice-config-to-noralvoice.ts`
10. Prod smoke: open an Agent detail page on `agent.noral.ai`, verify the Voice settings tab works end-to-end, change a voice, confirm NV reflects the change, confirm voice-config legacy reader (Conference Room) still works
11. Log result; proceed to final report

## Per-phase log line (after each prod smoke passes)

```
[PHASE X] merged: <PR URL> | published: <pkg@ver list or n/a> | deploy: ok | prod smoke: ok
```

## End-of-run report (only after all five steps green)

```
All four phases merged and validated on prod.

Phase 0:        <PR URL>
Phase 1 PR-A:   <PR URL>  Published: @noralai/voice-sdk@0.2.0, noralai-voice==0.2.0 (and deprecated aliases)
Phase 1 PR-B:   <PR URL>
Phase 2:        <PR URL>
Phase 3:        <PR URL>  Migration: <X migrated / Y skipped / Z failed>

End-to-end smoke:
- voice.noral.ai standalone (signup → workflow → call): ok
- agent.noral.ai Voice Director calls list_workflows against prod NV: ok
- agent.noral.ai voice settings tab change reflected in NV: ok
- conference-room-bridge legacy reader still works: ok

Issues that surfaced (not blocking):
<list, or "none">

Next: Phase 4 prompt.
```

## Hard stops (only these abort the sequence)

- Standalone NoralVoice smoke fails → roll back current phase; abort
- SDK publish fails on either registry → roll back Phase 1 PR-A; abort
- Prod deploy fails (container won't start, migration won't apply) → roll back; abort
- CI fails on a PR and you can't reasonably fix in two retry attempts → abort
- `gh` / `npm` / `twine` / SSH credential failure → abort, report missing prereq

For non-fatal issues (slow but eventually-green smoke, transient network errors, deprecation warnings during build), keep going and note in the end-of-run report.

## Anti-goals

- Do NOT pause for human approval between phases
- Do NOT batch multiple phases into one PR
- Do NOT skip the standalone NoralVoice smoke after any phase
- Do NOT skip the Dockerfile `pnpm --filter` addition in PR-B (silent prod failure)
- Do NOT start Phase 4 in this run — stop after Phase 3 validates
- Do NOT modify rollback paths in a way that loosens the standalone-NoralVoice guarantee
