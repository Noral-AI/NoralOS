"""Batch 9: test files."""
import re
from pathlib import Path

# Strategy:
# Fork-wins (test exercises fork-specific behavior)
fork_wins_files = [
    "./cli/src/__tests__/home-paths.test.ts",
    "./server/src/__tests__/better-auth.test.ts",
    "./server/src/__tests__/invite-onboarding-text.test.ts",
    "./cli/src/config/home.ts",  # Source file but fork has standalone impl
]

# Upstream-wins (additive features) with brand renames
upstream_wins_files = [
    "./packages/adapter-utils/src/ssh-fixture.test.ts",  # Take upstream (more setup) + Paperclip → NoralOS
    "./packages/adapter-utils/src/execution-target-sandbox.test.ts",  # bash handling
    "./packages/adapter-utils/src/sandbox-callback-bridge.test.ts",  # more imports + bash
]

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

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

# Pretty conservative — only rename brand strings inside conflict-taken blocks.
# Don't rename existing file content outside conflicts.
def upstream_brand_norm(text):
    for v in ENV_VAR_RENAMES:
        text = text.replace(v, v.replace("PAPERCLIP_", "NORALOS_"))
    text = text.replace("@paperclipai/", "@noralos/")
    text = re.sub(r"\bPaperclip\b", "NoralOS", text)
    text = re.sub(r"paperclipApiUrl\b", "noralosApiUrl", text)
    return text

for fp in fork_wins_files:
    p = Path(fp)
    content = p.read_text(encoding='utf-8')
    def take(m): return m.group(2)
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  fork→{fp}")

for fp in upstream_wins_files:
    p = Path(fp)
    content = p.read_text(encoding='utf-8')
    def take(m): return upstream_brand_norm(m.group(1))
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  upstream+rename→{fp}")
