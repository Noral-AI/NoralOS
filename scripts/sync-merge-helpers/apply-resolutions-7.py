"""Batch 7: UI components — apply upstream-wins for additive features."""
import re
from pathlib import Path

# Files where upstream wins wholesale (more features, brand-rename inside as needed)
upstream_wholesale = [
    "./ui/src/components/MarkdownBody.tsx",
    "./ui/src/pages/IssueDetail.tsx",
    "./ui/src/lib/queryKeys.ts",
    "./ui/src/components/MarkdownEditor.tsx",
]

# Files where fork wins wholesale
fork_wholesale = [
    "./ui/src/components/CompanySettingsSidebar.test.tsx",
    "./ui/src/components/access/CompanySettingsNav.test.tsx",
]

pattern = re.compile(r'<<<<<<< v2026\.525\.0\n(.*?)=======\n(.*?)>>>>>>> master\n', re.DOTALL)

# Identifier renames (Paperclip → Noralos) for upstream-taken text
def apply_brand_renames(text):
    # Only rename @paperclipai/ packages
    text = text.replace("@paperclipai/", "@noralos/")
    return text

for fp in upstream_wholesale:
    p = Path(fp)
    content = p.read_text(encoding='utf-8')
    def take(m): return apply_brand_renames(m.group(1))
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  upstream→{fp}")

for fp in fork_wholesale:
    p = Path(fp)
    content = p.read_text(encoding='utf-8')
    def take(m): return m.group(2)
    new = pattern.sub(take, content)
    if new != content:
        p.write_text(new, encoding='utf-8')
        print(f"  fork→{fp}")
