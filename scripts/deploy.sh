#!/usr/bin/env bash
# Rolling deploy — run ON THE SERVER (CI calls it over SSH; safe to run by hand).
#
#   bash scripts/deploy.sh
#
# Order matters for the zero-downtime window:
#   1. build new images (old containers keep serving)
#   2. run migrations (additive by convention; old code keeps working mid-deploy)
#   3. restart the STANDBY api first and wait until healthy
#   4. restart the PRIMARY api — nginx fails over to the standby (backup
#      upstream) for the few seconds it's down, then traffic returns
#   5. restart the worker (queue downtime is invisible to users)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── pulling latest"
git pull --ff-only

echo "── building images"
docker compose build

echo "── running migrations (platform + all tenants)"
docker compose run --rm migrate

echo "── rolling api-standby"
docker compose up -d --no-deps --wait api-standby

echo "── rolling api (nginx serves from standby during this window)"
docker compose up -d --no-deps --wait api

echo "── rolling worker"
docker compose up -d --no-deps worker

echo "── pruning old image layers"
docker image prune -f >/dev/null

echo "── health"
curl -fsS http://localhost:3000/api/health && echo
echo "deploy ✓"
