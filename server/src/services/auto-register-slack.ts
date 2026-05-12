/**
 * Idempotent startup hook that installs and activates the workspace-local
 * `@noralos-plugins/noralai-slack` package.
 *
 * Boundaries:
 *   - Touches only the Slack plugin. No general workspace scanning.
 *   - On warm starts: short-circuits unless the workspace manifest
 *     version differs from the stored one — then calls `upgradePlugin`
 *     so the DB picks up manifest changes (new tools, new capabilities,
 *     new apiRoutes). This is the fix for the NoralSign Phase-1 bug
 *     where workspace manifest changes never reached the DB row.
 *   - Failures are logged and swallowed: an unbuildable workspace plugin
 *     must not prevent the rest of the server from starting.
 *   - Does NOT seed per-company `plugin_config` rows — the operator
 *     configures the Slack workspace via Settings → Integrations or
 *     a direct seed script (see SLACK_SETUP.md follow-up).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "@noralos/db";
import { logger } from "../middleware/logger.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginLoader } from "./plugin-loader.js";

const SLACK_PACKAGE_NAME = "@noralos-plugins/noralai-slack";
const SLACK_PLUGIN_KEY = "noralai.slack";

function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-slack");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the workspace manifest's `version` field without importing the
 * module (which would require resolving its build output). We just parse
 * the source manifest file or its built JS.
 */
function readWorkspaceManifestVersion(localPath: string): string | null {
  try {
    const distFile = path.join(localPath, "dist", "manifest.js");
    if (fs.existsSync(distFile)) {
      const source = fs.readFileSync(distFile, "utf8");
      const match = source.match(/version:\s*['"]([^'"]+)['"]/);
      return match ? match[1] : null;
    }
  } catch {
    // fall through
  }
  return null;
}

export interface SlackRegistrationOutcome {
  registered: boolean;
  performedRegistration: boolean;
  performedUpgrade: boolean;
  activatedThisCall: boolean;
  reason?: string;
}

export async function ensureSlackRegistered(
  db: Db,
  loader: PluginLoader,
): Promise<SlackRegistrationOutcome> {
  const registry = pluginRegistryService(db);
  const existing = await registry.getByKey(SLACK_PLUGIN_KEY);
  const localPath = resolveWorkspacePluginPath();

  if (!localPath) {
    logger.warn(
      { packageName: SLACK_PACKAGE_NAME },
      "Slack workspace plugin not found; skipping auto-registration.",
    );
    return {
      registered: existing !== null && existing.status !== "uninstalled",
      performedRegistration: false,
      performedUpgrade: false,
      activatedThisCall: false,
      reason: "no_local_path",
    };
  }

  // Existing row — check if the workspace has a NEWER manifest version
  // and call upgradePlugin if so. This is the manifest-refresh path.
  if (existing && existing.status !== "uninstalled") {
    const workspaceVersion = readWorkspaceManifestVersion(localPath);
    const storedVersion = typeof existing.version === "string" ? existing.version : null;

    if (workspaceVersion && storedVersion && workspaceVersion !== storedVersion) {
      logger.info(
        {
          pluginKey: SLACK_PLUGIN_KEY,
          storedVersion,
          workspaceVersion,
        },
        "Slack workspace manifest version differs from stored row; upgrading",
      );
      try {
        await loader.upgradePlugin(existing.id, { localPath });
        // Reactivate so the new tool surface / capabilities take effect.
        try {
          await loader.unloadSingle(existing.id, SLACK_PLUGIN_KEY);
        } catch {
          // unload may no-op if the worker never started
        }
        await loader.loadSingle(existing.id);
        return {
          registered: true,
          performedRegistration: false,
          performedUpgrade: true,
          activatedThisCall: true,
        };
      } catch (err) {
        logger.warn(
          { err, pluginId: existing.id },
          "Slack manifest upgrade failed; falling back to stored manifest",
        );
      }
    }

    return {
      registered: true,
      performedRegistration: false,
      performedUpgrade: false,
      activatedThisCall: false,
      reason: "already_registered",
    };
  }

  // Fresh install path.
  let discovered;
  try {
    discovered = await loader.installPlugin({ localPath });
  } catch (err) {
    logger.error(
      { err, packageName: SLACK_PACKAGE_NAME, localPath },
      "Failed to install workspace Slack plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      performedUpgrade: false,
      activatedThisCall: false,
      reason: "install_failed",
    };
  }

  const installed = await registry.getByKey(SLACK_PLUGIN_KEY);
  if (!installed) {
    logger.error(
      { packageName: SLACK_PACKAGE_NAME, manifestId: discovered.manifest?.id },
      "Slack install reported success but the plugin row is missing; aborting activation",
    );
    return {
      registered: false,
      performedRegistration: true,
      performedUpgrade: false,
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
      { err, pluginId: installed.id, packageName: SLACK_PACKAGE_NAME },
      "Slack installed but immediate activation failed; will retry on next loadAll()",
    );
  }

  logger.info(
    {
      pluginKey: SLACK_PLUGIN_KEY,
      packageName: SLACK_PACKAGE_NAME,
      localPath,
      activatedThisCall,
    },
    "Slack plugin auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    performedUpgrade: false,
    activatedThisCall,
  };
}
