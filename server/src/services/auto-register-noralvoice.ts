/**
 * Idempotent startup hook that installs and activates the workspace-local
 * `@noralos-plugins/noralai-noralvoice` package (the NoralVoice integration).
 *
 * Mirrors `auto-register-noralsign.ts` exactly — NoralVoice ships in-tree
 * as a workspace member, so on the first server start of a fresh
 * deployment there's no DB row for it yet. This module performs the
 * one-time discover-install-activate step on every start, with a
 * `getByKey()` guard so subsequent starts are a no-op.
 *
 * Boundaries:
 *   - Touches only the NoralVoice plugin. No general workspace scanning.
 *   - Failures are logged and swallowed: an unbuildable workspace plugin
 *     must not prevent the rest of the server from starting.
 *   - Does NOT seed a per-company `integration_credentials` row for the
 *     NoralVoice API key. That happens in Phase 2 when an operator visits
 *     Settings → Integrations → NoralVoice; the plugin itself is harmless
 *     without it (its tools just return a "configure credentials" error
 *     until the row is present).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Db } from "@noralos/db";
import { logger } from "../middleware/logger.js";
import { pluginRegistryService } from "./plugin-registry.js";
import type { PluginLoader } from "./plugin-loader.js";

const NORALVOICE_PACKAGE_NAME = "@noralos-plugins/noralai-noralvoice";
const NORALVOICE_PLUGIN_KEY = "noralai.noralvoice";

function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-noralvoice");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface NoralVoiceRegistrationOutcome {
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

export async function ensureNoralVoiceRegistered(
  db: Db,
  loader: PluginLoader,
): Promise<NoralVoiceRegistrationOutcome> {
  const registry = pluginRegistryService(db);
  const existing = await registry.getByKey(NORALVOICE_PLUGIN_KEY);
  const localPath = resolveWorkspacePluginPath();

  // Existing row — short-circuit, but first refresh the manifest if the
  // workspace has a newer version. Otherwise manifest changes in code
  // never propagate to the DB and apiRoutes/tools/capabilities go stale
  // (caught during NoralSign Phase 1, 2026-05-12).
  if (existing && existing.status !== "uninstalled") {
    if (localPath) {
      const workspaceVersion = readWorkspaceManifestVersion(localPath);
      const storedVersion = typeof existing.version === "string" ? existing.version : null;
      if (workspaceVersion && storedVersion && workspaceVersion !== storedVersion) {
        logger.info(
          { pluginKey: NORALVOICE_PLUGIN_KEY, storedVersion, workspaceVersion },
          "NoralVoice workspace manifest version differs from stored row; upgrading",
        );
        try {
          await loader.upgradePlugin(existing.id, { localPath });
          try {
            await loader.unloadSingle(existing.id, NORALVOICE_PLUGIN_KEY);
          } catch {
            // worker may not be running; ignore
          }
          await loader.loadSingle(existing.id);
        } catch (err) {
          logger.warn(
            { err, pluginId: existing.id },
            "NoralVoice manifest upgrade failed; continuing with stored manifest",
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
      { packageName: NORALVOICE_PACKAGE_NAME },
      "NoralVoice workspace plugin not found; skipping auto-registration. " +
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
      { err, packageName: NORALVOICE_PACKAGE_NAME, localPath },
      "Failed to install workspace NoralVoice plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      activatedThisCall: false,
      reason: "install_failed",
    };
  }

  const installed = await registry.getByKey(NORALVOICE_PLUGIN_KEY);
  if (!installed) {
    logger.error(
      { packageName: NORALVOICE_PACKAGE_NAME, manifestId: discovered.manifest?.id },
      "NoralVoice install reported success but the plugin row is missing; aborting activation",
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
      { err, pluginId: installed.id, packageName: NORALVOICE_PACKAGE_NAME },
      "NoralVoice installed but immediate activation failed; will retry on next loadAll()",
    );
  }

  logger.info(
    {
      pluginKey: NORALVOICE_PLUGIN_KEY,
      packageName: NORALVOICE_PACKAGE_NAME,
      localPath,
      activatedThisCall,
    },
    "NoralVoice plugin auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    activatedThisCall,
  };
}
