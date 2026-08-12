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

# ===========================================================================
# PHASE 1 — pull, then RE-EXEC into the script we just pulled.
#
# This script `git pull`s the repository that contains this script. Bash reads a
# script incrementally from an open file descriptor, and git applies an update by
# writing a temp file and renaming it into place — which leaves the ORIGINAL
# inode intact for anyone already reading it. So bash carries on executing the
# OLD deploy.sh for the rest of the run, and the version just pulled does not
# take effect until the NEXT deploy.
#
# This is not theoretical. On 2026-08-04 a fix to the backup step was pulled and
# the run failed with the exact bug that had just been fixed; the giveaway was
# that the error text was the old wording. Every previous change to this file has
# silently had the same one-deploy lag.
#
# Re-exec closes it: pull, then hand over to the new file. PREVIOUS_SHA is passed
# through the environment because after the pull `git rev-parse HEAD` is the NEW
# commit, and the whole point of that value is to name what we are replacing.
# ===========================================================================
if [ "${PRAXIS_DEPLOY_REEXEC:-0}" != "1" ]; then
  echo "── recording the currently-running build (for rollback)"
  PREVIOUS_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ -f "$STATE_DIR/current" ]; then
    PREVIOUS_SHA="$(cat "$STATE_DIR/current")"
  fi
  echo "   previous: $PREVIOUS_SHA"

  # -------------------------------------------------------------------------
  # TC-D7 — deploy a NAMED COMMIT, not "whatever main is when the script runs".
  #
  # `git pull --ff-only` made deployment identity a moving target: the commit
  # whose CI turned green is not necessarily the commit that ships, and during
  # an incident you could not deploy a specific commit at all — the
  # workflow_dispatch path took no ref, so a manual run always shipped current
  # main, which is the opposite of what you want when main is the problem.
  #
  # `DEPLOY_REF` (env or $1) pins it. Unset keeps the old behaviour — current
  # main — so nothing about the automatic path changes.
  #
  # `git fetch` + `checkout --detach` rather than `pull`: a detached checkout of
  # an explicit SHA cannot fast-forward into something else, and it fails
  # cleanly on a dirty tree instead of half-applying. A hand-edited tracked file
  # on the server used to make the next deploy die mid-script under `set -e`, at
  # an arbitrary point, possibly after migrations had run.
  # -------------------------------------------------------------------------
  DEPLOY_REF="${DEPLOY_REF:-${1:-}}"
  echo "── fetching"
  git fetch --prune origin
  if [ -n "$DEPLOY_REF" ]; then
    echo "   pinned to: $DEPLOY_REF"
    if ! git rev-parse --verify --quiet "${DEPLOY_REF}^{commit}" >/dev/null; then
      echo "!! DEPLOY ABORTED — '$DEPLOY_REF' is not a commit this server knows about."
      echo "   Nothing has been changed. Check the SHA, or push the branch first."
      exit 1
    fi
    git checkout --detach "$DEPLOY_REF"
  else
    git checkout --detach origin/main
  fi

  PULLED_SHA="$(git rev-parse HEAD)"
  if [ "$PULLED_SHA" != "$PREVIOUS_SHA" ]; then
    echo "── re-executing the deploy script from $PULLED_SHA (it may have changed)"
  fi
  export PRAXIS_DEPLOY_REEXEC=1
  export PRAXIS_PREVIOUS_SHA="$PREVIOUS_SHA"
  export DEPLOY_REF
  exec bash "$0" "$@"
fi

# ===========================================================================
# PHASE 2 — running the freshly pulled script. Everything below is the deploy.
# ===========================================================================
PREVIOUS_SHA="${PRAXIS_PREVIOUS_SHA:-unknown}"
echo "   previous: $PREVIOUS_SHA"
BUILD_SHA="$(git rev-parse HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "   deploying: $BUILD_SHA"
announce "Deploy started on ${HOSTNAME_S} by ${DEPLOYER}: ${PREVIOUS_SHA:0:8} → ${BUILD_SHA:0:8}"

# ---------------------------------------------------------------------------
# TC-R3 — write down which commit deployed, when, by whom, and whether it
# finished. Append-only.
#
# The deploy job never checked out the repository and never recorded a SHA; it
# fired on CI completion and ran a script that pulled whatever `main` was at
# execution time. Combined with CI having had no concurrency group (TC-D8, now
# fixed), that was not even necessarily the SHA whose CI run triggered it. So
# for any past deploy, "which commit did this deploy?" had no recorded answer —
# only an inference from timestamps. Forty-four deploys, none of them
# attributable.
#
# A line is written HERE, at the start, with status `started`, and rewritten at
# the end with the outcome. Written at the start deliberately: a deploy that
# dies halfway is exactly the one you need a record of, and a log that only
# records successes is a log that is silent about every incident.
# ---------------------------------------------------------------------------
DEPLOY_LOG="$STATE_DIR/deploys.log"
record_deploy() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUILD_SHA" "$PREVIOUS_SHA" \
    "${DEPLOYER:-unknown}" "${DEPLOY_REF:-main}" "$1" >> "$DEPLOY_LOG"
}
record_deploy "started"
# `trap` so an abort anywhere below — a failed migration, a failed readiness
# gate, `set -e` on any command — still leaves a record instead of a dangling
# "started". Replaced by an explicit "succeeded" line at the end.
trap 'rc=$?; if [ "$rc" -ne 0 ]; then record_deploy "failed(rc=$rc)"; fi' EXIT

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

# The superuser is read from INSIDE the container, not guessed out here.
#
# First run of this step failed with `role "postgres" does not exist`: it
# defaulted to -U postgres, but docker-compose.yml sets
# `POSTGRES_USER: ${DB_USER:-praxis-admin}`, so the superuser is whatever DB_USER
# says. Resolving it host-side means duplicating that default and drifting from
# it; `sh -c` inside the container reads the value compose actually injected, so
# there is exactly one source of truth.
#
# pg_dumpall (not pg_dump) is deliberate: tenancy is database-per-tenant, so a
# single-database dump would back up the platform registry and none of the
# tenant data. It also captures roles, which a tenant restore needs.
#
# `set -o pipefail` at the top is what makes this `if` honest — without it the
# exit status would be gzip's, and gzip happily succeeds on an empty stream.
# Resolve the superuser first and PRINT it. When this step failed on 2026-08-04
# the log said only `role "postgres" does not exist`, which tells you the guess
# was wrong but not what the right answer is. One echo turns the next failure
# into a five-second diagnosis.
PG_SUPERUSER="$(docker compose exec -T postgres sh -c 'printf %s "${POSTGRES_USER:-}"' 2>/dev/null | tr -d '\r' || true)"
if [ -z "$PG_SUPERUSER" ]; then
  echo "!! Could not read POSTGRES_USER from the postgres container."
  echo "   docker-compose.yml sets it from \${DB_USER:-praxis-admin}; check DB_USER in .env"
  echo "   and that the postgres service is actually running:  docker compose ps"
  announce "DEPLOY ABORTED on ${HOSTNAME_S}: cannot resolve the Postgres superuser for the pre-migration backup"
  exit 1
fi
echo "   superuser: $PG_SUPERUSER"

if docker compose exec -T postgres pg_dumpall -U "$PG_SUPERUSER" | gzip > "$BACKUP_FILE"; then
  BACKUP_BYTES="$(wc -c < "$BACKUP_FILE" | tr -d ' ')"
  # A dump that "succeeded" but is a few hundred bytes is an empty cluster or a
  # silently truncated stream. Treat it as a failure — the point of this step is
  # to have something to restore, not to have a file.
  if [ "${BACKUP_BYTES:-0}" -lt 4096 ]; then
    echo "!! BACKUP SUSPICIOUSLY SMALL (${BACKUP_BYTES} bytes) — treating as failed."
    rm -f "$BACKUP_FILE"
    if [ "${SKIP_BACKUP:-0}" != "1" ]; then
      announce "DEPLOY ABORTED on ${HOSTNAME_S}: pre-migration backup was only ${BACKUP_BYTES} bytes"
      exit 1
    fi
  else
    echo "   wrote $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    echo "$BACKUP_FILE" > "$STATE_DIR/last-backup"
  fi
else
  rm -f "$BACKUP_FILE"
  echo "!! BACKUP FAILED — refusing to run migrations without one."
  echo "   Migrations have no down path (DATA 3.5). Fix the backup first."
  echo
  echo "   Check the superuser compose injected:"
  echo "     docker compose exec -T postgres sh -c 'echo \$POSTGRES_USER'"
  echo "   and that it matches DB_USER in .env on this host."
  if [ "${SKIP_BACKUP:-0}" != "1" ]; then
    announce "DEPLOY ABORTED on ${HOSTNAME_S}: pre-migration backup failed, nothing was migrated"
    exit 1
  fi
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
#
# uptime-probe is in this list because it is now rolled like the others (below).
# A monitoring container that cannot be rolled back with the rest of the stack
# is one you end up unable to revert during exactly the incident it is meant to
# be observing.
for svc in api worker uptime-probe; do
  img="$(docker compose images -q "$svc" 2>/dev/null | head -1 || true)"
  if [ -n "$img" ]; then docker tag "$img" "praxis-ls-$svc:$BUILD_SHA" || true; fi
done

# ---------------------------------------------------------------------------
# TC-E1 — validate the ENVIRONMENT before touching any database.
#
# `src/config/env.js` parses the whole environment with Zod at require time and
# refuses to boot in production on default JWT secrets, on identical access and
# refresh secrets, or on an empty DB_PASSWORD. That guard is well built and is
# the right control — the problem was purely WHEN it ran: at container start,
# two steps below, AFTER migrations had already been applied to every tenant
# database. A change introducing a required variable therefore got as far as
# mutating all customer data before anything complained, and the only way out
# was forward.
#
# Requiring env.js is the whole check: the parse and the production guard both
# run on require. `--no-deps` so this does not start Postgres or Redis to answer
# a question about a text file, and the freshly built image so it validates the
# schema being deployed rather than the one currently running.
# ---------------------------------------------------------------------------
echo "── validating environment (before migrations)"
if ! docker compose run --rm --no-deps api node -e "require('./src/config/env'); console.warn('environment OK')"; then
  echo "!! DEPLOY ABORTED — the environment is not valid for this build."
  echo "   Nothing has been migrated. Fix .env on this host and re-run."
  echo "   scripts/check-env-template.js lists what the schema requires."
  exit 1
fi

echo "── running migrations (platform + all tenants)"
docker compose run --rm migrate

echo "── syncing AI action catalogue (all tenants)"
# Rebuilds ai_action_catalogue from the *.ai.js manifests so the assistant is told
# about every read + vetted write. Idempotent upsert by action_key; without this the
# catalogue drifts and the copilot only "knows" whatever was last synced by hand.
docker compose run --rm api node scripts/ai/sync-actions.js --all

# ---------------------------------------------------------------------------
# SEC-L1 — make the bind mounts writable by the unprivileged container user.
#
# The runtime and worker images now run as `node` (uid 1000) instead of root.
# A bind-mounted host directory keeps its host ownership inside the container,
# so without this the app starts cleanly and then fails its FIRST WRITE — a
# rendered PDF, an upload, a log line — at runtime rather than at boot. That is
# the worst shape of failure: a green deploy that breaks on the first user.
#
# Idempotent, and the first run after this ships does the one-off repair of
# files an earlier root container created. `|| true` because a host whose
# directories are already correct but not root-owned (an unprivileged deploy
# user) must not have the deploy aborted by a chown it does not need.
# ---------------------------------------------------------------------------
echo "── ensuring bind-mount ownership for the non-root container user"
mkdir -p ./media ./uploads ./logs ./data
chown -R 1000:1000 ./media ./uploads ./logs ./data 2>/dev/null || \
  sudo chown -R 1000:1000 ./media ./uploads ./logs ./data 2>/dev/null || \
  echo "   ! could not chown bind mounts — if the API cannot write, run: sudo chown -R 1000:1000 ./media ./uploads ./logs ./data"

echo "── rolling api-standby"
docker compose up -d --no-deps --wait api-standby

echo "── rolling api (nginx serves from standby during this window)"
docker compose up -d --no-deps --wait api

echo "── rolling worker"
docker compose up -d --no-deps worker

# ---------------------------------------------------------------------------
# WS-U1 — the external uptime prober.
#
# THE BUG THIS FIXES, which is a silent one.
#
#   `uptime-probe` has been a service in docker-compose.yml with
#   `restart: unless-stopped`, so a bare `docker compose up -d` starts it. But
#   this script never named it, and it rolls services explicitly. Two
#   consequences, both quiet:
#
#     1. On a host where the prober was never started, no deploy ever started
#        it. It stayed off indefinitely and nothing said so — availability
#        simply came from the in-process sampler, which cannot observe the API
#        being down, which is the entire reason WS-U1 exists.
#
#     2. Worse, on a host where it WAS running: `restart: unless-stopped` keeps
#        the existing container alive across deploys, and nothing recreated it.
#        The prober went on running whatever image it started with, months after
#        the rest of the stack moved on. A monitoring process pinned to old code
#        is the last thing you want to discover during an incident.
#
#   `docker compose up -d` is idempotent and handles all three states in one
#   command: starts it if it is down, recreates it if the image changed, leaves
#   it alone if it is already current. That is the "check and switch on if it is
#   not on" the deploy needed — no separate probe-for-state step, because the
#   command already IS the check.
#
# WHY IT IS NOT `--wait`.
#
#   Unlike api-standby, this container exposes no health endpoint to wait on: it
#   is a loop that sleeps between sweeps. Waiting would block on a condition
#   that never arrives. Its first sample lands within UPTIME_PROBE_INTERVAL_MS.
#
# WHY IT CAN BE TURNED OFF.
#
#   The recommended arrangement is a prober on ANOTHER host or region — a probe
#   sharing a host with its target cannot see the host die. A deployment doing
#   that must not also run one here, so UPTIME_PROBE_IN_COMPOSE=false stops it,
#   and stops it ACTIVELY: flipping the flag has to take effect on the next
#   deploy, or "we turned it off" and "it is still running" stay indefinitely
#   confusable.
# ---------------------------------------------------------------------------
IN_COMPOSE="$(grep -E '^UPTIME_PROBE_IN_COMPOSE=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r' || true)"
IN_PROCESS="$(grep -E '^UPTIME_PROBE_IN_PROCESS=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r' || true)"

if [ "${IN_COMPOSE:-true}" = "false" ]; then
  echo "── uptime prober: disabled in this stack (UPTIME_PROBE_IN_COMPOSE=false)"
  echo "   expecting an EXTERNAL prober elsewhere: node scripts/ops/uptime-probe.js"
  docker compose stop uptime-probe >/dev/null 2>&1 || true

# DOUBLE-SAMPLING GUARD, and the reason this refuses rather than warns.
#
#   UPTIME_PROBE_IN_PROCESS defaults to TRUE, so on most hosts the API is
#   already sampling every tenant on the interval. Starting this container
#   without flipping that flag samples every host TWICE per interval — and
#   `availability()` divides recorded samples by the number EXPECTED from
#   UPTIME_PROBE_INTERVAL_MS, so the figure comes out inflated. Not missing,
#   not obviously broken: quietly wrong, in the optimistic direction, on the
#   number that feeds the status page and the monthly report.
#
#   So the container is not started. Doing otherwise would mean this change
#   introduced corrupted availability data on every existing deployment, which
#   is a worse outcome than the prober staying off one more day. Existing
#   behaviour is preserved exactly until someone makes a deliberate choice.
elif [ "${IN_PROCESS:-true}" != "false" ]; then
  echo "── uptime prober: NOT started (would double-count)"
  echo "   UPTIME_PROBE_IN_PROCESS is not false, so the API is already sampling."
  echo "   Running both samples every host twice per interval and INFLATES the"
  echo "   availability figure on the status page and monthly report."
  echo
  echo "   To switch the external prober on, set in .env:"
  echo "       UPTIME_PROBE_IN_PROCESS=false"
  echo "   then re-run this deploy. To keep in-process probing, set:"
  echo "       UPTIME_PROBE_IN_COMPOSE=false"
  echo
  echo "   (Not fatal — the deploy continues and in-process probing is unchanged.)"

else
  echo "── rolling uptime-probe (external prober)"
  docker compose up -d --no-deps uptime-probe
  # Prove it is actually up. `up -d` succeeding means Docker accepted the
  # request, not that the process survived its first second — and a prober that
  # crashed on boot looks identical to one quietly working, because both are
  # silent by design.
  sleep 2
  if [ -z "$(docker compose ps -q uptime-probe 2>/dev/null)" ] || \
     [ "$(docker inspect -f '{{.State.Running}}' "$(docker compose ps -q uptime-probe)" 2>/dev/null)" != "true" ]; then
    echo "   ! uptime-probe is not running — check: docker compose logs --tail=50 uptime-probe"
  else
    echo "   uptime-probe up; first sample within UPTIME_PROBE_INTERVAL_MS"
  fi
fi

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
  # NOT `curl -f`: -f makes curl exit non-zero AND discard the body on a 4xx/5xx,
  # so a 503 readiness response — the one case where the body explains exactly
  # which dependency is down — was thrown away. The first real failure of this
  # gate printed "Last probe response:" followed by nothing, which is worse than
  # useless. Capture the body and the status separately.
  HTTP_CODE="$(curl -sS --max-time 5 -o "$STATE_DIR/last-health.json" -w '%{http_code}' "$HEALTH_URL" 2>"$STATE_DIR/last-health.err" || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    READY=1
    break
  fi
  echo "   not ready yet (attempt $attempt/10, HTTP $HTTP_CODE)…"
  sleep 3
done

if [ "$READY" -ne 1 ]; then
  echo "!! DEPLOY FAILED READINESS CHECK"
  echo "   The new build is running but cannot serve. Last probe (HTTP $HTTP_CODE):"
  if [ -s "$STATE_DIR/last-health.json" ]; then
    sed 's/^/     /' "$STATE_DIR/last-health.json"
    echo
  else
    echo "     (empty body)"
    [ -s "$STATE_DIR/last-health.err" ] && sed 's/^/     curl: /' "$STATE_DIR/last-health.err"
    echo "     Nothing answered on $HEALTH_URL. Check the container is up and listening:"
    echo "       docker compose ps"
    echo "       docker compose logs --tail=50 api"
  fi
  echo
  echo "   Backup:     $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo 'none taken')"

  # -------------------------------------------------------------------------
  # OBS-I4 — AUTO-ROLLBACK, and the reason it is opt-in.
  #
  # A failed readiness check left the new, non-serving build in place and
  # printed a command for a human to run. Between the failure and that human
  # reading it, the site is down — and `deploy.sh` runs unattended from CI, so
  # "someone will see the log" is not a control.
  #
  # WHY `AUTO_ROLLBACK=1` RATHER THAN ALWAYS. Migrations have already run by
  # this point, and this codebase has no down-migrations (DI-3.5: new files
  # carry a `-- DOWN` block, the existing 99 do not). Reverting the CODE under a
  # schema that has moved forward is safe for an additive migration and is NOT
  # safe for anything else — an automatic revert could turn a broken deploy into
  # a corrupted one. That is a judgement about the specific change, so the
  # operator makes it once, in the deploy environment, rather than the script
  # guessing every time.
  #
  # Default OFF preserves today's behaviour exactly. Turn it on for a period
  # when you know the migrations in flight are additive.
  # -------------------------------------------------------------------------
  if [ "${AUTO_ROLLBACK:-0}" = "1" ] && [ "$PREVIOUS_SHA" != "unknown" ] && [ -x scripts/rollback.sh ]; then
    echo "   AUTO_ROLLBACK=1 → reverting to $PREVIOUS_SHA"
    announce "DEPLOY FAILED READINESS on ${HOSTNAME_S}: ${BUILD_SHA:0:8} cannot serve — AUTO-ROLLING BACK to ${PREVIOUS_SHA:0:8}"
    if bash scripts/rollback.sh "$PREVIOUS_SHA"; then
      record_deploy "failed-rolled-back"
      trap - EXIT
      announce "Rollback ✓ ${HOSTNAME_S}: serving ${PREVIOUS_SHA:0:8} again. The SCHEMA is still at ${BUILD_SHA:0:8} — check the migrations before redeploying."
      echo "!! rolled back to $PREVIOUS_SHA — note the database schema was NOT reverted"
      exit 1
    fi
    announce "ROLLBACK FAILED on ${HOSTNAME_S}. Manual intervention required: ${BUILD_SHA:0:8} is live and not serving."
    echo "!! rollback itself failed — manual intervention required"
    exit 1
  fi

  echo "   Roll back:  bash scripts/rollback.sh $PREVIOUS_SHA"
  echo "               (set AUTO_ROLLBACK=1 to have this happen automatically)"
  announce "DEPLOY FAILED READINESS on ${HOSTNAME_S}: ${BUILD_SHA:0:8} is running but cannot serve. Roll back: bash scripts/rollback.sh ${PREVIOUS_SHA:0:8}"
  exit 1
fi

cat "$STATE_DIR/last-health.json"
echo

# ---------------------------------------------------------------------------
# Tenant smoke gate — INCIDENT 2026-08-12.
#
# The readiness gate above passed throughout an outage in which EVERY tenant
# login failed. It could not have caught it: /api/health/ready probes the
# platform database and Redis, and both were fine. What was broken was the
# tenant connection path — opening a pool for a tenant database — which the
# readiness probe never touches.
#
# A health check that cannot see a tenant cannot see a tenant outage. This step
# exercises the real path: resolve a tenant from the registry, open its pool,
# run a query, release. It fails the deploy on the same timeout the application
# would give a user, so a regression that makes tenant connections slow is a red
# deploy rather than a red inbox.
#
# TENANT_SMOKE_SLUG names the tenant to probe. Unset = skipped with a warning,
# because a fresh deployment may have no tenants yet — but a deployment that HAS
# tenants and does not set this is choosing to keep the blind spot.
# ---------------------------------------------------------------------------
echo "── tenant smoke test"

# The slug is read from INSIDE the container, not from this shell.
#
# `.env` is consumed by COMPOSE (`env_file:`), not by bash — deploy.sh never
# sources it. So `$TENANT_SMOKE_SLUG` was always empty here and the gate silently
# skipped itself on a host that had configured it correctly, which is the exact
# failure mode this step exists to prevent. Same fix, and the same reasoning, as
# the POSTGRES_USER lookup above: ask the container what compose actually gave
# it, rather than re-implementing .env parsing in shell and drifting from it.
#
# (Re-implementing it is not hypothetical: the ALERT_WEBHOOK_URL grep near the
# top of this file does exactly that, and inherits the comment-value bug that
# took tenant sites down on 2026-08-12.)
SMOKE_SLUG="$(docker compose exec -T api sh -c 'printf %s "${TENANT_SMOKE_SLUG:-}"' 2>/dev/null | tr -d '\r' || true)"
# A value that is really a comment is not a slug. Same trap as above.
case "$SMOKE_SLUG" in \#*) SMOKE_SLUG="" ;; esac

if [ -z "$SMOKE_SLUG" ]; then
  echo "   ! TENANT_SMOKE_SLUG is not set — skipping."
  echo "     The readiness gate above does NOT touch a tenant database. On 2026-08-12"
  echo "     it passed while every tenant login timed out. Set TENANT_SMOKE_SLUG in .env"
  echo "     to the slug of a real tenant to close that gap."
else
  if docker compose exec -T api node scripts/ops/tenant-smoke.js --slug="$SMOKE_SLUG"; then
    echo "   tenant path OK ($SMOKE_SLUG)"
  else
    echo "!! DEPLOY FAILED TENANT SMOKE TEST"
    echo "   The platform is healthy but tenant '$SMOKE_SLUG' cannot be served."
    echo "   This is the failure mode the readiness gate is blind to — most likely the"
    echo "   tenant connection path: pool acquisition, per-tenant credentials, or the"
    echo "   connection budget (see src/config/connection-budget.js)."
    echo
    echo "   Check:  docker compose logs --tail=50 api"
    echo "           SELECT datname, count(*) FROM pg_stat_activity GROUP BY 1;"
    echo "   Roll back:  bash scripts/rollback.sh $PREVIOUS_SHA"
    announce "DEPLOY FAILED TENANT SMOKE on ${HOSTNAME_S}: ${BUILD_SHA:0:8} is healthy at the platform level but tenant ${SMOKE_SLUG} cannot be served. Roll back: bash scripts/rollback.sh ${PREVIOUS_SHA:0:8}"
    exit 1
  fi
fi

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
for svc in api worker uptime-probe; do
  docker images "praxis-ls-$svc" --format '{{.Tag}} {{.CreatedAt}}' 2>/dev/null \
    | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | awk '{print $1}' \
    | while read -r tag; do
        if [ -n "$tag" ] && [ "$tag" != "latest" ]; then
          docker rmi "praxis-ls-$svc:$tag" >/dev/null 2>&1 || true
        fi
      done
done

announce "Deploy ✓ ${HOSTNAME_S}: now running ${BUILD_SHA:0:8} (was ${PREVIOUS_SHA:0:8}), by ${DEPLOYER}"

# TC-R3 — close the record. The EXIT trap only fires on a non-zero status, so a
# success needs saying explicitly; then disarm it so the trap cannot append a
# second, contradictory line during normal shutdown.
record_deploy "succeeded"
trap - EXIT

echo
echo "deploy ✓  ${BUILD_SHA:0:8}"
echo "   rollback:  bash scripts/rollback.sh $PREVIOUS_SHA"
echo "   backup:    $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo 'none')"
echo "   recorded:  $DEPLOY_LOG"
