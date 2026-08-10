# Praxis LS — Integration Plan

**Status:** Proposal for review. Items tagged **BUILT** are in the codebase today (verified this pass); everything else is **PLANNED**.
**Owner:** JBS Praxis engineering.
**Audience:** Platform / admin review.
**Scope:** Every integration surface — the per-tenant **email** integration (Cloudflare-backed provisioning of addresses on the tenant's own domain), the **direct mailbox connectors** (Microsoft 365 / Google / IMAP-SMTP), and the **integrations management layer** (health, connect/verify/rotate/revoke) that governs all third-party credentials. Companion to `doc/INFRASTRUCTURE_PLAN.md` (which owns backup, pooling, entitlement); this document owns integrations.

**Decisions — all resolved as recommended (`doc/INFRASTRUCTURE_DECISIONS.md`):**

| # | Decision | Resolution |
|---|---|---|
| D1 | Email domain onboarding | **Support both; default to full Cloudflare delegation; MX-only as fallback** |
| D2 | Outbound transport | **Cloudflare authenticated SMTP first; REST `send_email` later** |

Those are treated as settled below — no longer open forks.

---

## 0. How to read this

| Tag | Meaning |
|---|---|
| **BUILT** | In the codebase today, verified this pass; file evidence in §9. |
| **PLANNED** | Not built. This document is the proposal. |

Each unit of work is a **WS-xx** with a rough **effort** (S ≈ ≤2 days, M ≈ 3–5 days, L ≈ 1–2 weeks, XL ≈ >2 weeks, one developer, excluding review) and a **verification** line — the objective test that closes it. DDL is illustrative (shapes to anchor review, not final migrations); real migrations follow the repo rules — additive, forward-only, never renumbered, one new file per change.

---

## 1. Principles (what every integration obeys)

1. **Secrets are configured from the Platform Console UI and stored encrypted — `.env` is fallback only, never the primary store.** Two vaults, both AES-256-GCM with the deployment's `ENCRYPTION_KEY`, both written from the UI, never from a hand-edited row or a committed file:
   - **Deploy-wide secrets** (Microsoft/Google OAuth apps, the Cloudflare account token, the mail fallback SMTP, S3/Geoapify/VAPID, AI vendor keys) live in the **platform settings vault** (`platform_setting`, section/key, `secret`), managed under **Platform Console → Integrations**. This is the established pattern — AI vendor keys moved there in session 16, and mail fallback resolves *platform setting → env*.
   - **Per-tenant secrets** (per-mailbox OAuth token bundles, a tenant's Cloudflare zone token) live in that tenant's **`integration_secret`** vault (`mail_conn:<id>`, `cf_zone:<tenantId>`), read via `settingService.readSecret/put`.
   - **`.env` is the last-resort fallback only** (used when a platform setting is absent — e.g. a fresh deploy before the console is configured), and secrets there are never committed. Resolution order everywhere: **platform/tenant vault → env**. **BUILT (pattern).**
2. **Provider-agnostic.** Business code never branches on a provider. Adapters implement `providers/provider.interface.js`; the service resolves the adapter per connection and normalizes I/O. Cloudflare becomes one more adapter, not a special case. **BUILT (interface).**
3. **Tenant isolation is the DB boundary.** Per-tenant integration data and secrets live in that tenant's own database; platform-level integration config (Cloudflare account, deploy-wide OAuth apps) lives in the platform DB. Nothing crosses the boundary.
4. **Every integration is verifiable and rotatable.** A credential you cannot test and cannot rotate is a liability. Every integration exposes a live `verify()` probe and a rotation path (§5).
5. **Degrade, never fail silently.** A missing/expired integration surfaces as a clear state in the console and a typed error to the caller — never a generic 500 or an invisible no-op.

---

## 2. Current state

**BUILT:**
- **Provider-agnostic mail engine** (`src/modules/mail/*`): IMAP/SMTP, Microsoft Graph, Gmail behind `provider.interface.js`; per-mailbox secrets vaulted (`mail_conn:<id>`); dedup, attachment→vault, auto-link-to-dossier, HTML sanitize on ingest.
- **Per-purpose system sender** (`src/services/email.service.js`) with tenant-identity → tenant-settings → platform-fallback → env resolution, deliverability-aware.
- **Single canonical OAuth callback (shipped this session).** The mail OAuth callback now resolves its tenant from the **signed `state`**, not the Host, so one registered redirect URI serves the whole fleet (`registry.resolveBySlug`, `host-tenent-resolver.js`), and it redirects the browser back to `/comms/mail` on the tenant subdomain with a success/error flag (`mail.controller.js`, `comms/mail.tsx`). Graph webhook URL now targets the tenant's canonical subdomain.
- **Credential probes** (`settings.probes.js`): live `verify()` for S3, Geoapify, SMTP, VAPID — driven from the Platform Console, over the resolved (platform-setting-first) config.
- **Platform-console-managed deploy-wide secrets:** the AI vendor keys already live in the platform settings vault, set + tested under **Integrations → AI providers** (`.env` fallback only). The OAuth apps and Cloudflare token below join the same surface.

**In motion (operator):** Microsoft 365 (Azure app registration) and Google (Google Auth Platform, currently in Testing) deploy-wide OAuth app credentials are being provisioned. These are entered in **Platform Console → Integrations** (stored encrypted in the platform settings vault); `.env` keys catalogued in §4.3 are the fallback only.

**Not built (this plan):** Cloudflare-backed address provisioning (§3), the integrations management layer (§5), and the connector-finish work (§4).

---

## 3. Email integration — Cloudflare

**Goal.** On tenant creation, auto-provision up to **5 working addresses** on the tenant's own domain — the way the subdomain is provisioned — renamable, bindable to any ERP section, and overridable by importing the tenant's own mailbox. Target end-state: **full inbox + outbound**.

### 3.0 Architecture

Cloudflare does not store mail. **Email Routing** (free) creates addresses on a Cloudflare-managed zone and routes each inbound message to an **Email Worker** that POSTs it to Praxis. **Email Service** (public beta, April 2026; authenticated SMTP / REST / Workers binding; $0.35/1k out) sends outbound. So **Praxis is the mailbox store** — `email_inbound` + `email_attachment` + vault already are the destination — and Cloudflare is the transport both directions.

```
 OUTBOUND  module → email.service.send(section) → cloudflare_routing adapter
                                                → CF Email Service (authenticated SMTP) → recipient
 INBOUND   sender → tenant MX (Cloudflare) → Email Routing → Email Worker
                  → POST /api/tenant/mail/ingest/cloudflare (HMAC) → email_inbound (+ vault, auto-link)
 CONTROL   provisionTenant() → CF API: create ≤5 addresses + MX/SPF/DKIM/DMARC
                             → email_connection + email_identity + section bindings + email_domain
```

**Decisions applied:** onboarding supports **both** delegation and MX-only, defaulting to delegation (WS-E5); outbound uses **authenticated SMTP** first (WS-E1).

### WS-E1 — Cloudflare API client + vaulted token · **PLANNED · M**

A typed, axios-only client (matching the Graph/Gmail adapter style — no SDK) for the Cloudflare v4 API: zones (verify), Email Routing (enable, create/list/delete addresses, catch-all → Worker), DNS (MX/TXT for SPF/DKIM/DMARC), Email Service (sending domain + DKIM, authenticated-SMTP credentials).

- **File:** `src/services/integrations/cloudflare.service.js` — `verifyZone`, `enableRouting`, `createAddress`, `deleteAddress`, `setCatchAllWorker`, `putDnsRecord`, `enableSendingDomain`, `getSmtpCredential`, `getDeliverabilityDns`. Timeout + never-throw-into-caller contract with typed errors; ret/backoff on 429/5xx (respect CF's account rate limit).
- **Auth:** a **scoped API token**, entered in **Platform Console → Integrations → Cloudflare** and stored encrypted — the deploy-wide **account token** in the platform settings vault (`cloudflare.account`), or a per-tenant **zone token** in that tenant's `integration_secret` (`cf_zone:<tenantId>`) when a tenant supplies their own. Never on a row; never primarily in `.env`.
- **Non-secret config** (safe as env, no vault needed): `CLOUDFLARE_API_BASE` (default `https://api.cloudflare.com/client/v4`), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ROUTING_WORKER_NAME`, `CLOUDFLARE_SMTP_HOST`. **Secrets** (`CLOUDFLARE_INGEST_HMAC_SECRET`, the account/zone token) resolve platform-vault → env, env being fallback only.
- **Verification:** unit tests with mocked CF responses per method; one live smoke test against a sandbox zone that creates then deletes an address.

### WS-E2 — Auto-provision ≤5 addresses on tenant creation · **PLANNED · L**

Extend `provisionTenant()` (`provisioning.service.js`) with an email step, gated on the tenant's domain being onboarded (WS-E5):

1. `verifyZone`; if not onboarded, mark email `PENDING_DOMAIN` and stop (non-fatal — the tenant still provisions).
2. `enableRouting`; `putDnsRecord` for MX, SPF, DKIM (from `enableSendingDomain`), DMARC (`p=quarantine` default).
3. `createAddress` × ≤5, each routed to the ingest Worker; default local-parts seeded from a template (`contact`, `billing`, `docs`, `hr`, `noreply`).
4. Insert ≤5 `email_connection` (provider `cloudflare_routing`) each linked to an `email_identity`; write default `email_section_binding` rows (WS-E3); record `email_domain` (WS-E5).

- **Idempotency:** the Cloudflare side is outside the DB transaction (external API, not rollback-able) and made idempotent — `createAddress` is upsert-by-local-part, re-runs reconcile rather than duplicate. A `reconcileTenantEmail(slug)` escape hatch (console button + scheduled sweep) lists CF addresses and ensures matching rows.
- **Console:** provisioning screen shows email state (provisioned / pending-domain / error) with a **Reprovision email** action.
- **Verification:** a freshly provisioned tenant with an onboarded domain shows 5 `CONNECTED` connections, valid MX/SPF/DKIM/DMARC, and a test send from each identity passes SPF/DKIM.

### WS-E3 — Section binding (rename + assign to any ERP section) · **PLANNED · M**

Replace the fixed `email_identity.purpose` enum (`BILLING/DOCUMENTS/NOTIFICATIONS/SUPPORT`, migration `0410`) with a tenant-configurable mapping.

```sql
CREATE TABLE email_section_binding (
  email_section_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_identity_id   uuid NOT NULL REFERENCES email_identity(email_identity_id),
  section_key         text NOT NULL,           -- module_key or a coarse section slug
  is_default_outbound boolean NOT NULL DEFAULT false,  -- this address sends this section's mail
  inbound_route       text,                    -- where inbound to this address lands
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_identity_id, section_key)
);
ALTER TABLE email_identity DROP CONSTRAINT IF EXISTS email_identity_purpose_check;
ALTER TABLE email_identity ADD COLUMN IF NOT EXISTS label text;   -- the tenant's rename
```

- **Resolution change:** `email.service.resolveMail({ section })` resolves the identity via the `is_default_outbound` binding for that section, falling back to the tenant default identity, then platform fallback. The four legacy purposes seed as four default bindings (backward compatible).
- **Two levels of rename, distinct in the UI:** relabel + reassign section = a DB write (instant); rename the local-part (`billing@`→`accounts@`) = a Cloudflare `deleteAddress`+`createAddress` + connection update (a heavier, confirmed action).
- **Enforcement (contract):** a module with no binding falls to the tenant default, then platform fallback — never a silent drop. Aligns with the settings-are-contracts rule.
- **Verification:** rebinding an address's section in Comms → Mail changes which identity a subsequent module send uses; an unbound module still sends via default.

### WS-E4 — Inbound: Email Worker + ingest webhook + `cloudflare_routing` provider · **PLANNED · L**

- **Cloudflare Email Worker** (one per account): the `email()` handler POSTs a JSON envelope to `POST /api/tenant/mail/ingest/cloudflare` on the tenant host, HMAC-signed (`CLOUDFLARE_INGEST_HMAC_SECRET`) with the recipient address (selects tenant + connection); large attachments to R2 by reference, small ones inline base64 under a cap.
- **Ingest endpoint** (declared **before** `authMiddleware`, like the existing OAuth callback/webhook routes): verify HMAC + timestamp (replay window) → resolve tenant from recipient domain → resolve `email_connection` by address → run the **existing** ingest path (`cleanHtml`, dedup index `ux_email_inbound_dedup`, `persistAttachments`→vault, `autoLink`→dossier/client, `emitEvent('email.received')`, `publishMailEvent`→realtime). Unknown recipients 202-and-drop (no enumeration).
- **New adapter** `providers/cloudflareRouting.provider.js`: `verify()` (zone + routing), `sendEmail()`/`createReply()` (via CF Email Service, WS-E1), inbound as **push** (`fetchSince` is a no-op — the webhook is the ingress). Business code stays provider-agnostic.
- **Verification:** an email to a provisioned address appears in that tenant's Mail view within seconds, deduped on redelivery, attachments vaulted, auto-linked on a dossier ref — identical assertions to the IMAP path.

### WS-E5 — Domain onboarding (both paths) · **PLANNED · M**

The tenant's domain must reach Cloudflare before addresses provision. **Both** paths, recorded in `email_domain`, defaulting to delegation.

```sql
CREATE TABLE email_domain (
  email_domain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      citext NOT NULL UNIQUE,
  cf_zone_id  text,
  onboarding  text NOT NULL CHECK (onboarding IN ('DELEGATION','MX_ONLY')),
  ns_status   text,    -- DELEGATION: pending/active
  mx_status   text,    -- MX_ONLY: pending/verified
  spf_ok boolean DEFAULT false, dkim_ok boolean DEFAULT false, dmarc_ok boolean DEFAULT false,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

- **Delegation (default):** tenant repoints nameservers to Cloudflare (or Praxis holds the zone); Praxis sets all records via API — fully automatic. Console shows the two NS targets and polls `ns_status`.
- **MX-only (fallback):** tenant keeps DNS elsewhere, adds CF's MX + a verification TXT; provisioning becomes generate → tenant applies → verify.
- **Verification worker:** a scheduled job re-checks pending domains (NS/MX/SPF/DKIM/DMARC), flips `email_domain` + `email_identity.*_verified`, then triggers WS-E2 if it was deferred.
- **Verification:** a tenant on each path reaches `verified_at` and provisions its addresses with no manual DB touch.

### WS-E6 — Deliverability & send-log dashboard · **PLANNED · M**

`email_send_log` already records `status IN (QUEUED,SENT,DELIVERED,BOUNCED,COMPLAINED,FAILED)` + `provider_message_id` (migration `0410`). A Cloudflare delivery-event webhook updates the log row; the console surfaces per-tenant SPF/DKIM/DMARC status, send volume, bounce/complaint rate, latest failures, plus a suppression list for hard bounces/complaints.
- **Verification:** a forced bounce moves the log row to `BOUNCED` and suppresses the address; the dashboard reflects it.

### WS-E7 — Override / import · **BUILT + S**

The `email_connection` connect path (`mail.service.connect()` + Microsoft/Google OAuth, now with the canonical callback) already attaches a tenant's own mailbox. Remaining work: keep the section bindings pointed at the same slot when a provisioned CF address is swapped for an imported mailbox, plus the Comms UI affordance for the swap.
- **Verification:** swapping a provisioned address for an imported M365 box preserves which ERP sections route to/from it.

### 3.9 Email phasing

| Phase | Workstreams | Outcome |
|---|---|---|
| **E-α** | WS-E1, WS-E5, WS-E3 | Domain onboarding + section model; no flows yet |
| **E-β** | WS-E2, WS-E7 (outbound) | 5 addresses provisioned; system + module mail sends via CF |
| **E-γ** | WS-E4 | Full inbound; Comms Mail shows the real inbox |
| **E-δ** | WS-E6 | Deliverability dashboard + suppression |

---

## 4. Direct mailbox connectors (Microsoft 365 / Google / IMAP-SMTP)

These let a tenant connect a mailbox they already own — the "import your own mail" path. Mostly **BUILT**; the remaining work is finishing production readiness.

### 4.1 What's built

- **Provider adapters** for `imap_smtp`, `microsoft_graph`, `google_gmail` behind `provider.interface.js`; secrets vaulted; OAuth token bundles refreshed + persisted with a 60-second expiry margin (`mail.service.oauthAccessToken`).
- **OAuth flows** — signed-`state` authorize/callback for Microsoft and Google, CSRF + tenant pinning in the state; **single canonical callback** resolving tenant from state (shipped this session).
- **Autodiscover** for IMAP/SMTP host settings; **push** via Graph change-subscriptions and Gmail Pub/Sub (best-effort; polling is the safety net).

### WS-M1 — Finish the OAuth connectors for production · **PLANNED · S**

- Register the **single canonical redirect URI** in Azure and Google and set `MS_GRAPH_REDIRECT_URI` / `GOOGLE_REDIRECT_URI` to it: `https://<canonical-host>/api/tenant/mail/oauth/{microsoft,google}/callback`.
- Comms → Mail affordance already calls `startMicrosoft()/startGoogle()`; confirm the redirect-result banner (BUILT) renders the `mail_connected` / `mail_error` flags.
- **Verification:** a Microsoft connect from a tenant subdomain completes on the canonical host and lands back on `/comms/mail` with the mailbox listed.

### WS-M2 — Google verification (restricted scope) · **PLANNED · M (mostly external)**

`gmail.modify` is a **restricted scope**: fine in Testing (test users, ~7-day refresh-token expiry), but production needs Google OAuth **verification** + a security assessment. Prerequisites: the app live at the canonical domain, a homepage, and hosted **privacy** + **terms** pages on an authorized domain (`praxisls.com`). Microsoft has no equivalent gate.
- **Verification:** the Google app moves from Testing to In-production with the restricted scope approved; refresh tokens stop expiring at 7 days.

### 4.2 Token lifecycle · **BUILT (refresh) → PLANNED (rotation surface)**

Refresh-on-expiry is built (`oauthAccessToken`). What's missing is operator visibility: a connection nearing token expiry, or one whose refresh has started failing, should surface in the integrations health view (§5) rather than silently degrading to polling failures. Folds into WS-I1.

### 4.3 Configuration (deploy-wide OAuth apps)

**Primary store: Platform Console → Integrations** (encrypted in the platform settings vault, `ENCRYPTION_KEY`). The env keys below are the **fallback only** — read when the platform setting is absent (e.g. a fresh deploy) and never committed. A small workstream (folds into WS-I2) adds the Microsoft/Google OAuth-app + Cloudflare panels alongside the existing **AI providers** panel, so an operator sets `client_id`/`client_secret`/`redirect_uri` in the UI and hits **Test**, exactly like the AI keys.

| Provider | Secrets (Platform UI; env = fallback) | Non-secret settings (defaulted) |
|---|---|---|
| Microsoft 365 | `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_REDIRECT_URI` | `MS_GRAPH_TENANT` (`common`), `MS_GRAPH_SCOPES` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `GOOGLE_SCOPES`, `GOOGLE_PUBSUB_TOPIC` (empty = polling) |

The `*_CLIENT_SECRET` values are the sensitive ones — they belong in the platform vault via the console, not in a committed file. These are **app-level** (deploy-wide, one set per deployment); per-mailbox OAuth token bundles are **per-tenant** in the tenant vault (`mail_conn:<id>`).

---

## 5. Integrations management layer

The vault + probe pattern exists per-integration but is not yet unified or observable. This layer makes every integration — Cloudflare, Microsoft, Google, IMAP, S3, Geoapify, VAPID, AI vendors — configure, verify, rotate, and revoke the same way, with one health view.

### WS-I1 — Per-tenant integrations health view · **PLANNED · M**

One console view per tenant: every integration, its state and last check, driven by the existing `probes.js` pattern extended to cover Cloudflare and the mail connectors. A scheduled re-verify keeps `last_checked` honest so an expired token is caught before a feature fails.

```sql
-- tenant DB (integration state is per-tenant; secrets stay in the vault)
CREATE TABLE integration_status (
  integration_key text PRIMARY KEY,      -- 'cloudflare' | 'mail:<conn-id>' | 's3' | 'geoapify' | ...
  category   text NOT NULL,              -- 'email' | 'storage' | 'geo' | 'push' | 'ai'
  state      text NOT NULL CHECK (state IN ('CONFIGURED','VERIFIED','ERROR','EXPIRING','UNCONFIGURED')),
  last_checked_at timestamptz,
  last_error text,
  expires_at timestamptz,                -- for token-bearing integrations
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- **Verification:** revoking a stored credential shows that integration as `ERROR` on the next scheduled re-verify; a token within its renewal window shows `EXPIRING`.

### WS-I2 — Unified connect / verify / rotate / revoke lifecycle · **PLANNED · M**

Each provider today has its own bespoke connect path. Standardize one lifecycle over the vault:

- **connect** → store secret (vault), set `CONFIGURED`.
- **verify** → run the provider probe, set `VERIFIED` / `ERROR`.
- **rotate** → write a **new secret version**, re-verify, then retire the old — so a key rotation is one flow with zero downtime, not per-integration surgery.
- **revoke** → delete the secret, set `UNCONFIGURED`, and (where the provider supports it) revoke server-side.

- **Shape:** `src/services/integrations/lifecycle.js` exposing `connect/verify/rotate/revoke(scope, integrationKey, payload)`, delegating to a per-provider probe + (optional) server-side revoke. The mail OAuth refresh path plugs in as the mail connector's `rotate`.
- **Two tiers, one lifecycle.** Deploy-wide integrations (OAuth apps, Cloudflare account token, AI vendors) are managed at the **platform tier** — Platform Console → Integrations, platform settings vault. Per-tenant integrations (a tenant's own mailbox, their Cloudflare zone token) are managed at the **tenant tier** — the tenant's Settings, `integration_secret` vault, surfaced in the health view (WS-I1). Both go through the same connect/verify/rotate/revoke calls; only the vault differs. `.env` never participates except as the final read-through fallback.
- **Verification:** rotating the S3 key mid-session keeps serving media with no downtime; the old key stops working only after the new one verifies.

### WS-I3 — Cloudflare as a first-class integration · **PLANNED · S**

Cloudflare (email + DNS) registers under the same vault + probe + health pattern as the rest, so §3's token handling isn't a special case. Its probe is `verifyZone`; its rotation swaps the scoped API token. Folds into WS-I1/WS-I2.
- **Verification:** the Cloudflare integration appears in the health view with `VERIFIED` after a successful `verifyZone`.

### WS-I4 — Connector discovery (optional) · **PLANNED · S**

Where a tenant needs a surface Praxis doesn't natively integrate, expose the connector registry so a suitable MCP/connector is suggested rather than custom-built. Demand-driven, low priority.

---

## 6. Cross-cutting concerns

- **Security.** Every new secret (Cloudflare token, ingest HMAC, SMTP credential) lives in the vault, never on a row. Ingest and delivery webhooks are HMAC-signed with a replay window. The single canonical OAuth callback verifies the signed `state` before resolving a tenant, so a forged callback cannot bind a mailbox to the wrong tenant (BUILT). Rotation (WS-I2) is itself a security control — a rotatable credential is one you can respond to a leak with.
- **Observability.** Every new job (ingest, domain-verification worker, re-verify sweep, deliverability webhook) emits to the existing metrics + structured-log + error-reporter stack (`workers.js` wraps handlers with duration + request-id + terminal-failure reporting). Integration state changes (`VERIFIED`→`ERROR`) feed the health view (WS-I1) and can raise an alert.
- **Cost.** Cloudflare email is ~free inbound + $0.35/1k outbound; Microsoft/Google OAuth apps are free; the material new spend is negligible. Google's restricted-scope verification is a time cost, not a money cost.
- **Tenancy invariants.** Per-tenant integration data and secrets stay in the tenant DB; deploy-wide app config (OAuth apps, Cloudflare account token) in the platform DB / env. The ingest webhook resolves the tenant from the recipient domain and the OAuth callback from the signed state — neither trusts an unauthenticated host.

---

## 7. Phased roadmap

Dependency- and value-ordered; each phase ends with its workstreams' verification.

| Phase | Workstreams | Rationale |
|---|---|---|
| **I-1** | WS-M1 (finish OAuth connectors), WS-E1 (CF client), WS-E5 (domain onboarding), WS-E3 (section model) | Ship the connectors that are nearly done; stand up email's non-flow foundation. Independent. |
| **I-2** | WS-E2 + WS-E7 outbound (provision 5 + send), WS-I1 (health view) | First provisioned addresses sending via Cloudflare; make integrations observable. |
| **I-3** | WS-E4 (inbound), WS-I2 (connect/verify/rotate/revoke), WS-I3 (Cloudflare first-class) | Full mailbox; unified credential lifecycle across all providers. |
| **I-4** | WS-E6 (deliverability), WS-M2 (Google verification), WS-I4 (connector discovery) | Deliverability hardening; open Gmail to production; demand-driven connectors. |

Google verification (WS-M2) runs **in parallel** from I-1 onward, since it is mostly external wait time.

---

## 8. Effort summary

| Bucket | Workstreams | Rough total |
|---|---|---|
| Cloudflare email | E1 M, E2 L, E3 M, E4 L, E5 M, E6 M, E7 S | ~6–8 weeks |
| Direct connectors | M1 S, M2 M (mostly external), token surface (I1) | ~1 week + verification wait |
| Integrations layer | I1 M, I2 M, I3 S, I4 S | ~3 weeks |

Single-developer engineering estimates excluding review; parallelizable across §7.

---

## 9. Evidence index

Verified against these files this pass:

`src/modules/mail/mail.service.js` · `src/modules/mail/mail.controller.js` · `src/modules/mail/mail.routes.js` · `src/modules/mail/providers/*` · `src/services/email.service.js` · `src/services/platform/mail-fallback.service.js` · `src/services/platform/settings.probes.js` · `src/services/tenant/registry.service.js` (`resolveBySlug`) · `src/middleware/host-tenent-resolver.js` (state-based tenant resolution) · `src/services/platform/provisioning.service.js` · `client/src/features/comms/mail.tsx` · `migrations/tenant/0410_notifications_ux.sql` · `migrations/tenant/0483_email_connection.sql`

Cloudflare capability claims (§3) verified against Cloudflare Email Service + Email Routing documentation, August 2026.

---

*No production code is changed by this document. The single canonical OAuth callback (§2, §4.1) was implemented in the session that produced this plan; everything tagged PLANNED awaits build sign-off.*
