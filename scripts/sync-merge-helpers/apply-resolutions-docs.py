"""Batch docs/scripts."""
import re
from pathlib import Path

ID_RENAMES = {
    "@paperclipai/": "@noralos/",
    "stringifyPaperclipWakePayload": "stringifyNoralosWakePayload",
    "normalizePaperclipWakePayload": "normalizeNoralosWakePayload",
    "readPaperclipIssueWorkModeFromContext": "readNoralosIssueWorkModeFromContext",
    "ensurePaperclipSkillSymlink": "ensureNoralosSkillSymlink",
    "PaperclipSkillEntry": "NoralosSkillEntry",
    "readPaperclipRuntimeSkillEntries": "readNoralosRuntimeSkillEntries",
    "resolvePaperclipDesiredSkillNames": "resolveNoralosDesiredSkillNames",
    "readPaperclipSkillSyncPreference": "readNoralosSkillSyncPreference",
    "writePaperclipSkillSyncPreference": "writeNoralosSkillSyncPreference",
    "refreshPaperclipWorkspaceEnvForExecution": "refreshNoralosWorkspaceEnvForExecution",
    "applyPaperclipWorkspaceEnv": "applyNoralosWorkspaceEnv",
}

def brand_norm(text):
    for old, new in ID_RENAMES.items():
        text = text.replace(old, new)
    # Brand prose - only some
    text = re.sub(r"\bPaperclip(?! App\b)", "NoralOS", text)
    text = text.replace("Paperclip App", "NoralOS App")
    text = re.sub(r"\bpaperclipai\b", "noralos", text)
    # Env vars
    text = text.replace("PAPERCLIP_HOME", "NORALOS_HOME")
    text = text.replace("PAPERCLIP_INSTANCE_ID", "NORALOS_INSTANCE_ID")
    return text

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)
# Also handle marker variants with filename hints (e.g., <<<<<<< v2026.525.0:skills/paperclip-create-plugin/SKILL.md)
pattern_alt = re.compile(r'<<<<<<< v2026\.525\.0:[^\n]*\n(.*?)=======\n(.*?)>>>>>>> master:[^\n]*\n', re.DOTALL)

upstream_with_brand = [
    "./doc/execution-semantics.md",  # take upstream's detail + rename
    "./skills/terminal-bench-loop/SKILL.md",  # take upstream content + rename
    "./packages/db/src/backup-lib.ts",  # take upstream (security)
]

fork_wins_files = [
    "./doc/plugins/PLUGIN_AUTHORING_GUIDE.md",
    "./skills/noralos-create-plugin/SKILL.md",
    "./packages/plugins/sdk/README.md",
    "./scripts/run-vitest-stable.mjs",
]

for fp in upstream_with_brand:
    p = Path(fp)
    if not p.exists():
        continue
    content = p.read_text(encoding='utf-8')
    def take_u(m): return brand_norm(m.group(1))
    new = pattern.sub(take_u, content)
    new = pattern_alt.sub(take_u, new)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  upstream+brand→{fp}")

for fp in fork_wins_files:
    p = Path(fp)
    if not p.exists():
        continue
    content = p.read_text(encoding='utf-8')
    def take_f(m): return m.group(2)
    new = pattern.sub(take_f, content)
    new = pattern_alt.sub(take_f, new)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  fork→{fp}")
