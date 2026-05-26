"""
Auto-resolve conflict blocks where one side is purely additive over the other
(after brand-normalizing). This handles cases like:
  - Upstream added new imports/symbols/fields that fork doesn't have:
      take upstream-normalized (apply brand rename to fork form).
  - Fork added new code that upstream doesn't have:
      take fork side as-is (already in fork brand).

Detection: brand-normalize both sides, then check if one is a "line-subset" of
the other — i.e., every line in side A appears in side B in the same order
(allowing intervening lines in B).
"""
import re, os
from pathlib import Path

def normalize(s):
    s = re.sub(r"PAPERCLIP_", "NORALOS_", s)
    s = re.sub(r"@paperclipai/", "@noralos/", s)
    s = re.sub(r"\bPaperclip\b", "Noralos", s)
    s = re.sub(r"\bPAPERCLIP\b", "NORALOS", s)
    s = re.sub(r"\bpaperclip\b", "noralos", s)
    s = re.sub(r"paperclip-", "noralos-", s)
    s = re.sub(r"paperclipai\.com", "noral.ai", s)
    # camelCase: paperclipFoo → noralosFoo
    s = re.sub(r"paperclip([A-Z])", r"noralos\1", s)
    # PascalCase: PaperclipFoo → NoralosFoo
    s = re.sub(r"Paperclip([A-Z])", r"Noralos\1", s)
    return s

def lines_subset(small_lines, big_lines):
    """True if small_lines appear in big_lines preserving order (subsequence).
    Ignores empty lines for the comparison."""
    small = [l.strip() for l in small_lines if l.strip()]
    big = [l.strip() for l in big_lines if l.strip()]
    if not small:
        return True
    j = 0
    for line in big:
        if j < len(small) and line == small[j]:
            j += 1
    return j == len(small)

def is_brand_only(ours, theirs):
    return normalize(ours).strip() == normalize(theirs).strip()

files = [line.strip() for line in os.popen("grep -rlE '^<<<<<<< ' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='Dockerfile' --include='*.mjs' --include='*.js' . 2>/dev/null | grep -v '/node_modules/'").read().strip().split("\n") if line.strip()]

total_upstream_wins = 0
total_fork_wins = 0
total_kept = 0
files_changed = 0

for f in files:
    p = Path(f)
    try:
        content = p.read_text(encoding='utf-8')
    except Exception as e:
        print(f"SKIP {f}: {e}")
        continue

    out_lines = []
    lines = content.split('\n')
    i = 0
    upstream_in_file = 0
    fork_in_file = 0
    kept_in_file = 0

    while i < len(lines):
        line = lines[i]
        if line.startswith('<<<<<<<'):
            marker_start = line
            i += 1
            ours = []
            while i < len(lines) and not lines[i].startswith('======='):
                ours.append(lines[i])
                i += 1
            if i >= len(lines):
                out_lines.append(marker_start)
                out_lines.extend(ours)
                continue
            i += 1
            theirs = []
            while i < len(lines) and not lines[i].startswith('>>>>>>>'):
                theirs.append(lines[i])
                i += 1
            if i >= len(lines):
                out_lines.append(marker_start)
                out_lines.extend(ours)
                out_lines.append('=======')
                out_lines.extend(theirs)
                continue
            marker_end = lines[i]
            i += 1

            ours_text = '\n'.join(ours)
            theirs_text = '\n'.join(theirs)
            ours_norm = normalize(ours_text)
            ours_norm_lines = ours_norm.split('\n')

            # Brand-only? (already handled in prior pass but be safe)
            if is_brand_only(ours_text, theirs_text):
                out_lines.extend(theirs)  # fork wins
                fork_in_file += 1
                continue

            # Is fork a subset of upstream-normalized? → upstream is additive, take upstream-normalized
            if lines_subset(theirs, ours_norm_lines):
                out_lines.extend(ours_norm_lines)
                upstream_in_file += 1
                continue

            # Is upstream-normalized a subset of fork? → fork is additive, take fork
            if lines_subset(ours_norm_lines, theirs):
                out_lines.extend(theirs)
                fork_in_file += 1
                continue

            # Neither side is a clean superset — keep conflict for manual review
            out_lines.append(marker_start)
            out_lines.extend(ours)
            out_lines.append('=======')
            out_lines.extend(theirs)
            out_lines.append(marker_end)
            kept_in_file += 1
        else:
            out_lines.append(line)
            i += 1

    if upstream_in_file + fork_in_file > 0:
        new_content = '\n'.join(out_lines)
        if content.endswith('\n') and not new_content.endswith('\n'):
            new_content += '\n'
        elif not content.endswith('\n') and new_content.endswith('\n'):
            new_content = new_content.rstrip('\n')
        p.write_text(new_content, encoding='utf-8')
        files_changed += 1
        total_upstream_wins += upstream_in_file
        total_fork_wins += fork_in_file
        total_kept += kept_in_file
        flag = ""
        if kept_in_file > 0:
            flag = f"  (kept {kept_in_file})"
        print(f"  {f}: upstream-additive={upstream_in_file} fork-additive={fork_in_file}{flag}")
    else:
        total_kept += kept_in_file

print()
print(f"=== upstream-additive: {total_upstream_wins} ===")
print(f"=== fork-additive:     {total_fork_wins} ===")
print(f"=== kept for manual:   {total_kept} ===")
print(f"=== files changed:     {files_changed} ===")
