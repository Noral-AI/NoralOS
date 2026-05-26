# sync-merge-helpers

Scripts used during the paperclip → noralos sync at `v2026.525.0`. They live here so they survive `/tmp` reboots in case the merge is resumed.

## Scripts

- **`classify-conflicts.py`** — Classify each conflicted file as brand-only vs substantive. Writes `/tmp/conflicts-brand-only.txt` and `/tmp/conflicts-substantive.txt`.
- **`resolve-brand-only-blocks.py`** — Auto-resolve pure brand-rename blocks (paperclip ↔ noralos) to fork-wins.
- **`resolve-additive-blocks.py`** — Auto-resolve blocks where one side is a line-subset of the other after brand-normalizing. Takes the superset side.
- **`resolve-execute-remote-tests.py`** — Take upstream side of `execute.remote.test.ts` across adapter packages + rename PAPERCLIP_* env vars to NORALOS_*.
- **`apply-resolutions-*.py`** — Per-batch resolution scripts with explicit (file, old_text, new_text) tuples for the cases that needed individual judgment.

## Re-usable patterns

If a future sync needs the same machinery:

1. Run `classify-conflicts.py` first to bucket files.
2. Run `resolve-brand-only-blocks.py` for the trivial brand-rename blocks (fork-wins).
3. Run `resolve-additive-blocks.py` for the cases where one side is a strict subset of the other.
4. Manually inspect what's left — most will be true semantic conflicts.

## Identifier renames (paperclip → noralos)

These identifiers were renamed in `@noralos/adapter-utils` and need brand-substitution when taking upstream side:

- `stringifyPaperclipWakePayload` → `stringifyNoralosWakePayload`
- `normalizePaperclipWakePayload` → `normalizeNoralosWakePayload`
- `readPaperclipIssueWorkModeFromContext` → `readNoralosIssueWorkModeFromContext`
- `ensurePaperclipSkillSymlink` → `ensureNoralosSkillSymlink`
- `PaperclipSkillEntry` → `NoralosSkillEntry`
- `readPaperclipRuntimeSkillEntries` → `readNoralosRuntimeSkillEntries`
- `resolvePaperclipDesiredSkillNames` → `resolveNoralosDesiredSkillNames`
- `readPaperclipSkillSyncPreference` → `readNoralosSkillSyncPreference`
- `writePaperclipSkillSyncPreference` → `writeNoralosSkillSyncPreference`
- `refreshPaperclipWorkspaceEnvForExecution` → `refreshNoralosWorkspaceEnvForExecution`
- `applyPaperclipWorkspaceEnv` → `applyNoralosWorkspaceEnv`
- `shapePaperclipWorkspaceEnvForExecution` → `shapeNoralosWorkspaceEnvForExecution`
- `buildPaperclipEnv` → `buildNoralosEnv`
- `sanitizeInheritedPaperclipEnv` → `sanitizeInheritedNoralosEnv`
- `PaperclipWakePayload` → `NoralosWakePayload`
- `PaperclipPluginManifestV1` → `NoralosPluginManifestV1`
- `paperclipWake` (property) → `noralosWake`
- `paperclipApiUrl` (property) → `noralosApiUrl`
- `@paperclipai/` → `@noralos/`
- `PAPERCLIP_*` env vars → `NORALOS_*`

These STAY paperclip-named (not renamed in the codebase):

- `resolvePaperclipInstanceRootForAdapter`
- `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`
- `paperclipBridge` (variable name)
- `startAdapterExecutionTargetPaperclipBridge`
- `materializePaperclipSkillCopy`
- `MaterializedPaperclipSkillCopyResult`
- `.paperclip-runtime/` (filesystem path)
