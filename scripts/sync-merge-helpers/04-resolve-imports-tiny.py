"""Auto-resolve imports-only (union both sides) and tiny (fork wins)."""
import re
from pathlib import Path

CONFLICT_RE = re.compile(
    r'^<<<<<<<.*?\n(.*?)^=======.*?\n(.*?)^>>>>>>>.*?\n',
    re.MULTILINE | re.DOTALL,
)

def union_imports_block(ours, theirs):
    """
    Try to union two import-only blocks intelligently.
    Pattern: import { A, B } from "X";
    """
    # Parse each side: collect (source, names_set, line_template)
    def parse(s):
        result = {}  # source -> set of names
        for line in s.strip().split('\n'):
            line = line.rstrip()
            if not line.strip():
                continue
            # Match named imports
            m = re.match(r'^(\s*)import\s+(type\s+)?\{\s*([^}]+)\s*\}\s+from\s+["\']([^"\']+)["\'];?\s*$', line)
            if m:
                indent, type_kw, names, source = m.groups()
                type_kw = (type_kw or '').strip()
                key = (source, indent, type_kw)
                if key not in result:
                    result[key] = set()
                for n in names.split(','):
                    result[key].add(n.strip())
                continue
            # Non-matching line: bail (just take fork side)
            return None
        return result
    
    ours_p = parse(ours)
    theirs_p = parse(theirs)
    if ours_p is None or theirs_p is None:
        return theirs  # fallback: fork wins
    
    # Merge
    all_keys = set(ours_p.keys()) | set(theirs_p.keys())
    out_lines = []
    for key in sorted(all_keys, key=lambda k: k[0]):
        source, indent, type_kw = key
        names = (ours_p.get(key, set()) | theirs_p.get(key, set()))
        names_str = ", ".join(sorted(names))
        type_str = f"{type_kw} " if type_kw else ""
        out_lines.append(f'{indent}import {type_str}{{ {names_str} }} from "{source}";')
    return '\n'.join(out_lines) + '\n'

def resolve_file(filepath, strategy):
    content = Path(filepath).read_text(encoding='utf-8', errors='replace')
    def replacer(m):
        ours, theirs = m.group(1), m.group(2)
        if strategy == 'union_imports':
            return union_imports_block(ours, theirs)
        else:  # fork wins
            return theirs
    resolved = CONFLICT_RE.sub(replacer, content)
    Path(filepath).write_text(resolved, encoding='utf-8')

# Resolve imports-only files
with open('/tmp/conflicts-imports_only.txt') as f:
    for f_path in [line.strip() for line in f if line.strip()]:
        resolve_file(f_path, 'union_imports')
        print(f"  union  {f_path}")

# Resolve tiny conflicts (fork wins)
with open('/tmp/conflicts-tiny.txt') as f:
    for f_path in [line.strip() for line in f if line.strip()]:
        resolve_file(f_path, 'fork_wins')
        print(f"  fork   {f_path}")
