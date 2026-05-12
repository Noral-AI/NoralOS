/**
 * Slack plugin manifest.
 *
 * Architecture:
 *   - **Inbound** (Slack → agent): the worker opens a Slack Socket Mode
 *     WebSocket on startup using `appToken`. DMs and @-mentions stream
 *     in as events and get routed to the configured `defaultAgentId`
 *     via `ctx.agents.sessions`. No host webhook is needed — Slack
 *     pushes events through the socket.
 *   - **Outbound** (agent → Slack): the worker uses `botToken` to call
 *     Slack's Web API (`chat.postMessage`, `chat.update`, `conversations.list`).
 *     Agents can also invoke outbound tools directly to send Slack messages
 *     as part of multi-step flows (e.g. a sales-contract agent posting
 *     a deal status update to a #revenue channel).
 *
 * Per-company config (`instanceConfigSchema`):
 *   - `botToken`: secret-ref UUID — Slack Bot User OAuth Token (`xoxb-…`)
 *   - `appToken`: secret-ref UUID — Slack App-Level Token (`xapp-…`),
 *     scoped to `connections:write` for Socket Mode
 *   - `defaultAgentId`: UUID of the agent that receives unrouted DMs +
 *     @-mentions (today, this is Brooklyn). Routing per channel/user is
 *     a Phase-2 follow-up.
 *
 * Tools registered:
 *   - `send_message` — post to any channel the bot can reach
 *   - `post_to_thread` — reply in an existing thread
 *   - `list_channels` — discover channels the bot is in
 */

import type { NoralosPluginManifestV1 } from "@noralos/shared";

import {
  LIST_CHANNELS_TOOL_NAME,
  PLUGIN_ID,
  PLUGIN_VERSION,
  POST_TO_THREAD_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SLACK_MAX_MESSAGE_CHARS,
} from "./constants.js";

const manifest: NoralosPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Slack",
  description:
    "Bridges a Slack workspace into NoralOS so reps can DM or @-mention a bot and have the conversation routed to a NoralOS agent (e.g. Brooklyn, the CEO). Uses Socket Mode for inbound events (no public webhook required) and Slack's Web API for outbound posts.",
  author: "NoralOS",
  categories: ["connector"],

  capabilities: [
    // Outbound calls to Slack's Web API.
    "http.outbound",
    // Resolve botToken / appToken from per-company secret refs.
    "secrets.read-ref",
    // Register the outbound tools (send_message, post_to_thread, list_channels).
    "agent.tools.register",
    // Audit trail of inbound deliveries and outbound posts.
    "activity.log.write",
    // Resolve agents by id/role when picking the default routing target.
    "agents.read",
    // Enumerate companies at setup time to find which one has Slack
    // credentials configured (the plugin_config is global, but secrets
    // are per-company; we bind to the company whose tokens resolve).
    "companies.read",
    // Open an agent session per Slack DM/thread and stream replies.
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    // Persist the Slack-channel/thread → agent-session mapping so a
    // multi-turn conversation reuses the same session.
    "plugin.state.read",
    "plugin.state.write",
    // Emit `noralai.slack.message.received` / `noralai.slack.reply.sent`
    // for downstream skills (e.g. sales-contract routing).
    "events.emit",
  ],

  entrypoints: {
    worker: "./dist/worker.js",
  },

  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    required: ["botToken", "appToken", "defaultAgentId"],
    properties: {
      botToken: {
        type: "string",
        description:
          "Encrypted-secret reference (UUID) to the Slack Bot User OAuth Token (`xoxb-…`). The bot token authorizes outbound calls (chat.postMessage, etc.) and must carry the scopes app_mentions:read, chat:write, im:history, im:read, im:write, users:read.",
        minLength: 1,
      },
      appToken: {
        type: "string",
        description:
          "Encrypted-secret reference (UUID) to the Slack App-Level Token (`xapp-…`) with `connections:write` scope. Used to open the Socket Mode WebSocket for inbound events.",
        minLength: 1,
      },
      defaultAgentId: {
        type: "string",
        description:
          "UUID of the agent that handles inbound Slack messages (DMs and @-mentions) when no other routing rule matches. Typically the company's CEO/Brooklyn.",
        minLength: 1,
      },
    },
  },

  tools: [
    {
      name: SEND_MESSAGE_TOOL_NAME,
      displayName: "Send a Slack message",
      description:
        "Post a message to a Slack channel or DM the bot has access to. Use when an agent needs to proactively notify a rep — e.g. 'Acme just signed the MSA' to #revenue. The bot must be a member of the channel first; use `list_channels` to confirm.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "text"],
        properties: {
          channel: {
            type: "string",
            description:
              "Channel id (`C0123ABCD`), user id (`U0123ABCD`) for a DM, or channel name with hash (`#revenue`). Prefer ids — names get resolved server-side and can collide.",
            minLength: 1,
            maxLength: 200,
          },
          text: {
            type: "string",
            description:
              "Message body. Supports Slack mrkdwn (bold *text*, code `text`, links <https://…|label>).",
            minLength: 1,
            maxLength: SLACK_MAX_MESSAGE_CHARS,
          },
        },
      },
    },
    {
      name: POST_TO_THREAD_TOOL_NAME,
      displayName: "Reply in a Slack thread",
      description:
        "Reply to an existing message thread. Use after `send_message` returns a `ts` so the reply lands as a thread reply rather than a new top-level message. Also the right tool for continuing a conversation the bot was @-mentioned in.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        required: ["channel", "threadTs", "text"],
        properties: {
          channel: {
            type: "string",
            description: "Channel id of the parent message.",
            minLength: 1,
            maxLength: 200,
          },
          threadTs: {
            type: "string",
            description:
              "Timestamp (`ts` field) of the parent message — Slack uses this to group threaded replies.",
            minLength: 1,
            maxLength: 50,
          },
          text: {
            type: "string",
            description: "Reply body. Supports Slack mrkdwn.",
            minLength: 1,
            maxLength: SLACK_MAX_MESSAGE_CHARS,
          },
        },
      },
    },
    {
      name: LIST_CHANNELS_TOOL_NAME,
      displayName: "List Slack channels the bot is in",
      description:
        "Return channels the bot is a member of. Use before `send_message` to confirm the bot has access, or to surface a picker to the rep.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of channels to return. Defaults to 50; cap is 200.",
            minimum: 1,
            maximum: 200,
          },
        },
      },
    },
  ],
};

// The plugin-loader's `mod.default ?? mod` import path resolves to the
// default export, so make sure the default IS the manifest object — not
// the module namespace. (Learned the hard way during NoralSign Phase 1.)
export { manifest };
export default manifest;
