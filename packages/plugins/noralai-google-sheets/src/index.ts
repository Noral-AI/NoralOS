/**
 * `@noralos-plugins/noralai-google-sheets` public entry.
 *
 * Re-exports the manifest (used by the host's manifest validator and by
 * the install-time DB row) plus the named constants (tool names, plugin
 * id) so callers and tests don't have to import deep paths.
 *
 * The worker entrypoint lives at `dist/worker.js` after `pnpm build`; it
 * is referenced by the manifest's `entrypoints.worker` and is not
 * exported through this index because no in-process consumer imports it.
 */

export { manifest } from "./manifest.js";
export {
  PLUGIN_ID,
  PLUGIN_VERSION,
  GSHEETS_LIST_SPREADSHEETS_TOOL_NAME,
  GSHEETS_GET_SPREADSHEET_TOOL_NAME,
  GSHEETS_READ_RANGE_TOOL_NAME,
  GSHEETS_APPEND_ROWS_TOOL_NAME,
  GSHEETS_UPDATE_RANGE_TOOL_NAME,
  GSHEETS_DEFAULT_TIMEOUT_MS,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_SHEETS_API_BASE,
  GOOGLE_DRIVE_API_BASE,
  TOOL_MIN_TIER,
  ROLE_TO_TIER,
  TIER_RANK,
} from "./constants.js";
export type { AgentTier } from "./constants.js";
