"""Batch 10: more server files."""
import re
from pathlib import Path

ENV_VAR_RENAMES = [
    "PAPERCLIP_API_URL", "PAPERCLIP_API_BRIDGE_MODE", "PAPERCLIP_WORKSPACE_CWD",
    "PAPERCLIP_WORKSPACE_WORKTREE_PATH", "PAPERCLIP_WORKSPACES_JSON",
    "PAPERCLIP_AGENT_JWT_SECRET", "PAPERCLIP_HOME", "PAPERCLIP_INSTANCE_ID",
    "PAPERCLIP_WAKE_PAYLOAD_JSON", "PAPERCLIP_TEST_CAPTURE_PATH",
    "PAPERCLIP_TEST_STDIN", "PAPERCLIP_RESOLVED_COMMAND", "PAPERCLIP_PUBLIC_URL",
    "PAPERCLIP_WAKE_REASON", "PAPERCLIP_WAKE_COMMENT_ID", "PAPERCLIP_TASK_ID",
    "PAPERCLIP_APPROVAL_ID", "PAPERCLIP_APPROVAL_STATUS", "PAPERCLIP_LINKED_ISSUE_IDS",
    "PAPERCLIP_ISSUE_WORK_MODE", "PAPERCLIP_API_KEY",
]

# Specific identifier renames (Paperclip → Noralos): the ones that ARE renamed in adapter-utils
ID_RENAMES = {
    "PaperclipPluginManifestV1": "NoralosPluginManifestV1",
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
    "PaperclipBridgeRegistry": "PluginBridgeRegistry",  # leave for now
    "paperclipWake": "noralosWake",  # property/variable
    "paperclipApiUrl": "noralosApiUrl",  # property/variable
    "@paperclipai/": "@noralos/",
    "PAPERCLIP_": "NORALOS_",  # env var prefix (general)
}

# Brand rename a piece of text (used when taking upstream side)
def brand_norm(text):
    # specific identifier renames
    for old, new in ID_RENAMES.items():
        text = text.replace(old, new)
    # Brand prose "Paperclip" → "NoralOS"
    text = re.sub(r"\bPaperclip\b", "NoralOS", text)
    return text

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

# Files where upstream wins (additive, brand rename applied)
upstream_wins = [
    "./server/src/routes/costs.ts",
    "./server/src/services/plugin-host-services.ts",
    "./server/src/__tests__/issues-service.test.ts",
    "./server/src/routes/issues.ts",  # UNION via upstream having additive imports + fork's authz
    "./packages/db/src/migrations/meta/0075_snapshot.json",  # migration JSON; take fork
]

# Files where fork wins
fork_wins = [
    "./server/src/services/company-portability.ts",  # uses canonical noralos helper names
    "./server/src/services/plugin-database.ts",  # simpler signatures fork maintains
    "./packages/db/src/migrations/meta/0075_snapshot.json",  # actually fork
]

# Override: 0075_snapshot.json is fork
upstream_wins = [f for f in upstream_wins if "0075_snapshot" not in f]

for fp in upstream_wins:
    p = Path(fp)
    if not p.exists():
        continue
    content = p.read_text(encoding='utf-8')
    def take(m): return brand_norm(m.group(1))
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  upstream+brand→{fp}")

for fp in fork_wins:
    p = Path(fp)
    if not p.exists():
        continue
    content = p.read_text(encoding='utf-8')
    def take(m): return m.group(2)
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  fork→{fp}")
