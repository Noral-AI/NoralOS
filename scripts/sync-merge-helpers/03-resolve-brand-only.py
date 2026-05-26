"""Resolve brand-only conflicts by taking fork (theirs) side."""
import re
from pathlib import Path

with open('/tmp/conflicts-brand-only.txt') as f:
    files = [line.strip() for line in f if line.strip()]

CONFLICT_RE = re.compile(
    r'^<<<<<<<.*?\n(.*?)^=======.*?\n(.*?)^>>>>>>>.*?\n',
    re.MULTILINE | re.DOTALL,
)

for f in files:
    content = Path(f).read_text(encoding='utf-8', errors='replace')
    # Take theirs (fork side) for each conflict block
    resolved = CONFLICT_RE.sub(lambda m: m.group(2), content)
    Path(f).write_text(resolved, encoding='utf-8')
    print(f"  ✓ {f}")
