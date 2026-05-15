/**
 * `@noralos-plugins/noralai-noralvoice` public entry.
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
  LIST_WORKFLOWS_TOOL_NAME,
  RUN_CALL_TOOL_NAME,
  GET_RUN_TOOL_NAME,
  RUN_COMPLETED_WEBHOOK_ENDPOINT_KEY,
  STATE_NAMESPACE,
  STATE_KEY_WEBHOOK_REGISTRATION,
  NORALVOICE_DEFAULT_TIMEOUT_MS,
  TOOL_MIN_TIER,
  ROLE_TO_TIER,
  TIER_RANK,
} from "./constants.js";
export type { AgentTier } from "./constants.js";
