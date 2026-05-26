"""
Auto-resolve brand-only conflict blocks to fork-wins (master side).
Leaves substantive blocks untouched. Reports per-file activity.
"""
import re, os, sys
from pathlib import Path

# Find all conflicted files
files = [line.strip() for line in os.popen("grep -rlE '^<<<<<<< ' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='Dockerfile' --include='*.mjs' --include='*.js' . 2>/dev/null | grep -v '/node_modules/'").read().strip().split("\n") if line.strip()]

def normalize(s):
    s = re.sub(r"PAPERCLIP_", "X_", s)
    s = re.sub(r"NORALOS_", "X_", s)
    s = re.sub(r"@paperclipai/", "@X/", s)
    s = re.sub(r"@noralos/", "@X/", s)
    s = re.sub(r"paperclip", "x", s, flags=re.IGNORECASE)
    s = re.sub(r"noralos", "x", s, flags=re.IGNORECASE)
    s = re.sub(r"paperclipai\.com", "X.com", s)
    s = re.sub(r"noral\.ai", "X.com", s)
    s = re.sub(r"paperclip-", "x-", s)
    s = re.sub(r"noralos-", "x-", s)
    return s.strip()

def is_brand_only(ours: str, theirs: str) -> bool:
    if not ours and not theirs:
        return True
    return normalize(ours) == normalize(theirs)

total_resolved = 0
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
    resolved_in_file = 0

    while i < len(lines):
        line = lines[i]
        if line.startswith('<<<<<<<'):
            # Capture the conflict
            marker_start = line
            i += 1
            ours = []
            while i < len(lines) and not lines[i].startswith('======='):
                ours.append(lines[i])
                i += 1
            if i >= len(lines):
                # malformed — bail
                out_lines.append(marker_start)
                out_lines.extend(ours)
                continue
            i += 1  # skip =======
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

            if is_brand_only(ours_text, theirs_text):
                # Take theirs (master = fork wins)
                out_lines.extend(theirs)
                resolved_in_file += 1
            else:
                # Preserve conflict
                out_lines.append(marker_start)
                out_lines.extend(ours)
                out_lines.append('=======')
                out_lines.extend(theirs)
                out_lines.append(marker_end)
        else:
            out_lines.append(line)
            i += 1

    if resolved_in_file > 0:
        new_content = '\n'.join(out_lines)
        # Ensure no trailing newline added/removed
        if content.endswith('\n') and not new_content.endswith('\n'):
            new_content += '\n'
        elif not content.endswith('\n') and new_content.endswith('\n'):
            new_content = new_content.rstrip('\n')
        p.write_text(new_content, encoding='utf-8')
        total_resolved += resolved_in_file
        files_changed += 1
        print(f"  {f}: resolved {resolved_in_file}")

print()
print(f"=== Auto-resolved {total_resolved} brand-only blocks across {files_changed} files ===")
