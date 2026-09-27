#!/bin/sh
# coturn entrypoint (Smart Comms calls, audit C1 and C3).
#
# Renders turnserver.conf from the environment and starts coturn with it.
#
# WHY A RENDERED FILE AND NOT FLAGS ON THE COMMAND LINE
#   The shared secret is the one value that lets anyone mint relay
#   credentials. On the command line it shows in `ps` and `docker inspect`;
#   in a mode-600 file inside the container it shows nowhere.
#
# WHAT THE CONFIG PROMISES
#   - Authentication is the REST scheme the API mints (use-auth-secret with
#     static-auth-secret). coturn never read the old TURNSHAREKEY variable, so
#     every minted credential was refused (C3).
#   - The relay cannot reach private, loopback, link-local (cloud metadata),
#     CGNAT or Docker-bridge addresses (C1). With network_mode: host, a relay
#     to 172.17.0.1 or 127.0.0.1 would otherwise reach Postgres and Redis.
#   - The one exception is the relay's own addresses (allowed-peer-ip), so a
#     call where BOTH callers are relayed (client -> TURN -> TURN -> client,
#     common on mobile data) works. coturn checks allowed-peer-ip before
#     denied-peer-ip, so an allowed address wins inside a denied range; it
#     checks loopback, multicast and 169.254/16 before both, so those stay
#     refused whatever is allowed (4.18.0, good_peer_addr).
#   - No TCP relay (RFC 6062): WebRTC relays UDP; a TCP relay is a port
#     scanner for anyone holding a credential.
#   - Per-user and total allocation quotas and a per-session bandwidth cap.
#
# Options checked against coturn 4.18.0 (the pinned image), whose defaults
# already turn the CLI, DTLS and the SOFTWARE attribute off; `no-cli` and
# `no-dtls` would only log errors there. tests/unit/turn-deployment.test.js
# fails on an option not checked against that version.
#
# The image runs as `nobody`: the TLS certificate and key must be readable
# by that user (a copy, not Let's Encrypt's root-only privkey).
#
# TURN_LISTENING_IP binds coturn to that one address (listening and relay),
# so it can take 443 on a second IP while nginx keeps 443 on the main one.
#
# Required: TURN_CREDENTIAL_SECRET, TURN_REALM. Anything else has a default.
# The container refuses to start without them rather than starting a relay
# that accepts no credential, or one keyed on an empty secret.
set -eu

# Where the shared secret comes from. `env` (the default) keeps the secret in
# this file, as before. `vault` means the API owns it and writes it into
# Redis, where coturn reads it — the only way both programs can see one value
# that a person can change without an SSH session.
#
#   turn/realm/<realm>/secret   a SET; EVERY member is a valid secret.
#
# That set is also how rotation avoids dropping a call: during a rotation it
# holds the new secret and the old one, so a credential minted a second before
# the switch still verifies. See smartcomm.turn.secret.service.js.
TURN_SECRET_SOURCE="${TURN_SECRET_SOURCE:-env}"

if [ "$TURN_SECRET_SOURCE" = "vault" ]; then
  if [ -z "${TURN_REDIS_HOST:-}" ] || [ -z "${TURN_REDIS_PASSWORD:-}" ]; then
    echo "FATAL: TURN_SECRET_SOURCE=vault needs TURN_REDIS_HOST and TURN_REDIS_PASSWORD." >&2
    echo "       coturn reads its secrets from turn/realm/<realm>/secret in Redis." >&2
    exit 1
  fi
elif [ -z "${TURN_CREDENTIAL_SECRET:-}" ] || [ "${TURN_CREDENTIAL_SECRET}" = "__set_me__" ]; then
  echo "FATAL: TURN_CREDENTIAL_SECRET is unset. The API signs relay credentials" >&2
  echo "       with it; coturn must verify them with the same value." >&2
  exit 1
fi
if [ -z "${TURN_REALM:-}" ]; then
  echo "FATAL: TURN_REALM is unset (use the TURN hostname, e.g. turn.example.com)." >&2
  exit 1
fi

: "${TURN_PORT_UDP:=3478}"
: "${TURN_TLS_PORT:=0}"
: "${TURN_MIN_PORT:=49152}"
: "${TURN_MAX_PORT:=65535}"
: "${TURN_USER_QUOTA:=12}"
: "${TURN_TOTAL_QUOTA:=400}"
: "${TURN_MAX_BPS:=64000}"
: "${TURN_EXTERNAL_IP:=}"
: "${TURN_LISTENING_IP:=}"
: "${TURN_TLS_CERT:=}"
: "${TURN_TLS_KEY:=}"
: "${TURN_CONF:=/tmp/turnserver.conf}"
: "${TURNSERVER_BIN:=turnserver}"

for n in "$TURN_PORT_UDP" "$TURN_TLS_PORT" "$TURN_MIN_PORT" "$TURN_MAX_PORT" \
         "$TURN_USER_QUOTA" "$TURN_TOTAL_QUOTA" "$TURN_MAX_BPS"; do
  case "$n" in
    ''|*[!0-9]*) echo "FATAL: TURN numeric setting '$n' is not a number." >&2; exit 1 ;;
  esac
done

# TURN_EXTERNAL_IP is "public" or, behind 1:1 cloud NAT, "public/private".
case "$TURN_EXTERNAL_IP" in */*/*|/*|*/) echo "FATAL: TURN_EXTERNAL_IP must be 'public' or 'public/private'." >&2; exit 1 ;; esac
EXT_PUBLIC="${TURN_EXTERNAL_IP%%/*}"
EXT_PRIVATE=""
case "$TURN_EXTERNAL_IP" in */*) EXT_PRIVATE="${TURN_EXTERNAL_IP#*/}" ;; esac
for ip in "$EXT_PUBLIC" "$EXT_PRIVATE" "$TURN_LISTENING_IP"; do
  case "$ip" in
    *[!0-9A-Fa-f:.]*) echo "FATAL: TURN address '$ip' is not an IP address." >&2; exit 1 ;;
  esac
done
case "$TURN_LISTENING_IP" in
  0.0.0.0|::|127.*|::1)
    echo "FATAL: TURN_LISTENING_IP must be the address clients reach, not '$TURN_LISTENING_IP'." >&2; exit 1 ;;
esac

umask 077
{
  echo "listening-port=$TURN_PORT_UDP"
  echo "realm=$TURN_REALM"
  echo "use-auth-secret"
  if [ "$TURN_SECRET_SOURCE" = "vault" ]; then
    # No static-auth-secret line: the secrets come from the set in Redis, and
    # a static one here would ALSO stay valid forever, quietly defeating the
    # rotation this mode exists for.
    #
    # The connection is a read-only ACL user scoped to `turn/*`
    # (docker-compose.yml). coturn runs with network_mode: host, which is the
    # case that compose's own Redis note warns about — so it is given a user
    # that can read the TURN secrets it already holds and nothing else: no
    # sessions, no RBAC projections, no rate-limit counters.
    echo "redis-userdb=\"ip=$TURN_REDIS_HOST port=${TURN_REDIS_PORT:-6379} dbname=0 password=$TURN_REDIS_PASSWORD connect_timeout=30\""
  else
    echo "static-auth-secret=$TURN_CREDENTIAL_SECRET"
  fi
  echo "fingerprint"
  echo "no-multicast-peers"
  echo "no-tcp-relay"
  echo "stale-nonce=600"
  echo "min-port=$TURN_MIN_PORT"
  echo "max-port=$TURN_MAX_PORT"
  echo "user-quota=$TURN_USER_QUOTA"
  echo "total-quota=$TURN_TOTAL_QUOTA"
  echo "max-bps=$TURN_MAX_BPS"
  echo "log-file=stdout"
  echo "simple-log"
  # IPv4: this network, RFC 1918, CGNAT, loopback, link-local (cloud
  # metadata at 169.254.169.254), IETF protocol assignments, benchmarking,
  # and the reserved 240/4. Multicast is refused by no-multicast-peers.
  for range in \
      0.0.0.0-0.255.255.255 \
      10.0.0.0-10.255.255.255 \
      100.64.0.0-100.127.255.255 \
      127.0.0.0-127.255.255.255 \
      169.254.0.0-169.254.255.255 \
      172.16.0.0-172.31.255.255 \
      192.0.0.0-192.0.0.255 \
      192.168.0.0-192.168.255.255 \
      198.18.0.0-198.19.255.255 \
      240.0.0.0-255.255.255.255 \
      ::1 \
      ::ffff:0.0.0.0-::ffff:255.255.255.255 \
      64:ff9b::-64:ff9b::ffff:ffff \
      fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
      fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff; do
    echo "denied-peer-ip=$range"
  done
  if [ -n "$TURN_LISTENING_IP" ]; then
    echo "listening-ip=$TURN_LISTENING_IP"
    echo "relay-ip=$TURN_LISTENING_IP"
  fi
  # Behind cloud NAT the relay advertises the public address. coturn maps a
  # peer at the public part of "public/private" to the private part before
  # checking it, which is why the private part is allowed too.
  [ -z "$TURN_EXTERNAL_IP" ] || echo "external-ip=$TURN_EXTERNAL_IP"
  seen=" "
  for ip in $EXT_PUBLIC $EXT_PRIVATE $TURN_LISTENING_IP; do
    case "$seen" in *" $ip "*) continue ;; esac
    seen="$seen$ip "
    echo "allowed-peer-ip=$ip"
  done
  if [ "$TURN_TLS_PORT" != "0" ]; then
    if [ -z "$TURN_TLS_CERT" ] || [ -z "$TURN_TLS_KEY" ]; then
      echo "FATAL: TURN_TLS_PORT is set but TURN_TLS_CERT / TURN_TLS_KEY are not." >&2
      exit 1
    fi
    echo "tls-listening-port=$TURN_TLS_PORT"
    echo "cert=$TURN_TLS_CERT"
    echo "pkey=$TURN_TLS_KEY"
  else
    echo "no-tls"
  fi
} > "$TURN_CONF"

exec "$TURNSERVER_BIN" -c "$TURN_CONF"
