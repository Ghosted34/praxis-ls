#!/bin/sh
# TURN relay check (Smart Comms calls, audit C1 and C3).
#
# Proves, against a running coturn, the two things the deployment promises:
#   1. a credential signed with TURN_CREDENTIAL_SECRET gets an allocation and
#      can relay to a public peer, and a wrong secret cannot allocate;
#   2. the relay refuses the cloud-metadata address and the Docker bridge
#      (and loopback and RFC 1918), so a credential is not a way into the host.
#
# Usage (on the TURN host, with the same .env the stack uses):
#   TURN_CREDENTIAL_SECRET=... scripts/turn-check.sh [host] [port]
# Defaults: host 127.0.0.1, port ${TURN_PORT_UDP:-3478}. Needs
# turnutils_uclient (in the coturn image: `docker compose --profile turn exec
# turn sh /check/turn-check.sh`, or the `coturn` package on the host).
#
# Exit 0 only when every check passes. turnutils_uclient's own exit status is
# not usable (a working relay waits for the peer's reply until it times out),
# so each run is judged by what it printed.
set -u

HOST="${1:-127.0.0.1}"
PORT="${2:-${TURN_PORT_UDP:-3478}}"
SECRET="${TURN_CREDENTIAL_SECRET:-}"
UCLIENT="${TURNUTILS_UCLIENT:-turnutils_uclient}"
# A documentation address (TEST-NET-3): public, routable-looking, never a host.
PUBLIC_PEER="${TURN_CHECK_PUBLIC_PEER:-203.0.113.10}"

if [ -z "$SECRET" ]; then
  echo "FAIL: TURN_CREDENTIAL_SECRET is not set in this shell." >&2
  exit 2
fi

failed=0
run() { # $1 user, $2 secret, $3 peer
  timeout 12 "$UCLIENT" -W "$2" -u "$1" -p "$PORT" -e "$3" -n 1 -m 1 -c "$HOST" 2>&1
}
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failed=1; }

tag="check$(date +%s)"

out=$(run "${tag}a" "$SECRET" "$PUBLIC_PEER")
if echo "$out" | grep -q "tot_send_msgs=1" && ! echo "$out" | grep -qi "error"; then
  pass "allocation and relay to a public peer ($PUBLIC_PEER)"
else
  fail "no allocation or relay to $PUBLIC_PEER:"; echo "$out" | grep -i error | head -3
fi

out=$(run "${tag}b" "wrong-$SECRET" "$PUBLIC_PEER")
if echo "$out" | grep -qi "Cannot complete Allocation"; then
  pass "a wrong secret cannot allocate"
else
  fail "a credential signed with the wrong secret was not refused"
fi

i=0
for peer in 169.254.169.254 172.17.0.1 127.0.0.1 10.0.0.1 192.168.1.1; do
  i=$((i + 1))
  out=$(run "${tag}p$i" "$SECRET" "$peer")
  if echo "$out" | grep -q "403"; then
    pass "peer $peer refused (403 Forbidden IP)"
  else
    fail "peer $peer was NOT refused"
  fi
done

[ "$failed" = 0 ] && echo "ALL TURN CHECKS PASSED" || echo "TURN CHECKS FAILED"
exit "$failed"
