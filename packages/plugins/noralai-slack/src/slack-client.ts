/**
 * Slack Web API wrapper used by the worker for outbound posts.
 *
 * The official `@slack/web-api` SDK handles auth, rate limiting, and
 * pagination. We expose a narrow surface (the three calls the plugin
 * actually needs) plus typed error categories so the worker's failure
 * handling stays consistent with how Twilio + DocuSeal handle theirs.
 *
 * Secrets handling:
 *   - The bot token (`xoxb-…`) is captured at client construction and
 *     never logged or echoed. Errors carry the safe Slack error code
 *     (`invalid_auth`, `channel_not_found`, etc.) but not the token.
 *   - Message bodies are NEVER logged at warn+ level — agent responses
 *     often carry customer-identifying detail (deal terms, names).
 */

import { WebClient, ErrorCode, type WebClientOptions } from "@slack/web-api";

import { SLACK_API_DEFAULT_TIMEOUT_MS } from "./constants.js";

export interface SlackClientConfig {
  /** Slack Bot User OAuth Token (`xoxb-…`). */
  botToken: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

export type SlackErrorCategory =
  | "auth"
  | "channel_not_found"
  | "not_in_channel"
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "malformed"
  | "unknown";

export class SlackProviderError extends Error {
  category: SlackErrorCategory;
  slackError?: string;
  constructor(category: SlackErrorCategory, message: string, opts?: { slackError?: string }) {
    super(message);
    this.name = "SlackProviderError";
    this.category = category;
    this.slackError = opts?.slackError;
  }
}

export function isRetryable(category: SlackErrorCategory): boolean {
  return category === "network" || category === "timeout" || category === "rate_limit" || category === "server";
}

export interface SlackPostMessageRequest {
  channel: string;
  text: string;
  threadTs?: string;
  signal?: AbortSignal;
}

export interface SlackPostMessageResult {
  channel: string;
  ts: string;
  latencyMs: number;
}

export interface SlackChannelSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  topic: string | null;
}

export interface SlackListChannelsResult {
  channels: SlackChannelSummary[];
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function buildClient(config: SlackClientConfig): WebClient {
  const opts: WebClientOptions = {
    timeout: config.timeoutMs ?? SLACK_API_DEFAULT_TIMEOUT_MS,
    // The official client has built-in retry; cap it so a hung Slack call
    // doesn't block a worker thread indefinitely.
    retryConfig: { retries: 2, minTimeout: 500 },
  };
  return new WebClient(config.botToken, opts);
}

function classifyError(err: unknown): SlackProviderError {
  if (err instanceof SlackProviderError) return err;
  const slackErr = err as { code?: string; data?: { error?: string; retry_after?: number } };

  if (slackErr.code === ErrorCode.RequestError || slackErr.code === ErrorCode.HTTPError) {
    return new SlackProviderError("network", "Could not reach Slack.");
  }
  if (slackErr.code === ErrorCode.RateLimitedError) {
    return new SlackProviderError("rate_limit", "Slack rate limit hit; retry shortly.");
  }
  if (slackErr.code === ErrorCode.PlatformError) {
    const code = slackErr.data?.error ?? "unknown";
    if (code === "invalid_auth" || code === "not_authed" || code === "account_inactive") {
      return new SlackProviderError(
        "auth",
        "Slack rejected the bot token. Re-issue it in Settings → Integrations → Slack.",
        { slackError: code },
      );
    }
    if (code === "channel_not_found") {
      return new SlackProviderError("channel_not_found", `Slack channel not found.`, { slackError: code });
    }
    if (code === "not_in_channel" || code === "is_archived") {
      return new SlackProviderError(
        "not_in_channel",
        "The Slack bot is not a member of that channel (or it's archived).",
        { slackError: code },
      );
    }
    return new SlackProviderError("malformed", `Slack rejected the request (${code}).`, { slackError: code });
  }
  return new SlackProviderError("unknown", "Slack call failed for an unknown reason.");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function postMessage(
  config: SlackClientConfig,
  request: SlackPostMessageRequest,
): Promise<SlackPostMessageResult> {
  const client = buildClient(config);
  const started = Date.now();
  try {
    const result = await client.chat.postMessage({
      channel: request.channel,
      text: request.text,
      thread_ts: request.threadTs,
    });
    if (!result.ok || !result.ts || !result.channel) {
      throw new SlackProviderError(
        "malformed",
        "Slack returned ok=false without an error code.",
      );
    }
    return { channel: result.channel, ts: result.ts, latencyMs: Date.now() - started };
  } catch (err) {
    throw classifyError(err);
  }
}

export async function listChannels(
  config: SlackClientConfig,
  limit = 50,
): Promise<SlackListChannelsResult> {
  const client = buildClient(config);
  const started = Date.now();
  try {
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: Math.min(limit, 200),
    });
    if (!result.ok || !result.channels) {
      throw new SlackProviderError(
        "malformed",
        "Slack returned ok=false on conversations.list.",
      );
    }
    const channels: SlackChannelSummary[] = result.channels
      .filter((c) => typeof c.id === "string" && typeof c.name === "string")
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
        isPrivate: c.is_private === true,
        isMember: c.is_member === true,
        topic: typeof c.topic?.value === "string" ? c.topic.value : null,
      }));
    return { channels, latencyMs: Date.now() - started };
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * Probe the bot token for validity. Used at startup so a misconfigured
 * deployment fails fast with a clear log line instead of silently no-op'ing.
 * Returns the bot user id on success.
 */
export async function authTest(config: SlackClientConfig): Promise<{ botUserId: string; teamId: string }> {
  const client = buildClient(config);
  try {
    const result = await client.auth.test();
    if (!result.ok || !result.user_id || !result.team_id) {
      throw new SlackProviderError("malformed", "Slack auth.test returned ok=false.");
    }
    return { botUserId: result.user_id, teamId: result.team_id };
  } catch (err) {
    throw classifyError(err);
  }
}
