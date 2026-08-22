# PDFs failing on the server — verified runbook

**Read this before running anything.** The runbook that was circulated is
written for a **non-Docker** deploy. If the stack runs under Docker Compose —
which this one does — those commands do nothing at best, and mislead at worst.

---

## 1. Why the host commands do nothing under Docker

`npm install` and `npx puppeteer browsers install chrome` install into the
**host** filesystem. Nothing mounts that into the containers:

```yaml
volumes:
  - ./media:/app/media
  - ./uploads:/app/uploads
  - ./logs:/app/logs
  - ./data:/app/data
```

That is the complete mount list for `api`, `api-standby` and `worker`
(`docker-compose.yml:328-338, 386-390, 433-437`). There is no `./:/app` and no
`node_modules` overlay, so `/app/node_modules` and the system Chromium inside a
container are the **image's own** and cannot be changed from the host.

Had there been such a mount it would be worse than useless: the image is
Alpine (musl) and an Ubuntu host is glibc, so host-built native binaries would
not load at all.

Chromium is already in the image. `Dockerfile:27` installs it
(`chromium nss freetype harfbuzz ca-certificates ttf-freefont`) and
`Dockerfile:31-33` sets all three variables, including
`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` — which on Alpine is the real
path. **Under Docker there is nothing to install; there is only a rebuild.**

## 2. The detail that probably rules the diagnosis out entirely

The preflight is a hard gate on the whole stack:

```yaml
migrate:
  depends_on:
    puppeteer-preflight: { condition: service_completed_successfully }
```

`docker-compose.yml:272`. And `api`, `api-standby` and `worker` all wait on
`migrate`. The preflight does not merely check a file exists — it launches
Chromium, renders HTML, and asserts the bytes begin `%PDF-`
(`scripts/ops/puppeteer-preflight.js`).

**So if the stack is up and serving, Chromium already rendered a valid PDF on
this host.** A missing browser would have stopped migrations and the API from
starting at all. `scripts/deploy.sh:288-305` enforces the same thing on every
deploy, and aborts the rollout if the preflight fails twice.

That means: if the app is running and PDFs still fail, **the cause is almost
certainly not a missing Chromium**, and reinstalling browsers will not fix it.

## 3. Find out which situation you are actually in — 30 seconds

```bash
cd /path/to/praxis-ls

# a) Is the app really in Docker, and is the worker up? PDF renders run from
#    the `pdf` worker job, so an api that is up and a worker that is not looks
#    exactly like "PDFs are broken".
docker compose ps

# b) Ask the image itself. This is the authoritative answer.
docker compose run --rm --no-deps puppeteer-preflight
```

**If (b) prints `"ok": true`** — Chromium is fine. Skip to §5; the problem is
elsewhere and the circulated runbook is a red herring.

**If (b) fails** — the image is stale or was built before Chromium was added.
Rebuild it; do not install anything on the host:

```bash
docker compose build --no-cache api api-standby worker puppeteer-preflight
docker compose run --rm --no-deps puppeteer-preflight
docker compose up -d
```

`scripts/deploy.sh` already does exactly this on failure, so a normal
`./scripts/deploy.sh` run is the supported path.

**If (a) shows the app is NOT in Docker** (only postgres/redis are, and the app
runs under pm2/systemd on the host) — then, and only then, §6 applies.

## 4. Get the real error

`resolveChromiumPath()` in `src/services/pdf.service.js` swallows its lookup
failures and returns `undefined`, at which point Puppeteer falls back to its own
bundled browser — so a genuine failure surfaces later, at launch or at render,
not as "path not found". Read what it actually says:

```bash
docker compose logs --tail=300 worker | grep -iE "pdf|puppeteer|chromium|vault"
docker compose logs --tail=300 api    | grep -iE "pdf|puppeteer|chromium|vault"
```

## 5. If the preflight passes but PDFs still fail

Then rendering works and something after it does not. In likely order:

- **The worker is down or not consuming.** Renders run from the `pdf` worker
  job, not in the API request. `docker compose ps worker`, then its logs.
- **Storage, not rendering.** The service renders, hashes, then *stores* via the
  storage driver and captures into `document_vault`. `STORAGE_LOCAL_PATH`
  resolves under `./data`, which is a bind mount — check it exists and is
  writable by the container's unprivileged `node` user. A permission error here
  reads to a user as "the PDF did not download".
- **A specific document type.** If invoices fail but payslips do not, it is the
  template or its data, not the browser.

## 6. Non-Docker only — a real browser on the host

Only if §3(a) shows the app running outside Docker.

The original note's steps 1 and 3 contradict each other: it installs
`chromium-browser` and then points `PUPPETEER_EXECUTABLE_PATH` at
`/usr/bin/chromium`, which that package does not create. On Ubuntu 20.04+
`chromium-browser` is also a **transitional stub that installs the snap**, and
snap confinement is a well-known cause of Puppeteer launch failures.

Preferred — let Puppeteer install its own Chrome (the original failure was a
*network* failure, not a missing package). `.puppeteerrc.cjs` already caches it
into `<repo>/.cache/puppeteer` and its own comment names the command:

```bash
npx puppeteer browsers install chrome
node scripts/ops/puppeteer-preflight.js
```

Do **not** set `PUPPETEER_EXECUTABLE_PATH` on this route — with no system
browser found, `resolveChromiumPath()` returns `undefined` and Puppeteer uses
its own, which is the intended path.

If the box cannot download Chrome, install a browser that is genuinely a deb:

```bash
# Debian — a real deb at /usr/bin/chromium
sudo apt-get update && sudo apt-get install -y chromium

# Ubuntu — chromium/chromium-browser are snaps; use Google Chrome
wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y /tmp/chrome.deb    # → /usr/bin/google-chrome-stable
```

Then, **before** `npm install` (the download runs in postinstall, so setting it
only in `.env` is too late — the original note is right about this):

```bash
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install
command -v chromium || command -v google-chrome-stable   # check before you write it
echo 'PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable' >> .env
node scripts/ops/puppeteer-preflight.js
```

Appending to `.env` with `>>` has bitten this project before — check
`tail -3 .env` afterwards and make sure it landed on its own line.

Missing shared libraries (`libnss3`, `libatk`, fonts) are the other bare-VPS
failure; the Dockerfile installs the Alpine equivalents for exactly this reason.

---

## Verdict on the circulated note

| Claim | Verdict |
|---|---|
| Puppeteer installed with no browser ⇒ renders fail | Correct *as a mechanism* |
| `PUPPETEER_SKIP_DOWNLOAD` must be exported before `npm install` | **Correct** |
| Docker deploys already covered by Dockerfile + deploy.sh | **Correct** |
| `node scripts/ops/puppeteer-preflight.js` is the right check | **Correct** (under Docker, run it via `docker compose run`) |
| `apt install chromium-browser` + `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` | **Wrong** — mismatched path, and a snap on Ubuntu |
| Applying any of it to a Docker deploy | **Does nothing** — host installs are not mounted into the containers |
