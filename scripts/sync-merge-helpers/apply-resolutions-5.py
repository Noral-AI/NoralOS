"""Batch 5: server services + tricky UI."""
from pathlib import Path

resolutions = [
    # registry.ts — fork (dropped acpx-local)
    ("./server/src/adapters/registry.ts",
     """<<<<<<< v2026.525.0
import type {
  AdapterModel,
  AdapterModelProfileDefinition,
  AdapterRuntimeCommandSpec,
  ServerAdapterModule,
} from "./types.js";
import {
  buildSandboxNpmInstallCommand,
  getAdapterSessionManagement,
} from "@paperclipai/adapter-utils";
import {
  execute as acpxExecute,
  testEnvironment as acpxTestEnvironment,
  sessionCodec as acpxSessionCodec,
  getConfigSchema as getAcpxConfigSchema,
  listAcpxSkills,
  syncAcpxSkills,
} from "@paperclipai/adapter-acpx-local/server";
import {
  agentConfigurationDoc as acpxAgentConfigurationDoc,
  models as acpxModels,
} from "@paperclipai/adapter-acpx-local";
=======
import type { AdapterModelProfileDefinition, ServerAdapterModule } from "./types.js";
import { getAdapterSessionManagement } from "@noralos/adapter-utils";
>>>>>>> master""",
     """import type { AdapterModelProfileDefinition, ServerAdapterModule } from "./types.js";
import { getAdapterSessionManagement } from "@noralos/adapter-utils";"""),

    # app.ts — fork (auto-register + uiMode guard)
    ("./server/src/app.ts",
     """<<<<<<< v2026.525.0
  const devWatcher = createPluginDevWatcher(
    lifecycle,
    async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
  );
  void loader.loadAll().then((result) => {
    if (!result) return;
    for (const loaded of result.results) {
      if (devWatcher && loaded.success && loaded.plugin.packagePath) {
        devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
      }
    }
  }).catch((err) => {
    logger.error({ err }, "Failed to load ready plugins on startup");
  });
  let appServicesShutdown = false;
  const shutdownAppServices = () => {
    if (appServicesShutdown) return;
    appServicesShutdown = true;
    disableFeedbackExportFlushes();
=======
  const devWatcher = opts.uiMode === "vite-dev"
    ? createPluginDevWatcher(
      lifecycle,
      async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
    )
    : null;
  // Auto-register the workspace-local plugins on first boot.
  // Idempotent — subsequent boots short-circuit unless the workspace
  // manifest version differs from the stored row (in which case
  // upgradePlugin runs to refresh the DB manifest).
  // Runs before loadAll() so a fresh deploy installs + activates in one cycle.
  void Promise.all([
    ensureNoralSignRegistered(db, loader),
    ensureNoralVoiceRegistered(db, loader),
    ensureSlackRegistered(db, loader),
  ])
    .then(() => loader.loadAll())
    .then((result) => {
      if (!result) return;
      for (const loaded of result.results) {
        if (devWatcher && loaded.success && loaded.plugin.packagePath) {
          devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
        }
      }
    })
    .catch((err) => {
      logger.error({ err }, "Failed to load ready plugins on startup");
    });
  process.once("exit", () => {
    if (feedbackExportTimer) clearInterval(feedbackExportTimer);
>>>>>>> master""",
     """  const devWatcher = opts.uiMode === "vite-dev"
    ? createPluginDevWatcher(
      lifecycle,
      async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
    )
    : null;
  // Auto-register the workspace-local plugins on first boot.
  // Idempotent — subsequent boots short-circuit unless the workspace
  // manifest version differs from the stored row (in which case
  // upgradePlugin runs to refresh the DB manifest).
  // Runs before loadAll() so a fresh deploy installs + activates in one cycle.
  void Promise.all([
    ensureNoralSignRegistered(db, loader),
    ensureNoralVoiceRegistered(db, loader),
    ensureSlackRegistered(db, loader),
  ])
    .then(() => loader.loadAll())
    .then((result) => {
      if (!result) return;
      for (const loaded of result.results) {
        if (devWatcher && loaded.success && loaded.plugin.packagePath) {
          devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
        }
      }
    })
    .catch((err) => {
      logger.error({ err }, "Failed to load ready plugins on startup");
    });
  process.once("exit", () => {
    if (feedbackExportTimer) clearInterval(feedbackExportTimer);"""),

    # environment-runtime.ts — fork (adds findReachableNoralosApiUrlOverSsh)
    ("./server/src/services/environment-runtime.ts",
     """<<<<<<< v2026.525.0
} from "@paperclipai/plugin-sdk";
import { ensureSshWorkspaceReady } from "@paperclipai/adapter-utils/ssh";
=======
} from "@noralos/plugin-sdk";
import { ensureSshWorkspaceReady, findReachableNoralosApiUrlOverSsh } from "@noralos/adapter-utils/ssh";
>>>>>>> master""",
     """} from "@noralos/plugin-sdk";
import { ensureSshWorkspaceReady, findReachableNoralosApiUrlOverSsh } from "@noralos/adapter-utils/ssh";"""),

    # worktree-config.ts — fork (brand renames + persistedEnv)
    ("./server/src/worktree-config.ts",
     """<<<<<<< v2026.525.0
    nonEmpty(stablePersistedEnv.PAPERCLIP_WORKTREE_NAME) ??
    nonEmpty(env.PAPERCLIP_WORKTREE_NAME) ??
    path.basename(worktreeRoot);
  const instanceId =
    nonEmpty(stablePersistedEnv.PAPERCLIP_INSTANCE_ID) ??
    nonEmpty(env.PAPERCLIP_INSTANCE_ID) ??
    sanitizeWorktreeInstanceId(worktreeName);
  const homeDir = resolveHomeAwarePath(
    nonEmpty(stablePersistedEnv.PAPERCLIP_HOME) ??
      nonEmpty(env.PAPERCLIP_HOME) ??
      nonEmpty(env.PAPERCLIP_WORKTREES_DIR) ??
      "~/.paperclip-worktrees",
=======
    nonEmpty(persistedEnv.NORALOS_WORKTREE_NAME) ??
    nonEmpty(env.NORALOS_WORKTREE_NAME) ??
    path.basename(worktreeRoot);
  const instanceId =
    nonEmpty(persistedEnv.NORALOS_INSTANCE_ID) ??
    nonEmpty(env.NORALOS_INSTANCE_ID) ??
    sanitizeWorktreeInstanceId(worktreeName);
  const homeDir = resolveHomeAwarePath(
    nonEmpty(persistedEnv.NORALOS_HOME) ??
      nonEmpty(env.NORALOS_HOME) ??
      nonEmpty(env.NORALOS_WORKTREES_DIR) ??
      "~/.noralos-worktrees",
>>>>>>> master""",
     """    nonEmpty(persistedEnv.NORALOS_WORKTREE_NAME) ??
    nonEmpty(env.NORALOS_WORKTREE_NAME) ??
    path.basename(worktreeRoot);
  const instanceId =
    nonEmpty(persistedEnv.NORALOS_INSTANCE_ID) ??
    nonEmpty(env.NORALOS_INSTANCE_ID) ??
    sanitizeWorktreeInstanceId(worktreeName);
  const homeDir = resolveHomeAwarePath(
    nonEmpty(persistedEnv.NORALOS_HOME) ??
      nonEmpty(env.NORALOS_HOME) ??
      nonEmpty(env.NORALOS_WORKTREES_DIR) ??
      "~/.noralos-worktrees","""),

    # home-paths.ts — fork (standalone implementation) + fix .paperclip bug to .noralos
    ("./server/src/home-paths.ts",
     """<<<<<<< v2026.525.0
export {
  expandHomePrefix,
  resolveHomeAwarePath,
  resolvePaperclipHomeDir,
  resolvePaperclipInstanceId,
  resolvePaperclipInstanceRoot,
};

export function resolveDefaultConfigPath(): string {
  return resolvePaperclipConfigPathForInstance();
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return resolveSharedDefaultEmbeddedPostgresDir();
}

export function resolveDefaultLogsDir(): string {
  return resolveSharedDefaultLogsDir();
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return resolveSharedDefaultSecretsKeyFilePath();
}

export function resolveDefaultStorageDir(): string {
  return resolveSharedDefaultStorageDir();
}

export function resolveDefaultBackupDir(): string {
  return resolveSharedDefaultBackupDir();
=======
function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveNoralosHomeDir(): string {
  const envHome = process.env.NORALOS_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".paperclip");
}

export function resolveNoralosInstanceId(): string {
  const raw = process.env.NORALOS_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid NORALOS_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveNoralosInstanceRoot(): string {
  return path.resolve(resolveNoralosHomeDir(), "instances", resolveNoralosInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "backups");
>>>>>>> master""",
     """function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveNoralosHomeDir(): string {
  const envHome = process.env.NORALOS_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".noralos");
}

export function resolveNoralosInstanceId(): string {
  const raw = process.env.NORALOS_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid NORALOS_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveNoralosInstanceRoot(): string {
  return path.resolve(resolveNoralosHomeDir(), "instances", resolveNoralosInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveNoralosInstanceRoot(), "data", "backups");"""),
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

print(f"\n=== Applied {applied}/{len(resolutions)} ===")
if failed:
    for path, reason in failed:
        print(f"  ✗ {path}: {reason}")
