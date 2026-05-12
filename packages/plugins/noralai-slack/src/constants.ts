/**
 * Constants shared between the manifest, worker, and tests.
 *
 * `PLUGIN_ID` is the stable identifier the host uses to namespace this
 * plugin's tools (e.g. `noralai.slack:send_message`). It MUST stay stable
 * across versions — operator-side assignments in `integration_credentials`
 * reference it by `pluginKey: "noralai.slack"`.
 */

export const PLUGIN_ID = "noralai.slack";
export const PLUGIN_VERSION = "0.1.0";

/** Tool names within this plugin. Each becomes `noralai.slack:<name>` at the host. */
export const SEND_MESSAGE_TOOL_NAME = "send_message";
export const POST_TO_THREAD_TOOL_NAME = "post_to_thread";
export const LIST_CHANNELS_TOOL_NAME = "list_channels";

/**
 * Plugin-state scope key for per-DM/per-thread agent sessions. We map
 * each Slack `(channelId, userId)` (DMs) or `(channelId, threadTs)`
 * (channel threads) to an `agent_session` row so multi-turn replies
 * preserve conversation context across messages.
 *
 * Keys are stored under scope `"company"` in plugin_state so they're
 * scoped per company.
 */
export const SLACK_SESSION_NAMESPACE = "slack-session";

/** TTL after which a stored session reference is considered stale and a new session is opened. */
export const SLACK_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Default per-call timeout for outbound Slack Web API calls. */
export const SLACK_API_DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Slack message length cap. The Slack API rejects messages over
 * ~40k chars; we keep a tighter cap so an agent's runaway response
 * gets truncated client-side instead of erroring at the edge.
 */
export const SLACK_MAX_MESSAGE_CHARS = 35_000;
