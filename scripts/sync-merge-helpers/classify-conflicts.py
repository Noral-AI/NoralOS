import re, os, sys
from pathlib import Path

# Read conflict file list
files = [line.strip() for line in os.popen("grep -rlE '^<<<<<<< ' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='Dockerfile' --include='*.mjs' --include='*.js' . 2>/dev/null | grep -v '/node_modules/'").read().strip().split("\n")]

brand_only = []
substantive = []
errors = []

def normalize(s):
    """Normalize brand strings so paperclip-vs-noralos diffs disappear."""
    # All-caps env var prefixes
    s = re.sub(r"PAPERCLIP_", "X_", s)
    s = re.sub(r"NORALOS_", "X_", s)
    # Scoped npm packages
    s = re.sub(r"@paperclipai/", "@X/", s)
    s = re.sub(r"@noralos/", "@X/", s)
    # Lowercase + camelCase identifiers (no word boundaries — catches paperclipFoo, noralosFoo)
    s = re.sub(r"paperclip", "x", s, flags=re.IGNORECASE)
    s = re.sub(r"noralos", "x", s, flags=re.IGNORECASE)
    # PascalCase tokens (Paperclip → Noralos brand swap inside identifiers like PaperclipFoo)
    # Already handled by the lowercase re.IGNORECASE above
    # Domain names
    s = re.sub(r"paperclipai\.com", "X.com", s)
    s = re.sub(r"noral\.ai", "X.com", s)
    # Path-like dashes
    s = re.sub(r"paperclip-", "x-", s)
    s = re.sub(r"noralos-", "x-", s)
    return s.strip()

def is_brand_only_block(ours, theirs):
    """Check if a conflict block is purely a brand-name change."""
    if not ours and not theirs:
        return True
    return normalize(ours) == normalize(theirs)

# Per-file classification: ALL blocks brand-only → brand_only; any substantive → substantive
file_stats = {}  # path -> (brand_count, substantive_count)

for f in files:
    if not f:
        continue
    try:
        content = Path(f).read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        errors.append((f, str(e)))
        continue

    blocks = []
    i = 0
    lines = content.split('\n')
    while i < len(lines):
        if lines[i].startswith('<<<<<<<'):
            ours = []
            theirs = []
            i += 1
            while i < len(lines) and not lines[i].startswith('======='):
                ours.append(lines[i])
                i += 1
            i += 1
            while i < len(lines) and not lines[i].startswith('>>>>>>>'):
                theirs.append(lines[i])
                i += 1
            blocks.append(('\n'.join(ours), '\n'.join(theirs)))
        i += 1

    if not blocks:
        continue

    brand_count = sum(1 for o, t in blocks if is_brand_only_block(o, t))
    sub_count = len(blocks) - brand_count
    file_stats[f] = (brand_count, sub_count)

    if sub_count == 0:
        brand_only.append(f)
    else:
        substantive.append(f)

print(f"BRAND-ONLY (all blocks are brand): {len(brand_only)}")
print(f"SUBSTANTIVE (has non-brand blocks): {len(substantive)}")
print(f"ERRORS: {len(errors)}")
print()
print(f"Total brand-only blocks across substantive files (auto-resolvable):")
total_brand_blocks_in_subs = sum(stats[0] for f, stats in file_stats.items() if stats[1] > 0)
total_sub_blocks = sum(stats[1] for stats in file_stats.values())
print(f"  brand blocks in substantive files: {total_brand_blocks_in_subs}")
print(f"  substantive blocks total:          {total_sub_blocks}")

Path("/tmp/conflicts-brand-only.txt").write_text("\n".join(brand_only))
Path("/tmp/conflicts-substantive.txt").write_text("\n".join(substantive))

print()
print("--- BRAND-ONLY (all-brand files, sample first 30) ---")
for f in brand_only[:30]:
    print(f"  {f}")
