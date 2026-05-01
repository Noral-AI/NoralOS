---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm noralos issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm noralos issue get <issue-id-or-identifier>

# Create issue
pnpm noralos issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm noralos issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm noralos issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm noralos issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm noralos issue release <issue-id>
```

## Company Commands

```sh
pnpm noralos company list
pnpm noralos company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm noralos company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm noralos company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm noralos company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm noralos agent list
pnpm noralos agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm noralos approval list [--status pending]

# Get approval
pnpm noralos approval get <approval-id>

# Create approval
pnpm noralos approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm noralos approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm noralos approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm noralos approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm noralos approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm noralos approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm noralos activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm noralos dashboard get
```

## Heartbeat

```sh
pnpm noralos heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
