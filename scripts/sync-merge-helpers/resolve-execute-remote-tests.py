"""
Take upstream side of execute.remote.test.ts conflicts across adapter packages,
then brand-rename env var names to NORALOS_* (production code uses these).
Leave .paperclip-runtime and paperclipBridge variable names as-is.
"""
import re
from pathlib import Path

# Specific env var rename — only these particular names
ENV_VAR_RENAMES = [
    "PAPERCLIP_API_URL",
    "PAPERCLIP_API_BRIDGE_MODE",
    "PAPERCLIP_WORKSPACE_CWD",
    "PAPERCLIP_WORKSPACE_WORKTREE_PATH",
    "PAPERCLIP_WORKSPACES_JSON",
    "PAPERCLIP_AGENT_JWT_SECRET",
    "PAPERCLIP_HOME",
    "PAPERCLIP_INSTANCE_ID",
    "PAPERCLIP_WAKE_PAYLOAD_JSON",
    "PAPERCLIP_TEST_CAPTURE_PATH",
    "PAPERCLIP_TEST_STDIN",
    "PAPERCLIP_RESOLVED_COMMAND",
    "PAPERCLIP_PUBLIC_URL",
]

files = [
    "./packages/adapters/claude-local/src/server/execute.remote.test.ts",
    "./packages/adapters/cursor-local/src/server/execute.remote.test.ts",
    "./packages/adapters/gemini-local/src/server/execute.remote.test.ts",
    "./packages/adapters/opencode-local/src/server/execute.remote.test.ts",
    "./packages/adapters/pi-local/src/server/execute.remote.test.ts",
]

# Pattern to match a conflict block and capture the upstream side
# <<<<<<< v2026.525.0\n<upstream>=======\n<fork>>>>>>>> master\n
pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

total_blocks = 0
files_changed = 0

for fp in files:
    p = Path(fp)
    try:
        content = p.read_text(encoding='utf-8')
    except Exception as e:
        print(f"SKIP {fp}: {e}")
        continue

    blocks_in_file = [0]
    def take_upstream(match):
        blocks_in_file[0] += 1
        return match.group(1)
    new_content = pattern.sub(take_upstream, content)
    blocks_in_file = blocks_in_file[0]

    # Apply env var brand renames
    for varname in ENV_VAR_RENAMES:
        new_varname = varname.replace("PAPERCLIP_", "NORALOS_")
        new_content = new_content.replace(varname, new_varname)

    # Also rename "@paperclipai/" → "@noralos/" (package imports)
    new_content = new_content.replace("@paperclipai/", "@noralos/")

    if new_content != content:
        p.write_text(new_content, encoding='utf-8')
        files_changed += 1
        total_blocks += blocks_in_file
        print(f"  ✓ {fp}: {blocks_in_file} blocks resolved")
    else:
        print(f"  ! {fp}: no changes")

print(f"\n=== {total_blocks} blocks across {files_changed} files ===")
