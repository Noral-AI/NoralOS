/**
 * Slack plugin worker entrypoint.
 *
 * Lifecycle:
 *   - `setup` resolves the company config (botToken + appToken + defaultAgentId),
 *     opens a Socket Mode WebSocket to Slack, and wires inbound `message.im`
 *     and `app_mention` events to the agent-router.
 *   - Each inbound message gets routed through `ctx.agents.sessions` so the
 *     conversation history is preserved across turns. The agent's reply
 *     posts back to Slack via `chat.postMessage` in the same thread.
 *   - The three outbound tools (`send_message`, `post_to_thread`,
 *     `list_channels`) are registered so other agents can post to Slack
 *     directly as part of multi-step flows.
 *   - `onShutdown` disconnects the Socket Mode client cleanly so Slack's
 *     side doesn't sit on a dead socket through the reconnect window.
 *
 * Boundaries:
 *   - The bot and app tokens are resolved through `ctx.secrets.resolve()`
 *     at startup (because the Socket Mode connection is long-lived);
 *     outbound tool calls re-resolve on every invocation in case the
 *     token has been rotated.
 *   - We NEVER log Slack message bodies at warn+ level. The text often
 *     carries customer-identifying detail.
 *   - The plugin is intentionally SINGLE-COMPANY in v1 — the config
 *     is global, one Slack workspace per NoralOS deployment. Multi-tenant
 *     Slack (OAuth-distributable app, per-workspace tokens) is a Phase-2
 *     follow-up; see plan in agent-router docs.
 */

import { definePlugin, runWorker } from "@noralos/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@noralos/plugin-sdk";
import { SocketModeClient } from "@slack/socket-mode";

import {
  LIST_CHANNELS_TOOL_NAME,
  PLUGIN_ID,
  POST_TO_THREAD_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SLACK_MAX_MESSAGE_CHARS,
} from "./constants.js";
import manifest from "./manifest.js";
import {
  authTest,
  listChannels as slackListChannels,
  postMessage as slackPostMessage,
  SlackProviderError,
  type SlackClientConfig,
} from "./slack-client.js";
import { markSessionUsed, resolveSession } from "./agent-router.js";

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

let pluginCtx: PluginContext | null = null;
let socketClient: SocketModeClient | null = null;
let botUserId: string | null = null;
let cachedCompanyId: string | null = null;
let cachedDefaultAgentId: string | null = null;

// ---------------------------------------------------------------------------
// Config + secret resolution
// ---------------------------------------------------------------------------

interface ResolvedConfig {
  botToken: string;
  appToken: string;
  defaultAgentId: string;
  companyId: string;
}

interface InstanceConfig {
  botToken: string;
  appToken: string;
  defaultAgentId: string;
}

function readConfig(raw: Record<string, unknown>): InstanceConfig | { error: string } {
  const botToken = typeof raw.botToken === "string" ? raw.botToken.trim() : "";
  const appToken = typeof raw.appToken === "string" ? raw.appToken.trim() : "";
  const defaultAgentId = typeof raw.defaultAgentId === "string" ? raw.defaultAgentId.trim() : "";
  const missing: string[] = [];
  if (!botToken) missing.push("botToken");
  if (!appToken) missing.push("appToken");
  if (!defaultAgentId) missing.push("defaultAgentId");
  if (missing.length > 0) {
    return { error: `Slack plugin config is missing: ${missing.join(", ")}.` };
  }
  return { botToken, appToken, defaultAgentId };
}

/**
 * Resolve the full credentials needed to operate Slack on behalf of the
 * configured company. Per-tool invocations call this with the run-context
 * companyId so outbound posts use that company's bot token. The Socket
 * Mode connection at setup-time picks a single companyId (the one whose
 * config resolves first); multi-workspace support lands in Phase 2.
 */
async function resolveOperatingConfig(
  ctx: PluginContext,
  companyId: string,
): Promise<ResolvedConfig | { error: string }> {
  const raw = readConfig(await ctx.config.get());
  if ("error" in raw) return { error: raw.error };
  try {
    const [botToken, appToken] = await Promise.all([
      ctx.secrets.resolve(raw.botToken),
      ctx.secrets.resolve(raw.appToken),
    ]);
    if (!botToken || !appToken) {
      return { error: "Slack credentials resolved to empty values. Re-paste in Settings → Integrations → Slack." };
    }
    return { botToken, appToken, defaultAgentId: raw.defaultAgentId, companyId };
  } catch (err) {
    ctx.logger.error("Slack: failed to resolve botToken/appToken secrets", {
      companyId,
      err: err instanceof Error ? err.message : "unknown",
    });
    return { error: "Slack could not resolve credentials. Check Settings → Integrations → Slack." };
  }
}

// ---------------------------------------------------------------------------
// Truncate long agent replies so Slack accepts them
// ---------------------------------------------------------------------------

function safeTruncate(text: string): string {
  if (text.length <= SLACK_MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, SLACK_MAX_MESSAGE_CHARS - 80)}\n\n_(truncated — agent reply exceeded Slack's size cap)_`;
}

// ---------------------------------------------------------------------------
// Inbound event handler
// ---------------------------------------------------------------------------

interface InboundMessage {
  channelId: string;
  /** Thread anchor — the parent ts for channel mentions, or user id for DMs. */
  threadKey: string;
  /** Slack's `thread_ts` if this lands inside an existing thread; null otherwise. */
  threadTs: string | null;
  /** Free-text body the user sent. Strips a leading @-mention of the bot. */
  text: string;
  userId: string;
  /** Slack message ts (the unique id of THIS event). */
  ts: string;
}

function parseInboundEvent(
  event: Record<string, unknown>,
  ownBotUserId: string,
): InboundMessage | null {
  const type = typeof event.type === "string" ? event.type : null;
  const channelType = typeof event.channel_type === "string" ? event.channel_type : null;
  const text = typeof event.text === "string" ? event.text : "";
  const userId = typeof event.user === "string" ? event.user : "";
  const channelId = typeof event.channel === "string" ? event.channel : "";
  const ts = typeof event.ts === "string" ? event.ts : "";
  const threadTs = typeof event.thread_ts === "string" ? event.thread_ts : null;

  if (!type || !userId || !channelId || !ts) return null;
  // Ignore the bot's own messages (would otherwise loop on our own replies).
  if (userId === ownBotUserId) return null;
  // Ignore message edits, deletes, and bot-message subtypes.
  if (typeof event.subtype === "string") return null;

  if (type === "message" && channelType === "im") {
    // DM: thread anchor is the user (so different users in different DMs
    // don't collide on the bot's side of the channel).
    return {
      channelId,
      threadKey: userId,
      threadTs: threadTs ?? null,
      text: text.trim(),
      userId,
      ts,
    };
  }
  if (type === "app_mention") {
    // Channel @-mention: thread is the parent ts if we're already in a
    // thread, otherwise this mention's own ts (so the reply opens a new
    // thread off it).
    const mentionPattern = new RegExp(`<@${ownBotUserId}>\\s*`, "g");
    return {
      channelId,
      threadKey: threadTs ?? ts,
      threadTs: threadTs ?? ts,
      text: text.replace(mentionPattern, "").trim(),
      userId,
      ts,
    };
  }
  return null;
}

async function handleInboundMessage(ctx: PluginContext, msg: InboundMessage): Promise<void> {
  if (!cachedCompanyId || !cachedDefaultAgentId) {
    ctx.logger.warn("Slack inbound dropped — plugin not yet bound to a company");
    return;
  }
  if (!msg.text) {
    // Empty messages happen when a user shares a file with no text.
    // Ignore politely rather than confusing the agent with "".
    return;
  }

  const credResult = await resolveOperatingConfig(ctx, cachedCompanyId);
  if ("error" in credResult) {
    ctx.logger.error("Slack inbound dropped — credentials unavailable", { reason: credResult.error });
    return;
  }
  const slackConfig: SlackClientConfig = { botToken: credResult.botToken };

  let sessionInfo;
  try {
    sessionInfo = await resolveSession({
      ctx,
      companyId: cachedCompanyId,
      defaultAgentId: cachedDefaultAgentId,
      channelId: msg.channelId,
      threadKey: msg.threadKey,
    });
  } catch (err) {
    ctx.logger.error("Slack: could not open agent session", {
      companyId: cachedCompanyId,
      defaultAgentId: cachedDefaultAgentId,
      channelId: msg.channelId,
      err: err instanceof Error ? err.message : "unknown",
    });
    await postFallback(slackConfig, msg, "Sorry — I couldn't reach the agent. The operator has been notified.");
    return;
  }

  ctx.logger.info("Slack inbound routed to agent", {
    companyId: cachedCompanyId,
    sessionId: sessionInfo.sessionId,
    agentId: sessionInfo.agentId,
    channelId: msg.channelId,
    fresh: sessionInfo.fresh,
    // Intentionally NOT logging msg.text or msg.userId.
  });

  let finalText: string | null = null;
  let errored = false;

  try {
    await ctx.agents.sessions.sendMessage(sessionInfo.sessionId, cachedCompanyId, {
      prompt: msg.text,
      reason: "Slack inbound message",
      onEvent: (event) => {
        if (event.eventType === "done" && typeof event.message === "string") {
          finalText = event.message;
        } else if (event.eventType === "error") {
          errored = true;
          ctx.logger.warn("Slack: agent returned error event", {
            sessionId: sessionInfo.sessionId,
            message: typeof event.message === "string" ? event.message : null,
          });
        }
      },
    });
  } catch (err) {
    ctx.logger.error("Slack: agent.sessions.sendMessage threw", {
      sessionId: sessionInfo.sessionId,
      err: err instanceof Error ? err.message : "unknown",
    });
    await postFallback(slackConfig, msg, "Sorry — the agent run failed. Please try again or contact your operator.");
    return;
  }

  await markSessionUsed(
    ctx,
    cachedCompanyId,
    msg.channelId,
    msg.threadKey,
    sessionInfo.sessionId,
    sessionInfo.agentId,
  );

  if (errored || !finalText) {
    await postFallback(
      slackConfig,
      msg,
      finalText ?? "The agent didn't produce a reply this time. Try rephrasing or escalate to a human.",
    );
    return;
  }

  try {
    const reply = await slackPostMessage(slackConfig, {
      channel: msg.channelId,
      text: safeTruncate(finalText),
      threadTs: msg.threadTs ?? undefined,
    });
    ctx.logger.info("Slack reply posted", {
      sessionId: sessionInfo.sessionId,
      channelId: msg.channelId,
      ts: reply.ts,
      latencyMs: reply.latencyMs,
    });
  } catch (err) {
    const cat = err instanceof SlackProviderError ? err.category : "unknown";
    ctx.logger.error("Slack: failed to post reply", {
      sessionId: sessionInfo.sessionId,
      category: cat,
    });
  }
}

async function postFallback(slackConfig: SlackClientConfig, msg: InboundMessage, body: string): Promise<void> {
  try {
    await slackPostMessage(slackConfig, {
      channel: msg.channelId,
      text: body,
      threadTs: msg.threadTs ?? undefined,
    });
  } catch {
    // intentionally swallowed — fallback's already a degraded path.
  }
}

// ---------------------------------------------------------------------------
// Socket Mode lifecycle
// ---------------------------------------------------------------------------

async function startSocketMode(ctx: PluginContext, cfg: ResolvedConfig): Promise<void> {
  if (socketClient) {
    ctx.logger.warn("Slack: Socket Mode start called while already connected; closing previous");
    await socketClient.disconnect().catch(() => undefined);
    socketClient = null;
  }

  const client = new SocketModeClient({ appToken: cfg.appToken });

  client.on("message", async (args: { event?: Record<string, unknown>; ack: () => Promise<void> }) => {
    try {
      await args.ack();
    } catch {
      // ack failures don't affect downstream processing
    }
    const parsed = args.event ? parseInboundEvent(args.event, botUserId ?? "") : null;
    if (!parsed) return;
    void handleInboundMessage(ctx, parsed).catch((err) => {
      ctx.logger.error("Slack: handleInboundMessage threw at top level", {
        err: err instanceof Error ? err.message : "unknown",
      });
    });
  });

  client.on("app_mention", async (args: { event?: Record<string, unknown>; ack: () => Promise<void> }) => {
    try {
      await args.ack();
    } catch {
      // best-effort ack
    }
    const parsed = args.event ? parseInboundEvent(args.event, botUserId ?? "") : null;
    if (!parsed) return;
    void handleInboundMessage(ctx, parsed).catch((err) => {
      ctx.logger.error("Slack: handleInboundMessage threw at top level", {
        err: err instanceof Error ? err.message : "unknown",
      });
    });
  });

  client.on("disconnect", () => {
    ctx.logger.warn("Slack Socket Mode disconnected; client will auto-reconnect");
  });
  client.on("error", (err: unknown) => {
    ctx.logger.error("Slack Socket Mode error", {
      err: err instanceof Error ? err.message : "unknown",
    });
  });

  await client.start();
  socketClient = client;
  ctx.logger.info("Slack Socket Mode connected", { botUserId, companyId: cfg.companyId });
}

// ---------------------------------------------------------------------------
// Outbound tools
// ---------------------------------------------------------------------------

type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): ParamResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ParamResult<T> => ({ ok: false, error });

function readParamsObject(raw: unknown, tool: string): ParamResult<Record<string, unknown>> {
  if (raw == null) return ok({});
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return fail(`${tool} parameters must be an object.`);
  }
  return ok(raw as Record<string, unknown>);
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  maxLen: number,
  tool: string,
): ParamResult<string> {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    return fail(`${tool}.\`${key}\` is required.`);
  }
  if (value.length > maxLen) {
    return fail(`${tool}.\`${key}\` exceeds the ${maxLen}-char limit.`);
  }
  return ok(value);
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;

    // Each tool wraps the same flow: read params, resolve creds for the
    // calling agent's company, invoke Slack, log + return.
    function registerTool<T>(
      toolName: string,
      readParams: (raw: Record<string, unknown>) => ParamResult<T>,
      executor: (
        params: T,
        slackConfig: SlackClientConfig,
        runCtx: ToolRunContext,
      ) => Promise<ToolResult>,
    ): void {
      const decl = manifest.tools?.find((t) => t.name === toolName);
      if (!decl) throw new Error(`Slack worker: tool '${toolName}' missing from manifest`);
      ctx.tools.register(
        toolName,
        {
          displayName: decl.displayName,
          description: decl.description,
          parametersSchema: decl.parametersSchema,
        },
        async (rawParams, runCtx) => {
          if (!runCtx.companyId) {
            return { error: "Slack tools require an agent-scoped run context." };
          }
          const paramsObj = readParamsObject(rawParams, toolName);
          if (!paramsObj.ok) return { error: paramsObj.error };
          const parsed = readParams(paramsObj.value);
          if (!parsed.ok) return { error: parsed.error };
          const cred = await resolveOperatingConfig(ctx, runCtx.companyId);
          if ("error" in cred) return { error: cred.error };
          const slackConfig: SlackClientConfig = { botToken: cred.botToken };
          try {
            return await executor(parsed.value, slackConfig, runCtx);
          } catch (err) {
            const cat = err instanceof SlackProviderError ? err.category : "unknown";
            ctx.logger.warn(`Slack tool '${toolName}' failed`, {
              companyId: runCtx.companyId,
              agentId: runCtx.agentId,
              category: cat,
            });
            return {
              error: err instanceof SlackProviderError ? err.message : "Slack call failed.",
            };
          }
        },
      );
    }

    // ---- send_message ---------------------------------------------------
    registerTool<{ channel: string; text: string }>(
      SEND_MESSAGE_TOOL_NAME,
      (raw) => {
        const channel = requireString(raw, "channel", 200, SEND_MESSAGE_TOOL_NAME);
        if (!channel.ok) return channel;
        const text = requireString(raw, "text", SLACK_MAX_MESSAGE_CHARS, SEND_MESSAGE_TOOL_NAME);
        if (!text.ok) return text;
        return ok({ channel: channel.value, text: text.value });
      },
      async (params, slackConfig, runCtx) => {
        const result = await slackPostMessage(slackConfig, params);
        ctx.logger.info("Slack send_message ok", {
          companyId: runCtx.companyId,
          agentId: runCtx.agentId,
          channelId: result.channel,
          ts: result.ts,
          latencyMs: result.latencyMs,
        });
        return {
          content: `Posted to Slack channel ${result.channel}.`,
          data: { channel: result.channel, ts: result.ts },
        };
      },
    );

    // ---- post_to_thread -------------------------------------------------
    registerTool<{ channel: string; threadTs: string; text: string }>(
      POST_TO_THREAD_TOOL_NAME,
      (raw) => {
        const channel = requireString(raw, "channel", 200, POST_TO_THREAD_TOOL_NAME);
        if (!channel.ok) return channel;
        const threadTs = requireString(raw, "threadTs", 50, POST_TO_THREAD_TOOL_NAME);
        if (!threadTs.ok) return threadTs;
        const text = requireString(raw, "text", SLACK_MAX_MESSAGE_CHARS, POST_TO_THREAD_TOOL_NAME);
        if (!text.ok) return text;
        return ok({ channel: channel.value, threadTs: threadTs.value, text: text.value });
      },
      async (params, slackConfig) => {
        const result = await slackPostMessage(slackConfig, {
          channel: params.channel,
          text: params.text,
          threadTs: params.threadTs,
        });
        return {
          content: `Replied in Slack thread ${params.threadTs}.`,
          data: { channel: result.channel, ts: result.ts },
        };
      },
    );

    // ---- list_channels --------------------------------------------------
    registerTool<{ limit?: number }>(
      LIST_CHANNELS_TOOL_NAME,
      (raw) => {
        if (raw.limit === undefined) return ok({});
        if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 200) {
          return fail(`${LIST_CHANNELS_TOOL_NAME}.\`limit\` must be an integer between 1 and 200.`);
        }
        return ok({ limit: raw.limit });
      },
      async (params, slackConfig) => {
        const result = await slackListChannels(slackConfig, params.limit);
        return {
          content: `Bot is in ${result.channels.length} channel(s).`,
          data: { channels: result.channels },
        };
      },
    );

    // ---- Socket Mode connection (one per plugin lifetime, single workspace) -----
    const raw = readConfig(await ctx.config.get());
    if ("error" in raw) {
      // No config yet — plugin starts but won't receive inbound. Outbound
      // tools will return "config missing" until configured.
      ctx.logger.warn("Slack: config not yet set; Socket Mode connection deferred", {
        reason: raw.error,
      });
      return;
    }

    // We need a companyId to scope secret resolution. The plugin_config
    // is global, but the secret rows are per-company. We bind to the
    // first company that has a valid config — i.e. whose secret UUIDs
    // resolve cleanly. For single-tenant deployments (the v1 norm)
    // this is uncontroversial.
    let resolved: ResolvedConfig | { error: string } = { error: "not yet attempted" };
    const candidateCompanies = await pickCompanies(ctx);
    for (const companyId of candidateCompanies) {
      const r = await resolveOperatingConfig(ctx, companyId);
      if (!("error" in r)) {
        resolved = r;
        break;
      }
    }
    if ("error" in resolved) {
      ctx.logger.warn("Slack: no company has resolvable Slack credentials; inbound disabled until configured", {
        reason: resolved.error,
      });
      return;
    }

    cachedCompanyId = resolved.companyId;
    cachedDefaultAgentId = resolved.defaultAgentId;

    try {
      const auth = await authTest({ botToken: resolved.botToken });
      botUserId = auth.botUserId;
      ctx.logger.info("Slack auth.test ok", {
        botUserId: auth.botUserId,
        teamId: auth.teamId,
        companyId: resolved.companyId,
      });
    } catch (err) {
      ctx.logger.error("Slack: auth.test failed; not opening Socket Mode", {
        err: err instanceof SlackProviderError ? err.message : "unknown",
      });
      return;
    }

    try {
      await startSocketMode(ctx, resolved);
    } catch (err) {
      ctx.logger.error("Slack: Socket Mode start failed", {
        err: err instanceof Error ? err.message : "unknown",
      });
    }

    ctx.logger.info(`${PLUGIN_ID} plugin setup complete`);
  },

  async onConfigChanged() {
    // Operator updated tokens — tear down + restart the socket. We don't
    // hot-swap because the @slack/socket-mode client owns its websocket
    // and reconnecting with a new appToken requires a fresh client.
    if (!pluginCtx) return;
    pluginCtx.logger.info("Slack: config changed; will reconnect on next setup");
    if (socketClient) {
      await socketClient.disconnect().catch(() => undefined);
      socketClient = null;
    }
    // The plugin lifecycle manager restarts the worker after onConfigChanged
    // returns if we don't reconnect here; we let the worker exit naturally
    // so a clean restart with the new config kicks in.
  },

  async onShutdown() {
    if (socketClient) {
      try {
        await socketClient.disconnect();
      } catch {
        // best-effort
      }
      socketClient = null;
    }
  },

  async onHealth() {
    return {
      status: socketClient ? "ok" : "degraded",
      message: socketClient
        ? `${PLUGIN_ID} connected (botUserId=${botUserId ?? "?"})`
        : `${PLUGIN_ID} not connected — check config`,
    };
  },
});

/**
 * Determine which companies might have Slack configured. The plugin
 * config is global but secrets are per-company; we ask the agents
 * client for a list of companies indirectly by walking entity scopes.
 * In v1 we fall back to a single env-pinned company if set, otherwise
 * try every company in the host until one resolves.
 */
async function pickCompanies(ctx: PluginContext): Promise<string[]> {
  // Env override for single-tenant deployments. The deploy operator can
  // pin SLACK_PIN_COMPANY_ID in the server's env if multiple companies
  // exist and only one should host the Slack workspace.
  const pinned = process.env.SLACK_PIN_COMPANY_ID;
  if (pinned && pinned.length > 0) {
    return [pinned];
  }
  // Otherwise: enumerate companies via the entities/companies client.
  // If unavailable, return empty — the caller logs and skips startup.
  try {
    const list = await ctx.companies.list({ limit: 50 });
    return list.map((c) => c.id);
  } catch {
    return [];
  }
}

export default plugin;
runWorker(plugin, import.meta.url);
