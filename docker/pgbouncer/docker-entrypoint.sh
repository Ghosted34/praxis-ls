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

envsubst < "$CONF_DIR/pgbouncer.ini.template" > "$CONF_DIR/pgbouncer.ini"

# Plaintext in userlist.txt is correct with auth_type=scram-sha-256: PgBouncer
# needs the cleartext to perform SCRAM as a client against Postgres. The file is
# chmod 600 and lives only in the container's filesystem.
printf '"%s" "%s"\n' "$PGBOUNCER_AUTH_USER" "$PGBOUNCER_AUTH_PASSWORD" > "$CONF_DIR/userlist.txt"
chmod 600 "$CONF_DIR/userlist.txt"

echo "pgbouncer: transaction mode, wildcard databases via ${PGBOUNCER_UPSTREAM_HOST}:${PGBOUNCER_UPSTREAM_PORT}," \
     "auth_query as ${PGBOUNCER_AUTH_USER}, pool ${PGBOUNCER_DEFAULT_POOL_SIZE}/db," \
     "max ${PGBOUNCER_MAX_DB_CONNECTIONS} server conns, ${PGBOUNCER_MAX_CLIENT_CONN} client conns"

exec pgbouncer "$CONF_DIR/pgbouncer.ini"
