#!/usr/bin/env bash
# scripts/bootstrap-vps.sh — set up a fresh VPS to run NoralOS.
#
# Run ONCE on a fresh VPS as root (or with sudo). Idempotent: re-running
# is safe and skips already-completed steps.
#
# What it does, in order:
#   1. Verify or install Docker (and the compose plugin).
#   2. Create /opt/noralos as the deploy directory (or whatever DEPLOY_DIR points to).
#   3. Download docker-compose.production.yml from this repo and place it
#      at $DEPLOY_DIR/docker-compose.yml.
#   4. Create a placeholder $DEPLOY_DIR/.env with REQUIRED keys; warn loudly
#      if the file is empty or contains placeholder values.
#   5. Set strict file permissions on .env (0600).
#   6. Print the next steps the operator needs to do MANUALLY:
#        a. Edit .env with real secret values.
#        b. (If GHCR is private) docker login ghcr.io.
#        c. Run scripts/deploy-production.sh for the first time.
#
# What it deliberately does NOT do:
#   - Prompt for, accept, or write any real secret values from this script.
#     Secrets must be added by the operator directly.
#   - Configure firewalls, TLS certs, DNS, or reverse proxies.
#     (Use Caddy/nginx/Traefik separately.)
#   - Touch any existing /opt/noralos data, volume, or env file unless --force.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/noralos}"
REPO_RAW_URL="${REPO_RAW_URL:-https://raw.githubusercontent.com/Noral-AI/NoralOS/master/docker/docker-compose.production.yml}"
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)        FORCE=true; shift ;;
    --deploy-dir)   DEPLOY_DIR="$2"; shift 2 ;;
    --compose-url)  REPO_RAW_URL="$2"; shift 2 ;;
    -h|--help)
      sed -n 's/^# \{0,1\}//p' "$0" | head -n 30
      exit 0 ;;
    *) echo "✗ unknown argument: $1" >&2; exit 1 ;;
  esac
done

log()   { printf '[bootstrap] %s\n' "$*"; }
warn()  { printf '[bootstrap] ⚠ %s\n' "$*" >&2; }
fatal() { printf '[bootstrap] ✗ %s\n' "$*" >&2; exit 1; }

# ────────────────────────────────────────────────────────────────────
#  1. Docker
# ────────────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "✓ docker already installed: $(docker --version)"
else
  log "installing Docker via official convenience script…"
  if [[ "$EUID" -ne 0 ]]; then fatal "must run as root or via sudo to install Docker"; fi
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  log "✓ docker installed: $(docker --version)"
fi

if docker compose version >/dev/null 2>&1; then
  log "✓ docker compose plugin: $(docker compose version --short)"
else
  fatal "docker compose plugin missing. The 'get.docker.com' script normally installs it; try a fresh OS install or install docker-compose-plugin manually for your distro."
fi

# ────────────────────────────────────────────────────────────────────
#  2. Deploy dir
# ────────────────────────────────────────────────────────────────────
if [[ ! -d "$DEPLOY_DIR" ]]; then
  log "creating $DEPLOY_DIR"
  mkdir -p "$DEPLOY_DIR"
  chmod 0755 "$DEPLOY_DIR"
fi
cd "$DEPLOY_DIR"

# ────────────────────────────────────────────────────────────────────
#  3. Compose file
# ────────────────────────────────────────────────────────────────────
if [[ -f docker-compose.yml && "$FORCE" != true ]]; then
  log "✓ docker-compose.yml already present (use --force to overwrite)"
else
  log "downloading $REPO_RAW_URL → $DEPLOY_DIR/docker-compose.yml"
  curl -fsSL "$REPO_RAW_URL" -o docker-compose.yml
  log "✓ compose file in place"
fi

# ────────────────────────────────────────────────────────────────────
#  4. .env placeholder
# ────────────────────────────────────────────────────────────────────
if [[ -f .env && "$FORCE" != true ]]; then
  log "✓ .env already present (use --force to overwrite). Verifying required keys…"
else
  log "creating placeholder .env (you MUST edit this with real values before deploying)"
  cat > .env <<'EOF'
# NoralOS production .env — fill these BEFORE first deploy.
# Never commit this file. ~/.gitignore should already exclude it.

# REQUIRED ── public URL the app is served from (no trailing slash)
NORALOS_PUBLIC_URL=https://agent.noral.ai

# REQUIRED ── 32+ bytes of random hex used to sign auth sessions.
# Generate with:  openssl rand -hex 32
BETTER_AUTH_SECRET=__REPLACE_ME_with_openssl_rand_hex_32__

# REQUIRED ── Postgres password for the in-cluster DB.
# Generate with:  openssl rand -hex 24
POSTGRES_PASSWORD=__REPLACE_ME_with_openssl_rand_hex_24__

# OPTIONAL ── pin to a specific image tag instead of :latest.
# Example values:
#   latest              (default, follows master)
#   sha-a84522bc        (a specific commit)
#   v2026.428.0         (a stable release tag)
#NORALOS_IMAGE_TAG=latest
EOF
  chmod 0600 .env
fi

# Validate required keys are not still placeholders.
NEEDS_FIX=0
for key in NORALOS_PUBLIC_URL BETTER_AUTH_SECRET POSTGRES_PASSWORD; do
  val=$(grep -E "^$key=" .env | head -n1 | cut -d= -f2- || true)
  if [[ -z "$val" || "$val" =~ ^__REPLACE_ME ]]; then
    warn "$key is missing or still a placeholder in $DEPLOY_DIR/.env"
    NEEDS_FIX=1
  fi
done

# ────────────────────────────────────────────────────────────────────
#  5. Permissions
# ────────────────────────────────────────────────────────────────────
chmod 0600 .env || true

# ────────────────────────────────────────────────────────────────────
#  6. Next steps
# ────────────────────────────────────────────────────────────────────
echo
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "VPS bootstrap complete."
log ""
log "Next steps (do these BEFORE first deploy):"
log ""
if [[ $NEEDS_FIX -ne 0 ]]; then
  log "  1. Edit $DEPLOY_DIR/.env and fill the REQUIRED keys. Generate secrets with:"
  log "       openssl rand -hex 32   # for BETTER_AUTH_SECRET"
  log "       openssl rand -hex 24   # for POSTGRES_PASSWORD"
  log ""
fi
log "  2. (If the GHCR image is private) authenticate Docker to GHCR:"
log "       echo \\\$YOUR_GH_PAT | docker login ghcr.io -u \\\$YOUR_GH_USERNAME --password-stdin"
log "     The PAT needs the 'read:packages' scope only."
log "     Don't paste the PAT into a chat or commit it; create it at"
log "     https://github.com/settings/tokens/new and supply via stdin."
log ""
log "  3. First deploy:"
log "       cd $DEPLOY_DIR && bash scripts/deploy-production.sh"
log "     (or run from this repo's checkout: scripts/deploy-production.sh)"
log ""
log "  4. Verify:"
log "       curl -sIL https://agent.noral.ai/api/health"
log "     Look for HTTP 200 and a recent Last-Modified header."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
