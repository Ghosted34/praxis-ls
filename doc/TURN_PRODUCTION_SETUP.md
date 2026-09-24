# Self-hosted TURN relay — production setup

How to run the call relay (coturn) for Smart Comms calls on the production VPS.
Written with calls audit PR-3 (`doc/SMART_COMMS_CALLS_AUDIT.md`, C1–C3, C12);
relay to relay and TLS on 443 added in PR-4.

## What it is, and what changes when it is on

A 1:1 call is peer-to-peer. Each phone first asks a **STUN** server "what is
my public address?", the two phones swap addresses, and they connect
directly. That fails when either side is behind carrier-grade NAT, which is
normal on mobile data in the corridor. There a **TURN** relay carries the
audio instead. Calls are still encrypted end to end (SRTP), and the relay
never sees the audio.

| Configuration | STUN used | Relay | Calls that connect |
| --- | --- | --- | --- |
| Neither `STUN_URLS` nor `TURN_HOST` (stopgap) | Google's public server — callers' addresses go to Google | none | Same network, and most home/office Wi-Fi. Not mobile data behind CGNAT. |
| `TURN_HOST` set and relay running | your relay | your relay | All of the above, plus mobile data. Google is no longer used. |

The Google fallback is an owner decision (2026-09-24), kept until the relay
is running. It stops automatically once `TURN_HOST` is set: there is no
second switch to remember.

## Before you start

1. **A DNS name** for the relay pointing at the VPS, e.g. an A record
   `turn.<your-domain>` → the VPS's public IPv4. A name is needed for TLS
   and keeps the setting stable if the IP ever changes.
2. **A certificate for that name** (optional but recommended: some
   corporate and hotel networks allow only TCP 443/5349). nginx owns ports
   80 and 443 on this host, so use its plugin:
   `certbot certonly --nginx -d turn.<your-domain>`.
3. **Ports.** The relay uses UDP and TCP 3478, TCP 5349 (TLS; or 443, see
   [TLS on 443](#tls-on-443)), and UDP 49152–65535 for the relayed media.
   Open them in the **cloud provider's firewall** as well as on the host.
   The setup script can apply the host (ufw) rules.
4. **Capacity.** A relayed call is roughly 100 kbit/s each way per person.
   A few dozen simultaneous relayed calls is well within a normal VPS.

## Setup (once, by hand)

From the app directory on the VPS (where `.env` and `docker-compose.yml`
are), as root:

```
sudo scripts/turn-setup.sh --host turn.<your-domain> \
     --tls-from /etc/letsencrypt/live/turn.<your-domain> \
     --apply-firewall
```

What it does, in order:

1. **Backs up `.env`** (`.env.bak-turn-<timestamp>`).
2. **Writes the settings:**
   - `TURN_HOST` and `TURN_REALM`;
   - `TURN_CREDENTIAL_SECRET`: 32 random bytes, generated only if there is
     none yet (a second run never rotates it);
   - `TURN_EXTERNAL_IP`, if the public IP is not on a network interface
     (1:1 cloud NAT), as `public/private`;
   - `TURN_LISTENING_IP`, with `--listening-ip`;
   - the TLS settings, with `--tls-from`. If the TLS port is already taken
     where the relay would bind it, the script stops before changing
     anything and says who holds it.
3. **Copies the certificate** where the relay can read it
   (`/etc/praxis/turn-tls`; the relay runs as `nobody`, and Let's Encrypt's
   key is root-only). It also installs a certbot renewal hook that re-copies
   the certificate and restarts the relay.
4. **Checks the DNS name resolves.**
5. **Opens the firewall** with ufw if you pass `--apply-firewall`. It
   **always prints** the rules to add in the cloud provider's firewall.
6. **Starts the relay** (`docker compose --profile turn up -d turn`) and
   **proves it** with `scripts/turn-check.sh`. That check confirms:
   - an allocation works;
   - a wrong secret is refused;
   - relay to relay works: two allocations on this relay reach each other
     (a call where both phones are relayed, see below);
   - 169.254.169.254 (cloud metadata), 172.17.0.1 (Docker bridge),
     127.0.0.1, 10.0.0.1 and 192.168.1.1 are refused, and so is the next
     address after the relay's own private one (its subnet neighbour).

   It stops here if any check fails.
7. **Restarts the API** in deploy order (standby first, then api, then
   worker), so new calls get relay credentials. Pass `--no-restart-api` to
   do this yourself.

Then place a call between two phones **on mobile data**. It should connect.

### Why a script you run once, and not a deploy step

`scripts/deploy.sh` runs unattended over SSH on every merge. The relay's
setup:
- creates a secret (repeating it would log everyone out of the relay);
- may change the firewall;
- needs a DNS name and a certificate only you can provide.

Those are host provisioning, done once and deliberately. Deploys never touch
the `turn` container: it keeps running across API deploys. After a PR changes
the relay itself (its entrypoint or image), run
`docker compose --profile turn up -d --force-recreate turn`.

## Verify from outside

From any machine with `turnutils_uclient` (the `coturn` package), using the
secret from `.env`:

```
turnutils_uclient -W "<secret>" -u probe -p 3478 -e 203.0.113.10 -n 1 -m 1 -c turn.<your-domain>
```

Expect `tot_send_msgs=1` and no `ERROR`. A timeout means the firewall
(usually the cloud provider's) is closed.

Relay to relay, from outside:

```
turnutils_uclient -W "<secret>" -u probe -p 3478 -y -n 1 -m 1 -c turn.<your-domain>
```

Expect `tot_recv_msgs=2` on the last `start_mclient` line. `channel bind:
error 403 (Forbidden IP)` means the relay refuses its own address (see
[Relay to relay](#relay-to-relay)).

## Relay to relay

On mobile data both callers are often behind carrier-grade NAT, so **both**
are relayed: phone A → relay → relay → phone B. The relay then sends to one
of its own relayed addresses, so it must accept itself as a peer. PR-3's
config refused that (it denied the host's public IP, and behind cloud NAT its
private IP sits in a denied private range), so those calls never connected.

The entrypoint now writes `allowed-peer-ip` for the relay's own addresses,
the documented coturn pattern (Synapse's TURN guide: "special case the turn
server itself so that client->TURN->TURN->client flows work"):

| Setting | Allowed peers |
| --- | --- |
| `TURN_EXTERNAL_IP=203.0.113.7` (public IP on the interface) | `203.0.113.7` |
| `TURN_EXTERNAL_IP=203.0.113.7/10.0.0.5` (1:1 cloud NAT) | `203.0.113.7`, `10.0.0.5` |
| `TURN_LISTENING_IP=203.0.113.8` | also `203.0.113.8` |

How coturn 4.18.0 decides (`good_peer_addr` in `src/server/ns_turn_server.c`):

1. Multicast, loopback (127/8, `::1`), `0.0.0.0` and link-local
   (169.254/16 including cloud metadata, `fe80::/10`, `fc00::/7`) are
   refused first. No `allowed-peer-ip` can re-open them.
2. `allowed-peer-ip` next: a match is allowed, even inside a denied range.
3. `denied-peer-ip` last.

The order of the lines in the config does not matter. With `public/private`,
coturn maps a peer at the public address to the private one before this
check (`stun_attr_get_addr_str` → `map_addr_from_public_to_private`), and
it already whitelists that private part itself (4.6.1 and 4.18.0 both log
"Whitelisting external-ip private part"); the explicit line keeps it stated.
With a public address only, the relayed packets go out to the public IP and
depend on the cloud hairpinning them back, which is why the setup script
writes `public/private` behind NAT.

Only exact addresses are allowed, never a range: every other private
address stays refused, including the relay's subnet neighbours
(`turn-check.sh` probes one). What allowing its own address does expose:
relayed UDP can reach any UDP service listening on those addresses (TCP
relay is off). Keep the relay host's other UDP services on loopback;
`ss -lunp` should show only coturn on the public and private addresses.

## Operating it

- **Logs:** `docker compose --profile turn logs -f turn`.
- **Health:** `docker compose ps turn`. The health check makes a real
  allocation every 5 minutes.
- **Rotating the secret:** calls in progress lose the relay when it
  changes, so do it at a quiet hour:
  1. set a new `TURN_CREDENTIAL_SECRET` in `.env`;
  2. `docker compose --profile turn up -d --force-recreate turn`;
  3. restart `api-standby`, `api` and `worker`.
- **Turning it off:** `docker compose --profile turn stop turn` and empty
  `TURN_HOST`; calls fall back to Google's STUN.

## TLS on 443

Some corporate, hotel and public Wi-Fi networks allow outbound TCP 443 and
nothing else. There, UDP 3478 and TCP 5349 are both blocked and a call
connects only through `turns:` on 443. nginx already holds 443 on the app
host, and two programs cannot listen on the same address and port, so the
relay needs an IP address of its own. Two layouts. Do not route TURN
through nginx (owner decision): it is not HTTP, every HTTPS request would
then pass through a stream proxy first, and the relay would see nginx's
address instead of each caller's.

**Is it worth it?** The 5349 listener already covers networks that block UDP
but allow other TCP ports. Pay for 443 when calls fail on such a network
and work on mobile data, or when your users are mostly on locked-down
office networks. It does not help behind a TLS-inspecting proxy, which
cannot pass TURN in either layout.

### Layout A: a second IP on the app host

1. **Buy a second public IPv4** for the VPS from the provider and attach it
   to the server (most providers call it an additional or floating IP; add
   it to the network interface as their guide says). `ip -4 addr` must list
   it.
2. **DNS:** point `turn.<your-domain>` at the **second** IP. Leave every
   app name on the main IP.
3. **nginx: bind 443 to the main IP only.** A plain `listen 443` holds 443 on
   every address of the host, the new one included. Change every such line:

   ```
   grep -rn 'listen .*443' /etc/nginx/
   # in each server block, for example:
   #   listen 443 ssl http2;      →   listen <main-ip>:443 ssl http2;
   #   listen [::]:443 ssl http2; →   leave as is (IPv6 only, no clash)
   nginx -t && systemctl reload nginx
   ss -ltnp 'sport = :443'          # nginx on <main-ip>:443 only
   ```

   Every server block must change: one wildcard `listen 443` left anywhere
   keeps the whole port. Port 80 stays as it is, so certbot's `--nginx`
   renewal for `turn.<your-domain>` keeps working through it.
4. **Run the setup** with the second IP:

   ```
   sudo scripts/turn-setup.sh --host turn.<your-domain> \
        --tls-from /etc/letsencrypt/live/turn.<your-domain> \
        --tls-port 443 --listening-ip <second-ip> --apply-firewall
   ```

   `TURN_LISTENING_IP` binds coturn's listeners and relay sockets to the
   second IP only (`listening-ip` and `relay-ip`), so it never touches the
   main IP's 443. The script stops before changing anything if 443 is still
   taken on the second IP (`ss -ltnH`), naming the holder. If the second IP
   is itself behind 1:1 NAT, also pass `--external-ip <public>/<private>`
   and use the private address as `--listening-ip`.

### Layout B: a dedicated TURN host

A small VPS that runs only the relay. It also keeps call bandwidth and the
relay's exposure off the host that holds the data (see the design notes).

1. **Create the VPS** and point `turn.<your-domain>` at it.
2. **Certificate:** nothing else listens there, so
   `certbot certonly --standalone -d turn.<your-domain>` (port 80 open for
   the challenge).
3. **Copy the repository** (for `docker-compose.yml`, the entrypoint and
   `scripts/`) and a `.env` holding the **same** `TURN_CREDENTIAL_SECRET` as
   the app host.
4. **Run the setup** there, without restarting an API that is not there:

   ```
   sudo scripts/turn-setup.sh --host turn.<your-domain> \
        --tls-from /etc/letsencrypt/live/turn.<your-domain> \
        --tls-port 443 --apply-firewall --no-restart-api
   ```

   With no nginx on the host there is no 443 warning; `--listening-ip` is
   optional.
5. **On the app host**, set `TURN_HOST=turn.<your-domain>`,
   `TURN_TLS_PORT=443` (the API builds the `turns:` URL from it) and the same
   secret in `.env`, then restart `api-standby`, `api` and `worker`.

### Check it

From a network that allows only 443 (or a laptop with outbound UDP and every
TCP port but 443 blocked), place a call. Relay-only calls (below) force the
relay, so the call can only connect through `turns:` on 443.

## Relay-only calls

Settings → Calls → "Relay-only calls" sends every call through the relay, so
no employee's IP address reaches the other. With the relay down, those calls
do not connect. That is the promise the switch makes.

## Design notes (and what not to do)

- **No static TURN username or password.** A fixed `TURN_USERNAME` /
  password is what the audit removed (C2, guide §5.5). Anyone who reads it
  relays through you forever. The API mints a credential per call:
  `<expiry>:<call token>`, HMAC-signed with the shared secret, expiring
  with the call.
- **One shared secret, two readers.** The API signs with
  `TURN_CREDENTIAL_SECRET` and coturn verifies with the same value, so both
  must read one source. Today that is the host's `.env`.
- **Moving it to the admin console (proposed for a later PR).** Storing the
  TURN host and secret encrypted in the platform console, like the AI vendor
  credentials, is sound for the API side. But coturn cannot read the
  console, so the secret would then live in two places, and they would drift.
  The way to do it properly:
  - the console stores the secret, encrypted, and the API reads it from
    there;
  - coturn reads its secrets from Redis (`redis-userdb` with the
    `turn/secret` keys, which coturn supports), written by the API when the
    console setting changes;
  - rotation keeps two secrets valid for one call's length, so a change
    never drops a call in progress;
  - the host `.env` then keeps only the relay's own settings (realm, ports,
    TLS).

  That is a separate, reviewable change (platform console, Redis ACL for
  coturn, rotation). Until it lands, `.env` is the single source.
- **Same VPS as the app.** Supported: the relay refuses private, loopback,
  link-local and Docker-bridge peers, has no TCP relay, and has quotas, so a
  credential cannot reach Postgres, Redis or cloud metadata. A separate
  small VPS for the relay is still the stronger layout: it keeps call
  bandwidth off the ERP's box, and the relay's network exposure off the host
  that holds the data. See [Layout B](#layout-b-a-dedicated-turn-host).
- **The relay allows itself as a peer, nothing else private.** Relay to
  relay needs it; see [Relay to relay](#relay-to-relay) for what that
  exposes and how coturn orders the rules.
