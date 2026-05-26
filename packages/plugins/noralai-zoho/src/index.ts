/**
 * `@noralos-plugins/noralai-zoho` public entry.
 *
 * Re-exports the manifest (used by the host's manifest validator and by
 * the install-time DB row) plus named constants (tool names, plugin id)
 * so callers and tests don't have to import deep paths.
 *
 * The worker entrypoint lives at `dist/worker.js` after `pnpm build`; it
 * is referenced by the manifest's `entrypoints.worker` and is not
 * exported through this index because no in-process consumer imports it.
 */

export { manifest } from "./manifest.js";
export {
  PLUGIN_ID,
  PLUGIN_VERSION,
  ZOHO_LIST_MODULES_TOOL_NAME,
  ZOHO_SEARCH_RECORDS_TOOL_NAME,
  ZOHO_GET_RECORD_TOOL_NAME,
  ZOHO_CREATE_RECORD_TOOL_NAME,
  ZOHO_UPDATE_RECORD_TOOL_NAME,
  ZOHO_DEFAULT_TIMEOUT_MS,
  ZOHO_ACCOUNTS_HOST_BY_DC,
  ZOHO_API_HOST_BY_DC,
  TOOL_MIN_TIER,
  ROLE_TO_TIER,
  TIER_RANK,
} from "./constants.js";
export type { AgentTier, ZohoDataCenter } from "./constants.js";
