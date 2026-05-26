#!/usr/bin/env bash
# scripts/deploy-production.sh — pull + restart the NoralOS production stack.
#
# Run this on the production VPS. Safe to re-run.
#
# Usage:
#   ./deploy-production.sh                       # pull :latest and restart
#   ./deploy-production.sh --tag v2026.428.0     # pull a specific tag
#   ./deploy-production.sh --tag sha-a84522bc    # pull a specific git SHA
#   ./deploy-production.sh --tag sha-a84522bc --skip-pull   # rollback only
#   ./deploy-production.sh --rollback                       # pull previous "previous" tag
#   ./deploy-production.sh --check                          # health check only, no deploy
#
# What this script does:
#   1. cd into the compose directory (default /opt/noralos, override with COMPOSE_DIR).
#   2. Pull the requested image tag from ghcr.io/noral-ai/noralos.
#   3. docker compose up -d (recreates only changed services).
#   4. Wait up to 90s for the server's /api/health to return {"status":"ok"}.
#   5. Probe https://agent.noral.ai if PUBLIC_HEALTH_URL is set.
#   6. Print summary.
#
# Notes:
#   - This script does NOT contain or print secrets. The compose file reads
#     env vars from the .env file in COMPOSE_DIR; that file is never logged.
#   - If GHCR is private, run `docker login ghcr.io` once before invoking
#     this script. The login persists in ~/.docker/config.json.

set -euo pipefail

# ────────────────────────────────────────────────────────────────────
#  Config
# ────────────────────────────────────────────────────────────────────
COMPOSE_DIR="${COMPOSE_DIR:-/opt/noralos}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
IMAGE_REF="ghcr.io/noral-ai/noralos"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://localhost:3100/api/health}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-}"        # e.g. https://agent.noral.ai/api/health
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-90}"
TAG=""
SKIP_PULL=false
ROLLBACK=false
CHECK_ONLY=false

# ────────────────────────────────────────────────────────────────────
#  Argument parsing
# ────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)         TAG="$2"; shift 2 ;;
    --skip-pull)   SKIP_PULL=true; shift ;;
    --rollback)    ROLLBACK=true; shift ;;
    --check)       CHECK_ONLY=true; shift ;;
    -h|--help)
      sed -n 's/^# \{0,1\}//p' "$0" | head -n 30
      exit 0 ;;
    *)
      echo "✗ unknown argument: $1" >&2
      exit 1 ;;
  esac
done

# ────────────────────────────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────────────────────────────
log()   { printf '[deploy] %s\n' "$*"; }
warn()  { printf '[deploy] ⚠ %s\n' "$*" >&2; }
fatal() { printf '[deploy] ✗ %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fatal "$1 not installed (required)"
}

# ────────────────────────────────────────────────────────────────────
#  Pre-flight
# ────────────────────────────────────────────────────────────────────
require docker
require curl

[[ -d "$COMPOSE_DIR" ]] || fatal "compose dir does not exist: $COMPOSE_DIR (set COMPOSE_DIR env)"
cd "$COMPOSE_DIR"

[[ -f "$COMPOSE_FILE" ]] || fatal "compose file not found: $COMPOSE_DIR/$COMPOSE_FILE"

if [[ ! -f .env ]]; then
  warn ".env not found in $COMPOSE_DIR — compose will fail if any required env var is missing"
fi

# ────────────────────────────────────────────────────────────────────
#  --check mode: health probe only, no deploy
# ────────────────────────────────────────────────────────────────────
if [[ "$CHECK_ONLY" == true ]]; then
  log "health check only (no deploy)"
  set +e
  curl -sf "$LOCAL_HEALTH_URL" >/dev/null 2>&1 && log "  local: $LOCAL_HEALTH_URL → ok" || log "  local: $LOCAL_HEALTH_URL → DOWN"
  if [[ -n "$PUBLIC_HEALTH_URL" ]]; then
    curl -sf "$PUBLIC_HEALTH_URL" >/dev/null 2>&1 && log "  public: $PUBLIC_HEALTH_URL → ok" || log "  public: $PUBLIC_HEALTH_URL → DOWN"
  fi
  exit 0
fi

# ────────────────────────────────────────────────────────────────────
#  Resolve image tag
# ────────────────────────────────────────────────────────────────────
if [[ "$ROLLBACK" == true ]]; then
  if [[ -f .last-deployed.tag ]]; then
    PREV=$(cat .last-deployed.tag)
    if [[ -f .previous-deployed.tag ]]; then
      TAG=$(cat .previous-deployed.tag)
      log "rollback: $PREV → $TAG (from .previous-deployed.tag)"
    else
      fatal "no .previous-deployed.tag to rollback to. Pass --tag <sha-...> explicitly."
    fi
  else
    fatal "no prior deploy recorded (.last-deployed.tag missing). Pass --tag explicitly."
  fi
elif [[ -z "$TAG" ]]; then
  TAG="latest"
fi

log "target image: $IMAGE_REF:$TAG"
log "compose dir : $COMPOSE_DIR"
log "compose file: $COMPOSE_FILE"

# ────────────────────────────────────────────────────────────────────
#  Pull image
# ────────────────────────────────────────────────────────────────────
if [[ "$SKIP_PULL" != true ]]; then
  log "pulling…"
  if ! NORALOS_IMAGE_TAG="$TAG" docker compose -f "$COMPOSE_FILE" pull server 2>&1 | sed 's/^/  /'; then
    fatal "docker pull failed. If you see 'unauthorized', either run \`docker login ghcr.io\` (see README-PRODUCTION.md) or make the GHCR package public."
  fi
fi

# Resolve the SHA we just pulled, for rollback bookkeeping.
PULLED_DIGEST=$(docker image inspect "$IMAGE_REF:$TAG" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "")
log "pulled digest: ${PULLED_DIGEST:-(unknown — image not in cache)}"

# Record current → previous before flipping.
if [[ -f .last-deployed.tag ]]; then
  cp -f .last-deployed.tag .previous-deployed.tag
fi
echo "$TAG" > .last-deployed.tag

# ────────────────────────────────────────────────────────────────────
#  Compose up
# ────────────────────────────────────────────────────────────────────
log "docker compose up -d…"
NORALOS_IMAGE_TAG="$TAG" docker compose -f "$COMPOSE_FILE" up -d 2>&1 | sed 's/^/  /'

# ────────────────────────────────────────────────────────────────────
#  Wait for health
# ────────────────────────────────────────────────────────────────────
log "waiting up to ${HEALTH_TIMEOUT_S}s for $LOCAL_HEALTH_URL …"
START=$(date +%s)
while true; do
  if curl -sf "$LOCAL_HEALTH_URL" -o /dev/null 2>&1; then
    log "  ✓ local health ok"
    break
  fi
  if (( $(date +%s) - START > HEALTH_TIMEOUT_S )); then
    warn "local health did NOT become healthy within ${HEALTH_TIMEOUT_S}s"
    docker compose -f "$COMPOSE_FILE" logs --tail 50 server || true
    fatal "deploy did not pass health check. Server may have rolled back via restart-policy or may be still starting."
  fi
  sleep 3
done

if [[ -n "$PUBLIC_HEALTH_URL" ]]; then
  log "checking public URL: $PUBLIC_HEALTH_URL"
  set +e
  curl -sf "$PUBLIC_HEALTH_URL" -o /dev/null && log "  ✓ public health ok" || warn "public health DOWN — check nginx / DNS / TLS"
  set -e
fi

# ────────────────────────────────────────────────────────────────────
#  Summary
# ────────────────────────────────────────────────────────────────────
log "✓ deploy complete"
log "running: $(docker compose -f "$COMPOSE_FILE" ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}' | tail -n +2)"
log "to rollback: $0 --rollback   (will revert to $(cat .previous-deployed.tag 2>/dev/null || echo 'unknown'))"
