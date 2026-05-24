# syntax=docker/dockerfile:1.20
FROM node:lts-trixie-slim AS base
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu curl gh git wget ripgrep python3 \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# Modify the existing node user/group to have the specified UID/GID to match host user
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /noralos node

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY --parents packages/plugins/sandbox-providers/./*/package.json packages/plugins/sandbox-providers/
COPY packages/plugins/noralos-plugin-fake-sandbox/package.json packages/plugins/noralos-plugin-fake-sandbox/
COPY packages/plugins/voice-config/package.json packages/plugins/voice-config/
COPY packages/plugins/voice-cascade/package.json packages/plugins/voice-cascade/
# Phase 6 (re-scoped): conference-room-bridge removed. Conference Room feature
# retired; voice-cascade + voice-config kept for Dashboard agent-voice autoplay.
# noralai-brooklyn is an external adapter plugin. The package.json is
# COPYd here so `pnpm install --frozen-lockfile` succeeds; the rest of
# the package (`src/`) lands via the broader `COPY . .` in the build
# stage. The runtime auto-registers it from the workspace path via
# `server/src/adapters/auto-register-brooklyn.ts` (no `tsc` build —
# the server loads `src/index.ts` through the same tsx loader it uses
# for its own code, see CMD below). An operator can still override
# with a newer npm-installed copy via POST /api/adapters; that path
# wins over the workspace fallback.
COPY packages/plugins/noralai-brooklyn/package.json packages/plugins/noralai-brooklyn/
# noralai-noralsign is the NoralSign document-signing plugin. Like Brooklyn,
# the package.json is COPYd here so `pnpm install --frozen-lockfile` resolves
# the workspace member; the rest of the package (`src/`, `scripts/`, etc.)
# lands via the broader `COPY . .` in the build stage. The runtime
# auto-registers it from the workspace path via
# `server/src/services/auto-register-noralsign.ts` on first boot.
COPY packages/plugins/noralai-noralsign/package.json packages/plugins/noralai-noralsign/
# noralai-slack: Slack channel for NoralOS agents. Same pattern as Brooklyn
# and NoralSign — package.json COPYd here so `pnpm install --frozen-lockfile`
# resolves the workspace member; src + scripts land via the broader `COPY . .`
# at the build stage. Runtime auto-registers from the workspace path via
# `server/src/services/auto-register-slack.ts`.
COPY packages/plugins/noralai-slack/package.json packages/plugins/noralai-slack/
# noralai-noralvoice: NoralVoice (voice.noral.ai) integration. Same pattern.
# Runtime auto-registers from the workspace path via
# `server/src/services/auto-register-noralvoice.ts`.
COPY packages/plugins/noralai-noralvoice/package.json packages/plugins/noralai-noralvoice/
# noralai-zoho: Zoho CRM integration. Same in-tree workspace-plugin pattern.
# Runtime auto-registers from the workspace path via
# `server/src/services/auto-register-zoho.ts`.
COPY packages/plugins/noralai-zoho/package.json packages/plugins/noralai-zoho/
# noralai-google-sheets: Google Sheets v4 integration. Same pattern.
# Runtime auto-registers from the workspace path via
# `server/src/services/auto-register-google-sheets.ts`.
COPY packages/plugins/noralai-google-sheets/package.json packages/plugins/noralai-google-sheets/
COPY patches/ patches/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @noralos/ui build
RUN pnpm --filter @noralos/plugin-sdk build
RUN pnpm --filter @noralos/server build
RUN pnpm --filter @noralos-plugins/voice-config build
RUN pnpm --filter @noralos-plugins/voice-cascade build
# Phase 6 (re-scoped): conference-room-bridge build removed; plugin deleted.
# noralai-noralsign builds tsc output (manifest, worker, REST client) plus
# the React UI bundle (esbuild → dist/ui/index.js). Without this step
# `ensureNoralSignRegistered` finds the workspace path but no manifest file
# and aborts auto-registration on the first boot.
RUN pnpm --filter @noralos-plugins/noralai-noralsign build
# noralai-slack builds tsc output (manifest, worker, slack client, router).
# Without this step `ensureSlackRegistered` finds the workspace path but
# no manifest file and aborts auto-registration on first boot.
RUN pnpm --filter @noralos-plugins/noralai-slack build
# noralai-noralvoice builds tsc output (manifest, worker, NoralVoice client)
# plus the React UI bundle (esbuild → dist/ui/index.js). Without this step
# `ensureNoralVoiceRegistered` finds the workspace path but no manifest
# file and aborts auto-registration on first boot.
RUN pnpm --filter @noralos-plugins/noralai-noralvoice build
# noralai-zoho builds tsc output (manifest, worker, Zoho REST client). No UI
# bundle in v0.1.0 — the plugin is agent-tools-only. Without this step
# `ensureZohoRegistered` finds the workspace path but no manifest file
# and aborts auto-registration on first boot.
RUN pnpm --filter @noralos-plugins/noralai-zoho build
# noralai-google-sheets builds tsc output (manifest, worker, Sheets/Drive
# REST client). No UI bundle in v0.1.0 — agent-tools-only. Without this
# step `ensureGoogleSheetsRegistered` finds the workspace path but no
# manifest file and aborts auto-registration on first boot.
RUN pnpm --filter @noralos-plugins/noralai-google-sheets build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)
RUN test -f packages/plugins/voice-config/dist/worker.js || (echo "ERROR: voice-config build output missing" && exit 1)
RUN test -f packages/plugins/voice-cascade/dist/worker.js || (echo "ERROR: voice-cascade build output missing" && exit 1)
# Phase 6 (re-scoped): conference-room-bridge build verification removed; plugin deleted.
RUN test -f packages/plugins/noralai-noralsign/dist/worker.js || (echo "ERROR: noralai-noralsign build output missing" && exit 1)
RUN test -f packages/plugins/noralai-noralsign/dist/manifest.js || (echo "ERROR: noralai-noralsign manifest build output missing" && exit 1)
RUN test -f packages/plugins/noralai-noralsign/dist/ui/index.js || (echo "ERROR: noralai-noralsign UI bundle missing" && exit 1)
RUN test -f packages/plugins/noralai-slack/dist/worker.js || (echo "ERROR: noralai-slack build output missing" && exit 1)
RUN test -f packages/plugins/noralai-slack/dist/manifest.js || (echo "ERROR: noralai-slack manifest build output missing" && exit 1)
RUN test -f packages/plugins/noralai-noralvoice/dist/worker.js || (echo "ERROR: noralai-noralvoice build output missing" && exit 1)
RUN test -f packages/plugins/noralai-noralvoice/dist/manifest.js || (echo "ERROR: noralai-noralvoice manifest build output missing" && exit 1)
RUN test -f packages/plugins/noralai-noralvoice/dist/ui/index.js || (echo "ERROR: noralai-noralvoice UI bundle missing" && exit 1)
RUN test -f packages/plugins/noralai-zoho/dist/worker.js || (echo "ERROR: noralai-zoho build output missing" && exit 1)
RUN test -f packages/plugins/noralai-zoho/dist/manifest.js || (echo "ERROR: noralai-zoho manifest build output missing" && exit 1)
RUN test -f packages/plugins/noralai-google-sheets/dist/worker.js || (echo "ERROR: noralai-google-sheets build output missing" && exit 1)
RUN test -f packages/plugins/noralai-google-sheets/dist/manifest.js || (echo "ERROR: noralai-google-sheets manifest build output missing" && exit 1)

FROM base AS production
ARG USER_UID=1000
ARG USER_GID=1000
# Build-time provenance metadata. Plumbed in by .github/workflows/docker.yml
# (and locally by `docker build --build-arg`). Both default to empty so an
# unconfigured local build still succeeds; the runtime version endpoint
# treats empty values as "unknown" rather than as a build error.
ARG GIT_SHA=""
ARG BUILD_TIME=""
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssh-client jq \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /noralos \
  && chown node:node /noralos

COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# OCI image annotations for image-level provenance. Read by registry tooling
# (docker manifest inspect, ghcr.io UI, container scanners) and useful when
# auditing "what is actually deployed". Kept consistent with the runtime env
# values below so an operator sees the same git SHA whether they inspect the
# image or call /api/version on the running container.
LABEL org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME \
      org.opencontainers.image.source="https://github.com/Noral-AI/NoralOS" \
      org.opencontainers.image.title="NoralOS Server"

ENV NODE_ENV=production \
  HOME=/noralos \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  NORALOS_HOME=/noralos \
  NORALOS_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  NORALOS_CONFIG=/noralos/instances/default/config.json \
  NORALOS_DEPLOYMENT_MODE=authenticated \
  NORALOS_DEPLOYMENT_EXPOSURE=private \
  OPENCODE_ALLOW_ALL_MODELS=true \
  NORALOS_GIT_SHA=${GIT_SHA} \
  NORALOS_BUILD_TIME=${BUILD_TIME}

VOLUME ["/noralos"]
EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
