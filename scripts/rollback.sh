#!/usr/bin/env bash
# Roll production back to a previously-deployed build.
#
#   bash scripts/rollback.sh              # back to the previous build
#   bash scripts/rollback.sh <commit-sha> # back to a specific one
#   bash scripts/rollback.sh --list       # what can I roll back to?
#
# ---------------------------------------------------------------------------
# NEW 2026-08-04 — audit TEST-D1 / OBS-I2.
#
# Before this file existed there was no rollback procedure and, more to the
# point, nothing to roll back TO: `scripts/deploy.sh` ran `docker image prune -f`
# on every deploy, which deleted the previous image. The recovery plan was
# "fix forward under pressure".
#
# READ THE CODE PATH BELOW BEFORE YOU NEED IT. The worst time to learn what a
# rollback does to your database is halfway through one.
# ---------------------------------------------------------------------------
#
#                        ⚠  THE DATABASE IS THE HARD PART  ⚠
#
# This script rolls back CODE. It does not, and cannot safely, roll back the
# SCHEMA, because there is not one down-migration in this repository
# (audit DATA 3.5 — "no migration is reversible", still open).
#
# That means a rollback is only safe when the migrations included in the bad
# deploy were ADDITIVE — new tables, new nullable columns, new indexes. The old
# code simply ignores them. This is the normal case and the convention the repo
# already follows.
#
# It is NOT safe if the bad deploy DROPPED or RENAMED anything, or backfilled
# destructively. Old code will query a column that no longer exists. In that
# case the database must be restored from the pre-deploy dump — which
# deploy.sh now always takes — and that means accepting the loss of every write
# since the deploy. That is a decision for a human, so this script will not make
# it for you: it detects the situation, stops, and tells you where the dump is.
#
set -euo pipefail
cd "$(dirname "$0")/.."

STATE_DIR="./.deploy-state"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health/ready}"

if [ "${1:-}" = "--list" ]; then
  echo "Available api images:"
  docker images "praxis-ls-api" --format '  {{.Tag}}\t{{.CreatedSince}}' 2>/dev/null | grep -v latest || echo "  (none tagged)"
  echo
  echo "Currently deployed: $(cat "$STATE_DIR/current" 2>/dev/null || echo unknown)"
  echo "Previous:           $(cat "$STATE_DIR/previous" 2>/dev/null || echo unknown)"
  echo
  echo "Backups:"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | head -10 | sed 's/^/  /' || echo "  (none)"
  exit 0
fi

TARGET="${1:-$(cat "$STATE_DIR/previous" 2>/dev/null || echo '')}"
CURRENT="$(cat "$STATE_DIR/current" 2>/dev/null || echo unknown)"

if [ -z "$TARGET" ]; then
  echo "!! No rollback target. Pass a commit sha, or run --list to see what exists."
  exit 1
fi

echo "── rolling back"
echo "   from: $CURRENT"
echo "   to:   $TARGET"

if ! docker image inspect "praxis-ls-api:$TARGET" >/dev/null 2>&1; then
  echo "!! No image tagged praxis-ls-api:$TARGET"
  echo "   Run 'bash scripts/rollback.sh --list' to see what is available."
  echo "   If the image is gone, roll back by checking out the commit and"
  echo "   rebuilding — slower, but the git history is intact:"
  echo "     git checkout $TARGET && bash scripts/deploy.sh"
  exit 1
fi

# -------------------------------------------------------------------------
# Destructive-migration check.
#
# Look at what the outgoing deploy added. If any of it drops or renames, the old
# code cannot run against this schema and a code-only rollback would replace one
# outage with a louder one.
# -------------------------------------------------------------------------
if [ "$CURRENT" != "unknown" ] && git rev-parse --verify "$CURRENT" >/dev/null 2>&1; then
  CHANGED_MIGRATIONS="$(git diff --name-only "$TARGET" "$CURRENT" -- migrations/ 2>/dev/null || true)"
  if [ -n "$CHANGED_MIGRATIONS" ]; then
    echo
    echo "── migrations changed between these builds:"
    echo "$CHANGED_MIGRATIONS" | sed 's/^/     /'
    DESTRUCTIVE="$(git diff "$TARGET" "$CURRENT" -- migrations/ 2>/dev/null \
      | grep -iE '^\+.*(DROP (TABLE|COLUMN|CONSTRAINT)|RENAME (TO|COLUMN)|TRUNCATE|DELETE FROM)' || true)"
    if [ -n "$DESTRUCTIVE" ]; then
      echo
      echo "!! STOP. The outgoing deploy contains DESTRUCTIVE schema changes:"
      echo "$DESTRUCTIVE" | sed 's/^/     /'
      echo
      echo "   Rolling back the code alone will leave $TARGET running against a"
      echo "   schema it does not understand. You need a database restore, and"
      echo "   that loses every write since the deploy."
      echo
      echo "   Pre-deploy dump: $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo 'NOT FOUND — check '"$BACKUP_DIR")"
      echo
      echo "   Restore is a human decision. To do it:"
      echo "     docker compose stop api api-standby worker"
      # -U is read from inside the container: compose sets POSTGRES_USER from
      # DB_USER (default praxis-admin), NOT 'postgres'. Guessing 'postgres' here
      # is what broke the first real run of deploy.sh's backup step, and getting
      # it wrong mid-restore is considerably more expensive.
      echo "     gunzip -c <dump> | docker compose exec -T postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres'"
      echo "     bash scripts/rollback.sh $TARGET --schema-restored"
      echo
      if [ "${2:-}" != "--schema-restored" ]; then exit 1; fi
      echo "   --schema-restored given; continuing with the code rollback."
    else
      echo "   All additive — old code can run against this schema. Continuing."
    fi
  fi
fi

echo "── retagging $TARGET as the running image"
docker tag "praxis-ls-api:$TARGET" "praxis-ls-api:latest"
if docker image inspect "praxis-ls-worker:$TARGET" >/dev/null 2>&1; then
  docker tag "praxis-ls-worker:$TARGET" "praxis-ls-worker:latest"
fi

# Standby first, same order as a deploy: nginx keeps serving throughout.
echo "── rolling api-standby"
docker compose up -d --no-deps --wait api-standby
echo "── rolling api"
docker compose up -d --no-deps --wait api
echo "── rolling worker"
docker compose up -d --no-deps worker

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
  echo "!! ROLLBACK IS ALSO NOT READY. This is now an incident, not a deploy problem."
  cat "$STATE_DIR/last-health.json" 2>/dev/null || true
  echo "   Backup: $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo none)"
  exit 1
fi

cat "$STATE_DIR/last-health.json"
echo

echo "$CURRENT" > "$STATE_DIR/previous"
echo "$TARGET" > "$STATE_DIR/current"

echo
echo "rollback ✓  now running $TARGET"
echo "   NOTE: the git working tree on this host still points at $CURRENT."
echo "   The next 'git pull' in deploy.sh will move forward again — fix the bug"
echo "   or revert the commit on main before redeploying."
