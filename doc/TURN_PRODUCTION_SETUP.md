# Self-hosted TURN relay — production setup

How to run the call relay (coturn) for Smart Comms calls on the production VPS.
Written with calls audit PR-3 (`doc/SMART_COMMS_CALLS_AUDIT.md`, C1–C3, C12).

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
3. **Ports.** The relay uses UDP and TCP 3478, TCP 5349 (TLS), and UDP
   49152–65535 for the relayed media. Open them in the **cloud provider's
   firewall** as well as on the host. The setup script can apply the host
   (ufw) rules.
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
     (cloud NAT);
   - the TLS settings, with `--tls-from`.
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
   - 169.254.169.254 (cloud metadata), 172.17.0.1 (Docker bridge),
     127.0.0.1, 10.0.0.1 and 192.168.1.1 are refused.

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
  that holds the data. It needs only `.env` changes (`TURN_HOST` elsewhere,
  the same secret).
