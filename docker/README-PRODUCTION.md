# NoralOS production deploy (auto-update via Watchtower)

This is the deploy path used for `agent.noral.ai`. It uses pre-built images from `ghcr.io/noral-ai/noralos` and a Watchtower sidecar that auto-pulls new images on every push to `master`.

## File layout

- `docker-compose.production.yml` — the production stack (Postgres + NoralOS server + Watchtower)
- `.env.production` (you create this on the VPS, not committed) — secrets

## One-time bootstrap on a new VPS

```sh
# 1. Get the production compose file onto the VPS.
mkdir -p /opt/noralos && cd /opt/noralos
curl -sL https://raw.githubusercontent.com/Noral-AI/NoralOS/master/docker/docker-compose.production.yml -o docker-compose.yml

# 2. Create the .env with required secrets.
cat > .env <<'EOF'
NORALOS_PUBLIC_URL=https://agent.noral.ai
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
NORALOS_IMAGE_TAG=latest
EOF

# 3. Login to GHCR (if the image is private). Skip if public.
echo "$GITHUB_PAT" | docker login ghcr.io -u <your-gh-username> --password-stdin

# 4. Pull and start.
docker compose pull
docker compose up -d

# 5. Verify.
curl -sI http://localhost:3100/api/health
docker logs noralos-watchtower --tail 30
```

After step 4 lands, every push to `master` will:
1. Trigger `.github/workflows/docker.yml` → publish `ghcr.io/noral-ai/noralos:latest`
2. Watchtower (polling every 5 min) pulls the new image
3. Watchtower restarts `noralos-server` with the new image
4. `restart: unless-stopped` brings it back up cleanly

No manual SSH-and-pull required for normal release flow.

## Migrating an existing legacy deploy

If the VPS is currently running an image from before the Paperclip → NoralOS rebrand (i.e. `Last-Modified` on the running container is older than 2026-04-30), it expects:
- Volume mount path `/paperclip` instead of `/noralos`
- Env var prefix `PAPERCLIP_*`
- Postgres user `paperclip` instead of `noralos`

The new image refuses to start with the old env. **One-time migration:**

```sh
# On the VPS, with the old stack still running:
cd /opt/noralos      # or wherever the old compose lives

# 1. Capture state for rollback.
docker compose ps > /tmp/legacy-stack.txt
docker exec <legacy-server-name> cat /paperclip/instances/default/config.json > /tmp/legacy-config.json
# (Postgres data: Docker named volumes survive `docker compose down`. No manual dump needed,
#  but a defensive `pg_dump` is cheap insurance:)
docker exec <legacy-db-name> pg_dump -U paperclip paperclip > /tmp/legacy-db.sql

# 2. Stop the legacy stack (volumes preserved).
docker compose down

# 3. Replace the compose file with the production version.
mv docker-compose.yml docker-compose.legacy.yml.bak
curl -sL https://raw.githubusercontent.com/Noral-AI/NoralOS/master/docker/docker-compose.production.yml -o docker-compose.yml

# 4. Update .env to use NORALOS_* var names + pre-existing Postgres password.
#    Critical: set POSTGRES_PASSWORD to the *legacy* password from the old compose.
#    Set NORALOS_PUBLIC_URL=https://agent.noral.ai
#    Generate BETTER_AUTH_SECRET if you don't have one yet (rotates sessions).

# 5. The new Postgres expects user `noralos` and database `noralos`. The legacy
#    DB has user `paperclip` and database `paperclip`. Run a one-shot migration
#    container to rename the DB role + database (data is preserved by-volume):
docker run --rm \
  --network <legacy-stack-network> \
  -v <legacy-pgdata-volume>:/var/lib/postgresql/data \
  postgres:17-alpine \
  psql -U paperclip -d postgres -c "
    ALTER ROLE paperclip RENAME TO noralos;
    ALTER DATABASE paperclip RENAME TO noralos;
  "

# 6. Start the new stack.
docker compose pull
docker compose up -d

# 7. Verify.
curl -sIL https://agent.noral.ai/api/health
docker logs noralos-server --tail 50
```

If anything goes wrong, restore via:

```sh
docker compose down
mv docker-compose.legacy.yml.bak docker-compose.yml
docker compose up -d
# (Postgres data is intact in the volume; legacy stack will boot on it.)
```

## Operational notes

- **Watchtower polling**: 5 min default. Override with `WATCHTOWER_POLL_INTERVAL` env in compose.
- **Pinning a version**: set `NORALOS_IMAGE_TAG=v2026.428.0` in `.env` and Watchtower will only pull within that tag's matching label set (or, more strictly, set Watchtower to manual-only mode and use `docker compose pull && docker compose up -d` on cadence).
- **Rolling back**: `docker compose pull` only ever moves forward when `:latest` is used. To roll back, set `NORALOS_IMAGE_TAG` to a known-good version tag and `docker compose up -d`.
- **GHCR auth**: if the image is private, the daemon needs auth. Either `docker login ghcr.io` once (credentials persist in `~/.docker/config.json`) or use a credential helper. Watchtower picks up the daemon's auth automatically.
- **Notifications**: enable Slack/Discord/email via `WATCHTOWER_NOTIFICATION_URL`. See <https://containrrr.dev/watchtower/notifications/>.

## Deploy chain summary

```
git push origin master
        │
        ▼
.github/workflows/docker.yml
        │
        ▼  (3-7 min later)
ghcr.io/noral-ai/noralos:latest  ← new image
        │
        ▼  (within 5 min of publish)
Watchtower on the VPS pulls the new image
        │
        ▼
noralos-server container restarts
        │
        ▼
agent.noral.ai serves the new build
```
