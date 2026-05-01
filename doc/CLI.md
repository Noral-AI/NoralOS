# CLI Reference

NoralOS CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm noralos --help
```

First-time local bootstrap + run:

```sh
pnpm noralos run
```

Choose local instance:

```sh
pnpm noralos run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `noralos onboard` and `paperclipai configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `paperclipai run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `NORALOS_DEPLOYMENT_MODE`
- `paperclipai run` and `paperclipai doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm noralos allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm noralos env-lab up
pnpm noralos env-lab doctor
pnpm noralos env-lab status --json
pnpm noralos env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.noralos`:

```sh
pnpm noralos run --data-dir ./tmp/noralos-dev
pnpm noralos issue list --data-dir ./tmp/noralos-dev
```

## Context Profiles

Store local defaults in `~/.noralos/context.json`:

```sh
pnpm noralos context set --api-base http://localhost:3100 --company-id <company-id>
pnpm noralos context show
pnpm noralos context list
pnpm noralos context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm noralos context set --api-key-env-var-name NORALOS_API_KEY
export NORALOS_API_KEY=...
```

## Company Commands

```sh
pnpm noralos company list
pnpm noralos company get <company-id>
pnpm noralos company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm noralos company delete PAP --yes --confirm PAP
pnpm noralos company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `NORALOS_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `NORALOS_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm noralos issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm noralos issue get <issue-id-or-identifier>
pnpm noralos issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm noralos issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm noralos issue comment <issue-id> --body "..." [--reopen]
pnpm noralos issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm noralos issue release <issue-id>
```

## Agent Commands

```sh
pnpm noralos agent list --company-id <company-id>
pnpm noralos agent get <agent-id>
pnpm noralos agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

`agent local-cli` is the quickest way to run local Claude/Codex manually as a NoralOS agent:

- creates a new long-lived agent API key
- installs missing NoralOS skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `NORALOS_API_URL`, `NORALOS_COMPANY_ID`, `NORALOS_AGENT_ID`, and `NORALOS_API_KEY`

Example for shortname-based local setup:

```sh
pnpm noralos agent local-cli codexcoder --company-id <company-id>
pnpm noralos agent local-cli claudecoder --company-id <company-id>
```

## Approval Commands

```sh
pnpm noralos approval list --company-id <company-id> [--status pending]
pnpm noralos approval get <approval-id>
pnpm noralos approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm noralos approval approve <approval-id> [--decision-note "..."]
pnpm noralos approval reject <approval-id> [--decision-note "..."]
pnpm noralos approval request-revision <approval-id> [--decision-note "..."]
pnpm noralos approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm noralos approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm noralos activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm noralos dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm noralos heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.noralos/instances/default`:

- config: `~/.noralos/instances/default/config.json`
- embedded db: `~/.noralos/instances/default/db`
- logs: `~/.noralos/instances/default/logs`
- storage: `~/.noralos/instances/default/data/storage`
- secrets key: `~/.noralos/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
NORALOS_HOME=/custom/home NORALOS_INSTANCE_ID=dev pnpm noralos run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm noralos configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
