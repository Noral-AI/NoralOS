"""Apply batch 2 of conflict resolutions."""
import sys
from pathlib import Path

# Brand-rename helper for taking upstream text with brand normalization
def to_noralos(s):
    import re
    s = s.replace("PAPERCLIP_", "NORALOS_")
    s = s.replace("@paperclipai/", "@noralos/")
    # Keep PascalCase identifiers that include "Paperclip" (e.g. PluginPerformActionContext) as-is
    # since these are imports and the upstream symbol names stay
    # Only normalize plain brand prose
    s = s.replace("Paperclip Sample", "NoralOS Sample")
    return s

resolutions = [
    # command-managed-runtime.test.ts — take upstream + brand-rename env var
    ("./packages/adapter-utils/src/command-managed-runtime.test.ts",
     """<<<<<<< v2026.525.0
        const command =
          input.command === "sh" ? "/bin/sh" : input.command === "bash" ? "/bin/bash" : input.command;
        const args = [...(input.args ?? [])];
        if (
          input.stdin != null &&
          (input.command === "sh" || input.command === "bash") &&
          (args[0] === "-c" || args[0] === "-lc") &&
          typeof args[1] === "string"
        ) {
          env.PAPERCLIP_TEST_STDIN = input.stdin;
          args[1] = `printf '%s' \\"$PAPERCLIP_TEST_STDIN\\" | (${args[1]})`;
=======
        const command = input.command === "sh" ? "/bin/sh" : input.command;
        const args = [...(input.args ?? [])];
        if (input.stdin != null && input.command === "sh" && args[0] === "-lc" && typeof args[1] === "string") {
          env.NORALOS_TEST_STDIN = input.stdin;
          args[1] = `printf '%s' \\"$NORALOS_TEST_STDIN\\" | (${args[1]})`;
>>>>>>> master""",
     """        const command =
          input.command === "sh" ? "/bin/sh" : input.command === "bash" ? "/bin/bash" : input.command;
        const args = [...(input.args ?? [])];
        if (
          input.stdin != null &&
          (input.command === "sh" || input.command === "bash") &&
          (args[0] === "-c" || args[0] === "-lc") &&
          typeof args[1] === "string"
        ) {
          env.NORALOS_TEST_STDIN = input.stdin;
          args[1] = `printf '%s' \\"$NORALOS_TEST_STDIN\\" | (${args[1]})`;"""),

    # server-utils.ts — take upstream (adds redactCommandTextForLogs security wrapping) + brand rename
    ("./packages/adapter-utils/src/server-utils.ts",
     """<<<<<<< v2026.525.0
    merged[options.resolvedCommandEnvKey ?? "PAPERCLIP_RESOLVED_COMMAND"] = redactCommandTextForLogs(resolvedCommand);
=======
    merged[options.resolvedCommandEnvKey ?? "NORALOS_RESOLVED_COMMAND"] = resolvedCommand;
>>>>>>> master""",
     '    merged[options.resolvedCommandEnvKey ?? "NORALOS_RESOLVED_COMMAND"] = redactCommandTextForLogs(resolvedCommand);'),

    # codex-home.ts — take upstream (uses helper, eliminates fork's .paperclip bug)
    ("./packages/adapters/codex-local/src/server/codex-home.ts",
     """<<<<<<< v2026.525.0
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return companyId
    ? path.resolve(instanceRoot, "companies", companyId, "codex-home")
    : path.resolve(instanceRoot, "codex-home");
=======
  const noralosHome = nonEmpty(env.NORALOS_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = nonEmpty(env.NORALOS_INSTANCE_ID) ?? DEFAULT_NORALOS_INSTANCE_ID;
  return companyId
    ? path.resolve(noralosHome, "instances", instanceId, "companies", companyId, "codex-home")
    : path.resolve(noralosHome, "instances", instanceId, "codex-home");
>>>>>>> master""",
     """  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.NORALOS_HOME) ?? undefined,
    instanceId: nonEmpty(env.NORALOS_INSTANCE_ID) ?? undefined,
    env,
  });
  return companyId
    ? path.resolve(instanceRoot, "companies", companyId, "codex-home")
    : path.resolve(instanceRoot, "codex-home");"""),

    # cursor-local/src/index.ts — take upstream (more comprehensive PATH guidance) + brand rename
    ("./packages/adapters/cursor-local/src/index.ts",
     """<<<<<<< v2026.525.0
- Paperclip auto-injects local skills into "~/.cursor/skills" when missing, so Cursor can discover "$paperclip" and related skills on local runs.
- Paperclip auto-adds --yolo unless one of --trust/--yolo/-f is already present in extraArgs.
- Remote sandbox runs prepend "~/.cursor/bin" and "~/.local/bin" to PATH and prefer the installed absolute entrypoint from one of those directories when the default Cursor command is requested, so installer-managed sandbox leases do not need hardcoded command paths.
=======
- NoralOS auto-injects local skills into "~/.cursor/skills" when missing, so Cursor can discover "$paperclip" and related skills on local runs.
- NoralOS auto-adds --yolo unless one of --trust/--yolo/-f is already present in extraArgs.
- Remote sandbox runs prepend "~/.local/bin" to PATH and prefer "~/.local/bin/cursor-agent" when the default Cursor entrypoint is requested, so standard E2B-style installs do not need hardcoded absolute command paths.
>>>>>>> master""",
     """- NoralOS auto-injects local skills into "~/.cursor/skills" when missing, so Cursor can discover "$paperclip" and related skills on local runs.
- NoralOS auto-adds --yolo unless one of --trust/--yolo/-f is already present in extraArgs.
- Remote sandbox runs prepend "~/.cursor/bin" and "~/.local/bin" to PATH and prefer the installed absolute entrypoint from one of those directories when the default Cursor command is requested, so installer-managed sandbox leases do not need hardcoded command paths."""),

    # gemini-local/src/index.ts — take upstream (adds SANDBOX_INSTALL_COMMAND) + brand rename
    ("./packages/adapters/gemini-local/src/index.ts",
     """<<<<<<< v2026.525.0
import {
  buildSandboxNpmInstallCommand,
  type AdapterModelProfileDefinition,
} from "@paperclipai/adapter-utils";
=======
import type { AdapterModelProfileDefinition } from "@noralos/adapter-utils";
>>>>>>> master""",
     """import {
  buildSandboxNpmInstallCommand,
  type AdapterModelProfileDefinition,
} from "@noralos/adapter-utils";"""),

    # gemini-local/server/test.ts — take upstream + brand rename
    ("./packages/adapters/gemini-local/src/server/test.ts",
     """<<<<<<< v2026.525.0
} from "@paperclipai/adapter-utils/execution-target";
import { DEFAULT_GEMINI_LOCAL_MODEL, SANDBOX_INSTALL_COMMAND } from "../index.js";
=======
} from "@noralos/adapter-utils/execution-target";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "../index.js";
>>>>>>> master""",
     """} from "@noralos/adapter-utils/execution-target";
import { DEFAULT_GEMINI_LOCAL_MODEL, SANDBOX_INSTALL_COMMAND } from "../index.js";"""),

    # packages/db/src/runtime-config.ts — take upstream (uses shared helper)
    ("./packages/db/src/runtime-config.ts",
     """<<<<<<< v2026.525.0
function resolvePaperclipEnvPath(configPath: string): string {
  return resolvePaperclipEnvPathForConfig(configPath);
=======
function resolveNoralosEnvPath(configPath: string): string {
  return path.resolve(path.dirname(configPath), ENV_BASENAME);
>>>>>>> master""",
     """function resolveNoralosEnvPath(configPath: string): string {
  return resolvePaperclipEnvPathForConfig(configPath);"""),
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
