# Praxis LS — Mail System Audit (2026-08-06)

Scope: the two email configurations end-to-end — **system email** (per-tenant
sender identities + the new deploy-wide `mail.fallback` sender) and the **mailbox
engine** (`email_connection`, IMAP/SMTP + Microsoft/Google OAuth, inbound sync,
outbound send/reply, threads, attachments, realtime). Also the **messaging
surface** (`smartcomm` chat + `mail`/setup UI).

Method: code walk-through of every send/inbound path, the workers, the OAuth
flows, the data model migrations, and the client UI. **All 1,359 unit/security
tests pass.**

---

## 1. What is correct (verified)

### System email (two-config model)

- `email.service.resolveMail` resolves tenant identity → **platform `mail.fallback`**
  → env. Tenants with no own SMTP get `no-reply@praxisls.com` (transactional) /
  `support@praxisls.com` (SUPPORT) through the deploy-wide SMTP, so OTP/invites/
  invoices/notifications never silently fail. **Fixed** a pre-existing bug where
  `MAIL_DEFAULT_FROM` was referenced but never defined.
- Deliverability guard: when we fall back on **transport** we also fall back on
  the **sender** (a tenant-domain From through the deploy SMTP would fail SPF/DKIM).
- All real system-email callers (`app_user` OTP/reset, `portal_auth` invite,
  `notification` fan-out, `documents/template` invoice/PO/payslip mailing, the
  `email-send` worker) go through `email.service.send` → all benefit from the fallback.
- The fallback itself is **platform-configured** (Platform Console → Integrations →
  System-email fallback sender), password AES-256-GCM at rest; env is last resort.
- `MAIL_FALLBACK_DOMAIN` default corrected `nmail.praxisls.com` → `praxisls.com`.

### Mailbox engine

- Provider-agnostic interface (`provider.interface.js`) + 3 adapters: **IMAP/SMTP**
  (inbound `fetchSince` with UIDVALIDITY-safe cursor, outbound with **Sent-folder
  APPEND**), **Microsoft Graph**, **Google Gmail** (both delta-cursor).
- Inbound: BullMQ `mail-sync-scheduler` fans a per-tenant `mail-sync` job →
  dedup insert (`ux_email_inbound_dedup`), attachment persist to `document_vault`,
  HTML sanitised on ingest, CRM/dossier auto-link, `email.received` event.
- Realtime: worker → Redis `mail-bus` → web socket `mail:new` to the tenant's mail
  room (works across the web/worker process split).
- Outbound: `send` + `reply` (in-thread with References/In-Reply-To), OUT copies
  recorded for the thread view.
- OAuth: signed-JWT state (CSRF + tenant pinning), refresh-and-persist, webhook
  renewal cron. Gating on `MOD-72` with correct action mapping (RFC 2026-08-02 audit).
- Secrets: mailbox passwords / OAuth bundles encrypted in `integration_secret`;
  only `secret_key` on the row.
- UI: mailbox reachable at **Comms → Mailbox**; Setup explains the two-config split.

---

## 2. Gaps found

### Fixed (this pass)

**G-1 · HIGH — `email_send_log` is never written.** ✅ **Fixed.** The table exists
(migration `0410`) and `GET /mail/sent` reads it, but nothing INSERTed into it — the
"Send log" view was always empty with no audit trail of system emails.
`email.service.send` now writes a **SENT** row (with provider message-id) on success
and a **FAILED** row (with the error) on failure, via `email.repo.recordSend`.
Callers can pass `entityRef` (the source document) — wired for document emails
(`invoice:<id>`, etc.). Best-effort: a log-write failure never masks the send.

**G-2 · MEDIUM — no "compose new email" in the Mailbox UI.** ✅ **Fixed.** Added a
**Compose** button + modal to `ThreadsSection` that lets you pick a connected mailbox
and send a new message (`api.sendMail`), wired to `POST /mail/send`. "Send emails
from here" now includes new messages, not just replies.

**G-3 · MEDIUM — "mark as read" does not propagate to the mail server.** ✅ **Fixed.**
`mail.service.markRead` now resolves the message's connection, builds the adapter
and calls `adapter.markAsRead(externalMessageId)` (all three providers implement it)
before flipping the local row — best-effort so a provider failure never blocks the
local read flip.

**G-4 · Marketing-campaign `from` override bypasses the fallback rule.** ✅ **Fixed.**
`email.service.send` now honours a caller-supplied `from` override **only** when the
tenant resolved their **own** SMTP host (`sender_source` identity/settings). On the
fallback sender the Praxis address wins, so a tenant-domain From never goes out
through the deploy relay and fails SPF/DKIM/DMARC.

**G-8 · Fallback sender has no display name.** ✅ **Fixed.** The fallback From now
formats as `"Praxis" <no-reply@praxisls.com>` when `from_name` is set.

### Remaining notes (documented, not blocking)

**G-5 · IMAP inbound sync polls only INBOX.** Other folders aren't pulled for
inbound; outbound is recorded locally (`direction='OUT'`) and the SMTP adapter
APPENDs to Sent, so the thread view is complete — but pre-existing mail in other
folders won't appear. **Decision: deferred.** This is a scope expansion (multi-
folder sync has tradeoffs), not a defect, so it's kept as a documented limitation
and a follow-up rather than crammed into this PR.

**G-6 · Webhook authenticity.** ✅ **Mitigated.** Full cryptographic signing isn't
available by default (Microsoft/Google don't sign change notifications unless you
opt in to provider-side encryption), but two cheap checks are now in place:
Microsoft Graph — a notification's `clientState` must resolve to a real, CONNECTED
mailbox in the tenant (forged/stale ids are skipped, not synced); Gmail Pub/Sub — a
push whose `subscription` doesn't match the configured `GOOGLE_PUBSUB_TOPIC` is
ignored before any decode/lookup. Tested in `mail-webhook-auth.test.js`. For
stronger guarantees, opt into Microsoft Graph notification encryption / a Gmail
push verification token as a later hardening step.

**G-7 · Realtime mail bridge retry.** ✅ **Fixed.** `attachMailBridge` now retries
indefinitely with capped backoff (500ms → 16s) instead of giving up after 20 tries,
so `mail:new` live refresh resumes if Redis comes up shortly after boot. Polling
remains the safety net regardless.

---

## 3. Server setup checklist

Things to configure on the server/deployment for the mail system to run properly.

### 3.0 Cloudflare / DNS (things to create on Cloudflare)

The email system touches your DNS in three places. All live in the **`praxisls.com`
zone on Cloudflare**.

**a. Tenant resolution + OAuth redirects / webhooks (must be live for the whole app):**

- A **wildcard** `*.praxisls.com` record (A/AAAA to your server, or a proxied CNAME
  to a host) so every tenant resolves to the app and the Microsoft/Google redirect +
  webhook URLs are publicly reachable over HTTPS. (This is for tenant subdomains —
  already part of the multi-tenant design.)

**b. Deliverability of the fallback sender (`no-reply@` / `support@praxisls.com`) — the critical one:**

- **SPF** — a TXT record on `praxisls.com` authorising the deploy SMTP relay, e.g.
  `v=spf1 include:<your-relay-spf> ~all` (plus Cloudflare's own if you proxy mail
  servers). Without it fallback mail is sent but often lands in spam or bounces.
- **DKIM** — a TXT/`TXT` record under `default._domainkey.praxisls.com` (selector
  depends on your relay) with the relay's DKIM public key, so fallback mail is signed.
- **DMARC** — a TXT record `_dmarc.praxisls.com` = `v=DMARC1; p=none; rua=mailto:<report@praxisls.com>`.
  Start at `p=none` (monitor) before tightening to `p=quarantine`.
- **MX** — only if you want replies addressed to `no-reply@praxisls.com` /
  `support@praxisls.com` to actually be _received_. If you do, set MX records to a
  real mailbox provider and create those addresses there; otherwise send-only is
  fine and a bounce to the fallback From will fail quietly (reply-to is usually a
  real address anyway).

**c. Per-tenant mailbox deliverability (their own domain, not praxisls.com):**

- Each tenant who connects a mailbox on **their own domain** (e.g. `smartls.cm`)
  needs **their own** SPF/DKIM/DMARC records on _their_ DNS. That is done by the
  tenant, not on Cloudflare for `praxisls.com`. Praxis only shows them the values to
  add (and a "verified" flag in the senders UI).

### 3.1 Build-time / platform config (one-off, per deployment)

1. **Migrate the platform DB** so the new `mail.fallback` row exists and existing
   tenants pick up the fix — `npm run db:migrate:platform` (applies `0091`).
2. **Set the deploy-wide fallback sender** in **Platform Console → Integrations →
   System-email fallback sender**: `no-reply@praxisls.com` / `support@praxisls.com`,
   **SMTP host/port/user/password**, and click **Test**. This is the authoritative
   config; the env vars below are only the last-resort default.
3. **Make `praxisls.com` deliverable** (one-time, critical): add the deploy SMTP
   relay to `praxisls.com` **SPF**, set **DKIM** for the relay, and **DMARC**. Without
   this, fallback mail is _sent_ but not _delivered_.

### 3.2 `.env` (used by `docker compose`, overridable per tenant/fallback)

```
SMTP_HOST=              # fallback relay host (only if not set in the console)
SMTP_PORT=587           # 587 STARTTLS / 465 SSL
SMTP_USER=
SMTP_PASS=
MAIL_FALLBACK_DOMAIN=praxisls.com
MAIL_DEFAULT_FROM=no-reply@praxisls.com
MAIL_SUPPORT_FROM=support@praxisls.com
MAIL_FALLBACK_FROM_NAME=Praxis
```

### 3.3 Mailbox engine runtime (workers + queue)

- **Redis** must be up (BullMQ queue + the `mail-bus` realtime channel). `REDIS_URL`
  - `REDIS_PASSWORD`.
- **Run the worker process** — `npm run worker` (`src/jobs/workers.js`) — which
  registers the mail schedulers + handlers:
  - `MAIL_SYNC_INTERVAL_MS` — how often to poll each tenant's mailbox (default
    `60000` ms; `0` disables). The `mail-sync-scheduler` fans a per-tenant
    `mail-sync` job; `mail-sync` opens the tenant DB and syncs every `CONNECTED`
    `email_connection`.
  - `MAIL_WEBHOOK_RENEW_INTERVAL_MS` — renews Graph/Gmail push subscriptions
    (default `21600000` = 6h; `0` disables).
- **Optional:** IMAP IDLE for low-latency inbound — `npm run idle`
  (`src/jobs/mail-idle.js`) as a separate process. Polling is the safety net, so
  this is optional.

### 3.4 Public endpoints needed (for OAuth + webhooks)

- **Microsoft 365 mailbox** — register an Azure app with scopes
  `offline_access User.Read Mail.Read Mail.Send Mail.ReadWrite`; set
  `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET`; redirect
  `…/api/tenant/mail/oauth/microsoft/callback` (or `MS_GRAPH_REDIRECT_URI`);
  webhook `…/api/tenant/mail/webhook/microsoft` must be publicly reachable (HTTPS).
- **Google Gmail mailbox** — Google Cloud OAuth client, scopes
  `openid email https://www.googleapis.com/auth/gmail.modify`; `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`; redirect `…/api/tenant/mail/oauth/google/callback`; optional
  Pub/Sub push via `GOOGLE_PUBSUB_TOPIC` (delta-polling works without it).
- The webhook/redirect URLs are reached over the **tenant subdomain host**, so the
  API must be publicly reachable on `<tenant>.praxisls.com` with a valid TLS cert.

### 3.5 Per-tenant (done by the tenant admin in the product, not on the server)

- **System email:** Comms → Setup → set per-purpose **Section senders** + shared
  SMTP login; until then the platform fallback covers them.
- **Mailbox:** Comms → Mailbox → connect their company-domain address (IMAP/SMTP
  app password, or Microsoft/Google OAuth).

---

## 4. Recommendation

All functional/security gaps are now **fixed and tested**: G-1 (send log), G-2
(compose), G-3 (read-state propagation), G-4 (SPF override guard), G-6 (webhook
authenticity), G-7 (realtime bridge retry), G-8 (fallback display name). G-5
(multi-folder IMAP sync) is the only one left and is **intentionally deferred** as
scope, not a defect. Before shipping the PR, the **3.0 Cloudflare/DNS** items
(especially `praxisls.com` SPF/DKIM/DMARC for the fallback relay) and the **3.1
platform config** (set the fallback sender + click Test) are the hard prerequisites
for the fallback to be useful in production.
