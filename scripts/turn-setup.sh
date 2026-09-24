#!/bin/sh
# One-time setup of the self-hosted TURN relay on the production host
# (calls audit PR-3; doc/TURN_PRODUCTION_SETUP.md explains every step).
#
# Run it BY HAND, once, from the app directory (where .env and
# docker-compose.yml are), as root:
#
#   sudo scripts/turn-setup.sh --host turn.example.com \
#        [--tls-from /etc/letsencrypt/live/turn.example.com] [--tls-port 5349] \
#        [--external-ip 203.0.113.7] [--apply-firewall] [--no-restart-api]
#
# It is NOT a deploy step: it writes a secret, can change the firewall and
# restarts the API, none of which belongs in an unattended run on every
# merge. It is idempotent: a second run keeps the existing secret (it never
# rotates one silently), re-copies the certificate and re-checks the relay.
#
#   --env-only   write .env and stop (no TLS copy, firewall, Docker or API).
set -eu

HOST=""; TLS_FROM=""; TLS_PORT="5349"; EXTERNAL_IP=""; APPLY_FW=0; RESTART_API=1; ENV_ONLY=0
ENV_FILE="${ENV_FILE:-.env}"
TLS_DIR="${TURN_TLS_TARGET_DIR:-/etc/praxis/turn-tls}"

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --tls-from) TLS_FROM="$2"; shift 2 ;;
    --tls-port) TLS_PORT="$2"; shift 2 ;;
    --external-ip) EXTERNAL_IP="$2"; shift 2 ;;
    --apply-firewall) APPLY_FW=1; shift ;;
    --no-restart-api) RESTART_API=0; shift ;;
    --env-only) ENV_ONLY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "FATAL: $*" >&2; exit 1; }
[ -n "$HOST" ] || die "--host is required (the public DNS name clients reach, e.g. turn.example.com)"
case "$HOST" in *[!A-Za-z0-9.-]*) die "--host '$HOST' is not a hostname" ;; esac
case "$TLS_PORT" in ''|*[!0-9]*) die "--tls-port must be a number" ;; esac
[ "$TLS_PORT" != "443" ] || echo "WARNING: 443 is usually nginx's on this host; 5349 avoids the clash." >&2
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found — run from the app directory"
if [ "$ENV_ONLY" = 0 ]; then
  [ -f docker-compose.yml ] || die "docker-compose.yml not found — run from the app directory"
  [ "$(id -u)" = 0 ] || die "run as root (it copies the certificate and may change the firewall)"
fi

# ── .env ────────────────────────────────────────────────────────────────────
backup="$ENV_FILE.bak-turn-$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_FILE" "$backup"
echo "backed up $ENV_FILE to $backup"

get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
set_env() { # replace KEY=... in place, or append; values here never contain | or newlines
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

secret="$(get_env TURN_CREDENTIAL_SECRET)"
if [ -z "$secret" ] || [ "$secret" = "__set_me__" ] || [ "$secret" = "__rotate_me__" ]; then
  command -v openssl >/dev/null || die "openssl is needed to generate the secret"
  set_env TURN_CREDENTIAL_SECRET "$(openssl rand -hex 32)"
  echo "generated TURN_CREDENTIAL_SECRET"
else
  echo "kept the existing TURN_CREDENTIAL_SECRET (never rotated by this script)"
fi
set_env TURN_HOST "$HOST"
set_env TURN_REALM "$HOST"
[ -n "$(get_env TURN_PORT_UDP)" ] || set_env TURN_PORT_UDP 3478
[ -n "$(get_env TURN_PORT_TCP)" ] || set_env TURN_PORT_TCP 3478

if [ -z "$EXTERNAL_IP" ] && [ "$ENV_ONLY" = 0 ] && command -v curl >/dev/null; then
  public="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [ -n "$public" ] && ! ip -4 -o addr show 2>/dev/null | grep -q " $public/"; then
    EXTERNAL_IP="$public"
    echo "the public IP $public is not on a network interface (cloud NAT): setting TURN_EXTERNAL_IP"
  fi
fi
[ -z "$EXTERNAL_IP" ] || set_env TURN_EXTERNAL_IP "$EXTERNAL_IP"

if [ -n "$TLS_FROM" ]; then
  set_env TURN_TLS_PORT "$TLS_PORT"
  set_env TURN_TLS_DIR "$TLS_DIR"
  set_env TURN_TLS_CERT /etc/turn-tls/fullchain.pem
  set_env TURN_TLS_KEY /etc/turn-tls/privkey.pem
fi

if [ "$ENV_ONLY" = 1 ]; then echo "--env-only: stopping after .env"; exit 0; fi

# ── TLS copy (the relay runs as nobody; Let's Encrypt's key is root-only) ───
if [ -n "$TLS_FROM" ]; then
  [ -r "$TLS_FROM/fullchain.pem" ] && [ -r "$TLS_FROM/privkey.pem" ] || die "no fullchain.pem/privkey.pem in $TLS_FROM"
  install -d -m 750 -o root -g 65534 "$TLS_DIR"
  install -m 644 -o root -g 65534 "$TLS_FROM/fullchain.pem" "$TLS_DIR/fullchain.pem"
  install -m 640 -o root -g 65534 "$TLS_FROM/privkey.pem" "$TLS_DIR/privkey.pem"
  echo "copied the certificate to $TLS_DIR (group nogroup, key 640)"
  hooks=/etc/letsencrypt/renewal-hooks/deploy
  if [ -d "$hooks" ]; then
    cat > "$hooks/praxis-turn.sh" <<HOOK
#!/bin/sh
# Re-copy the renewed certificate for the TURN relay and restart it.
install -m 644 -o root -g 65534 "$TLS_FROM/fullchain.pem" "$TLS_DIR/fullchain.pem"
install -m 640 -o root -g 65534 "$TLS_FROM/privkey.pem" "$TLS_DIR/privkey.pem"
cd "$(pwd)" && docker compose --profile turn restart turn
HOOK
    chmod 755 "$hooks/praxis-turn.sh"
    echo "installed the certbot renewal hook $hooks/praxis-turn.sh"
  else
    echo "WARNING: no $hooks — re-run this script after each certificate renewal." >&2
  fi
fi

# ── DNS ─────────────────────────────────────────────────────────────────────
resolved="$(getent hosts "$HOST" | awk '{print $1}' | head -n 1 || true)"
[ -n "$resolved" ] || echo "WARNING: $HOST does not resolve yet — clients cannot reach the relay until it does." >&2

# ── Firewall ────────────────────────────────────────────────────────────────
udp="$(get_env TURN_PORT_UDP)"; min="$(get_env TURN_MIN_PORT)"; max="$(get_env TURN_MAX_PORT)"
min="${min:-49152}"; max="${max:-65535}"
rules="$udp/udp $udp/tcp $min:$max/udp"
[ -z "$TLS_FROM" ] || rules="$rules $TLS_PORT/tcp"
if [ "$APPLY_FW" = 1 ] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  for r in $rules; do ufw allow "$r" comment "praxis turn"; done
  echo "ufw: allowed $rules"
else
  echo "FIREWALL (not changed): allow exactly $rules — here (ufw allow ...) AND in your cloud provider's firewall."
fi

# ── Start and prove ─────────────────────────────────────────────────────────
docker compose --profile turn up -d --force-recreate turn
sleep 3
if ! docker compose --profile turn exec -T turn sh /check/turn-check.sh 127.0.0.1 "$udp"; then
  die "the relay check failed — see: docker compose logs turn"
fi

if [ "$RESTART_API" = 1 ]; then
  # deploy.sh's order: the standby takes traffic while the api restarts.
  docker compose up -d --no-deps --force-recreate --wait api-standby
  docker compose up -d --no-deps --force-recreate --wait api
  docker compose up -d --no-deps --force-recreate worker
  echo "restarted api-standby, api and worker with the new TURN settings"
else
  echo "Restart the API to use the relay: docker compose up -d --no-deps --wait api-standby api"
fi
echo "TURN relay ready at $HOST. Now place a call between two phones on mobile data."
