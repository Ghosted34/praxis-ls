# Praxis LS — Provider-Agnostic Email Engine: Implementation Plan

**Status:** Plan of record for unifying email into a provider-agnostic engine. Phase 1 (IMAP/SMTP) is largely landed — see §8.
**Read alongside:** `DB_ARCHITECTURE.md` (tenancy, config→execution, encrypted secrets), `GAP_FIXES_PLAN.md`.
**Decisions taken (2026-08-01):** Phase 1 covers **IMAP/SMTP only**; OAuth providers (Microsoft 365, Google) are built **native** behind the interface in a later phase; connection state lives in a **new `email_connection` table**, leaving `email_identity` as the outbound sender identity it already is.

---

## 0. Why this plan differs from the generic roadmap

A generic "build an email engine" roadmap assumes a greenfield MySQL app with a `company_id` multi-tenancy column, a `src/services/email/` tree, and node-cron/RabbitMQ workers. **None of that matches Praxis.**

| Generic roadmap | Praxis reality | Consequence |
|---|---|---|
| MySQL | **PostgreSQL** (`pg`, no ORM) | SQL migrations under `migrations/tenant/`, snake_case, uuid PKs |
| `company_id` column | **Database-per-tenant** | Email tables carry **no** tenant column |
| `src/services/email/` | **`src/modules/<group>/<module>/`** | Email is a module; adapters under it |
| node-cron / RabbitMQ | **BullMQ + ioredis** (`src/jobs/`) | Sync worker is a BullMQ repeatable job |
| Build `encrypted_*` cols | **`encryption.service.js` + `integration_secret` setting section** | Secrets via the setting service |
| Greenfield outbound | **Outbound SMTP already works** (`src/services/email.service.js`) | Wrap it behind the interface |
| Greenfield inbound | `email_inbound` (0451) was a **stub** | Inbound intake was the real net-new work |
| Greenfield `mail` module | A **read-only `mail` module already existed** (senders + send log) | Extend it in place |

---

## 1. Current state (post-Phase-1)

**Outbound.** `src/services/email.service.js` (nodemailer) resolves a per-purpose sender identity from `email_identity`, reads the SMTP password from the `integration_secret` setting section, logs to `email_send_log`. Unchanged.

**Engine (new).** `src/modules/mail/` now also provides the provider-agnostic engine: connect a mailbox, test, sync inbound, send, reply. Secrets keyed `mail_conn:<id>` in the vault.

**Adjacent, do-not-confuse.** `smartcomm` (`0430`) is internal team chat. "Comms → Mail" is the UI that reads `email_inbound`.

**Infra:** `bullmq`, `ioredis`, `nodemailer` present; added `imapflow`, `mailparser`. Worker entry `src/jobs/workers.js`.

---

## 2. Target architecture

```
   Modules (finance, CRM, notifications, Mail UI)
                    │  mail.service.send() / .listThread() / .syncConnection()
                    ▼
          Email engine  (src/modules/mail)
    resolve email_connection → adapter → normalize
                    │  EmailProvider interface
     ┌──────────────┼───────────────────────────┐
   ImapSmtpProvider  MicrosoftGraphProvider(P2)  GmailProvider(P2)
```

**Interface** (`providers/provider.interface.js`): `capabilities()`, `verify()`, `sendEmail()`, `createReply()`, `fetchSince(cursor)`, `getMessage()`, `markAsRead()`, `subscribe()/renewSubscription()` (push providers). Each adapter advertises `{push, delta, serverThreads, appendSent}` — the interface is NOT shrunk to IMAP's floor.

**NormalizedEmail:** `{externalMessageId, threadKey, direction, from, to[], cc[], subject, bodyHtml, bodyText, attachments[], inReplyTo, references[], receivedAt, isRead, provider}`.

---

## 3. Data model (migrations 0480–0482)

- `0480_email_connection.sql` — per-mailbox connection: `provider`, transport (imap/smtp host/port/secure), `auth_user`, `secret_key` (→ vault), `sync_cursor jsonb` (a cursor, never a timestamp), push fields (P2), `status`, optional `email_identity_id`. Registers event types `email.received` / `email.sent`.
- `0481_email_inbound_enrich.sql` — enriches the 0451 stub: `email_connection_id`, `external_message_id`, `thread_key`, `direction`, `body_html/text`, `in_reply_to`, and the **dedup unique index** `ux_email_inbound_dedup (email_connection_id, external_message_id) WHERE external_message_id IS NOT NULL`.
- `0482_email_attachment.sql` — `email_attachment` (`email_inbound_id`, `vault_id`, `filename`, `content_type`, `size_bytes`); binaries go to `document_vault` via `document_vault.createDocument`, linked here. Mirrors `comms_attachment`.

---

## 4. Module layout

```
src/modules/mail/
  mail.routes.js        senders/log (original) + connections, test, sync, thread, attachments, send, reply
  mail.controller.js
  mail.service.js       engine: resolveAdapter → connect/test/sync/send/reply + attachment persistence
  mail.repo.js          email_identity/log (original) + email_connection + email_inbound + email_attachment SQL
  mail.validator.js     zod: connect / send / reply
  mail.events.js        email.received / email.sent keys
  mail.provider.test.js / mail.service.test.js / mail.graph.test.js   hermetic unit tests
  providers/provider.interface.js
  providers/imapSmtp.provider.js
  providers/microsoftGraph.provider.js   (Phase 2)
  providers/microsoftOAuth.js            (Phase 2 — IdP token flow)
src/jobs/handlers/mail-sync.js            per-tenant poll (withTenantConnection → syncConnection)
src/jobs/handlers/mail-sync-scheduler.js  BullMQ repeat fan-out over LIVE tenants
```

Gating: routes keep `feature:null` (module was always-mounted); a dedicated `mail` `feature_state` key can gate it once the platform projects one.

---

## 5. Inbound engine

BullMQ `mail-sync-scheduler` (repeat, `MAIL_SYNC_INTERVAL_MS`, default 60s) fans one `mail-sync` job per LIVE tenant. `mail-sync` opens the tenant connection, lists CONNECTED `imap_smtp` connections, and for each calls `mail.service.syncConnection`:

1. `fetchSince(sync_cursor)` — IMAP `{uidvalidity, last_uid}`. **If `uidvalidity` changed → re-scan from 0** (naive timestamp cursors silently drop mail).
2. Parse via `mailparser` → `NormalizedEmail`.
3. Dedup-insert into `email_inbound` (`ux_email_inbound_dedup`).
4. Persist attachments to `document_vault` + link (`email_attachment`).
5. Emit `email.received` (`event_log`) per new message.
6. Advance cursor; record per-connection errors without aborting siblings.

Phase 2 push providers use webhooks + renewal (Graph ≈3d, Gmail ≈7d) and delta cursors.

---

## 6. Outbound & threading

`sendEmail` composes once to a raw RFC822 buffer, sends via SMTP, then **IMAP-APPENDs a copy to Sent** (SMTP does not file Sent — guarded by `capabilities().appendSent`). `createReply` sets `In-Reply-To` + appends the original id to `References`. `thread_key` = provider thread id when `serverThreads`, else `References[0]`/`In-Reply-To`/`Message-Id`. Outbound copies are stored `direction='OUT'` for the thread view.

---

## 7. Security, gating, config

Secrets encrypted via `encryption.service.js` into the `integration_secret` setting section (`readSecret`/`put`), keyed `mail_conn:<id>`; only `secret_key` sits on the row. Attachments inherit `document_vault` audit + hashing. Bodies are HTML — sanitize at the render boundary (open). Feature/settings as in §4.

---

## 8. Phasing & status

**Phase 1 — IMAP/SMTP (largely landed)**
1. ✅ Migrations `0480`, `0481`, `0482`.
2. ✅ Extended `src/modules/mail/` + `providers/provider.interface.js`.
3. ✅ `imapSmtp.provider.js`: send (+APPEND-to-Sent), reply, fetchSince (UIDVALIDITY-safe), getMessage, markAsRead, verify.
4. ✅ `mail-sync.js` + `mail-sync-scheduler.js` registered in `workers.js`; `MAIL_SYNC_INTERVAL_MS` in env.
5. ✅ Routes: connect, test, sync-now, thread, attachments, send, reply.
6. ⛔ Mail UI wiring (Comms → Mail over socket.io) — frontend, not in this cycle.
7. ✅ Hermetic Jest tests (provider cursor/normalize/reply; service sync-loop).

Phase 1 follow-ups: ✅ IMAP **IDLE** — opt-in low-latency worker `src/jobs/mail-idle.js` (`npm run idle`), triggers the normal sync job; polling stays as the safety net. ✅ HTML **sanitization** on ingest (`sanitize-html`, `mail.service.cleanHtml`). ✅ IMAP **autodiscover** — `src/modules/mail/autodiscover.js` + `GET /mail/autodiscover?email=` (known domains → MX inference → convention + TLS probe), wired to an "Autodiscover" button in the connect form. ✅ **Live integration test** — `tests/integration/mail-imap.test.js` (env-gated; skips without `MAIL_TEST_*` creds) exercises the real imapflow/nodemailer paths.

**Phase 2 — native OAuth providers (Microsoft landed):**
- ✅ `providers/microsoftGraph.provider.js` (axios, no SDK): capabilities (push/delta/server-threads, no appendSent — Graph files Sent), verify, sendEmail (draft→send), createReply (in-thread), fetchSince (**delta**, cursor `{delta_link}`), getMessage, markAsRead, subscribe/renewSubscription.
- ✅ `providers/microsoftOAuth.js`: authorize URL, code exchange, refresh. Deploy-wide Azure app via `MS_GRAPH_*` env; per-mailbox token bundle encrypted in the tenant vault (`mail_conn:<id>`), refreshed+persisted by `mail.service.graphAccessToken`.
- ✅ Flow: `GET /mail/oauth/microsoft/start` (authed → consent URL, signed-JWT state), `GET /mail/oauth/microsoft/callback` (pre-auth, host-resolved tenant, upserts connection + stores tokens), `POST /mail/webhook/microsoft` (pre-auth: echoes `validationToken`, else syncs by `clientState`).
- ✅ Inbound works via **delta polling** through the existing `mail-sync` worker (`listSyncable` now returns all CONNECTED providers) — webhooks are an optional accelerator (receiver + subscribe/renew implemented; **auto-subscribe on connect and the renewal cron are the remaining wiring**, since they need a publicly reachable notificationUrl).
- ✅ **Google Gmail** — `providers/gmail.provider.js` (axios, no googleapis dep): capabilities (delta + server-threads; no push/appendSent), verify, sendEmail (raw MIME via nodemailer compose → base64url → `messages.send`), createReply (fetch original Message-ID + threadId, reply in-thread), fetchSince (**history delta**, cursor `{history_id}`, seeds from profile+INBOX on first run / 404 recovery), getMessage, markAsRead, base64url payload decode. `providers/googleOAuth.js` (authorize with `access_type=offline&prompt=consent`, exchange, refresh). Flow: `GET /mail/oauth/google/start` (authed), `GET /mail/oauth/google/callback` (pre-auth). Inbound via the same delta-polling worker.
- ✅ Hermetic tests: `mail.graph.test.js`, `mail.gmail.test.js`. OAuth start/complete generalized in `mail.service` (`OAUTH` map + `oauthAccessToken` refresh) so both providers share one flow.
- ✅ Webhook auto-subscribe on connect (Graph) + a BullMQ **renewal cron** (`mail-webhook-renew` scheduler, `MAIL_WEBHOOK_RENEW_INTERVAL_MS`, renews within 24h of expiry); `mail.service.setupPush` / `renewSubscriptions`.
- ✅ Gmail **Pub/Sub push**: `users.watch` on connect (gated on `GOOGLE_PUBSUB_TOPIC`) + `POST /mail/webhook/google` receiver decoding the Pub/Sub envelope → sync.
- ✅ **Attachment fetch** for both OAuth providers (Graph `fileAttachment` bytes; Gmail `attachmentId` hydration) → persisted to `document_vault` like IMAP.
- ◻ Remaining: reconciliation is covered by the always-on delta poll; a dedicated gap-audit job is still nice-to-have.

**Prerequisites.** Microsoft: Azure app (Mail.ReadWrite, Mail.Send, User.Read, offline_access) → `MS_GRAPH_CLIENT_ID/SECRET` + redirect `…/api/tenant/mail/oauth/microsoft/callback` (or `MS_GRAPH_REDIRECT_URI`). Google: Google Cloud OAuth client with the Gmail API enabled (`gmail.modify` + `openid email`) → `GOOGLE_CLIENT_ID/SECRET` + redirect `…/api/tenant/mail/oauth/google/callback` (or `GOOGLE_REDIRECT_URI`).

**Phase 3 — CRM intelligence (started):**
- ✅ Client linking: on ingest, `mail.service.linkToClient` matches the sender against `client_master.email` (0475) and tags the message `entity_ref = client:<id>` (best-effort, never breaks sync).
- ✅ Client mail timeline: `repo.timelineByEntity` + `service.clientTimeline` + `GET /mail/client/:id/timeline`.
- ✅ `mail.ai.js` copilot catalogue: reads (`list_mail_connections`, `list_mail_thread`, `client_mail_timeline`) + writes (`send_mail`, `reply_mail`, both `confirm:true`, MOD-64 create). Drafting/summarizing = the copilot composing over these; surfaced only when AI is enabled (EMV). Run `scripts/ai/sync-actions.js` to publish into `ai_action_catalogue`.
- ✅ Test: linking assertion in `mail.service.test.js`.
- ✅ Manual linking endpoint `POST /mail/thread/:id/link {entity_ref}` — attach any message to a `dossier:<id>` / `client:<id>` (auto client-linking already runs on ingest).
- ✅ **Mail UI** — `client/src/features/comms/mail.tsx` rebuilt with three modes: **Threads** (per-mailbox, open/read/reply, attachments, server-sanitized bodies), **Mailboxes** (connect IMAP form + Microsoft/Google OAuth buttons, test + sync-now, status), and the legacy **Send log**. API in `client/src/lib/mail-api.ts`.
- ✅ **Automatic dossier linking** — on ingest, a `dossier.ref` (e.g. `SLAS-2026-0001`) found in the subject links the message to `dossier:<id>` (wins over client-by-email); manual `POST /mail/thread/:id/link` remains for overrides.
- ✅ **Live inbox push** — worker publishes to a Redis mail bus (`src/realtime/mail-bus.js`); the web socket layer re-emits `mail:new` to the per-tenant mail room (`t:<slug>:mail`), and the Threads view live-reloads. Works across the web/worker process split (no socket in the worker).

---

## 9. Runbook / prerequisites

`npm install` (adds `imapflow`, `mailparser`) → run tenant migrations (`0480`–`0482`) → `POST /mail/connections` with a real mailbox → the scheduler polls it. Set `MAIL_SYNC_INTERVAL_MS=0` to disable polling.

---

## 10. Risks (tracked)

UIDVALIDITY resets → re-scan (§5, tested). Dedup before intake (0481). Sent-folder APPEND (§6). Webhook expiry (P2). HTML sanitization (open). `email_identity` (sender/deliverability) vs `email_connection` (mailbox+sync) kept distinct.
