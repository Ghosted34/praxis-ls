#!/usr/bin/env bash
# Rolling deploy — run ON THE SERVER (CI calls it over SSH; safe to run by hand).
#
#   bash scripts/deploy.sh
#
# Order matters for the zero-downtime window:
#   1. record what is currently running, so it can be rolled back to
#   2. back up the database (BEFORE migrations, which have no down path)
#   3. build new images, tagged with the commit
#   4. run migrations (additive by convention; old code keeps working mid-deploy)
#   5. restart the STANDBY api first and wait until READY
#   6. restart the PRIMARY api — nginx fails over to the standby (backup
#      upstream) for the few seconds it's down, then traffic returns
#   7. restart the worker (queue downtime is invisible to users)
#   8. verify READINESS, not just liveness
#
# ---------------------------------------------------------------------------
# CHANGED 2026-08-04 — audit TEST-D1 / TEST-D2 / OBS-I2 / OBS-I4 / TEST-R2.
#
# What this script used to do, and why each was a problem:
#
#   `docker image prune -f`   Ran on every deploy and deleted the previous
#                             image. The only artifact you could have rolled
#                             back to was destroyed by the very thing that might
#                             need rolling back. There was no rollback path at
#                             all — not a slow one, none.
#
#   no backup                 Migrations ran against production with no dump
#                             taken first, and there is not one down-migration
#                             in the repo (DATA 3.5). A bad migration was
#                             unrecoverable.
#
#   `curl /api/health`        The final gate. That endpoint returned {ok:true}
#                             unconditionally and never touched the database, so
#                             a container that could not reach Postgres passed
#                             the gate and the deploy printed "deploy ✓".
#
#   untagged images           Everything was `latest`; nothing identified which
#                             commit was running (TEST-R2).
#
# Rollback is now `bash scripts/rollback.sh`. Read that file before you need it,
# not while you need it.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

# How many previous builds to keep. Enough to step back more than once during a
# bad afternoon; few enough not to fill the disk.
KEEP_IMAGES="${KEEP_IMAGES:-5}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health/ready}"
STATE_DIR="./.deploy-state"

mkdir -p "$STATE_DIR"

# ---------------------------------------------------------------------------
# Deploy announcements (audit OBS-I5).
#
# Deploys were unattributed and unannounced: nothing recorded who deployed what,
# and nobody found out a deploy had happened — so a 09:00 incident could not be
# correlated with an 08:55 release without asking around. Now that
# ALERT_WEBHOOK_URL exists (OBS-A1), say so.
#
# Silent no-op when unset, so a dev running this by hand is unaffected. Never
# fatal: a webhook being down must not fail a deploy that otherwise worked.
# ---------------------------------------------------------------------------
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-$(grep -E '^ALERT_WEBHOOK_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'' || true)}"

announce() {
  # NOT `[ -z … ] && return 0`: under `set -e` that construct aborts the whole
  # script when the test is FALSE, because the && list then exits non-zero. An
  # announcement helper must never be able to kill a deploy.
  if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
    return 0
  fi
  local text="$1"
  local payload
  payload="$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}))' 2>/dev/null || true)"
  if [ -n "$payload" ]; then
    curl -fsS --max-time 5 -X POST -H 'Content-Type: application/json' \
         -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  return 0
}

DEPLOYER="$(git config user.name 2>/dev/null || echo "${USER:-unknown}")"
HOSTNAME_S="$(hostname 2>/dev/null || echo unknown)"

echo "── recording the currently-running build (for rollback)"
PREVIOUS_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -f "$STATE_DIR/current" ]; then
  PREVIOUS_SHA="$(cat "$STATE_DIR/current")"
fi
echo "   previous: $PREVIOUS_SHA"

echo "── pulling latest"
git pull --ff-only
BUILD_SHA="$(git rev-parse HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "   deploying: $BUILD_SHA"
announce "Deploy started on ${HOSTNAME_S} by ${DEPLOYER}: ${PREVIOUS_SHA:0:8} → ${BUILD_SHA:0:8}"

# ---------------------------------------------------------------------------
# Database backup — BEFORE migrations.
#
# TEST-D2 / OBS-I3. Migrations are applied to production with no rollback path,
# and the migrator is not atomic with its own ledger (DATA 3.1), so a failure
# part-way can leave a schema the repo cannot describe. A dump taken here is the
# only thing between that and data loss.
#
# Deliberately fatal on failure: deploying without a backup is how a recoverable
# afternoon becomes an unrecoverable one. SKIP_BACKUP=1 exists for the case
# where you have taken one another way and can say where it is.
# ---------------------------------------------------------------------------
echo "── backing up the database (pre-migration)"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_SHA:0:8}.sql.gz"
if docker compose exec -T postgres pg_dumpall -U "${POSTGRES_USER:-postgres}" | gzip > "$BACKUP_FILE"; then
  echo "   wrote $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  echo "$BACKUP_FILE" > "$STATE_DIR/last-backup"
else
  rm -f "$BACKUP_FILE"
  echo "!! BACKUP FAILED — refusing to run migrations without one."
  echo "   Migrations have no down path. Fix the backup first."
  if [ "${SKIP_BACKUP:-0}" != "1" ]; then exit 1; fi
  echo "   SKIP_BACKUP=1 set — continuing anyway. State where your backup is."
fi

# Prune old backups by COUNT, not by age: an idle month should not leave you
# holding nothing.
ls -1t "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f

echo "── building images (tagged ${BUILD_SHA:0:8})"
docker compose build \
  --build-arg BUILD_SHA="$BUILD_SHA" \
  --build-arg BUILD_TIME="$BUILD_TIME"

# Tag what we just built so a rollback has something it can name. Without this
# every image is `latest` and "the previous one" is not addressable.
for svc in api worker; do
  img="$(docker compose images -q "$svc" 2>/dev/null | head -1 || true)"
  if [ -n "$img" ]; then docker tag "$img" "praxis-ls-$svc:$BUILD_SHA" || true; fi
done

echo "── running migrations (platform + all tenants)"
docker compose run --rm migrate

echo "── syncing AI action catalogue (all tenants)"
# Rebuilds ai_action_catalogue from the *.ai.js manifests so the assistant is told
# about every read + vetted write. Idempotent upsert by action_key; without this the
# catalogue drifts and the copilot only "knows" whatever was last synced by hand.
docker compose run --rm api node scripts/ai/sync-actions.js --all

echo "── rolling api-standby"
docker compose up -d --no-deps --wait api-standby

echo "── rolling api (nginx serves from standby during this window)"
docker compose up -d --no-deps --wait api

echo "── rolling worker"
docker compose up -d --no-deps worker

# ---------------------------------------------------------------------------
# Readiness gate.
#
# OBS-I4 / TEST-D4. The old gate was `curl /api/health`, which could not fail —
# "deploy ✓" meant "a Node process is listening", not "the application works".
# /api/health/ready probes Postgres and Redis and 503s when the database is
# unreachable.
# ---------------------------------------------------------------------------
echo "── verifying readiness"
READY=0
for attempt in $(seq 1 10); do
  if curl -fsS --max-time 5 "$HEALTH_URL" > "$STATE_DIR/last-health.json" 2>/dev/null; then
    READY=1
    break
  fi
  echo "   not ready yet (attempt $attempt/10)…"
  sleep 3
done

if [ "$READY" -ne 1 ]; then
  echo "!! DEPLOY FAILED READINESS CHECK"
  echo "   The new build is running but cannot serve. Last probe response:"
  cat "$STATE_DIR/last-health.json" 2>/dev/null || echo "   (no response at all)"
  echo
  echo "   Roll back:  bash scripts/rollback.sh $PREVIOUS_SHA"
  echo "   Backup:     $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo 'none taken')"
  announce "DEPLOY FAILED READINESS on ${HOSTNAME_S}: ${BUILD_SHA:0:8} is running but cannot serve. Roll back: bash scripts/rollback.sh ${PREVIOUS_SHA:0:8}"
  exit 1
fi

cat "$STATE_DIR/last-health.json"
echo

# Only now is this build "current" — i.e. the thing a future deploy rolls back TO.
echo "$PREVIOUS_SHA" > "$STATE_DIR/previous"
echo "$BUILD_SHA" > "$STATE_DIR/current"

# ---------------------------------------------------------------------------
# Image retention.
#
# TEST-D1. `docker image prune -f` used to run here unconditionally and take the
# previous build with it. Now only DANGLING layers older than a week go, and
# tagged praxis-ls-* images are kept KEEP_IMAGES deep.
# ---------------------------------------------------------------------------
echo "── pruning (keeping the last $KEEP_IMAGES builds)"
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
for svc in api worker; do
  docker images "praxis-ls-$svc" --format '{{.Tag}} {{.CreatedAt}}' 2>/dev/null \
    | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | awk '{print $1}' \
    | while read -r tag; do
        if [ -n "$tag" ] && [ "$tag" != "latest" ]; then
          docker rmi "praxis-ls-$svc:$tag" >/dev/null 2>&1 || true
        fi
      done
done

announce "Deploy ✓ ${HOSTNAME_S}: now running ${BUILD_SHA:0:8} (was ${PREVIOUS_SHA:0:8}), by ${DEPLOYER}"

echo
echo "deploy ✓  ${BUILD_SHA:0:8}"
echo "   rollback:  bash scripts/rollback.sh $PREVIOUS_SHA"
echo "   backup:    $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo 'none')"
