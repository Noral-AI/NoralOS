# PAPERCLIP_TREE — Noral-AI/NoralOS @ HEAD f1a312f7

Generated 2026-04-30 from `/tmp/noralos-audit/NoralOS`. Depth 3, excluding node_modules/.git/dist/build/.next/coverage. Substituted for tree(1) since tree is not installed locally.

Total entries: 438

```
.
.agents
  |-- skills
    |-- company-creator
    |-- create-agent-adapter
    |-- deal-with-security-advisory
    |-- doc-maintenance
    |-- pr-report
    |-- prcheckloop
    |-- release
    |-- release-changelog
.claude
  |-- skills
    |-- company-creator
    |-- design-guide
    |-- paperclip
.dockerignore
.env.example
.mailmap
.npmrc
AGENTS.md
CONTRIBUTING.md
Dockerfile
LICENSE
NOTICE
README.md
ROADMAP.md
SECURITY.md
adapter-plugin.md
cli
  |-- CHANGELOG.md
  |-- README.md
  |-- esbuild.config.mjs
  |-- package.json
  |-- src
    |-- __tests__
    |-- adapters
    |-- checks
    |-- client
    |-- commands
    |-- config
    |-- index.ts
    |-- prompts
    |-- telemetry.ts
    |-- utils
    |-- version.ts
  |-- tsconfig.json
  |-- vitest.config.ts
doc
  |-- AGENTCOMPANIES_SPEC_INVENTORY.md
  |-- CLI.md
  |-- CLIPHUB.md
  |-- DATABASE.md
  |-- DEPLOYMENT-MODES.md
  |-- DEVELOPING.md
  |-- DOCKER.md
  |-- GOAL.md
  |-- OPENCLAW_ONBOARDING.md
  |-- PRODUCT.md
  |-- PUBLISHING.md
  |-- README-draft.md
  |-- RELEASE-AUTOMATION-SETUP.md
  |-- RELEASING.md
  |-- SPEC-implementation.md
  |-- SPEC.md
  |-- TASKS-mcp.md
  |-- TASKS.md
  |-- UNTRUSTED-PR-REVIEW.md
  |-- assets
    |-- avatars
    |-- footer.jpg
    |-- header.png
    |-- logos
    |-- pap-2189
  |-- execution-semantics.md
  |-- experimental
    |-- issue-worktree-support.md
  |-- memory-landscape.md
  |-- plans
    |-- 2026-02-16-module-system.md
    |-- 2026-02-18-agent-authentication-implementation.md
    |-- 2026-02-18-agent-authentication.md
    |-- 2026-02-19-agent-mgmt-followup-plan.md
    |-- 2026-02-19-ceo-agent-creation-and-hiring.md
    |-- 2026-02-20-issue-run-orchestration-plan.md
    |-- 2026-02-20-storage-system-implementation.md
    |-- 2026-02-21-humans-and-permissions-implementation.md
    |-- 2026-02-21-humans-and-permissions.md
    |-- 2026-02-23-cursor-cloud-adapter.md
    |-- 2026-02-23-deployment-auth-mode-consolidation.md
    |-- 2026-03-10-workspace-strategy-and-git-worktrees.md
    |-- 2026-03-11-agent-chat-ui-and-issue-backed-conversations.md
    |-- 2026-03-13-TOKEN-OPTIMIZATION-PLAN.md
    |-- 2026-03-13-agent-evals-framework.md
    |-- 2026-03-13-company-import-export-v2.md
    |-- 2026-03-13-features.md
    |-- 2026-03-13-paperclip-skill-tightening-plan.md
    |-- 2026-03-13-plugin-kitchen-sink-example.md
    |-- 2026-03-13-workspace-product-model-and-work-product.md
    |-- 2026-03-14-adapter-skill-sync-rollout.md
    |-- 2026-03-14-billing-ledger-and-reporting.md
    |-- 2026-03-14-budget-policies-and-enforcement.md
    |-- 2026-03-14-skills-ui-product-plan.md
    |-- 2026-03-17-docker-release-browser-e2e.md
    |-- 2026-03-17-memory-service-surface-api.md
    |-- 2026-03-17-release-automation-and-versioning.md
    |-- 2026-04-06-smart-model-routing.md
    |-- 2026-04-06-subissue-creation-on-issue-detail.md
    |-- 2026-04-07-issue-detail-speed-and-optimistic-inventory.md
    |-- 2026-04-07-pi-hooks-survey.md
    |-- 2026-04-08-agent-browser-process-cleanup-plan.md
    |-- 2026-04-08-agent-os-follow-up-plan.md
    |-- 2026-04-08-agent-os-technical-report.md
    |-- 2026-04-12-vscode-task-interoperability-plan.md
    |-- workspace-product-model-and-work-product.md
    |-- workspace-technical-implementation.md
  |-- plugins
    |-- PLUGIN_AUTHORING_GUIDE.md
    |-- PLUGIN_SPEC.md
    |-- ideas-from-opencode.md
  |-- spec
    |-- agent-runs.md
    |-- agents-runtime.md
    |-- invite-flow.md
    |-- ui.md
docker
  |-- .env.aws.example
  |-- Dockerfile.onboard-smoke
  |-- docker-compose.quickstart.yml
  |-- docker-compose.untrusted-review.yml
  |-- docker-compose.yml
  |-- ecs-task-definition.json
  |-- openclaw-smoke
    |-- Dockerfile
    |-- server.mjs
  |-- quadlet
    |-- paperclip-db.container
    |-- paperclip.container
    |-- paperclip.pod
  |-- untrusted-review
    |-- Dockerfile
    |-- bin
docs
  |-- adapters
    |-- adapter-ui-parser.md
    |-- claude-local.md
    |-- codex-local.md
    |-- creating-an-adapter.md
    |-- external-adapters.md
    |-- gemini-local.md
    |-- http.md
    |-- overview.md
    |-- process.md
  |-- agents-runtime.md
  |-- api
    |-- activity.md
    |-- agents.md
    |-- approvals.md
    |-- authentication.md
    |-- companies.md
    |-- costs.md
    |-- dashboard.md
    |-- goals-and-projects.md
    |-- issues.md
    |-- overview.md
    |-- routines.md
    |-- secrets.md
  |-- cli
    |-- control-plane-commands.md
    |-- overview.md
    |-- setup-commands.md
  |-- companies
    |-- companies-spec.md
  |-- deploy
    |-- aws-ecs.md
    |-- database.md
    |-- deployment-modes.md
    |-- docker.md
    |-- environment-variables.md
    |-- local-development.md
    |-- overview.md
    |-- secrets.md
    |-- storage.md
    |-- tailscale-private-access.md
  |-- docs.json
  |-- favicon.svg
  |-- feedback-voting.md
  |-- guides
    |-- agent-developer
    |-- board-operator
    |-- execution-policy.md
    |-- openclaw-docker-setup.md
  |-- images
    |-- logo-dark.svg
    |-- logo-light.svg
  |-- plans
    |-- 2026-03-13-issue-documents-plan.md
  |-- pr-screenshots
    |-- pr-4616
  |-- specs
    |-- agent-config-ui.md
    |-- cliphub-plan.md
  |-- start
    |-- architecture.md
    |-- core-concepts.md
    |-- quickstart.md
    |-- what-is-paperclip.md
evals
  |-- README.md
  |-- promptfoo
    |-- promptfooconfig.yaml
    |-- prompts
    |-- tests
package.json
packages
  |-- adapter-utils
    |-- CHANGELOG.md
    |-- package.json
    |-- src
    |-- tsconfig.json
  |-- adapters
    |-- claude-local
    |-- codex-local
    |-- cursor-local
    |-- gemini-local
    |-- openclaw-gateway
    |-- opencode-local
    |-- pi-local
  |-- db
    |-- CHANGELOG.md
    |-- drizzle.config.ts
    |-- package.json
    |-- scripts
    |-- src
    |-- tsconfig.json
    |-- vitest.config.ts
  |-- mcp-server
    |-- README.md
    |-- package.json
    |-- src
    |-- tsconfig.json
    |-- vitest.config.ts
  |-- plugins
    |-- create-paperclip-plugin
    |-- examples
    |-- paperclip-plugin-fake-sandbox
    |-- sandbox-providers
    |-- sdk
  |-- shared
    |-- CHANGELOG.md
    |-- package.json
    |-- src
    |-- tsconfig.json
    |-- vitest.config.ts
patches
  |-- embedded-postgres@18.1.0-beta.16.patch
pnpm-lock.yaml
pnpm-workspace.yaml
releases
  |-- v0.2.7.md
  |-- v0.3.0.md
  |-- v0.3.1.md
  |-- v2026.318.0.md
  |-- v2026.325.0.md
  |-- v2026.403.0.md
  |-- v2026.414.0.md
  |-- v2026.415.0.md
  |-- v2026.416.0.md
  |-- v2026.427.0.md
  |-- v2026.428.0.md
report
  |-- 2026-03-13-08-46-token-optimization-implementation.md
scripts
  |-- backfill-issue-reference-mentions.ts
  |-- backup-db.sh
  |-- check-docker-deps-stage.mjs
  |-- check-forbidden-tokens.mjs
  |-- clean-onboard-git.sh
  |-- clean-onboard-npm.sh
  |-- clean-onboard-ref.sh
  |-- create-github-release.sh
  |-- dev-runner-output.mjs
  |-- dev-runner-output.ts
  |-- dev-runner-paths.mjs
  |-- dev-runner.mjs
  |-- dev-runner.ts
  |-- dev-service-profile.ts
  |-- dev-service.ts
  |-- discord-daily-digest.sh
  |-- docker-build-test.sh
  |-- docker-entrypoint.sh
  |-- docker-onboard-smoke.sh
  |-- ensure-plugin-build-deps.mjs
  |-- ensure-workspace-package-links.ts
  |-- generate-company-assets.ts
  |-- generate-npm-package-json.mjs
  |-- generate-org-chart-images.ts
  |-- generate-org-chart-satori-comparison.ts
  |-- generate-plugin-package-json.mjs
  |-- generate-ui-package-json.mjs
  |-- kill-agent-browsers.sh
  |-- kill-dev.sh
  |-- kill-vitest.sh
  |-- link-plugin-dev-sdk.mjs
  |-- migrate-inline-env-secrets.ts
  |-- paperclip-commit-metrics.ts
  |-- paperclip-issue-update.sh
  |-- prepare-server-ui-dist.sh
  |-- provision-worktree.sh
  |-- release-lib.sh
  |-- release-package-map.mjs
  |-- release.sh
  |-- rollback-latest.sh
  |-- run-vitest-stable.mjs
  |-- screenshot-pap2373.mjs
  |-- screenshot-subissues.mjs
  |-- screenshot.cjs
  |-- smoke
    |-- openclaw-docker-ui.sh
    |-- openclaw-gateway-e2e.sh
    |-- openclaw-join.sh
    |-- openclaw-sse-standalone.sh
server
  |-- CHANGELOG.md
  |-- package.json
  |-- scripts
    |-- dev-watch.ts
  |-- src
    |-- __tests__
    |-- adapters
    |-- agent-auth-jwt.ts
    |-- app.ts
    |-- attachment-types.ts
    |-- auth
    |-- board-claim.ts
    |-- config-file.ts
    |-- config.ts
    |-- dev-runner-worktree.ts
    |-- dev-server-status.ts
    |-- dev-watch-ignore.ts
    |-- errors.ts
    |-- home-paths.ts
    |-- index.ts
    |-- lib
    |-- log-redaction.ts
    |-- middleware
    |-- onboarding-assets
    |-- paths.ts
    |-- realtime
    |-- redaction.ts
    |-- routes
    |-- runtime-api.ts
    |-- secrets
    |-- services
    |-- startup-banner.ts
    |-- storage
    |-- telemetry.ts
    |-- types
    |-- ui-branding.ts
    |-- version.ts
    |-- vite-html-renderer.ts
    |-- worktree-config.ts
  |-- tsconfig.json
  |-- vitest.config.ts
skills
  |-- paperclip
  |-- paperclip-converting-plans-to-tasks
    |-- SKILL.md
  |-- paperclip-create-agent
    |-- SKILL.md
    |-- references
  |-- paperclip-create-plugin
    |-- SKILL.md
  |-- paperclip-dev
    |-- SKILL.md
    |-- SKILL.md
    |-- references
  |-- para-memory-files
    |-- SKILL.md
    |-- references
tests
  |-- e2e
    |-- multi-user-authenticated.spec.ts
    |-- multi-user.spec.ts
    |-- onboarding.spec.ts
    |-- playwright-multiuser-authenticated.config.ts
    |-- playwright-multiuser.config.ts
    |-- playwright.config.ts
    |-- signoff-policy.spec.ts
  |-- release-smoke
    |-- docker-auth-onboarding.spec.ts
    |-- playwright.config.ts
tsconfig.base.json
tsconfig.json
ui
  |-- README.md
  |-- components.json
  |-- index.html
  |-- package.json
  |-- public
    |-- android-chrome-192x192.png
    |-- android-chrome-512x512.png
    |-- apple-touch-icon.png
    |-- brands
    |-- favicon-16x16.png
    |-- favicon-32x32.png
    |-- favicon.ico
    |-- favicon.svg
    |-- site.webmanifest
    |-- sw.js
    |-- worktree-favicon-16x16.png
    |-- worktree-favicon-32x32.png
    |-- worktree-favicon.ico
    |-- worktree-favicon.svg
  |-- src
    |-- App.test.tsx
    |-- App.tsx
    |-- adapters
    |-- api
    |-- components
    |-- context
    |-- fixtures
    |-- hooks
    |-- index.css
    |-- lib
    |-- main.tsx
    |-- pages
    |-- plugins
    |-- vite-env.d.ts
  |-- storybook
    |-- .storybook
    |-- fixtures
    |-- stories
  |-- tsconfig.json
  |-- vite.config.ts
  |-- vitest.config.ts
  |-- vitest.setup.ts
vitest.config.ts
```
