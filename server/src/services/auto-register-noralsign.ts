/**
 * Idempotent startup hook that installs and activates the workspace-local
 * `@noralos-plugins/noralai-noralsign` package (the NoralSign / DocuSeal
 * integration).
 *
 * Why this is needed: the regular plugin-install pipeline only loads
 * packages an operator previously installed via `POST /api/plugins/install`.
 * NoralSign ships in-tree as a workspace member, so on the first server
 * start of a fresh deployment there's no DB row for it yet. This module
 * performs the one-time discover-install-activate step on every start,
 * with a `getByKey()` guard so subsequent starts are a no-op.
 *
 * Boundaries:
 *   - Touches only the NoralSign plugin. No general workspace scanning.
 *   - Failures are logged and swallowed: an unbuildable workspace plugin
 *     must not prevent the rest of the server from starting.
 *   - Does NOT seed a per-company `integration_credentials` row for the
 *     DocuSeal API token. That happens when an operator visits Settings
 *     → Integrations → NoralSign and pastes their token; the plugin
 *     itself is harmless without it (its tools just return a "configure
 *     credentials" error until the row is present).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "@noralos/db";
import { logger } from "../middleware/logger.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginLoader } from "./plugin-loader.js";

const NORALSIGN_PACKAGE_NAME = "@noralos-plugins/noralai-noralsign";
const NORALSIGN_PLUGIN_KEY = "noralai.noralsign";

/**
 * Resolve the absolute path of the workspace NoralSign package.
 *
 * Layout in both source (dev, run via tsx) and built (prod, run from
 * `server/dist`) trees:
 *   <repoRoot>/packages/plugins/noralai-noralsign
 *   <repoRoot>/server/src/services/auto-register-noralsign.ts  (dev)
 *   <repoRoot>/server/dist/services/auto-register-noralsign.js (prod)
 * Either way, three directories up from this file's directory is the
 * repo root (`services/ → src|dist/ → server/ → repoRoot`).
 */
function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-noralsign");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface NoralSignRegistrationOutcome {
  /** True if the plugin row is present and ready after this call. */
  registered: boolean;
  /** True if this call is what put it there (false on warm starts). */
  performedRegistration: boolean;
  /** True if `loadSingle` was called to activate the freshly-installed plugin. */
  activatedThisCall: boolean;
  reason?: string;
}

/**
 * Make sure `noralai.noralsign` is installed in the plugins table. Safe to
 * call multiple times; warm starts return immediately after a single
 * indexed lookup.
 *
 * @param db    The application database handle.
 * @param loader The constructed pluginLoader; must already have runtime
 *               services (the production app.ts loader does).
 */
/**
 * Read the workspace manifest's version from `dist/manifest.js`. Used to
 * detect when a code change has bumped the manifest and the stored DB
 * row needs to be refreshed via `upgradePlugin`. Without this check, a
 * manifest change in source code never reaches production unless an
 * operator manually triggers an upgrade — caught the hard way during
 * NoralSign Phase 1 (2026-05-12).
 */
function readWorkspaceManifestVersion(localPath: string): string | null {
  try {
    const distFile = path.join(localPath, "dist", "manifest.js");
    if (!fs.existsSync(distFile)) return null;
    const source = fs.readFileSync(distFile, "utf8");
    // Literal form: `version: "0.2.0",`
    const literal = source.match(/version:\s*['"]([^'"]+)['"]/);
    if (literal) return literal[1];
    // Identifier-reference form: `version: PLUGIN_VERSION,` — tsc leaves the
    // identifier intact, so resolve it from constants.js.
    const ref = source.match(/version:\s*([A-Z_][A-Z0-9_]*)/);
    if (ref) {
      const constName = ref[1];
      const distConstants = path.join(localPath, "dist", "constants.js");
      if (!fs.existsSync(distConstants)) return null;
      const constSource = fs.readFileSync(distConstants, "utf8");
      const constMatch = constSource.match(new RegExp(`${constName}\\s*=\\s*['"]([^'"]+)['"]`));
      return constMatch ? constMatch[1] : null;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function ensureNoralSignRegistered(
  db: Db,
  loader: PluginLoader,
): Promise<NoralSignRegistrationOutcome> {
  const registry = pluginRegistryService(db);
  const existing = await registry.getByKey(NORALSIGN_PLUGIN_KEY);
  const localPath = resolveWorkspacePluginPath();

  // Existing row — short-circuit, but FIRST refresh the manifest if the
  // workspace has a newer version. Otherwise manifest changes in code
  // never propagate to the DB and apiRoutes/tools/capabilities go stale.
  if (existing && existing.status !== "uninstalled") {
    if (localPath) {
      const workspaceVersion = readWorkspaceManifestVersion(localPath);
      const storedVersion = typeof existing.version === "string" ? existing.version : null;
      if (workspaceVersion && storedVersion && workspaceVersion !== storedVersion) {
        logger.info(
          { pluginKey: NORALSIGN_PLUGIN_KEY, storedVersion, workspaceVersion },
          "NoralSign workspace manifest version differs from stored row; upgrading",
        );
        try {
          await loader.upgradePlugin(existing.id, { localPath });
          try {
            await loader.unloadSingle(existing.id, NORALSIGN_PLUGIN_KEY);
          } catch {
            // worker may not be running; ignore
          }
          await loader.loadSingle(existing.id);
        } catch (err) {
          logger.warn(
            { err, pluginId: existing.id },
            "NoralSign manifest upgrade failed; continuing with stored manifest",
          );
        }
      }
    }
    return {
      registered: true,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "already_registered",
    };
  }

  if (!localPath) {
    logger.warn(
      { packageName: NORALSIGN_PACKAGE_NAME },
      "NoralSign workspace plugin not found; skipping auto-registration. " +
        "If this is a packaged production image, confirm packages/plugins/ shipped in the build context.",
    );
    return {
      registered: false,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "no_local_path",
    };
  }

  let discovered;
  try {
    discovered = await loader.installPlugin({ localPath });
  } catch (err) {
    logger.error(
      { err, packageName: NORALSIGN_PACKAGE_NAME, localPath },
      "Failed to install workspace NoralSign plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "install_failed",
    };
  }

  // Look the installed row back up so we have its DB id for activation.
  const installed = await registry.getByKey(NORALSIGN_PLUGIN_KEY);
  if (!installed) {
    logger.error(
      { packageName: NORALSIGN_PACKAGE_NAME, manifestId: discovered.manifest?.id },
      "NoralSign install reported success but the plugin row is missing; aborting activation",
    );
    return {
      registered: false,
      performedRegistration: true,
      activatedThisCall: false,
      reason: "missing_after_install",
    };
  }

  let activatedThisCall = false;
  try {
    await loader.loadSingle(installed.id);
    activatedThisCall = true;
  } catch (err) {
    // Activation can fail for reasons unrelated to the plugin's correctness
    // (e.g. worker manager not yet wired in unit tests). The row is still
    // installed; the next `loadAll()` will retry it once it's `ready`.
    logger.warn(
      { err, pluginId: installed.id, packageName: NORALSIGN_PACKAGE_NAME },
      "NoralSign installed but immediate activation failed; will retry on next loadAll()",
    );
  }

  logger.info(
    {
      pluginKey: NORALSIGN_PLUGIN_KEY,
      packageName: NORALSIGN_PACKAGE_NAME,
      localPath,
      activatedThisCall,
    },
    "NoralSign plugin auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    activatedThisCall,
  };
}
