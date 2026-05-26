/**
 * `@noralos-plugins/noralai-slack` public entry.
 *
 * Re-exports the manifest (used by the host's manifest validator and
 * the install-time DB row), constants, and the Slack client types so
 * tests and downstream packages don't import deep paths.
 *
 * The worker entrypoint lives at `dist/worker.js` after `pnpm build`;
 * it is referenced by the manifest's `entrypoints.worker` field and is
 * not exported through this index file because no in-process consumer
 * imports it.
 */

export { manifest, default as default } from "./manifest.js";
export {
  PLUGIN_ID,
  PLUGIN_VERSION,
  SEND_MESSAGE_TOOL_NAME,
  POST_TO_THREAD_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  SLACK_SESSION_NAMESPACE,
  SLACK_SESSION_TTL_MS,
  SLACK_API_DEFAULT_TIMEOUT_MS,
  SLACK_MAX_MESSAGE_CHARS,
} from "./constants.js";
export {
  authTest,
  postMessage,
  listChannels,
  isRetryable,
  SlackProviderError,
  type SlackClientConfig,
  type SlackPostMessageRequest,
  type SlackPostMessageResult,
  type SlackChannelSummary,
  type SlackListChannelsResult,
  type SlackErrorCategory,
} from "./slack-client.js";
export {
  resolveSession,
  markSessionUsed,
  type RouteContext,
  type ResolvedSession,
} from "./agent-router.js";
