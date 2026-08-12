#!/bin/sh
# PgBouncer entrypoint (WS-S1).
#
# Renders pgbouncer.ini from the template and writes a userlist.txt holding
# exactly one credential — the auth_user, which is the one account that cannot
# be resolved by auth_query because it is the account auth_query runs as.
#
# WHY THE FILE IS BUILT AT START AND NOT COMMITTED
#   userlist.txt contains a password hash. Generating it here means the secret
#   lives only in the environment and in a file inside the running container,
#   never in the repository or the image.
set -eu

: "${PGBOUNCER_AUTH_USER:=pgbouncer}"
: "${PGBOUNCER_UPSTREAM_HOST:=postgres}"
: "${PGBOUNCER_UPSTREAM_PORT:=5432}"
: "${PGBOUNCER_AUTH_DBNAME:=postgres}"
: "${PGBOUNCER_MAX_CLIENT_CONN:=1000}"
: "${PGBOUNCER_DEFAULT_POOL_SIZE:=5}"
: "${PGBOUNCER_RESERVE_POOL_SIZE:=2}"
: "${PGBOUNCER_MAX_DB_CONNECTIONS:=80}"

if [ -z "${PGBOUNCER_AUTH_PASSWORD:-}" ]; then
  echo "FATAL: PGBOUNCER_AUTH_PASSWORD is unset." >&2
  echo "       It must match the password given to the lookup role by" >&2
  echo "       scripts/db/setup-pgbouncer-auth.js, or every connection fails" >&2
  echo "       authentication in a way that looks like a Postgres outage." >&2
  exit 1
fi

CONF_DIR=/etc/pgbouncer
mkdir -p "$CONF_DIR"

export PGBOUNCER_AUTH_USER PGBOUNCER_UPSTREAM_HOST PGBOUNCER_UPSTREAM_PORT \
       PGBOUNCER_AUTH_DBNAME PGBOUNCER_MAX_CLIENT_CONN PGBOUNCER_DEFAULT_POOL_SIZE \
       PGBOUNCER_RESERVE_POOL_SIZE PGBOUNCER_MAX_DB_CONNECTIONS

# Rendered with `sed`, not `envsubst`.
#
# `envsubst` ships with gettext, which this image does not have:
#
#     /praxis-entrypoint.sh: line 38: envsubst: not found
#
# So this entrypoint has NEVER rendered a config, and the pgbouncer container has
# never started — in CI or in production. It was invisible because nothing
# depended on the pooler: the container sat in `docker compose ps` output nobody
# read, and the one time traffic was pointed at port 6432 the symptom was
# ECONNREFUSED, which reads as "pooler not configured yet" rather than "pooler
# has never once worked".
#
# The 2026-08-12 CI run is what found it, on its first execution, which is the
# entire argument for rehearsing a cutover rather than planning one.
#
# `sed` is in every base image including busybox, so this has no dependency to
# forget. `|` as the delimiter: hostnames, identifiers and integers are the only
# values substituted here and none of them can contain one.
cp "$CONF_DIR/pgbouncer.ini.template" "$CONF_DIR/pgbouncer.ini"
for v in PGBOUNCER_UPSTREAM_HOST PGBOUNCER_UPSTREAM_PORT PGBOUNCER_AUTH_USER \
         PGBOUNCER_AUTH_DBNAME PGBOUNCER_MAX_CLIENT_CONN PGBOUNCER_DEFAULT_POOL_SIZE \
         PGBOUNCER_RESERVE_POOL_SIZE PGBOUNCER_MAX_DB_CONNECTIONS; do
  eval "val=\${$v}"
  sed -i "s|\${$v}|${val}|g" "$CONF_DIR/pgbouncer.ini"
done

# A placeholder left unsubstituted would be handed to PgBouncer as a literal
# `${...}`, and it would either refuse to start with an opaque parse error or —
# worse, for the numeric settings — quietly take a default nobody chose. Fail
# here instead, naming what was missed.
# Comment lines excluded: the template's own header explains that `${VARS}` are
# substituted, and a check that trips over the documentation of itself is a check
# that gets deleted. Only SETTINGS are inspected.
if grep -vE '^[[:space:]]*;' "$CONF_DIR/pgbouncer.ini" | grep -q '\${'; then
  echo "FATAL: pgbouncer.ini still contains unsubstituted placeholders:" >&2
  grep -nvE '^[[:space:]]*;' "$CONF_DIR/pgbouncer.ini" | grep '\${' >&2
  echo "       Add the variable to the loop in this script, or remove it from the template." >&2
  exit 1
fi

# Plaintext in userlist.txt is correct with auth_type=scram-sha-256: PgBouncer
# needs the cleartext to perform SCRAM as a client against Postgres. The file is
# chmod 600 and lives only in the container's filesystem.
printf '"%s" "%s"\n' "$PGBOUNCER_AUTH_USER" "$PGBOUNCER_AUTH_PASSWORD" > "$CONF_DIR/userlist.txt"
chmod 600 "$CONF_DIR/userlist.txt"

echo "pgbouncer: transaction mode, wildcard databases via ${PGBOUNCER_UPSTREAM_HOST}:${PGBOUNCER_UPSTREAM_PORT}," \
     "auth_query as ${PGBOUNCER_AUTH_USER}, pool ${PGBOUNCER_DEFAULT_POOL_SIZE}/db," \
     "max ${PGBOUNCER_MAX_DB_CONNECTIONS} server conns, ${PGBOUNCER_MAX_CLIENT_CONN} client conns"

exec pgbouncer "$CONF_DIR/pgbouncer.ini"
