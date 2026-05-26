import re, os, sys
from pathlib import Path

# Read conflict file list
files = [line.strip() for line in os.popen("grep -rlE '^<<<<<<< ' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.md' --include='*.yaml' --include='Dockerfile' --include='*.mjs' --include='*.js' . 2>/dev/null | grep -v '/node_modules/'").read().strip().split("\n")]

brand_only = []
substantive = []
errors = []

# Brand markers: things that are likely just rebranding deltas
brand_patterns = [
    re.compile(r"\bPaperclip\b|paperclipai|paperclip-|paperclip\."),
    re.compile(r"@paperclipai/"),
    re.compile(r"PAPERCLIP_"),
    re.compile(r"\bpaperclip-?ai?\b"),
]
# Inverse markers in other side
noralos_patterns = [
    re.compile(r"\bNoralos\b|noralai\.|noralos-|noralos\."),
    re.compile(r"@noralos/"),
    re.compile(r"NORALOS_"),
]

def is_brand_only_block(ours, theirs):
    """Check if a conflict block is purely a brand-name change."""
    if not ours and not theirs:
        return True
    # Normalize by replacing all brand strings, then compare
    def normalize(s):
        s = re.sub(r"\bPaperclip\b", "X", s)
        s = re.sub(r"\bNoralos\b", "X", s)
        s = re.sub(r"\bPAPERCLIP_", "X_", s)
        s = re.sub(r"\bNORALOS_", "X_", s)
        s = re.sub(r"@paperclipai/", "@X/", s)
        s = re.sub(r"@noralos/", "@X/", s)
        s = re.sub(r"paperclipai\.com", "X.com", s)
        s = re.sub(r"noral\.ai", "X.com", s)
        s = re.sub(r"\bpaperclip\b", "x", s)
        s = re.sub(r"\bnoralos\b", "x", s)
        return s.strip()
    return normalize(ours) == normalize(theirs)

for f in files:
    if not f:
        continue
    try:
        content = Path(f).read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        errors.append((f, str(e)))
        continue
    
    # Parse conflict blocks
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
            i += 1  # skip =======
            while i < len(lines) and not lines[i].startswith('>>>>>>>'):
                theirs.append(lines[i])
                i += 1
            blocks.append(('\n'.join(ours), '\n'.join(theirs)))
        i += 1
    
    if not blocks:
        continue
    
    if all(is_brand_only_block(o, t) for o, t in blocks):
        brand_only.append(f)
    else:
        substantive.append(f)

print(f"BRAND-ONLY (auto-resolve to fork-wins): {len(brand_only)}")
print(f"SUBSTANTIVE (need review):              {len(substantive)}")
print(f"ERRORS:                                  {len(errors)}")
print()
print("--- BRAND-ONLY sample (first 20) ---")
for f in brand_only[:20]:
    print(f"  {f}")
print()
print("--- SUBSTANTIVE sample (first 20) ---")
for f in substantive[:20]:
    print(f"  {f}")

# Write lists
Path("/tmp/conflicts-brand-only.txt").write_text("\n".join(brand_only))
Path("/tmp/conflicts-substantive.txt").write_text("\n".join(substantive))
