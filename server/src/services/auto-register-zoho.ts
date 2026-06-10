/**
 * Idempotent startup hook that installs and activates the workspace-local
 * `@noralos-plugins/noralai-zoho` package (the Zoho CRM integration).
 *
 * Why this is needed: the regular plugin-install pipeline only loads
 * packages an operator previously installed via `POST /api/plugins/install`.
 * Zoho ships in-tree as a workspace member, so on the first server
 * start of a fresh deployment there's no DB row for it yet. This module
 * performs the one-time discover-install-activate step on every start,
 * with a `getByKey()` guard so subsequent starts are a no-op.
 *
 * Boundaries:
 *   - Touches only the Zoho plugin. No general workspace scanning.
 *   - Failures are logged and swallowed: an unbuildable workspace plugin
 *     must not prevent the rest of the server from starting.
 *   - Does NOT seed a per-company `integration_credentials` row for the
 *     Zoho OAuth credential. That happens when an operator visits Settings
 *     → Integrations → Zoho CRM, pastes their client id/secret, and walks
 *     the OAuth consent flow; the plugin itself is harmless without it
 *     (its tools just return a "configure credentials" error until a row
 *     is present and assigned).
 *
 * Mirrors `auto-register-noralsign.ts` and `auto-register-noralvoice.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "@noralos/db";
import { logger } from "../middleware/logger.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginLoader } from "./plugin-loader.js";

const ZOHO_PACKAGE_NAME = "@noralos-plugins/noralai-zoho";
const ZOHO_PLUGIN_KEY = "noralai.zoho";

/**
 * Resolve the absolute path of the workspace Zoho package. Same three-up
 * layout as the other auto-register services — `services/` →
 * `src|dist/` → `server/` → repo root.
 */
function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-zoho");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ZohoRegistrationOutcome {
  registered: boolean;
  performedRegistration: boolean;
  activatedThisCall: boolean;
  reason?: string;
}

/**
 * Read the workspace manifest's version from `dist/manifest.js`. Used to
 * detect when a code change has bumped the manifest and the stored DB
 * row needs to be refreshed via `upgradePlugin`. Identifier-reference
 * form (`version: PLUGIN_VERSION,`) is resolved by reading `constants.js`
 * — same gotcha as noralsign/noralvoice.
 */
function readWorkspaceManifestVersion(localPath: string): string | null {
  try {
    const distFile = path.join(localPath, "dist", "manifest.js");
    if (!fs.existsSync(distFile)) return null;
    const source = fs.readFileSync(distFile, "utf8");
    const literal = source.match(/version:\s*['"]([^'"]+)['"]/);
    if (literal) return literal[1];
    const ref = source.match(/version:\s*([A-Z_][A-Z0-9_]*)/);
    if (ref) {
      const constName = ref[1];
      const distConstants = path.join(localPath, "dist", "constants.js");
      if (!fs.existsSync(distConstants)) return null;
      const constSource = fs.readFileSync(distConstants, "utf8");
      const constMatch = constSource.match(
        new RegExp(`${constName}\\s*=\\s*['"]([^'"]+)['"]`),
      );
      return constMatch ? constMatch[1] : null;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function ensureZohoRegistered(
  db: Db,
  loader: PluginLoader,
): Promise<ZohoRegistrationOutcome> {
  const registry = pluginRegistryService(db);
  const existing = await registry.getByKey(ZOHO_PLUGIN_KEY);
  const localPath = resolveWorkspacePluginPath();

  if (existing && existing.status !== "uninstalled") {
    if (localPath) {
      const workspaceVersion = readWorkspaceManifestVersion(localPath);
      const storedVersion = typeof existing.version === "string" ? existing.version : null;
      if (workspaceVersion && storedVersion && workspaceVersion !== storedVersion) {
        logger.info(
          { pluginKey: ZOHO_PLUGIN_KEY, storedVersion, workspaceVersion },
          "Zoho workspace manifest version differs from stored row; upgrading",
        );
        try {
          await loader.upgradePlugin(existing.id, { localPath });
          try {
            await loader.unloadSingle(existing.id, ZOHO_PLUGIN_KEY);
          } catch {
            // worker may not be running; ignore
          }
          await loader.loadSingle(existing.id);
        } catch (err) {
          logger.warn(
            { err, pluginId: existing.id },
            "Zoho manifest upgrade failed; continuing with stored manifest",
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
      { packageName: ZOHO_PACKAGE_NAME },
      "Zoho workspace plugin not found; skipping auto-registration. " +
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
      { err, packageName: ZOHO_PACKAGE_NAME, localPath },
      "Failed to install workspace Zoho plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "install_failed",
    };
  }

  const installed = await registry.getByKey(ZOHO_PLUGIN_KEY);
  if (!installed) {
    logger.error(
      { packageName: ZOHO_PACKAGE_NAME, manifestId: discovered.manifest?.id },
      "Zoho install reported success but the plugin row is missing; aborting activation",
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
    logger.warn(
      { err, pluginId: installed.id, packageName: ZOHO_PACKAGE_NAME },
      "Zoho installed but immediate activation failed; will retry on next loadAll()",
    );
  }

  logger.info(
    {
      pluginKey: ZOHO_PLUGIN_KEY,
      packageName: ZOHO_PACKAGE_NAME,
      localPath,
      activatedThisCall,
    },
    "Zoho plugin auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    activatedThisCall,
  };
}
