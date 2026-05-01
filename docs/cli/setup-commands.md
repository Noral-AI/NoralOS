---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `paperclipai run`

One-command bootstrap and start:

```sh
pnpm noralos run
```

Does:

1. Auto-onboards if config is missing
2. Runs `paperclipai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm noralos run --instance dev
```

## `noralos onboard`

Interactive first-time setup:

```sh
pnpm noralos onboard
```

If NoralOS is already configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm noralos onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm noralos onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts NoralOS with that setup.

## `paperclipai doctor`

Health checks with optional auto-repair:

```sh
pnpm noralos doctor
pnpm noralos doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `paperclipai configure`

Update configuration sections:

```sh
pnpm noralos configure --section server
pnpm noralos configure --section secrets
pnpm noralos configure --section storage
```

## `paperclipai env`

Show resolved environment configuration:

```sh
pnpm noralos env
```

This now includes bind-oriented deployment settings such as `NORALOS_BIND` and `NORALOS_BIND_HOST` when configured.

## `paperclipai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm noralos allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.noralos/instances/default/config.json` |
| Database | `~/.noralos/instances/default/db` |
| Logs | `~/.noralos/instances/default/logs` |
| Storage | `~/.noralos/instances/default/data/storage` |
| Secrets key | `~/.noralos/instances/default/secrets/master.key` |

Override with:

```sh
NORALOS_HOME=/custom/home NORALOS_INSTANCE_ID=dev pnpm noralos run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm noralos run --data-dir ./tmp/noralos-dev
pnpm noralos doctor --data-dir ./tmp/noralos-dev
```
