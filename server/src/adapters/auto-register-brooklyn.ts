/**
 * Idempotent startup hook that registers the workspace-local
 * `@noralos-plugins/noralai-brooklyn` package with the external
 * adapter registry.
 *
 * Why this is needed in addition to the regular plugin store:
 * the canonical external-adapter pipeline (`buildExternalAdapters`)
 * only loads packages that an operator previously installed via
 * `POST /api/adapters` (which writes a row to
 * `~/.noralos/adapter-plugins.json`). Brooklyn ships in-tree as a
 * workspace member, so on the first server start of a fresh
 * deployment there's no row for it yet. This module performs the
 * one-time discover-and-register step on every start, with a
 * `findServerAdapter()` guard so the second start is a no-op.
 *
 * Boundaries:
 *   - Only touches the Brooklyn adapter. No general workspace
 *     scanning, no other plugin types.
 *   - Failures are logged and swallowed: an unbuildable workspace
 *     plugin must not prevent the rest of the server from starting.
 *   - Does NOT call `setBrooklynCredentialResolver()`. That is a
 *     separate bootstrap step in `server/src/index.ts` so the
 *     resolver remains under explicit control of the bootstrap
 *     code path (and tests that spin up the registry without a Db
 *     handle don't accidentally register a half-wired adapter).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../middleware/logger.js";
import {
  addAdapterPlugin,
  listAdapterPlugins,
  type AdapterPluginRecord,
} from "../services/adapter-plugin-store.js";
import { loadExternalAdapterPackage } from "./plugin-loader.js";
import {
  findServerAdapter,
  registerServerAdapter,
  resolveExternalAdapterRegistration,
} from "./registry.js";
import { BROOKLYN_ADAPTER_TYPE } from "./brooklyn-secret-ref.js";

const BROOKLYN_PACKAGE_NAME = "@noralos-plugins/noralai-brooklyn";

/**
 * Resolve the absolute path of the workspace Brooklyn package.
 *
 * Layout in both source (dev, run via tsx) and built (prod, run from
 * `server/dist`) trees:
 *   <repoRoot>/packages/plugins/noralai-brooklyn
 *   <repoRoot>/server/src/adapters/auto-register-brooklyn.ts  (dev)
 *   <repoRoot>/server/dist/adapters/auto-register-brooklyn.js (prod)
 * Either way, three directories up from this file's directory is the
 * repo root (`adapters/ → src|dist/ → server/ → repoRoot`).
 */
function resolveWorkspacePluginPath(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(here), "..", "..", "..");
    const candidate = path.join(repoRoot, "packages", "plugins", "noralai-brooklyn");
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface BrooklynRegistrationOutcome {
  /** True if the adapter is registered in the active registry after this call. */
  registered: boolean;
  /** True if this call is what put it there (false on warm starts). */
  performedRegistration: boolean;
  /** True if `adapter-plugins.json` was extended in this call. */
  persistedToStore: boolean;
  reason?: string;
}

/**
 * Make sure `noralai_brooklyn` is registered and persisted. Safe to
 * call multiple times; the second call is a cheap O(1) check.
 *
 * Resolution order for the local path:
 *   1. Existing `adapter-plugins.json` entry (so an operator-pinned
 *      override wins).
 *   2. Workspace fallback (`packages/plugins/noralai-brooklyn`).
 */
export async function ensureBrooklynRegistered(): Promise<BrooklynRegistrationOutcome> {
  if (findServerAdapter(BROOKLYN_ADAPTER_TYPE)) {
    return {
      registered: true,
      performedRegistration: false,
      persistedToStore: false,
      reason: "already_registered",
    };
  }

  const existingRecord = listAdapterPlugins().find(
    (r) => r.type === BROOKLYN_ADAPTER_TYPE,
  );
  const localPath = existingRecord?.localPath ?? resolveWorkspacePluginPath();
  if (!localPath) {
    logger.warn(
      { packageName: BROOKLYN_PACKAGE_NAME },
      "Brooklyn LLM workspace plugin not found; skipping auto-registration. " +
        "Install manually via POST /api/adapters or check the repository layout.",
    );
    return {
      registered: false,
      performedRegistration: false,
      persistedToStore: false,
      reason: "no_local_path",
    };
  }

  let adapterModule;
  try {
    adapterModule = await loadExternalAdapterPackage(BROOKLYN_PACKAGE_NAME, localPath);
  } catch (err) {
    logger.error(
      { err, packageName: BROOKLYN_PACKAGE_NAME, localPath },
      "Failed to load workspace Brooklyn plugin; server continuing without it",
    );
    return {
      registered: false,
      performedRegistration: false,
      persistedToStore: false,
      reason: "load_failed",
    };
  }

  if (adapterModule.type !== BROOKLYN_ADAPTER_TYPE) {
    logger.error(
      {
        packageName: BROOKLYN_PACKAGE_NAME,
        expected: BROOKLYN_ADAPTER_TYPE,
        actual: adapterModule.type,
      },
      "Brooklyn plugin reported an unexpected adapter type; refusing to register",
    );
    return {
      registered: false,
      performedRegistration: false,
      persistedToStore: false,
      reason: "type_mismatch",
    };
  }

  registerServerAdapter(resolveExternalAdapterRegistration(adapterModule));

  let persistedToStore = false;
  if (!existingRecord) {
    const record: AdapterPluginRecord = {
      packageName: BROOKLYN_PACKAGE_NAME,
      localPath,
      type: BROOKLYN_ADAPTER_TYPE,
      installedAt: new Date().toISOString(),
    };
    addAdapterPlugin(record);
    persistedToStore = true;
  }

  logger.info(
    { type: BROOKLYN_ADAPTER_TYPE, packageName: BROOKLYN_PACKAGE_NAME, localPath },
    "Brooklyn LLM adapter auto-registered from workspace",
  );

  return {
    registered: true,
    performedRegistration: true,
    persistedToStore,
  };
}
