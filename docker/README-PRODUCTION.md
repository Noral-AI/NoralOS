# Production deployment — agent.noral.ai

Plain-English guide. Read top to bottom on first deploy. Everything you need is in this file or linked from it.

---

## What this is

NoralOS is the platform that runs at **agent.noral.ai**. This document explains how a code change ends up serving traffic at that URL, and what to do when something breaks.

```
   you push code to master
            │
            ▼
   GitHub Actions (.github/workflows/docker.yml)
   builds a Docker image and pushes it to:
            │
            ▼
   ghcr.io/noral-ai/noralos:latest
   ghcr.io/noral-ai/noralos:sha-<short-commit>
            │
            ▼
   Two ways the VPS picks up the new image:
   ┌──────────────────────────┬──────────────────────────────┐
   │ A. GitHub Actions deploy │ B. Watchtower on the VPS     │
   │    (.github/workflows/   │    polls GHCR every 5 min    │
   │    deploy.yml SSHes in   │    and pulls new images      │
   │    and triggers compose) │    automatically             │
   └──────────────────────────┴──────────────────────────────┘
            │
            ▼
   docker compose up -d → server container restarts on the new image
            │
            ▼
   agent.noral.ai serves the new build
```

You get **both A and B** working together. A gives instant deploys when you merge a PR; B is the safety net that catches anything A misses (network blips, runner failure, manual image push, etc.).

---

## What's in this directory

| File | What it does |
|---|---|
| `docker-compose.production.yml` | The production stack: Postgres, NoralOS server, Watchtower. Pulls images from GHCR — does NOT build locally. |
| `README-PRODUCTION.md` | This file. |

Other files in this dir are dev / smoke / quickstart variants — leave them alone for production.

Helper scripts live in the **repo's `scripts/` directory**:

| Script | When to use |
|---|---|
| `scripts/bootstrap-vps.sh` | Once, on a fresh VPS, to install Docker + place the compose file + create a placeholder `.env` |
| `scripts/deploy-production.sh` | Manually trigger a deploy or rollback on the VPS (used by the GitHub Actions workflow too) |

---

## First-time setup checklist

Do these once, in order. **Each step has a copy/paste block. None of them ask you to paste a secret into chat.**

### 1. Make the GHCR package public *(strongly recommended)*

The Docker image is published to `ghcr.io/noral-ai/noralos`. By default GHCR packages are private even when the source repo is public.

**Public** package = no authentication on the VPS, Watchtower just works, no token rotation. The image is a compiled distribution of code that's already in a public repo, so making the image public reveals nothing the source doesn't.

**Private** package = the VPS needs `docker login ghcr.io` with a Personal Access Token. The token has to be rotated when it expires, and Watchtower needs the host's `~/.docker/config.json` mounted (the compose file already does this).

**To make it public:** open https://github.com/orgs/Noral-AI/packages/container/noralos/settings and click **Change visibility → Public**.

If you'd rather keep it private, skip ahead to *Appendix A — keeping the GHCR image private*.

### 2. Add GitHub Actions secrets

Open https://github.com/Noral-AI/NoralOS/settings/secrets/actions and add these:

| Secret name | Value | Required |
|---|---|---|
| `VPS_HOST` | The VPS IP or hostname, e.g. `129.121.84.139` | yes |
| `VPS_USER` | SSH user, e.g. `root`, or a less-privileged user that's in the `docker` group | yes |
| `VPS_SSH_KEY` | The **private** half of an SSH keypair generated for this purpose. (See step 3.) | yes |
| `GHCR_USERNAME` | Your GitHub username (only if package stays private) | only if private |
| `GHCR_READ_TOKEN` | A PAT with `read:packages` scope (only if package stays private) | only if private |

Optional repository **variables** (Settings → Secrets and variables → Actions → Variables tab):

| Variable | Default | Purpose |
|---|---|---|
| `VPS_SSH_PORT` | `22` | If the VPS uses a non-standard SSH port |
| `VPS_DEPLOY_DIR` | `/opt/noralos` | Where the compose file lives on the VPS |
| `PUBLIC_HEALTH_URL` | `https://agent.noral.ai/api/health` | What URL the workflow probes after deploy |

### 3. Generate a fresh SSH keypair for GitHub Actions

**Do this on your laptop** (not on the VPS). Never reuse a personal key for CI.

```sh
# Make a new ed25519 key, no passphrase (CI can't type one):
ssh-keygen -t ed25519 -f ./gh-actions-noral -N ""

# Copy the PUBLIC half to the VPS so it can be added to authorized_keys:
ssh-copy-id -i ./gh-actions-noral.pub root@129.121.84.139

# Print the PRIVATE half so you can paste it into the VPS_SSH_KEY secret:
cat ./gh-actions-noral
```

Take the output of the last line, paste it into the `VPS_SSH_KEY` secret in GitHub. Then **delete the local copies** (the secret in GitHub is the source of truth):

```sh
shred -u gh-actions-noral gh-actions-noral.pub 2>/dev/null || rm -f gh-actions-noral gh-actions-noral.pub
```

### 4. Bootstrap the VPS

SSH into the VPS and run the bootstrap script. **Do not paste any secrets into chat — the script asks you to fill in `.env` after it finishes, in your own editor on the VPS.**

```sh
# On your laptop:
ssh root@129.121.84.139

# On the VPS:
curl -sL https://raw.githubusercontent.com/Noral-AI/NoralOS/master/scripts/bootstrap-vps.sh -o /tmp/bootstrap.sh
sudo bash /tmp/bootstrap.sh
```

The script:
- Installs Docker + the compose plugin if missing
- Creates `/opt/noralos`
- Downloads `docker-compose.production.yml` and saves it as `/opt/noralos/docker-compose.yml`
- Creates a placeholder `/opt/noralos/.env` with the required keys

### 5. Fill in the VPS `.env`

Still on the VPS:

```sh
cd /opt/noralos
nano .env       # or vim, whichever you prefer
```

Replace the three placeholder lines:

```
NORALOS_PUBLIC_URL=https://agent.noral.ai
BETTER_AUTH_SECRET=<paste output of: openssl rand -hex 32>
POSTGRES_PASSWORD=<paste output of: openssl rand -hex 24>
```

Generate the random values right there on the VPS:

```sh
openssl rand -hex 32       # for BETTER_AUTH_SECRET
openssl rand -hex 24       # for POSTGRES_PASSWORD
```

Save and close. Then **lock down the file**:

```sh
chmod 600 /opt/noralos/.env
```

### 6. (Private GHCR only) Authenticate Docker on the VPS

Skip this step if you made the package public in step 1.

```sh
# On the VPS, supply the PAT via stdin (never as an argument — that puts
# it in shell history and ps output):
echo $GHCR_READ_TOKEN | docker login ghcr.io -u <your-github-username> --password-stdin
unset GHCR_READ_TOKEN
```

The login persists in `/root/.docker/config.json`. Watchtower reads this file (it's mounted into the watchtower container) so it can also pull private images.

### 7. First deploy

```sh
# On the VPS, from anywhere:
cd /opt/noralos
docker compose pull
docker compose up -d

# Watch it come up:
docker compose ps
docker compose logs -f server
# (Ctrl-C to exit logs once you see "Server listening on …")
```

### 8. Verify

From your laptop:

```sh
curl -sIL https://agent.noral.ai/api/health
# Expect: HTTP/1.1 200 and a Last-Modified within the last few minutes.
```

If you see HTTP 200 and a fresh `Last-Modified`, you're done. The next step is automatic.

### 9. Test the auto-deploy chain

Push a trivial change to master (or merge a PR). Within a few minutes:

1. The **Docker** workflow builds and publishes a new `:latest` and `:sha-<...>` image.
2. The **Deploy** workflow SSHes in, pulls, and restarts.
3. Watchtower (on the VPS) **also** notices the new `:latest` within 5 minutes and would deploy if Deploy hadn't already.

Both being active is intentional — they're redundant on purpose.

---

## Day-to-day operations

### Force a redeploy (e.g. nothing changed but the container's wedged)

From the GitHub UI: **Actions → Deploy → Run workflow → Run workflow** (uses `:latest` by default).

Or from your laptop:

```sh
gh workflow run deploy.yml --repo Noral-AI/NoralOS
```

### Rollback to a previous build

The image is tagged with the git SHA on every push. To roll back to a specific commit:

```sh
# From your laptop:
gh workflow run deploy.yml --repo Noral-AI/NoralOS -f image_tag=sha-a84522b

# Or directly on the VPS:
ssh root@129.121.84.139
cd /opt/noralos
NORALOS_IMAGE_TAG=sha-a84522b docker compose up -d
```

The deploy script also has a built-in shortcut that uses the last-deployed tag history:

```sh
ssh root@129.121.84.139
cd /opt/noralos
bash /path/to/scripts/deploy-production.sh --rollback
```

### Pin to a specific tag instead of always tracking `:latest`

Add this line to `/opt/noralos/.env`:

```
NORALOS_IMAGE_TAG=v2026.428.0
```

Then `docker compose up -d` to apply. Watchtower will only update within the same tag pattern, so pinning effectively freezes Watchtower until you remove the line.

### Tail logs

```sh
ssh root@129.121.84.139 'cd /opt/noralos && docker compose logs --tail 80 -f server'
```

### Watch Watchtower

```sh
ssh root@129.121.84.139 'docker logs noralos-watchtower --tail 50'
```

Look for lines like `Found new ghcr.io/noral-ai/noralos:latest image` and `Stopping /noralos-server`.

### Rotate the production secrets

**`POSTGRES_PASSWORD`**: requires a Postgres role-password change. Easiest path:

```sh
ssh root@129.121.84.139
cd /opt/noralos
docker compose exec db psql -U noralos -d noralos -c "ALTER USER noralos WITH PASSWORD '<new-password>';"
# Then update POSTGRES_PASSWORD in /opt/noralos/.env
nano .env
chmod 600 .env
docker compose up -d  # picks up the new password
```

**`BETTER_AUTH_SECRET`**: rotating this invalidates all active sessions (everyone signs out).

```sh
NEW=$(openssl rand -hex 32)
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$NEW|" /opt/noralos/.env
unset NEW
docker compose up -d
```

**`VPS_SSH_KEY`**: regenerate as in step 3 above, paste new private key into the GitHub secret, append the new public key to `~/.ssh/authorized_keys` on the VPS, then remove the old public key.

**`GHCR_READ_TOKEN`**: revoke at https://github.com/settings/tokens, create a new one with `read:packages`, update the GitHub secret. Then on the VPS:
```sh
echo $NEW_PAT | docker login ghcr.io -u <github-username> --password-stdin
unset NEW_PAT
```

### Disable password-based SSH (recommended after key auth confirmed working)

After confirming `ssh root@129.121.84.139` works without prompting for a password:

```sh
ssh root@129.121.84.139
sudo nano /etc/ssh/sshd_config
# Set:    PasswordAuthentication no
sudo systemctl reload sshd
# Test: open a NEW terminal and confirm SSH still works before closing the existing one.
```

---

## Troubleshooting

### "error from registry: unauthorized" when pulling

The VPS doesn't have valid GHCR credentials, or the package is private and Docker hasn't logged in.

**Fix A** (recommended): make the package public — see step 1.

**Fix B**: log Docker into GHCR on the VPS using a `read:packages` PAT:
```sh
echo $YOUR_PAT | docker login ghcr.io -u <github-username> --password-stdin
unset YOUR_PAT
```

### Container starts but `agent.noral.ai` returns 502 / 504

The reverse proxy (nginx) can't reach the server. Check:

```sh
docker compose ps                          # is server "Up (healthy)"?
docker compose logs --tail 100 server      # any errors?
docker compose exec server wget -qO- http://localhost:3100/api/health
# expect: {"status":"ok",...}
```

If `/api/health` is OK inside the container but nginx still can't reach it, check the nginx config that proxies port 80/443 to localhost:3100.

### Watchtower isn't pulling new images

```sh
docker logs noralos-watchtower --tail 100
```

Common causes:
- **Label missing on server container**: confirm the `server` service in `docker-compose.yml` has `com.centurylinklabs.watchtower.enable: "true"`. The compose file in this repo already sets it.
- **Stale Docker auth**: if the package is private and `~/.docker/config.json` has expired credentials, `docker login` again as in step 6.
- **`WATCHTOWER_LABEL_ENABLE: "true"` filter excluding everything**: also a label issue, same fix.

### `docker compose up -d` says ".env not found"

You're not in `/opt/noralos`. `cd` there first. Or `docker compose --env-file /opt/noralos/.env -f /opt/noralos/docker-compose.yml up -d` from anywhere.

### After deploy, the server container restarts repeatedly

Health check is failing. Check logs:
```sh
docker compose logs --tail 200 server
```

Common causes:
- `BETTER_AUTH_SECRET` missing or empty in `.env`
- `DATABASE_URL` can't connect (Postgres container down or password wrong)
- Image is corrupt (rare; force a fresh pull: `docker compose pull && docker compose up -d --force-recreate`)

Rollback while you debug:
```sh
cd /opt/noralos
bash /path/to/scripts/deploy-production.sh --rollback
```

---

## Appendix A — Keeping the GHCR image private

If you choose to keep `ghcr.io/noral-ai/noralos` private, this section covers what changes.

**On the VPS (one-time):**
```sh
echo $YOUR_PAT | docker login ghcr.io -u <github-username> --password-stdin
unset YOUR_PAT
# Persists in /root/.docker/config.json. Watchtower reads it via the
# bind-mount in docker-compose.production.yml.
```

**In GitHub secrets (one-time):**
- Add `GHCR_USERNAME` (your GitHub username)
- Add `GHCR_READ_TOKEN` (a PAT with `read:packages` only, no other scopes)

The deploy workflow detects these and runs `docker login` on the VPS before each pull. If they're not set, it skips that step (assuming public).

**Trade-offs:**

| | Public package | Private package |
|---|---|---|
| Setup | One click | Generate PAT, login on VPS, store in GitHub secrets, plan rotation |
| Watchtower | Just works | Needs `~/.docker/config.json` mounted (the compose does this) |
| PAT expiry | Never matters | Watchtower silently stops pulling when the token expires; that's how this whole thread started |
| Information hiding | Image bytes are visible | Image bytes are gated |
| What's actually hidden | Nothing — source repo is already public | Nothing if the source is public; only meaningful if the source is also private |

Recommendation: **public package**, unless source is also private and the image bytes constitute a meaningful secret beyond the source.

---

## Appendix B — File reference

| Repo file | What it is |
|---|---|
| `.github/workflows/docker.yml` | Builds + pushes the Docker image on every master push and on `v*` tags |
| `.github/workflows/deploy.yml` | SSHes to the VPS and triggers `docker compose up -d` after a successful build |
| `docker/docker-compose.production.yml` | The production stack (Postgres, server, Watchtower) |
| `docker/README-PRODUCTION.md` | This file |
| `scripts/bootstrap-vps.sh` | Run once on a fresh VPS to install Docker + place the compose file |
| `scripts/deploy-production.sh` | Run on the VPS (or by the deploy workflow) to pull + restart |
| `.gitignore` | Already excludes `.env`, keys, `*.pem`, etc. — never commit secrets |

---

## Appendix C — Watchtower, in plain words

Watchtower is a tiny Docker container whose only job is to:
1. Every 5 minutes, check whether `ghcr.io/noral-ai/noralos:latest` has a different image SHA than the running `noralos-server` container.
2. If yes, pull the new image, stop the old container, start a new one with the new image, and clean up the old image.

It only touches containers labeled `com.centurylinklabs.watchtower.enable: "true"`. Postgres is explicitly opted out (set to `false`) because major-version Postgres bumps need manual data-dir migration.

When the deploy workflow runs, it does the same thing Watchtower would do — pull + recreate — but immediately rather than waiting up to 5 minutes. The two paths coexist by design: deploy workflow gives you instant cutover, Watchtower catches anything the workflow missed (offline runner, secret expired, network blip, manual GHCR push).

---

## Quick reference card

| Action | Command |
|---|---|
| Tail server logs | `ssh root@129.121.84.139 'cd /opt/noralos && docker compose logs -f server'` |
| Tail Watchtower | `ssh root@129.121.84.139 'docker logs -f noralos-watchtower'` |
| Force redeploy from CI | `gh workflow run deploy.yml --repo Noral-AI/NoralOS` |
| Rollback to specific SHA | `gh workflow run deploy.yml --repo Noral-AI/NoralOS -f image_tag=sha-XXXXXXX` |
| Verify production live | `curl -sIL https://agent.noral.ai/api/health` |
| Containers status | `ssh root@129.121.84.139 'cd /opt/noralos && docker compose ps'` |
