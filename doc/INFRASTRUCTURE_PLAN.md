# Praxis LS — Infrastructure Plan

**Status:** Proposal for review. Nothing here is built unless tagged **BUILT**; everything else is a plan awaiting sign-off.
**Owner:** JBS Praxis engineering.
**Audience:** Platform / admin review.
**Scope:** The infrastructure surface that is *not* business logic — email provisioning, platform-integrated operations (health, backup/restore, error/uptime/maintenance), integrations, and the optimization/scalability work that decides whether the product onboards at volume. Both tiers: **per-tenant** and **system-wide**.
**Read alongside:** `doc/DB_ARCHITECTURE.md` (tenancy of record), `doc/EMAIL_TWO_CONFIGS.md` + `doc/EMAIL_ENGINE_PLAN.md` (mail engine), `doc/PERF_ARCHITECTURE_AUDIT_2026-08-04.md` (superseded on several points — see §1).

This revision expands every planned item to implementation depth: schema/DDL sketches, endpoints, worker jobs, config, provisioning integration, failure modes, and per-workstream verification. Each unit of work is a **WS-xx** so it can be estimated and assigned independently.

---

## 0. How to read this

| Tag | Meaning |
|---|---|
| **BUILT** | In the codebase today, verified against source in this pass; file evidence cited (§10). |
| **PARTIAL** | Exists but incomplete, or a seam not yet switched on. |
| **PLANNED** | Not built. This document is the proposal. |
| **DECISION** | A fork needing an owner's call before work proceeds; consolidated in §8. |

Each workstream carries a rough **effort** (S ≈ ≤2 days, M ≈ 3–5 days, L ≈ 1–2 weeks, XL ≈ >2 weeks) and a **verification** line — the objective test that closes it. Effort is engineering time for one developer, excluding review.

Tenancy context (unchanged, `DB_ARCHITECTURE.md`): one physical Postgres DB per tenant, a shared `platform` DB, `live`+`sandbox` schemas inside each tenant DB. Isolation is the database boundary. All configuration is driven from the Praxis console; no tenant DB is hand-edited.

DDL in this document is **illustrative** — column names and shapes to anchor review, not final migrations. Real migrations follow the repo rules: additive, forward-only, never renumbered, one new file per change (`migrator.js` keys on filename).

---

## 1. Current state — ground truth (condensed)

A code-level audit this pass found the **2026-08-04 performance audit substantially remediated**. Review the plan against this, not the older audit.

**BUILT (scaling):** per-request single connection + `search_path` as a startup param (`tenant-context.js`); pool cap + LRU + idle-close + PgBouncer *seam* (`registry.service.js`); `SCAN`-based tenant-namespaced cache + versioned scope closure (`identity-cache.js`); per-worker Redis (`workers.js`); Socket.IO Redis adapter (`realtime/index.js`); compression + global per-tenant rate limit (`server.js`, `rate-limit.js`).

**BUILT (fleet):** continue-on-failure `migrateAllTenants()` + `fleetSchemaStatus()` drift report; atomic migration+ledger; transactional provisioning & sandbox-wipe (`provisioning.service.js`, `migrator.js`); the `scripts/db/*` check suite.

**BUILT (email foundation):** provider-agnostic engine (IMAP/Graph/Gmail) with vaulted secrets, dedup, attachment→vault, auto-link (`src/modules/mail/*`); per-purpose system sender with fallback resolution (`email.service.js`, `mail-fallback.service.js`).

**The open gaps this plan closes:** (1) no mailbox provisioning backend — §2; (2) per-tenant DB credentials unresolved — §6.2; (3) PgBouncer a seam, not deployed — §6.1; (4) no entitlement/quota/metering — §6.3; (5) ops is point-in-time, not continuous — §3–§4.

---

## 2. Email provisioning (Cloudflare)

**Goal.** On tenant creation, auto-provision up to **5 working addresses** on the tenant's own domain — the way the subdomain is provisioned — renamable, bindable to any ERP section, and overridable by importing the tenant's own mail from Comms → Mail. Target end-state: **full inbox + outbound**.

**Decisions taken (owner):** backend = **Cloudflare**; addresses = **tenant's own domain**; scope = **inbox + outbound**.

### 2.0 Architecture in one paragraph

Cloudflare does not store mail. **Email Routing** (free) creates addresses on a Cloudflare-managed zone and routes each inbound message to an **Email Worker** that POSTs it to Praxis. **Email Service** (public beta, April 2026; $0.35/1k, Workers `send_email` / REST / authenticated SMTP) sends outbound. So **Praxis is the mailbox store** — `email_inbound` + `email_attachment` + vault already are the destination — and Cloudflare is the transport in both directions. This reuses the existing inbound engine wholesale; the new surface is a Cloudflare API client, one provider adapter, an ingest webhook, and the provisioning wiring.

```
 OUTBOUND  module → email.service.send(purpose) → cloudflare_routing adapter
                                                → CF Email Service (SMTP/REST) → recipient
 INBOUND   sender → tenant MX (Cloudflare) → Email Routing → Email Worker
                  → POST /api/tenant/mail/ingest/cloudflare (HMAC) → email_inbound (+ vault, auto-link)
 CONTROL   provisionTenant() → CF API: create 5 addresses + MX/SPF/DKIM/DMARC
                             → insert 5 email_connection + email_identity + section bindings
```

### WS-E1 — Cloudflare API client + secret handling · **PLANNED · M**

A thin, typed client for the Cloudflare v4 API, used by provisioning and the console. Scope: zones (read/verify), Email Routing (enable, create/list/delete addresses, set catch-all → Worker), DNS records (create MX/TXT for SPF/DKIM/DMARC), Email Service (sending domain, DKIM).

- **Auth:** a **scoped API token per tenant zone** (or one Praxis-account token when Praxis holds zones — see D1). Stored in the `integration_secret` vault (`settingService.readSecret/put`, AES-256-GCM), keyed `cf_zone:<tenantId>`. Never on a row — same rule as mail/S3/AI keys.
- **Shape:** `src/services/integrations/cloudflare.service.js` exposing `verifyZone`, `enableRouting`, `createAddress`, `deleteAddress`, `setCatchAllWorker`, `putDnsRecord`, `enableSendingDomain`, `getDeliverabilityDns`. Native `axios`, no SDK (matches the Graph/Gmail adapters' style), timeout + never-throw-into-caller contract with structured errors.
- **Rate/errors:** respect CF 1200-req/5-min account limit; retries with backoff on 429/5xx; a failed call returns a typed result, never a half-provisioned tenant (provisioning wraps it — WS-E2).
- **Config/env:** `CLOUDFLARE_API_BASE` (default `https://api.cloudflare.com/client/v4`), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ROUTING_WORKER_NAME`, `CLOUDFLARE_INGEST_HMAC_SECRET`.
- **Verification:** unit tests with mocked CF responses for each method; one live smoke test against a sandbox zone creating + deleting an address.

### WS-E2 — Auto-provision 5 addresses on tenant creation · **PLANNED · L**

Extend `provisionTenant()` (`provisioning.service.js`) with an email step, gated behind the tenant's domain being onboarded (WS-E5). Behaviour:

1. `verifyZone` — confirm the domain resolves to a CF zone Praxis can act on; if not, mark email `PENDING_DOMAIN` and stop (non-fatal — the tenant still provisions).
2. `enableRouting`; `putDnsRecord` for MX (→ CF), SPF (`v=spf1 include:...`), DKIM (from `enableSendingDomain`), DMARC (`p=quarantine` default, configurable).
3. `createAddress` × up to 5, each routed to the ingest Worker; default local-parts seeded from a template (e.g. `contact`, `billing`, `docs`, `hr`, `noreply`).
4. Insert 5 `email_connection` rows (provider `cloudflare_routing`), each linked to an `email_identity`; vault any per-address secret; write default `email_section_binding` rows (WS-E3).
5. Record an `email_domain` row (WS-E5) with the onboarding path and verification state.

- **Transactionality:** platform + tenant DB writes wrap in a transaction the same way the DB provisioning does; the **Cloudflare side is outside the transaction** (external API, not rollback-able) and is made **idempotent** — re-running provisioning re-uses existing addresses (`createAddress` is upsert-by-local-part) rather than duplicating, mirroring the `ON CONFLICT DO NOTHING` discipline already in `provisionTenant()`.
- **Partial failure:** if CF succeeds but the DB write fails, the next provisioning run reconciles (list CF addresses → ensure matching rows). A reconcile function `reconcileTenantEmail(slug)` is the escape hatch, callable from the console and a scheduled sweep.
- **Console:** the tenant provisioning screen shows email state (provisioned / pending-domain / error) with a **Reprovision email** action.
- **Verification:** a freshly provisioned tenant (with an onboarded domain) shows 5 `CONNECTED` connections, valid MX/SPF/DKIM/DMARC per `getDeliverabilityDns`, and a test send from each identity lands (SPF/DKIM pass).

### WS-E3 — Section binding (rename + assign to any ERP section) · **PLANNED · M**

Replace the fixed `email_identity.purpose` enum (`CHECK (purpose IN ('BILLING','DOCUMENTS','NOTIFICATIONS','SUPPORT'))`, migration `0410`) with a tenant-configurable mapping.

```sql
-- new: a tenant-defined binding of one provisioned address to ERP section(s)
CREATE TABLE email_section_binding (
  email_section_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_identity_id  uuid NOT NULL REFERENCES email_identity(email_identity_id),
  section_key        text NOT NULL,          -- module_key or a coarse section slug
  is_default_outbound boolean NOT NULL DEFAULT false, -- this address sends this section's mail
  inbound_route      text,                   -- where inbound to this address lands (module/dossier/queue)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_identity_id, section_key)
);
-- relax the enum: purpose becomes a free label/slug (kept for back-compat display)
ALTER TABLE email_identity DROP CONSTRAINT IF EXISTS email_identity_purpose_check;
ALTER TABLE email_identity ADD COLUMN label text;          -- the tenant's rename
```

- **Resolution change:** `email.service.resolveMail({ purpose })` currently reads `emailRepo.identityFor(purpose)`. It becomes `identityForSection(sectionKey)` → the binding with `is_default_outbound` for that section, falling back to the platform fallback exactly as today. Backward compatible: the four legacy purposes seed as four default bindings.
- **Two levels of rename, distinct in the UI:** (a) **label + section** = a DB write, instant; (b) **local-part** (`billing@`→`accounts@`) = a Cloudflare `deleteAddress`+`createAddress` and a connection update, shown as a heavier action with a confirmation.
- **Settings enforcement:** per [[settings-must-be-enforced]] — a binding is a contract. Every module that sends must resolve its section's identity at send time; a module with no binding falls to the tenant default identity, then platform fallback. No silent drop.
- **Verification:** renaming an address's section in Comms → Mail changes which identity a subsequent send from that module uses; a module with no binding still sends (via default), proving no lockout.

### WS-E4 — Inbound: Email Worker + ingest webhook + `cloudflare_routing` provider · **PLANNED · L**

- **Cloudflare Email Worker** (deployed once per account, not per tenant): the `email()` handler reads the raw message, extracts headers/parts/attachments, and POSTs a JSON envelope to `POST /api/tenant/mail/ingest/cloudflare` on the tenant's host, signed with an **HMAC** (`CLOUDFLARE_INGEST_HMAC_SECRET`) and carrying the recipient address (which selects the tenant + connection). Large attachments go to R2 and are passed by reference, or inline base64 under a size cap.
- **Ingest endpoint** (declared **before** `authMiddleware`, like the existing mail OAuth callback/webhook routes): verify HMAC → resolve tenant from recipient domain via `registry.resolveByHost`-equivalent → resolve `email_connection` by address → run the **existing** ingest path (`syncConnection`'s body: `cleanHtml` sanitize, dedup index `ux_email_inbound_dedup`, `persistAttachments` → vault, `autoLink` → dossier/client, `emitEvent('email.received')`, `publishMailEvent` → realtime).
- **New provider adapter** `providers/cloudflareRouting.provider.js` implementing `provider.interface.js`: `verify()` (zone + routing status), `sendEmail()`/`createReply()` (via CF Email Service — shared with WS-E1), and inbound as **push** (no `fetchSince` cursor; the webhook is the ingress, so `fetchSince` returns empty and sync is a no-op). This keeps business code provider-agnostic — it never learns mail arrives by webhook.
- **Security:** HMAC + timestamp (replay window), recipient-domain must match a known tenant, unknown recipients 202-and-drop (a probe can't enumerate). Same 25 MB attachment cap as `document_vault`.
- **Verification:** an email to a provisioned address appears in that tenant's Mail view within seconds, deduped on redelivery, attachments in the vault, auto-linked when the subject carries a dossier ref — identical to the IMAP path, proven by the same assertions.

### WS-E5 — Domain onboarding handshake · **PLANNED · M · DECISION D1**

The tenant's own domain must be a Cloudflare zone before addresses provision. Two paths, both recorded in `email_domain`:

```sql
CREATE TABLE email_domain (
  email_domain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        citext NOT NULL UNIQUE,
  cf_zone_id    text,
  onboarding    text NOT NULL CHECK (onboarding IN ('DELEGATION','MX_ONLY')),
  ns_status     text,   -- for DELEGATION: pending/active
  mx_status     text,   -- for MX_ONLY: pending/verified
  spf_ok boolean DEFAULT false, dkim_ok boolean DEFAULT false, dmarc_ok boolean DEFAULT false,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

- **Delegation (recommended default):** tenant repoints nameservers to Cloudflare (or Praxis holds the zone); Praxis then sets all records via API — fully automatic, subdomain-like. Console shows the two NS targets and polls `ns_status`.
- **MX-only:** tenant keeps DNS elsewhere, adds CF's MX + a verification TXT; provisioning is "generate records → tenant applies → we verify," a guided flow.
- **Verification worker:** a scheduled job re-checks pending domains (NS/MX/SPF/DKIM/DMARC) and flips `email_domain` + `email_identity.*_verified` when they pass, then triggers WS-E2's address creation if it was deferred.
- **Verification (test):** a tenant on each path reaches `verified_at` and provisions its 5 addresses without a manual DB touch.

### WS-E6 — Deliverability & send-log dashboard · **PLANNED · M**

`email_send_log` already records `status IN (QUEUED,SENT,DELIVERED,BOUNCED,COMPLAINED,FAILED)` with `provider_message_id` (migration `0410`). Cloudflare Email Service delivery events (bounce/complaint) feed back via a webhook that updates the log row. Console surfaces per-tenant: SPF/DKIM/DMARC status, send volume, bounce/complaint rate, last failures. Suppression list for hard bounces/complaints so a bad address isn't retried.
- **Verification:** a forced bounce updates the log to `BOUNCED` and adds the address to suppression; the dashboard reflects it.

### WS-E7 — Override / import (reuse) · **BUILT + S**

The `email_connection` connect path (`mail.service.connect()` + Microsoft/Google OAuth) already attaches a tenant's own mailbox. Work is only: keep the section bindings pointed at the same slot when a provisioned CF box is swapped for an imported one, and a Comms UI affordance for the swap.
- **Verification:** swapping a provisioned address for an imported M365 mailbox preserves which ERP sections route to/from it.

### 2.9 Email phasing

| Phase | Workstreams | Outcome |
|---|---|---|
| **E-α** | WS-E1, WS-E5, WS-E3 | Domain onboarding + section model; no mail flows yet |
| **E-β** | WS-E2, WS-E7 outbound | 5 addresses provisioned; system + module mail sends via CF |
| **E-γ** | WS-E4 | Full inbound; Comms Mail shows real inbox |
| **E-δ** | WS-E6 | Deliverability dashboard + suppression |

---

## 3. Kaizen ops — platform-integrated operations

**Goal.** Fold continuous operations into the platform console so 50 tenants are as observable and recoverable as 5. The signals largely exist; the work is aggregation, scheduling, external probing, rehearsed recovery, and surfacing.

### 3.1 Live health monitoring

#### WS-H1 — Fleet health rollup + console page · **PARTIAL → PLANNED · L**

Raw signals already emitted: `registry.poolStats()` / `hostCacheStats()` (`registry.service.js`), `fleetSchemaStatus()` (`provisioning.service.js`), Prometheus target (`routes/metrics.js`), business-metric collector (`business-metrics.js`), `/api/health/ready` with `degraded`.

- **Collector:** a scheduled platform job snapshots per-tenant signals into a time-series table (below), so the console renders history, not just an instant.

```sql
-- platform DB
CREATE TABLE platform.tenant_health (
  tenant_id uuid NOT NULL REFERENCES platform.tenant(tenant_id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  pool_total int, pool_idle int, pool_waiting int,   -- from poolStats()
  schema_behind int, schema_unreachable boolean,     -- from fleetSchemaStatus()
  jobs_failed_24h int,                               -- from BullMQ / praxis_jobs_total
  mail_verified boolean,                             -- email_domain state
  redis_ok boolean, last_error_at timestamptz,
  status text CHECK (status IN ('GREEN','AMBER','RED')),
  PRIMARY KEY (tenant_id, captured_at)
);
```

- **Status rules:** RED = unreachable DB, pool saturated (`waiting>0` sustained), migration behind during a deploy, or Redis down; AMBER = elevated job failures, mail unverified, drift outside a deploy; GREEN otherwise. Rules live in one function so the console and alerting agree.
- **Console:** a fleet grid (tenant × status) with drill-down to the per-tenant series; a system-wide banner for platform-level RED (Redis/Postgres/worker).
- **Verification:** killing a tenant DB flips it RED within one collection interval; saturating a pool shows AMBER→RED with `pool_waiting>0`.

#### WS-H2 — Synthetic per-tenant liveness · **PLANNED · M**

Beyond process metrics, a cheap per-tenant read (e.g. `SELECT 1` through the tenant pool + a feature-state read) proves the *tenant path* works, catching the "process up, one tenant's DB wedged" case that fleet-wide metrics miss. Recorded into `tenant_health.redis_ok`/status.
- **Verification:** a tenant whose DB rejects connections is RED while the rest stay GREEN.

### 3.2 Backup & restore (deep dive)

Database-per-tenant makes per-tenant backup *simple in principle* and is the strongest argument for the tenancy model — but **it is neither scheduled centrally nor ever rehearsed today**, which means it is not yet a backup. This is the section to get right before sign-off.

**Threat model — what we are protecting against, in priority order:**

1. **Single-tenant logical loss** — a bad God-Mode purge, a botched migration, an app bug corrupting one tenant's rows. Most likely; must be recoverable per tenant without touching others.
2. **Single-tenant physical loss** — a tenant DB/volume corrupts.
3. **Fleet/host loss** — the Postgres host or the storage backend is lost.
4. **Object loss** — a vault document is deleted or corrupted independently of Postgres.

Because tenants are separate databases, (1) and (2) must be **restorable one tenant at a time to a point in time**, which rules out relying only on a whole-cluster snapshot.

#### WS-B1 — Postgres backup: per-tenant logical + cluster PITR · **PLANNED · L · DECISION D4**

- **Layer 1 — per-tenant logical dumps.** A scheduled platform job runs `pg_dump` per tenant DB (custom format, compressed), to the offsite bucket, on a cadence (proposed: nightly full + retained 30 days, plus a weekly kept 12 weeks; align long-term with the **10-year immutable-ledger** retention for ledger-bearing schemas). Per-tenant dumps are what make single-tenant restore trivial. Naming: `pg/<slug>/<yyyy-mm-dd>T<hh>.dump`.
- **Layer 2 — cluster PITR.** Continuous WAL archiving (via `pgBackRest` or `wal-g`) to the same offsite bucket, giving point-in-time recovery to the second for host-level events (threat 3) and for a per-tenant restore between nightly dumps (threat 1/2) when the loss window matters. **Availability depends on the host** (managed vs self-run Postgres) — hence D4.
- **Encryption:** dumps and WAL encrypted at rest (bucket SSE + a Praxis-held key); the backup bucket is write-once/versioned so a compromised app credential can't erase history.
- **Registry:** every backup records to `platform.backup_run` (below) so the console can show "last good backup" per tenant and alert when one is stale.

```sql
CREATE TABLE platform.backup_run (
  backup_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenant(tenant_id),  -- NULL = fleet/cluster (WAL, object)
  kind text NOT NULL CHECK (kind IN ('PG_DUMP','WAL','OBJECT_SYNC','SNAPSHOT_SCAN')),
  status text NOT NULL CHECK (status IN ('OK','FAILED')),
  bytes bigint, location text, started_at timestamptz, finished_at timestamptz,
  error text
);
```

- **Verification:** a nightly run writes an `OK` `PG_DUMP` row per tenant; a tenant DB made unreachable produces a `FAILED` row and an alert; the console shows staleness.

#### WS-B2 — Object/system backup via rclone · **PLANNED · M**

The storage root (vault documents, branding, media) is backed by the storage driver (local or S3). A scheduled `rclone sync` copies it to an **independent** offsite bucket (different provider/account than the primary, so a single account compromise isn't total), versioned, encrypted. For the local driver this also captures the on-disk root; for S3 it is cross-bucket/cross-account replication. Records `OBJECT_SYNC` to `backup_run`.
- **Verification:** a file written to the vault appears in the offsite copy within one sync interval; deleting it from primary leaves the offsite version intact.

#### WS-B3 — Restore rehearsal (the part that makes it real) · **PLANNED · L**

A **scripted, scheduled restore drill** — not a document, an actual run:

- `scripts/db/restore-tenant.js --slug=<x> --at=<timestamp> --into=<throwaway-db>` : provision a scratch DB, restore the latest dump (or PITR to `--at`), run a battery of integrity probes (row counts vs source within tolerance, `SELECT` on core tables, trial-balance recompute for a ledger-bearing schema, vault-hash spot check), then drop the scratch DB. Records the outcome and the **measured RTO** (time to restore) to `platform.restore_drill`.
- **Cadence:** monthly automated drill on a rotating tenant + on-demand before any risky fleet migration. A drill that fails pages someone.
- **RPO/RTO targets (for D4 sign-off):** propose **RPO ≤ 24h** from nightly dumps, **≤ 5 min** where PITR is available; **RTO ≤ 1h** per tenant. These are proposals to ratify.

```sql
CREATE TABLE platform.restore_drill (
  restore_drill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenant(tenant_id),
  restored_to timestamptz,          -- the PITR/dump point tested
  rto_seconds int, ok boolean, checks_json jsonb, ran_at timestamptz DEFAULT now()
);
```

- **Verification:** the monthly drill produces an `ok=true` row with an RTO under target; a deliberately corrupted dump produces `ok=false` and an alert.

#### WS-B4 — Snapshot integrity scan · **PLANNED · M**

A periodic scan reconciles `document_vault` content hashes against the bytes in storage (and the offsite copy), so a corrupt/missing artifact is caught **before** a restore needs it. Records `SNAPSHOT_SCAN` to `backup_run` with a list of mismatches.
- **Verification:** corrupting a stored object flags exactly that object on the next scan.

### 3.3 Error reporting

#### WS-ER1 — Wire alerting + per-tenant error surface · **PARTIAL → PLANNED · M**

The **Error Command Center** exists: `error-maintenance` job (30-day purge + escalation), platform namespace feed (`realtime/platform-ns.js`), escalation service (`error-escalation.service.js`), and the boot path already **warns when no alert destination is set** (`server.js`). Work: configure a real destination (`ALERT_WEBHOOK_URL` / `ALERT_EMAIL`), define severity→channel routing, and surface per-tenant error rate + top errors + latest fatals in the console, tied to `tenant_health.last_error_at`.
- **Verification:** an unhandled fatal reaches the configured channel; the console shows the tenant's error spike.

### 3.4 Uptime reporting

#### WS-U1 — External uptime probe + status page · **PLANNED · M**

Internal metrics can't see "the process is down." An **external** probe hits `/api/health/ready` per host (each tenant subdomain + the platform/admin host) on an interval, from outside the deployment, recording to an uptime series; renders a per-tenant availability figure and a monthly report. Feeds a public/tenant-facing **status page** (shared with §3.5).
- **Verification:** stopping a host drops its availability and shows an incident on the status page; recovery closes it.

### 3.5 Maintenance & support

#### WS-M1 — Maintenance windows + banners · **PLANNED · M**

Scheduled, announced maintenance: a platform-set window writes a tenant-facing banner (and optionally a read-only/parked state), auto-clearing after. Surfaced on the status page. Integrates with deploys so a fleet migration can announce itself.
- **Verification:** a scheduled window shows the banner to tenant users for its duration and clears automatically.

#### WS-M2 — Support ↔ telemetry linking · **PARTIAL → PLANNED · M**

`support_ticket` exists (`DB_ARCHITECTURE.md` §3) with a kanban lifecycle. Work: attach the reporting tenant's live telemetry (health status, recent errors, backup state) to a ticket so triage starts with context, and drive the status page from §3.1/§3.4 rather than by hand.
- **Verification:** opening a ticket shows the tenant's current health/error snapshot inline.

---

## 4. Integrations

The `integration_secret` vault (AES-256-GCM, `settingService.readSecret/put`) is the established home for third-party credentials (mail, S3, Geoapify, VAPID, AI vendor keys), already live-tested by `settings.probes.js`. The work is consistency and visibility, not a new mechanism.

#### WS-I1 — Per-tenant integrations health view · **PLANNED · M**

One console view per tenant: every integration, its state (configured / verified / last-checked / error), driven by the existing `probes.js` pattern extended to cover Cloudflare (WS-E1). A scheduled re-verify keeps `last-checked` honest, so an expired token is caught before a feature fails.
- **Verification:** revoking a stored credential shows the integration as failing on the next re-verify.

#### WS-I2 — Unified connect / verify / rotate flow · **PLANNED · M**

Each provider today has its own connect path. Standardize a `connect → verify → rotate → revoke` lifecycle over the vault so credential rotation (a security requirement) is one flow, not per-integration bespoke code. Rotation writes a new secret version and re-verifies before retiring the old.
- **Verification:** rotating an S3 key mid-session continues serving media with no downtime.

#### WS-I3 — Cloudflare as a first-class integration · **PLANNED · S**

Cloudflare (email + DNS) registers under the same vault + probe + health pattern as the rest, so §2's token handling isn't a special case. Folds into WS-I1/WS-I2.

#### WS-I4 — Connector discovery (optional) · **PLANNED · S**

Where tenants ask for surfaces Praxis doesn't natively integrate, expose the connector registry so a suitable MCP/connector can be suggested rather than custom-built. Low priority; demand-driven.

---

## 5. Optimization & scalability

### WS-S1 — Stand up PgBouncer · **PARTIAL → PLANNED · M · DECISION D3**

The code routes every tenant pool through `TENANT_DB_POOLER_HOST` when set and keeps migrations/provisioning pointed at Postgres directly (they must not traverse a transaction pooler). The prerequisites — per-request single connection, `search_path` as a startup parameter — are **BUILT**, so transaction pooling is now safe. Work: deploy PgBouncer (transaction mode) in the infra manifest, point the app at it, and set pool sizing against `max_connections`.

- **Sizing:** with transaction pooling, per-tenant backend connections decouple from app pool count; target a server-side pool that keeps the fleet under `max_connections` with headroom, and set `TENANT_POOL_CACHE_MAX` / idle windows accordingly.
- **Observability:** add PgBouncer stats to `tenant_health` (server vs client connections, wait).
- **Verification:** the §1.4-style capacity test from the perf audit demonstrates **>100 concurrently-active tenants** on one API process, and a two-replica soak holds connections flat.

### WS-S2 — Resolve per-tenant DB credentials · **PLANNED · M**

`provisionTenant()` records `secret_ref` (`vault:tenant/<slug>/db-password`) but `registry.service.js` authenticates every tenant pool with the shared `config.DB_PASSWORD` and one app role. Work: at pool creation, resolve the per-tenant secret from the vault (the `secret_ref` already exists on `platform.tenant_database`), so each tenant DB has its own credential.

- **Why it matters:** it's the missing half of "your data, your Postgres" — the isolation is physical (separate DBs) but the credential is shared, so a leaked app password reaches every tenant DB. It is also the prerequisite for ever handing a tenant access to *their own* database (the documented commercial add-on).
- **Rollout:** provision distinct roles/passwords per tenant DB; backfill existing tenants (rotate in, dual-read during the window); the pooler (WS-S1) authenticates per tenant.
- **Verification:** a tenant pool authenticates with a credential that does **not** open any other tenant DB (proven by a negative test).

### WS-S3 — Entitlement / quota / metering · **PLANNED · XL · DECISION D5**

Feature gating is binary (`feature_state`); the rate limiter is a flat per-tenant ceiling. There is no measurement of consumption against a plan. This is the one genuinely new subsystem and the bridge from gating to billing.

```sql
-- platform DB: what a plan grants, and what a tenant consumes
CREATE TABLE platform.plan_entitlement (
  plan_id uuid REFERENCES platform.plan(plan_id),
  metric  text NOT NULL,        -- 'seats' | 'storage_gb' | 'ai_spend_xaf' | 'emails_month' | ...
  limit_value numeric NOT NULL, hard boolean NOT NULL DEFAULT false,  -- hard=block, soft=warn
  PRIMARY KEY (plan_id, metric)
);
CREATE TABLE platform.tenant_usage (
  tenant_id uuid REFERENCES platform.tenant(tenant_id),
  metric text NOT NULL, period date NOT NULL,       -- monthly bucket
  used numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric, period)
);
```

- **Meters:** seats (count active `app_user`), storage (sum vault bytes), AI spend (**reuse the existing `ai_budget_period` / `ai_usage_ledger`** per tenant), email volume (from `email_send_log`), API rate (from the limiter). Each meter increments `tenant_usage`; a resolver compares against `plan_entitlement`.
- **Enforcement:** soft limits warn (console + tenant banner); hard limits block the specific action with a clear `ENTITLEMENT_EXCEEDED` (never a generic 500), consistent with how `requireFeature` gates today.
- **Console:** per-tenant usage vs entitlement, and the platform-wide roll-up that feeds billing.
- **Scope decision (D5):** propose **spend + seats first** (highest commercial value, data mostly exists), storage + email next.
- **Verification:** a tenant at its seat limit is blocked from adding a user with `ENTITLEMENT_EXCEEDED`; usage shows correctly in the console; a soft-limit tenant warns but proceeds.

### WS-S4 — Content-drift hashing in the migration ledger · **PLANNED · S**

`fleetSchemaStatus()` compares file *counts*; the migrator is filename-keyed, so a file edited after a tenant ran it never re-applies and no checksum catches the divergence. Add a `sha256` column to `public.schema_migration`, recorded at apply time; `fleetSchemaStatus()` (and a CI check) then flags a tenant whose applied hash differs from the current file — the one drift class the count-based check can't see.
- **Verification:** editing an already-applied migration file is flagged as drift on the next fleet status, without re-applying it.

### WS-S5 — Residual operational rules · **BUILT (documented) · S**

- **Migration idempotency:** 23 files use bare `CREATE TRIGGER` (fails `42710` on rerun); "never renumber an applied migration" is permanent. Keep as an enforced rule (CI guard exists), not a fix.
- **Noisy-neighbour:** the global per-tenant rate limiter (`rate-limit.js`) already bounds one tenant's blast radius; revisit per-plan limits once WS-S3 lands (rate becomes an entitlement).

---

## 6. Cross-cutting concerns

- **Security:** every new secret (Cloudflare token, per-tenant DB password, backup encryption key) lives in the vault, never on a row — the established rule. Ingest and delivery webhooks are HMAC-signed. Per-tenant DB credentials (WS-S2) are themselves a security upgrade.
- **Observability:** every new job (backup, health collector, uptime probe, verification worker) emits to the existing metrics + structured-log + error-reporter stack (`workers.js` already wraps handlers with duration + request-id + terminal-failure reporting). No job runs blind.
- **Cost:** Cloudflare email is ~free inbound + $0.35/1k outbound; the material new costs are the offsite backup bucket(s) and the uptime-probe/status surface. All modest.
- **Tenancy invariants:** nothing here crosses the DB boundary — health, backup, and metering aggregate in the **platform** DB from per-tenant reads; no business data is co-mingled.

---

## 7. Phased roadmap

Dependency- and risk-ordered; each phase ends with its workstreams' verification.

| Phase | Workstreams | Rationale |
|---|---|---|
| **P1** | WS-S1 (PgBouncer), WS-S2 (per-tenant creds), WS-E1/E5/E3 (email foundation) | Bank the scaling headroom and isolation fix; stand up email's non-flow foundation. Independent of each other. |
| **P2** | WS-E2/E7 (provision + outbound), WS-H1/H2 (health), WS-ER1 (alerting) | First mail flows; make the fleet observable and alerting real. |
| **P3** | WS-B1/B2/B3/B4 (backup + rehearsed restore), WS-U1 (uptime), WS-M1 (maintenance) | Recoverability and availability — existential before scale. Restore drill gates P3 sign-off. |
| **P4** | WS-E4 (inbound), WS-E6 (deliverability), WS-S3 (entitlement/metering), WS-I1/I2/I3 (integrations) | Full mailbox; the billing bridge; integration hygiene. |
| **P5** | WS-S4 (drift hash), WS-M2 (support↔telemetry), WS-I4 (connectors) | Hardening and polish. |

---

## 8. Decisions — all resolved

**All six decisions were signed off as recommended on 2026-08-10** (`doc/INFRASTRUCTURE_DECISIONS.md`). No workstream in this plan is decision-blocked; §7 can proceed end to end.

| # | Decision | Resolution | Unblocked |
|---|---|---|---|
| D1 | Email domain onboarding: full Cloudflare delegation vs MX-only (§WS-E5) | **Approved** — support both; default delegation; MX-only fallback | WS-E2, WS-E5 |
| D2 | Outbound transport: CF authenticated SMTP vs REST `send_email` (§2.0/WS-E1) | **Approved** — SMTP first (near drop-in), REST later | WS-E1 |
| D3 | Commit PgBouncer/transaction pooling in deployment now (§WS-S1) | **Approved** — deploy now; prerequisites are built | WS-S1 |
| D4 | Backup: PITR availability on the host, dump cadence, rclone destination, RPO/RTO targets (§3.2) | **Approved** — RPO ≤24h (≤5m w/ PITR), RTO ≤1h; rehearse before sign-off | WS-B1/B3 |
| D5 | Entitlement scope: seats/storage/spend now vs spend-only first (§WS-S3) | **Approved** — spend + seats first; storage/email next | WS-S3 |
| D6 | Backup bucket provider/account separation & key custody (§3.2) | **Approved** — independent account for offsite; Praxis-held key | WS-B1/B2 |

Two carry-forward notes from sign-off: the ≤5 min RPO in D4 holds **only where WAL archiving is available**, which still depends on the Postgres host (confirm at WS-B1 build time); and D3's pooler must be configured for the per-tenant roles introduced by **WS-S2**, so S2 should land first or PgBouncer's auth config must anticipate it.

---

## 9. Effort summary

| Bucket | Workstreams | Rough total |
|---|---|---|
| Email | E1 M, E2 L, E3 M, E4 L, E5 M, E6 M, E7 S | ~6–8 weeks |
| Kaizen ops | H1 L, H2 M, B1 L, B2 M, B3 L, B4 M, ER1 M, U1 M, M1 M, M2 M | ~7–9 weeks |
| Integrations | I1 M, I2 M, I3 S, I4 S | ~3 weeks |
| Scalability | S1 M, S2 M, S3 XL, S4 S, S5 S | ~5–7 weeks |

Totals are single-developer engineering estimates excluding review and are parallelizable across the phase structure in §7.

---

## 10. Evidence index

Verified against these files this pass:

`src/services/tenant/registry.service.js` · `src/middleware/tenant-context.js` · `src/shared/cache/identity-cache.js` · `src/jobs/workers.js` · `src/config/redis.js` · `src/realtime/index.js` · `src/realtime/platform-ns.js` · `src/server.js` · `src/shared/http/rate-limit.js` · `src/services/platform/provisioning.service.js` · `src/services/platform/migrator.js` · `src/services/platform/mail-fallback.service.js` · `src/services/platform/settings.probes.js` · `src/services/platform/error-escalation.service.js` · `src/services/email.service.js` · `src/modules/mail/mail.service.js` · `migrations/tenant/0410_notifications_ux.sql` · `migrations/tenant/0483_email_connection.sql` · `scripts/db/check-schema-drift.js` · `scripts/db/fleet-status.js`

Cloudflare capability claims (§2) verified against Cloudflare Email Service + Email Routing documentation, August 2026.

---

*No code has been changed. This is a plan awaiting review.*
