"""Adapter helper files: take upstream side, apply specific identifier renames."""
import re
from pathlib import Path

ENV_RENAMES = {
    "PAPERCLIP_": "NORALOS_",
}

ID_RENAMES_NORALOS = {
    "stringifyPaperclipWakePayload": "stringifyNoralosWakePayload",
    "normalizePaperclipWakePayload": "normalizeNoralosWakePayload",
    "renderPaperclipWakePrompt": "renderNoralosWakePrompt",
    "readPaperclipIssueWorkModeFromContext": "readNoralosIssueWorkModeFromContext",
    "ensurePaperclipSkillSymlink": "ensureNoralosSkillSymlink",
    "PaperclipSkillEntry": "NoralosSkillEntry",
    "readPaperclipRuntimeSkillEntries": "readNoralosRuntimeSkillEntries",
    "resolvePaperclipDesiredSkillNames": "resolveNoralosDesiredSkillNames",
    "readPaperclipSkillSyncPreference": "readNoralosSkillSyncPreference",
    "writePaperclipSkillSyncPreference": "writeNoralosSkillSyncPreference",
    "refreshPaperclipWorkspaceEnvForExecution": "refreshNoralosWorkspaceEnvForExecution",
    "applyPaperclipWorkspaceEnv": "applyNoralosWorkspaceEnv",
    "shapePaperclipWorkspaceEnvForExecution": "shapeNoralosWorkspaceEnvForExecution",
    "buildPaperclipEnv": "buildNoralosEnv",
    "sanitizeInheritedPaperclipEnv": "sanitizeInheritedNoralosEnv",
    "PaperclipWakePayload": "NoralosWakePayload",
    "context.paperclipWake": "context.noralosWake",
    "input.paperclipWake": "input.noralosWake",
    "@paperclipai/": "@noralos/",
}

# Stay paperclip-named (don't rename):
# - resolvePaperclipInstanceRootForAdapter (exists in noralos shared)
# - DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE (exists in noralos shared)
# - paperclipBridge (variable name)
# - startAdapterExecutionTargetPaperclipBridge (function name)
# - materializePaperclipSkillCopy / MaterializedPaperclipSkillCopyResult

def transform_upstream(text):
    for old, new in ID_RENAMES_NORALOS.items():
        text = text.replace(old, new)
    # Env var prefix
    text = text.replace("PAPERCLIP_", "NORALOS_")
    return text

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

# Take upstream side + rename: applies to many adapter files
files = [
    "./packages/adapters/claude-local/src/server/claude-config.ts",
    "./packages/adapters/claude-local/src/server/prompt-cache.ts",
    "./packages/adapters/codex-local/src/server/execute.ts",
    "./packages/adapters/codex-local/src/server/test.ts",
    "./packages/adapters/cursor-local/src/server/execute.ts",
    "./packages/adapters/cursor-local/src/server/remote-command.ts",
    "./packages/adapters/gemini-local/src/server/execute.ts",
    "./packages/adapters/opencode-local/src/server/execute.ts",
    "./packages/adapters/opencode-local/src/server/test.ts",
    "./packages/adapters/pi-local/src/server/execute.ts",
    "./packages/adapters/claude-local/src/server/execute.ts",
    "./packages/adapter-utils/src/ssh.ts",
]

for fp in files:
    p = Path(fp)
    if not p.exists():
        print(f"  SKIP missing: {fp}")
        continue
    content = p.read_text(encoding='utf-8')
    def take(m): return transform_upstream(m.group(1))
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  ✓ {fp}")
    else:
        print(f"  - {fp} (no change)")
