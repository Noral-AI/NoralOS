"""Final resolutions for remaining UI/test files."""
import re
from pathlib import Path

ID_RENAMES = {
    "@paperclipai/": "@noralos/",
    "stringifyPaperclipWakePayload": "stringifyNoralosWakePayload",
    "normalizePaperclipWakePayload": "normalizeNoralosWakePayload",
    "readPaperclipIssueWorkModeFromContext": "readNoralosIssueWorkModeFromContext",
    "ensurePaperclipSkillSymlink": "ensureNoralosSkillSymlink",
    "PaperclipSkillEntry": "NoralosSkillEntry",
    "PaperclipPluginManifestV1": "NoralosPluginManifestV1",
    "PaperclipWakePayload": "NoralosWakePayload",
    "context.paperclipWake": "context.noralosWake",
    "input.paperclipWake": "input.noralosWake",
    "paperclipApiUrl": "noralosApiUrl",
    "PAPERCLIP_": "NORALOS_",
}

def transform_upstream(text):
    for old, new in ID_RENAMES.items():
        text = text.replace(old, new)
    return text

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

# Files where take upstream side wholesale (additive feature evolution)
upstream_files = [
    "./ui/src/components/MarkdownEditor.test.tsx",
    "./ui/src/pages/PluginSettings.test.tsx",
    "./ui/src/pages/CompanyInvites.test.tsx",
    "./server/src/__tests__/claude-local-execute.test.ts",
    "./server/src/__tests__/costs-service.test.ts",
    "./server/src/__tests__/environment-execution-target.test.ts",
    "./server/src/services/heartbeat.ts",
    "./server/src/services/costs.ts",
    "./server/src/services/issues.ts",
    "./server/src/services/secrets.ts",
    "./packages/plugins/sandbox-providers/e2b/src/plugin.ts",
    "./packages/plugins/sandbox-providers/e2b/src/plugin.test.ts",
    "./packages/adapter-utils/src/execution-target.ts",
    "./packages/adapter-utils/src/sandbox-callback-bridge.ts",
    "./server/src/auth/better-auth.ts",
    "./server/src/routes/access.ts",
    "./server/src/routes/agents.ts",
    "./scripts/verify-release-registry-state.test.mjs",
    "./scripts/verify-release-registry-state.mjs",
]

# For NewIssueDialog: special handling (take upstream + keep MicDictationButton)
def handle_new_issue_dialog():
    p = Path("./ui/src/components/NewIssueDialog.tsx")
    content = p.read_text(encoding='utf-8')
    # First conflict: UNION imports — keep both CSSProperties AND MicDictationButton
    content = content.replace(
        '''<<<<<<< v2026.525.0
import { memo, useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type CSSProperties, type DragEvent, type RefObject } from "react";
=======
import { memo, useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type DragEvent, type RefObject } from "react";
import { MicDictationButton } from "./MicDictationButton";
>>>>>>> master''',
        '''import { memo, useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type CSSProperties, type DragEvent, type RefObject } from "react";
import { MicDictationButton } from "./MicDictationButton";''')
    # Remaining conflicts: take upstream
    def take_u(m): return transform_upstream(m.group(1))
    content = pattern.sub(take_u, content)
    p.write_text(content, encoding='utf-8')
    print("  ✓ ./ui/src/components/NewIssueDialog.tsx")

handle_new_issue_dialog()

for fp in upstream_files:
    p = Path(fp)
    if not p.exists():
        print(f"  SKIP missing: {fp}")
        continue
    content = p.read_text(encoding='utf-8')
    def take(m): return transform_upstream(m.group(1))
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  upstream→{fp}")
    else:
        print(f"  - {fp} (no change)")
