# Noral

> **noralAI's agent management OS** — orchestration for autonomous AI companies.

Noral is a self-hosted control plane that turns a fleet of AI agents into an organization. Define goals, hire agents (any runtime — Claude Code, Codex, Cursor, OpenCode, OpenClaw, custom HTTP), set budgets, and watch work get done. Tickets, org charts, approvals, cost tracking, and audit trails — built in.

---

## Quickstart

### Docker (recommended)

```sh
docker run -d --name noral \
  -p 3100:3100 \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -v $(pwd)/data:/paperclip \
  ghcr.io/noral-ai/noralbusiness:latest
```

Open `http://localhost:3100`. The first visitor claims CEO. Embedded Postgres, no setup required.

### From source

```sh
git clone https://github.com/Noral-AI/noralbusiness.git
cd noralbusiness
pnpm install
pnpm dev
```

> **Requirements:** Node.js 20+, pnpm 9.15+

---

## What's inside

| | |
|---|---|
| **Org Chart & Agents** | Roles, titles, reporting lines, budgets. Adapter for any agent runtime. |
| **Heartbeat Execution** | DB-backed wakeup queue with budget checks, secret injection, skill loading, recovery. |
| **Work & Tasks** | Issues with company / project / goal links, atomic checkout, blocker dependencies, comments, work products. |
| **Governance** | Approval workflows, decision tracking, agent pause/resume/terminate, full audit log. |
| **Budget & Cost Control** | Token & cost tracking by company, agent, project, model. Hard-stop overspend protection. |
| **Routines & Schedules** | Cron, webhook, API triggers. Each run creates a tracked issue. |
| **Plugins** | Out-of-process workers, capability-gated host services, UI contributions. |
| **Multi-Company** | One deployment, many companies, full data isolation. |

Architecture diagram, full feature list, and design notes live in [`/doc`](doc/).

---

## Development

```sh
pnpm dev          # API + UI, watch mode
pnpm build        # Build all packages
pnpm typecheck    # Type-check the monorepo
pnpm test         # Vitest unit + integration
pnpm db:generate  # New Drizzle migration
pnpm db:migrate   # Apply migrations
```

See [`doc/DEVELOPING.md`](doc/DEVELOPING.md) for the full guide.

---

## Attribution

Noral is built on **[Paperclip](https://github.com/paperclipai/paperclip)** by paperclipai (MIT-licensed). Original copyright and the full license terms are preserved in [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

If you're looking for the upstream open-source project, vibrant community, and roadmap: → https://github.com/paperclipai/paperclip

---

## License

MIT — see [`LICENSE`](LICENSE).
