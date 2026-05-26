"""
Apply a list of conflict resolutions to files in bulk.
Each resolution is a (file_path, conflict_marker_block, replacement_text) tuple.

The conflict_marker_block must match the exact text from <<<<<<< through >>>>>>>.
"""
import sys
from pathlib import Path

# Resolutions: list of (path, old_text, new_text)
resolutions = [
    # cli/package.json — fork wins (intentional drops + drizzle 0.38)
    ("./cli/package.json",
     """<<<<<<< v2026.525.0
    "@paperclipai/adapter-acpx-local": "workspace:*",
    "@paperclipai/adapter-claude-local": "workspace:*",
    "@paperclipai/adapter-codex-local": "workspace:*",
    "@paperclipai/adapter-cursor-cloud": "workspace:*",
    "@paperclipai/adapter-cursor-local": "workspace:*",
    "@paperclipai/adapter-gemini-local": "workspace:*",
    "@paperclipai/adapter-grok-local": "workspace:*",
    "@paperclipai/adapter-opencode-local": "workspace:*",
    "@paperclipai/adapter-pi-local": "workspace:*",
    "@paperclipai/adapter-openclaw-gateway": "workspace:*",
    "@paperclipai/adapter-utils": "workspace:*",
    "@paperclipai/db": "workspace:*",
    "@paperclipai/server": "workspace:*",
    "@paperclipai/shared": "workspace:*",
    "drizzle-orm": "0.45.2",
=======
    "@noralos/adapter-claude-local": "workspace:*",
    "@noralos/adapter-codex-local": "workspace:*",
    "@noralos/adapter-cursor-local": "workspace:*",
    "@noralos/adapter-gemini-local": "workspace:*",
    "@noralos/adapter-opencode-local": "workspace:*",
    "@noralos/adapter-pi-local": "workspace:*",
    "@noralos/adapter-openclaw-gateway": "workspace:*",
    "@noralos/adapter-utils": "workspace:*",
    "@noralos/db": "workspace:*",
    "@noralos/server": "workspace:*",
    "@noralos/shared": "workspace:*",
    "drizzle-orm": "0.38.4",
>>>>>>> master""",
     """    "@noralos/adapter-claude-local": "workspace:*",
    "@noralos/adapter-codex-local": "workspace:*",
    "@noralos/adapter-cursor-local": "workspace:*",
    "@noralos/adapter-gemini-local": "workspace:*",
    "@noralos/adapter-opencode-local": "workspace:*",
    "@noralos/adapter-pi-local": "workspace:*",
    "@noralos/adapter-openclaw-gateway": "workspace:*",
    "@noralos/adapter-utils": "workspace:*",
    "@noralos/db": "workspace:*",
    "@noralos/server": "workspace:*",
    "@noralos/shared": "workspace:*",
    "drizzle-orm": "0.38.4","""),

    # ui/package.json — fork wins
    ("./ui/package.json",
     """<<<<<<< v2026.525.0
    "@paperclipai/adapter-acpx-local": "workspace:*",
    "@paperclipai/adapter-claude-local": "workspace:*",
    "@paperclipai/adapter-codex-local": "workspace:*",
    "@paperclipai/adapter-cursor-cloud": "workspace:*",
    "@paperclipai/adapter-cursor-local": "workspace:*",
    "@paperclipai/adapter-gemini-local": "workspace:*",
    "@paperclipai/adapter-grok-local": "workspace:*",
    "@paperclipai/adapter-openclaw-gateway": "workspace:*",
    "@paperclipai/adapter-opencode-local": "workspace:*",
    "@paperclipai/adapter-pi-local": "workspace:*",
    "@paperclipai/adapter-utils": "workspace:*",
    "@paperclipai/shared": "workspace:*",
=======
    "@noralos/adapter-claude-local": "workspace:*",
    "@noralos/adapter-codex-local": "workspace:*",
    "@noralos/adapter-cursor-local": "workspace:*",
    "@noralos/adapter-gemini-local": "workspace:*",
    "@noralos/adapter-openclaw-gateway": "workspace:*",
    "@noralos/adapter-opencode-local": "workspace:*",
    "@noralos/adapter-pi-local": "workspace:*",
    "@noralos/adapter-utils": "workspace:*",
    "@noralos/shared": "workspace:*",
    "@noralos-plugins/noralai-brooklyn": "workspace:*",
>>>>>>> master""",
     """    "@noralos/adapter-claude-local": "workspace:*",
    "@noralos/adapter-codex-local": "workspace:*",
    "@noralos/adapter-cursor-local": "workspace:*",
    "@noralos/adapter-gemini-local": "workspace:*",
    "@noralos/adapter-openclaw-gateway": "workspace:*",
    "@noralos/adapter-opencode-local": "workspace:*",
    "@noralos/adapter-pi-local": "workspace:*",
    "@noralos/adapter-utils": "workspace:*",
    "@noralos/shared": "workspace:*",
    "@noralos-plugins/noralai-brooklyn": "workspace:*","""),

    # package.json — take upstream (3 test files exist)
    ("./package.json",
     """<<<<<<< v2026.525.0
    "test:release-registry": "node --test scripts/verify-release-registry-state.test.mjs scripts/release-package-map.test.mjs scripts/check-release-package-bootstrap.test.mjs",
=======
    "test:release-registry": "node --test scripts/verify-release-registry-state.test.mjs",
>>>>>>> master""",
     '    "test:release-registry": "node --test scripts/verify-release-registry-state.test.mjs scripts/release-package-map.test.mjs scripts/check-release-package-bootstrap.test.mjs",'),

    # doc/PRODUCT.md — fork wins + restore upstream's privacy bullet (additive)
    ("./doc/PRODUCT.md",
     """<<<<<<< v2026.525.0
- Do not build a complete Jira/GitHub replacement. The repo/docs already position Paperclip as organization orchestration, not focused on pull-request review.
- Do not build enterprise-grade RBAC first. Paperclip now has authenticated mode, company memberships, instance roles, and permission grants, but fine-grained enterprise governance should remain secondary to the core company control plane.
- Do not interpret agent-level privacy flags as a project/issue privacy feature in V1; work visibility stays company-scoped.
=======
- Do not build a complete Jira/GitHub replacement. The repo/docs already position NoralOS as organization orchestration, not focused on pull-request review.
- Do not build enterprise-grade RBAC first. NoralOS now has authenticated mode, company memberships, instance roles, and permission grants, but fine-grained enterprise governance should remain secondary to the core company control plane.
>>>>>>> master""",
     """- Do not build a complete Jira/GitHub replacement. The repo/docs already position NoralOS as organization orchestration, not focused on pull-request review.
- Do not build enterprise-grade RBAC first. NoralOS now has authenticated mode, company memberships, instance roles, and permission grants, but fine-grained enterprise governance should remain secondary to the core company control plane.
- Do not interpret agent-level privacy flags as a project/issue privacy feature in V1; work visibility stays company-scoped."""),

    # doc/CLI.md — take upstream + brand rename
    ("./doc/CLI.md",
     """<<<<<<< v2026.525.0
Local Paperclip data lives under the selected instance root. `PAPERCLIP_HOME` chooses the home directory and `PAPERCLIP_INSTANCE_ID` chooses the instance.

```text
~/.paperclip/                                     # PAPERCLIP_HOME
└── instances/
    └── default/                                  # instance root (PAPERCLIP_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── companies/                            # per-company adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not company-scoped)
```

Default paths for the canonical install:
=======
Default local instance root is `~/.noralos/instances/default`:
>>>>>>> master""",
     """Local NoralOS data lives under the selected instance root. `NORALOS_HOME` chooses the home directory and `NORALOS_INSTANCE_ID` chooses the instance.

```text
~/.noralos/                                       # NORALOS_HOME
└── instances/
    └── default/                                  # instance root (NORALOS_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── companies/                            # per-company adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not company-scoped)
```

Default paths for the canonical install:"""),

    # doc/DEVELOPING.md — take upstream + brand rename
    ("./doc/DEVELOPING.md",
     """<<<<<<< v2026.525.0
- `pnpm paperclipai onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm paperclipai configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm paperclipai doctor` validates secrets adapter configuration, can create a missing local key file with `--repair`, and reports missing AWS Secrets Manager bootstrap env when that provider is selected.
- Provider health is available at `GET /api/companies/:companyId/secret-providers/health` and reports local key permission warnings plus backup guidance.

Per-company provider vaults are configured in the board UI under
`Company Settings → Secrets → Provider vaults`, backed by
`/api/companies/{companyId}/secret-provider-configs`. The CLI does not own
vault lifecycle today. See `docs/deploy/secrets.md` (`Provider Vaults` section)
for the operator model.
=======
- `pnpm noralos onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm noralos configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm noralos doctor` validates secrets adapter configuration and can create a missing local key file with `--repair`.
>>>>>>> master""",
     """- `pnpm noralos onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm noralos configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm noralos doctor` validates secrets adapter configuration, can create a missing local key file with `--repair`, and reports missing AWS Secrets Manager bootstrap env when that provider is selected.
- Provider health is available at `GET /api/companies/:companyId/secret-providers/health` and reports local key permission warnings plus backup guidance.

Per-company provider vaults are configured in the board UI under
`Company Settings → Secrets → Provider vaults`, backed by
`/api/companies/{companyId}/secret-provider-configs`. The CLI does not own
vault lifecycle today. See `docs/deploy/secrets.md` (`Provider Vaults` section)
for the operator model."""),

    # doc/plugins/PLUGIN_SPEC.md — take upstream's structure + rename deprecated alias
    ("./doc/plugins/PLUGIN_SPEC.md",
     """<<<<<<< v2026.525.0
  minimumHostVersion?: string;
  /** @deprecated Use `minimumHostVersion` instead. Retained for backwards compatibility. */
  minimumPaperclipVersion?: string;
=======
  minimumNoralOSVersion?: string;
>>>>>>> master""",
     """  minimumHostVersion?: string;
  /** @deprecated Use `minimumHostVersion` instead. Retained for backwards compatibility. */
  minimumNoralOSVersion?: string;"""),

    # packages/shared/src/constants.ts — UNION (both sides add permissions)
    ("./packages/shared/src/constants.ts",
     """<<<<<<< v2026.525.0
  "agents.managed",
  "access.members.write",
  "access.invites.write",
  "authorization.grants.write",
  "authorization.policies.write",
=======
  // `agents.write` is broader than pause/resume/invoke — it permits a
  // plugin to *create* new agents (e.g. shipping an agent template like
  // the NoralVoice plugin's "Voice Director"). Gates `agents.create`.
  "agents.write",
>>>>>>> master""",
     """  "agents.managed",
  "access.members.write",
  "access.invites.write",
  "authorization.grants.write",
  "authorization.policies.write",
  // `agents.write` is broader than pause/resume/invoke — it permits a
  // plugin to *create* new agents (e.g. shipping an agent template like
  // the NoralVoice plugin's "Voice Director"). Gates `agents.create`.
  "agents.write","""),
]

applied = 0
failed = []
for path, old, new in resolutions:
    p = Path(path)
    try:
        content = p.read_text(encoding='utf-8')
    except Exception as e:
        failed.append((path, f"read error: {e}"))
        continue
    if old not in content:
        failed.append((path, "old text not found"))
        continue
    new_content = content.replace(old, new, 1)
    p.write_text(new_content, encoding='utf-8')
    applied += 1
    print(f"  ✓ {path}")

print()
print(f"=== Applied {applied}/{len(resolutions)} ===")
if failed:
    print("FAILURES:")
    for path, reason in failed:
        print(f"  ✗ {path}: {reason}")
