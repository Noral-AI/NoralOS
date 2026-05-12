# @noralos-plugins/noralai-slack

Slack channel for NoralOS agents.

A rep sends a DM (or @-mentions the bot in a channel) → the plugin
routes the message to the company's configured **default agent**
(e.g. Brooklyn, the CEO) → the agent's response posts back to Slack
in the same thread.

## How it works

| Direction | Mechanism |
| --- | --- |
| **Inbound** (Slack → agent) | Slack **Socket Mode** WebSocket — no public webhook required |
| **Outbound** (agent → Slack) | Slack **Web API** (`chat.postMessage`) |

Each `(channelId, userId)` (DMs) or `(channelId, threadTs)` (channel
threads) maps to one `agent.sessions` row, so multi-turn conversations
preserve context.

## v1 scope

- DMs to the bot get routed to the default agent
- @-mentions in any channel the bot is in get routed to the default agent
- Three agent tools for outbound posts: `send_message`, `post_to_thread`, `list_channels`
- Single-workspace, single-company per NoralOS deployment

## Out of scope (Phase 2)

- OAuth distributable app for self-service installs across many workspaces
- Per-channel agent routing (e.g. `#sales` → Sierra, `#engineering` → CTO agent)
- Slash commands (`/noralos send-contract …`)
- Interactive components (buttons, modals)
- File uploads + attachments

## Operator config

| Key             | Source | Description |
| --------------- | ------ | ----------- |
| `botToken`      | Secret ref (`xoxb-…`) | Bot User OAuth Token; scopes: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `users:read` |
| `appToken`      | Secret ref (`xapp-…`) | App-Level Token with `connections:write` (Socket Mode) |
| `defaultAgentId`| UUID | Agent that handles unrouted inbound (typically the CEO) |

## Slack app setup (one-time, manual)

1. **api.slack.com/apps** → Create New App → From scratch
2. **OAuth & Permissions → Bot Token Scopes**: add `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`, `users:read`
3. **Socket Mode → Enable**
4. **Event Subscriptions → Enable** (leave Request URL blank for Socket Mode) → subscribe to bot events: `app_mention`, `message.im`
5. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`)
6. **Basic Information → App-Level Tokens** → generate a token with `connections:write` (`xapp-…`)
7. Paste both tokens at NoralOS **Settings → Integrations → Slack** (Phase-2 provider entry — for now operators install via plugin_config)

## Plugin id (stable)

`noralai.slack`

Tools: `noralai.slack:send_message`, `noralai.slack:post_to_thread`, `noralai.slack:list_channels`
