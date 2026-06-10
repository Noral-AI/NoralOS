/**
 * Idempotent startup hook that installs and activates the workspace-local
 * `@noralos-plugins/noralai-google-sheets` package.
 *
 * Same pattern as auto-register-noralsign / auto-register-noralvoice /
 * auto-register-zoho — the plugin ships in-tree as a workspace member,
 * so the regular plugin-install pipeline never sees it. This hook
 * discovers it from the source tree on every boot and short-circuits
 * once the DB row exists (with a manifest-version refresh path so code
 * bumps land without operator action).
 *
 * Boundaries:
 *   - Touches only the Google Sheets plugin. No general workspace scanning.
 *   - Failures are logged and swallowed: an unbuildable workspace plugin
 *     must not prevent the rest of the server from starting.
 *   - Does NOT seed a per-company `integration_credentials` row. That
 *     happens when an operator visits Settings → Integrations → Google
 *     Sheets and walks the OAuth flow; the plugin is harmless without it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "@noralos/db";
import { logger } from "../middleware/logger.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginLoader } from "./plugin-loader.js";

const GOOGLE_SHEETS_PACKAGE_NAME = "@noralos-plugins/noralai-google-sheets";
const GOOGLE_SHEETS_PLUGIN_KEY = "noralai.google-sheets";

function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-google-sheets");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface GoogleSheetsRegistrationOutcome {
  registered: boolean;
  performedRegistration: boolean;
  activatedThisCall: boolean;
  reason?: string;
}

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

export async function ensureGoogleSheetsRegistered(
  db: Db,
  loader: PluginLoader,
): Promise<GoogleSheetsRegistrationOutcome> {
  const registry = pluginRegistryService(db);
  const existing = await registry.getByKey(GOOGLE_SHEETS_PLUGIN_KEY);
  const localPath = resolveWorkspacePluginPath();

  if (existing && existing.status !== "uninstalled") {
    if (localPath) {
      const workspaceVersion = readWorkspaceManifestVersion(localPath);
      const storedVersion = typeof existing.version === "string" ? existing.version : null;
      if (workspaceVersion && storedVersion && workspaceVersion !== storedVersion) {
        logger.info(
          { pluginKey: GOOGLE_SHEETS_PLUGIN_KEY, storedVersion, workspaceVersion },
          "Google Sheets workspace manifest version differs from stored row; upgrading",
        );
        try {
          await loader.upgradePlugin(existing.id, { localPath });
          try {
            await loader.unloadSingle(existing.id, GOOGLE_SHEETS_PLUGIN_KEY);
          } catch {
            // worker may not be running; ignore
          }
          await loader.loadSingle(existing.id);
        } catch (err) {
          logger.warn(
            { err, pluginId: existing.id },
            "Google Sheets manifest upgrade failed; continuing with stored manifest",
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
      { packageName: GOOGLE_SHEETS_PACKAGE_NAME },
      "Google Sheets workspace plugin not found; skipping auto-registration. " +
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
      { err, packageName: GOOGLE_SHEETS_PACKAGE_NAME, localPath },
      "Failed to install workspace Google Sheets plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "install_failed",
    };
  }

  const installed = await registry.getByKey(GOOGLE_SHEETS_PLUGIN_KEY);
  if (!installed) {
    logger.error(
      { packageName: GOOGLE_SHEETS_PACKAGE_NAME, manifestId: discovered.manifest?.id },
      "Google Sheets install reported success but the plugin row is missing; aborting activation",
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
      { err, pluginId: installed.id, packageName: GOOGLE_SHEETS_PACKAGE_NAME },
      "Google Sheets installed but immediate activation failed; will retry on next loadAll()",
    );
  }

  logger.info(
    {
      pluginKey: GOOGLE_SHEETS_PLUGIN_KEY,
      packageName: GOOGLE_SHEETS_PACKAGE_NAME,
      localPath,
      activatedThisCall,
    },
    "Google Sheets plugin auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    activatedThisCall,
  };
}
