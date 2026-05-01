---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that NoralOS uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `NORALOS_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `NORALOS_BIND_HOST` | (unset) | Required when `NORALOS_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `NORALOS_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `NORALOS_HOME` | `~/.noralos` | Base directory for all NoralOS data |
| `NORALOS_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `NORALOS_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `NORALOS_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `NORALOS_API_URL` | (auto-derived) | NoralOS API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `NORALOS_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `NORALOS_SECRETS_MASTER_KEY_FILE` | `~/.noralos/.../secrets/master.key` | Path to key file |
| `NORALOS_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `NORALOS_AGENT_ID` | Agent's unique ID |
| `NORALOS_COMPANY_ID` | Company ID |
| `NORALOS_API_URL` | NoralOS API base URL (inherits the server-level value; see Server Configuration above) |
| `NORALOS_API_KEY` | Short-lived JWT for API auth |
| `NORALOS_RUN_ID` | Current heartbeat run ID |
| `NORALOS_TASK_ID` | Issue that triggered this wake |
| `NORALOS_WAKE_REASON` | Wake trigger reason |
| `NORALOS_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `NORALOS_APPROVAL_ID` | Resolved approval ID |
| `NORALOS_APPROVAL_STATUS` | Approval decision |
| `NORALOS_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
