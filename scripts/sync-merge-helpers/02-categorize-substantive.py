import re
from pathlib import Path

with open('/tmp/conflicts-substantive.txt') as f:
    files = [line.strip() for line in f if line.strip()]

CONFLICT_RE = re.compile(
    r'^<<<<<<<.*?\n(.*?)^=======.*?\n(.*?)^>>>>>>>.*?\n',
    re.MULTILINE | re.DOTALL,
)

categories = {
    'imports_only': [],   # All conflicts are import-statement only
    'tiny': [],           # All conflicts ≤2 lines diff
    'small': [],          # All conflicts ≤10 lines diff
    'medium': [],         # All conflicts ≤30 lines diff
    'large': [],          # Has conflicts >30 lines
    'lockfile': [],       # pnpm-lock.yaml or similar
}

def conflict_size(ours, theirs):
    o = len(ours.strip().split('\n'))
    t = len(theirs.strip().split('\n'))
    return max(o, t)

def is_import_only(ours, theirs):
    """Both sides are pure import statements."""
    for side in (ours, theirs):
        for line in side.strip().split('\n'):
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            if not (line.startswith('import ') or line.startswith('export ') or 
                    line.startswith('from ') or line.startswith('}')):
                return False
    return True

for f in files:
    try:
        content = Path(f).read_text(encoding='utf-8', errors='replace')
    except:
        continue
    
    if 'pnpm-lock.yaml' in f or 'package-lock.json' in f:
        categories['lockfile'].append(f)
        continue
    
    blocks = CONFLICT_RE.findall(content)
    if not blocks:
        continue
    
    sizes = [conflict_size(o, t) for o, t in blocks]
    max_size = max(sizes)
    
    if all(is_import_only(o, t) for o, t in blocks):
        categories['imports_only'].append(f)
    elif max_size <= 2:
        categories['tiny'].append(f)
    elif max_size <= 10:
        categories['small'].append(f)
    elif max_size <= 30:
        categories['medium'].append(f)
    else:
        categories['large'].append(f)

for cat in ['lockfile', 'imports_only', 'tiny', 'small', 'medium', 'large']:
    count = len(categories[cat])
    print(f"{cat:15s} {count:4d}")
    Path(f"/tmp/conflicts-{cat}.txt").write_text("\n".join(categories[cat]))

print()
print("--- 'large' files (need most careful review) ---")
for f in categories['large'][:15]:
    print(f"  {f}")
