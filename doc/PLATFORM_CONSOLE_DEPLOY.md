# Platform Console — deployment & AI-vendor rollout

Operational runbook for shipping the Platform Console at **`admin.praxisls.com`**
and the **shared AI-vendor** change. This complements the one-time infrastructure
in `DEPLOYMENT.md` §5b (host-gating, DNS, nginx) — read that once; this page is
the repeatable "what to run now."

The subdomain **already exists** (`admin.praxisls.com`), so the one-time setup
below is for reference/verification only. Skip to §2 for the actual rollout.

---

## 1. One-time infra (already done — verify only)

The console is **host-gated**: the API serves the built console `dist/` only when
the request `Host` equals `PLATFORM_CONSOLE_HOST`. On tenant hosts it is never
served, and there is no `/console` path.

Verify these are in place:

- `.env` on the server contains `PLATFORM_CONSOLE_HOST=admin.praxisls.com`.
- DNS `admin.praxisls.com` points at the same A record as the `*.praxisls.com`
  wildcard (the existing wildcard nginx block proxies it through with the `Host`
  header intact — no new block required).
- A Root Admin exists. If not, bootstrap the first one (the console can't create
  the first platform user):
  ```bash
  docker compose run --rm api npm run platform:create-admin
  ```
- Smoke test: `https://admin.praxisls.com` shows the console login; a tenant host
  (`<slug>.praxisls.com/console`) does **not** reach it.

The console ships inside the Docker image via the `consolebuild` stage, so it is
built and served by the normal deploy — no separate host or process.

---

## 2. Rollout (this release)

### 2.1 Deploy the code

Automatic: push to `main` → CI green → the Deploy workflow runs `scripts/deploy.sh`
(build → migrate → roll standby api → roll primary → worker; zero-downtime).

Manual, by hand:

```bash
cd ~/praxis-ls && bash scripts/deploy.sh
```

`deploy.sh` runs the `migrate` service, which applies **both** migration sets:
`db:migrate:platform` and `db:migrate:tenants`. So the migrations below go out
automatically with the deploy — listed here so you know what to expect and how to
verify.

### 2.2 Migrations in this release

Platform DB (`db:migrate:platform`):

- **`platform/0060_ai_vendor.sql`** — creates the shared `ai_vendor_credential`
  table and seeds the four vendors (deepseek, embeddings, gemini, groq) with no
  keys, active.

Every tenant DB (`db:migrate:tenants`):

- **`tenant/0475_master_email.sql`** — `email` column on client/supplier/employee
  (document recipients).
- **`tenant/0476_document_lines.sql`** — line-item tables for purchase requests,
  delivery notes, transit orders, and GRNs.

All are additive (new tables/columns), so old code stays correct during the
few seconds both versions run. If `migrate` fails, `deploy.sh` stops **before**
touching the running containers — check `docker compose logs migrate`.

### 2.3 Set the shared AI vendor keys (console)

AI provider keys are now **one shared, deploy-wide set** managed only from the
console — the per-tenant Vendors tab is gone.

1. Sign in at `https://admin.praxisls.com`.
2. Open **Integrations → AI providers** (the vendor cards are a section at the
   bottom of the Integrations page).
3. For each provider you use (DeepSeek, Embeddings/OpenAI, Gemini, Groq): paste
   the **API key**, adjust the **model** / **endpoint** if needed, keep **Active**
   on, **Save**, then **Test** (a live `/models` auth check — expect "Connected").

Keys are AES-256-GCM encrypted at rest and never shown again after saving (reads
report presence only). Rotating = paste a new key and Save.

> Encryption key: keys are encrypted with the deployment's `ENCRYPTION_KEY`
> (`encryption.service`). It must be the **same** value the API already uses — do
> not rotate it, or previously-saved vendor keys become undecryptable.

### 2.4 Verify the AI runtime

Because this reroutes the live credential path (tenants now read keys from the
platform table, `.env` remains the fallback), confirm on a real tenant after
setting a key:

- Trigger an assistant chat turn → expect a real response (not the stub).
- Trigger something that embeds/retrieves → no "no vendor configured" degrade.
- If a provider fails, re-check its **Test** in the console and the key/endpoint.

---

## 3. Rollback notes

- The migrations are additive; a code rollback does **not** require dropping the
  new tables. Old tenant code simply ignores `document_lines` / master `email`.
- If the shared-vendor path misbehaves, the fastest mitigation is to set the
  provider keys in the API `.env` fallback (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
  …); `resolveVendor` falls back to env when the platform row has no usable key.
- The tenant Vendors tab and its routes were removed; there is no per-tenant key
  path to fall back to.

---

## 4. Quick reference

| Action                          | Command                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Deploy (build → migrate → roll) | `bash scripts/deploy.sh`                                    |
| Platform migrations only        | `docker compose run --rm api npm run db:migrate:platform`   |
| Tenant migrations only          | `docker compose run --rm api npm run db:migrate:tenants`    |
| Create first Root Admin         | `docker compose run --rm api npm run platform:create-admin` |
| Console logs                    | `docker compose logs -f api`                                |
