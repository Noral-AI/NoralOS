#!/usr/bin/env bash
# NoralOS production deploy on agent.noral.ai.
#
# Idempotent. Pulls the latest images, recreates containers that changed,
# waits for the server health gate, reloads the public nginx proxy as a
# belt-and-suspenders step (the resolver fix in
# /opt/noralagent/deploy/proxy/nginx.conf already prevents the stale-IP
# class of outage, but the reload is cheap insurance), and finally probes
# the public endpoint so a regression fails the script loudly.
#
# Production location: /opt/noralos/deploy.sh on agent.noral.ai (kept in
# sync with this file). To re-sync after editing here:
#   scp scripts/deploy-noralos.sh root@agent.noral.ai:/opt/noralos/deploy.sh

set -euo pipefail

cd /opt/noralos

echo '[1/5] docker compose pull'
docker compose pull

echo '[2/5] docker compose up -d'
docker compose up -d

echo '[3/5] waiting for server health'
until docker compose ps --format json server 2>/dev/null | grep -q '"Health":"healthy"'; do
  sleep 2
done
docker compose ps

echo '[4/5] reloading public nginx proxy'
docker exec deploy-proxy-1 nginx -s reload

echo '[5/5] public health probe'
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -m 8 https://agent.noral.ai/api/health)
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FAIL: https://agent.noral.ai/api/health returned $HTTP_CODE" >&2
  exit 1
fi
echo "OK: public health returned 200"
