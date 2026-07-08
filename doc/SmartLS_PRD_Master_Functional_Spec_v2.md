# SmartLS / PRAXIS-LS — Master Functional Specification (PRD v2.0)

**Product:** PRAXIS-LS — a white-label, multi-tenant logistics & freight ERP for the OHADA / CEMAC region
**First tenant:** Smart Logistics (SmartLS), Cameroon
**Vendor:** JBS Praxis LLC
**Status:** Engineering build specification — final
**Companion document (mandatory):** `SmartLS_OHADA_Accounting_Tax_KnowledgeBase.md` (the single source of truth for how money is recorded; every accounting/tax rule in this PRD defers to it and cites its sections as **[KB §n]**).
**Date:** 1 July 2026

---

## 0. How to read this document

This PRD is written to be handed directly to the engineering team. It assumes **no prior knowledge of the current SmartLS system** and defines everything needed to build. It is deliberately grounded in the **existing codebase** (PHP/MySQL) — we are not throwing away the hard-won domain logic already encoded there; we are rebuilding it correctly on a new stack. Where a rule already exists in the current code, this PRD says so, so the team preserves behaviour that is right and fixes what is wrong.

Conventions used throughout:

- **[KB §n]** — see section _n_ of the OHADA/Tax Knowledge Base. Accounting mechanics are **not** duplicated here; they live in the KB.
- **[FROM CODEBASE]** — a pattern, status enum, or field that already exists in the current system and must be carried forward.
- **[NEW]** — net-new capability not in the current system.
- **[RULE]** — a hard invariant the system MUST enforce (not optional).
- **MOD-nn** — the module number from the functional map (Section 9).
- **MUST / SHOULD / MAY** — RFC-2119 priority.

A companion **RBAC & User-Journey** document (`SmartLS_SuperAdmin_User_Journey_and_RBAC`) describes who does and sees what; this PRD encodes that access model as the central policy engine (Section 7).

---

## 1. Vision & product strategy

**The one-sentence product.** A single, multi-tenant SaaS platform that runs an entire logistics/freight-forwarding business — sales, operations, warehouse, fleet, procurement, HR, and a full OHADA-compliant accounting and tax core — that any Cameroonian (and later CEMAC/ECOWAS) logistics firm can adopt as if it were built just for them.

**Why it wins.** Logistics SMEs in the region run on spreadsheets, WhatsApp and disconnected tools. They cannot see per-shipment margin, cannot file OHADA statements from their own data, and re-key everything. PRAXIS-LS closes that gap end to end and — critically — is **white-labelled**: every tenant sees their own name, logo and colours, with only a subtle _"Powered by JBS Praxis LLC"_. To the client it feels bespoke; to us it is one codebase sold many times.

**Commercial model.** Multi-tenant SaaS. Each new tenant is provisioned from a Praxis-side platform console (isolated data, own subdomain, own branding). Server capacity scales with tenant count (Section 6.4). The product is designed to **take the Cameroon logistics market** by making each customer feel the system was written for them.

**Design tenets.**

1. **Accounting is the spine, not a bolt-on.** Every operational action that moves money posts to an OHADA ledger at source **[KB §7]**.
2. **Isolation and trust.** Tenants never see each other; sensitive figures are governed by rules on the data, not the screen; irreversible actions are logged immutably.
3. **Feels bespoke.** White-label theming, bilingual EN/FR, and a UX built around how a forwarder actually works (the _dossier_/operation file at the centre).
4. **Grounded in reality.** Cameroon-specific: XAF, TVA 19.25%, CNPS, DSF, débours vs revenue, mobile money, manual bank reconciliation.

---

## 2. What exists today (grounding in the current codebase)

The current system is a PHP + Bootstrap + MySQL monolith (84 tables, ~714 PHP files). It is **more capable than a typical v1** and several patterns are worth preserving. It is also fragile and non-compliant in ways this rebuild fixes.

### 2.1 Strengths to carry forward **[FROM CODEBASE]**

- **Document lifecycle with hard locking.** Invoices, costings, POs and receipts already move through explicit states and _lock_ on issue/approval: `DRAFT → ISSUED_LOCKED / APPROVED_LOCKED / POSTED_LOCKED`, with an `UNLOCK_REQUESTED` path. This is the seed of immutability — keep it and make it stricter (Section 8).
- **Issuer → Validator → Approver already encoded.** `costing_master` carries `SUBMITTED_FOR_VALIDATION → SUBMITTED_FOR_APPROVAL → APPROVED_LOCKED` with `validator_*` and `approver_*` fields; POs carry `issuer_auth_id` / `approver_auth_id` and auth codes; payroll runs move `OPEN → COMPUTED → SUBMITTED → APPROVED → VALIDATED → DISBURSED`. The segregation-of-duties backbone exists.
- **Document integrity hashing.** `payment_receipts.document_dna_hash` and `purchase_order_master.security_hash` show a tamper-evidence instinct — formalise it (Section 8.4).
- **Financial-dictionary linkage on lines.** `invoice_lines.dict_code` and `costing_line.item_code` already point lines at a catalogue — this is exactly the posting-rule seam the KB requires **[KB §4]**.
- **The logistics taxonomy.** `service_type` (SEA/AIR freight import/export, HINTERLAND*TRANSIT, INLAND_TRANSPORTATION, WAREHOUSING, END_TO_END*\*, BUSINESS_REPRESENTATION) and `service_territory` enums, plus a rich `operations_file_master` (BL/MAWB, vessel/flight, incoterm, POL/POD, customs regime). Keep this taxonomy — it drives milestones and costing.
- **Versioned milestone engine.** `ops_milestone_template` (per `service_type`, versioned, `stage_seq/code/label`) → `ops_milestone_instance` (status per file). Genuinely good; carry it forward and push updates to the client portal.
- **Multi-currency already present.** `currency` + `exchange_rate` on invoices and `exchange_rate_to_xaf` on costings.
- **Cameroon-real master data.** `client_master`/`supplier_master` carry `niu` (NIU/tax ID), `rccm`, `momo_network`/`momo_number`, `credit_limit`, KYC docs, and cached receivable/payable rollups.
- **Per-module/year document numbering.** `doc_sequences (module_key, year, seq)` — keep as the numbering engine (Section 5.2).

### 2.2 What must be fixed (the debt) **[FROM CODEBASE]**

- Hard-coded DB credentials and provider API keys in source; error logs served on the web; a lightly-governed hard-delete "God Mode"; the same screens copy-pasted across five role folders; several twin/duplicate tables; raw-SQL surface; no automated tests, staging, or CI/CD.
- **No accounting layer at all** — invoices/receipts exist as documents but never post to a general ledger; there is no chart of accounts, journals, or statements, so **taxes cannot be filed from the system**. This is the single biggest gap and the reason the KB exists.
- **English-only back office** in a bilingual country.

### 2.3 The rebuild in one line

Keep the domain intelligence (lifecycle, SoD, taxonomy, milestones, dictionary linkage), add the OHADA accounting spine and bilingual white-label multi-tenancy, and re-home everything on a secure, tested Node.js + PostgreSQL + React/Vite PWA stack.

---

## 3. Goals, non-goals, success criteria

### 3.1 Goals

1. One multi-tenant platform that runs the full logistics business end to end (Section 9's module map).
2. A native OHADA/SYSCOHADA accounting + Cameroon tax engine that produces the statutory statements and the DSF from live data **[KB Parts A & B]**.
3. White-label, fully bilingual (EN/FR), installable PWA.
4. A safe agentic-AI layer (Gemini/DeepSeek/Groq) with schema-validated actions.
5. Provable trust: RBAC with field-level confidentiality, an immutable ledger, reversal-not-deletion for booked data, and "Watch-the-Watcher" oversight.

### 3.2 Non-goals (v2)

- Live integrations to the DGI e-invoicing portal, bank APIs, or mobile-money aggregator APIs (designed-for, built later — bank/MoMo reconciliation is manual in v2 **[KB §5 class 5 note]**).
- Full IFRS dual-ledger (OHADA only; an optional IFRS _view_ may feed the Investor terminal).
- Native mobile apps (the PWA covers mobile).

### 3.3 Success criteria

- A tenant can go from onboarding → quote → operation → invoice → payment → **posted OHADA journals** → month-end statements → DSF dataset, without leaving the system or re-keying.
- Trial balance always balances (Σ Dr = Σ Cr); débours never inflate turnover **[KB §6]**.
- Two tenants run concurrently with zero data bleed.
- Every destructive or permission-changing action is on the immutable ledger.

---

## 4. Personas & roles (summary)

Full detail is in the RBAC/User-Journey document; the policy engine (Section 7) is the source of truth. Tiers:

- **Platform tier (Praxis):** _Platform Root Admin_ — provisions tenants, subdomains, capacity; never sees tenant working data.
- **Tenant tier:** _Tenant Super Admin, CEO/Executive (holds the God-Mode purge PIN), Management, Finance/Treasury, Accountant, Sales, Operations, Warehouse, Fleet, Procurement, HR, Line Manager._
- **External tier (portals):** _Client, Investor/Board, External Auditor._
- **Authority overlay (capabilities) on documents:** _Issuer, Validator, Approver_ — enforced so no one holds two conflicting hats on the same document **[FROM CODEBASE; KB §23]**.

---

## 5. Architecture

### 5.1 Technology stack (final)

| Layer            | Choice                                               | Notes                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | **React 18 + Vite**, TypeScript, installable **PWA** | Component library + design tokens + i18n from day one. Offline for field tasks only (Section 15.2).                                                                                     |
| Backend          | **Node.js (TypeScript)**, **NestJS**                 | Modular monolith with clean module boundaries + separate workers (AI, jobs, PDF). Splittable into services as tenants grow (6.4). Overrides the PRD's earlier "Python microservices".   |
| Database         | **PostgreSQL 16**                                    | One database, **schema-per-tenant** isolation (5.3). Row/column security available for field-level rules. Current data is MySQL → migrated **after** build, by the client (Section 16). |
| Cache / queue    | **Redis**                                            | Sessions, rate-limits, job queue (BullMQ), socket fan-out.                                                                                                                              |
| Realtime         | **Socket.IO (WebSockets)**                           | Chat, notifications, live milestone/dashboard updates.                                                                                                                                  |
| PDF              | **Puppeteer + headless Chromium**                    | Server-side rendering of invoices, POs, payslips, statements (5.10).                                                                                                                    |
| Validation       | **Zod**                                              | Request DTOs and the AI action-payload gate (10.3).                                                                                                                                     |
| Containerisation | **Docker + Docker Compose** (k3s-ready)              | K8s is over-spec for one node; stay compatible for later (6.4).                                                                                                                         |
| Hosting          | **Self-managed VPS, off AWS** (Hetzner/OVH/local CM) | Portable; capacity steps up per tenant.                                                                                                                                                 |
| Object storage   | **S3-compatible, non-AWS** (or local for now)        | Client chose local-disk-for-now; abstract behind a storage interface so it can move to MinIO/Backblaze/Wasabi without code change (Section 16 watch-point).                             |

### 5.2 Repository & code organisation

- **Monorepo** (pnpm/Turborepo): `apps/api`, `apps/web`, `apps/workers`, `packages/shared` (Zod schemas, types, the **posting-rules** and **tax** libraries, i18n dictionaries).
- Shared TypeScript types across API and web (one definition of every entity).
- **[RULE]** No secrets in code. Everything through `.env` / a secret store (Appendix A). No raw SQL string-building; use the ORM/query-builder with parameters.

### 5.3 Multi-tenancy model **[NEW]**

- **Isolation = schema-per-tenant in one PostgreSQL cluster.** A shared `platform` schema holds the tenant registry, subdomains, plans, and platform users; each tenant gets `tenant_<slug>` with the full application schema. This gives strong isolation, simple per-tenant backup/restore, and a trivial sandbox wipe (5.5).
- **Tenant resolution:** by subdomain (`smartls.praxisls.com` → tenant `smartls`). Middleware resolves tenant → sets the Postgres `search_path` / connection to that schema for the request. **[RULE]** No query may run without a resolved tenant context (except platform-tier endpoints).
- **Platform console** (separate app area, Praxis-only): create/suspend tenants, assign subdomain, seed branding & the OHADA chart of accounts, set initial capacity, and **toggle a tenant Live** (which hides the tenant's Test/Live switch — 5.5).
- **[RULE]** Cross-tenant data access is impossible by construction; platform users see tenant _metadata and health_, never tenant business rows.

### 5.4 White-label theming **[NEW]**

Every tenant feels bespoke. Tenant **Settings → Appearance** (Section 12, MOD-70) drives:

- **Company name** — used as the app title, document letterheads, email "from" name, and the PWA name.
- **Logos** — separate **light-mode** and **dark-mode** logos (+ favicon + PWA icons in required sizes). Rendered on the login/splash, top bar, printed documents and emails.
- **Colour tokens** — primary/secondary/accent (+ derived states) applied as CSS variables at runtime; light & dark themes.
- **Fonts** — default set (incl. a monospaced face for financial figures, e.g. IBM Plex Mono).
- **Document identity** — numbering prefixes (e.g. `SLAS`/`SLS`), TIN/NIU, RCCM, registered address, bank details block.
- **PWA manifest is generated per tenant** (name, short_name, theme_color, icons = tenant logo) so an installed app carries the tenant's identity.

**[RULE] The reveal.** The login page and every app reload/splash show the **tenant company name and logo**, with a **subtle "Powered by JBS Praxis LLC"** line (small, muted, footer-level). No Praxis branding competes with the tenant's identity anywhere else.

### 5.5 Test/Live sandbox mode **[NEW]**

Purpose: during rollout and training there will be junk data and mistakes; staff need a safe place to "play and break", and we must be able to wipe it cheaply.

- **Two schemas per tenant:** `tenant_<slug>` (Live) and `tenant_<slug>_sandbox` (Test). Identical structure; the sandbox is a copy/seed used for training and testing.
- **Toggle** in the top bar switches a user's session between Live and Test. **[RULE]** When in Test, a persistent, unmistakable **"TEST MODE" banner** is shown on every screen, and all outbound side-effects are sandboxed: **no real client emails, no real AI spend where avoidable (or a hard low cap), separate document numbering**, and clearly watermarked PDFs.
- **Auto-wipe:** a configurable **cron (default every 14 days)** truncates the sandbox schema and re-seeds baseline reference data, to save space. Interval configurable per tenant from the platform console.
- **Go-live:** when the Platform Root Admin marks the tenant **Live**, the Test/Live **toggle is hidden** from that tenant's users (the platform console can still restore it). The tenant then only ever sees the Live system.
- **[RULE]** Sandbox and Live never share rows; the wipe can never touch Live (different schema).

### 5.6 Security architecture

- **AuthN:** email/username + password (Argon2id hashing). **2FA (TOTP)** available to all, **strongly advised**, and enforceable per-role by the tenant (default: advised for Finance/Admin). **[FROM CODEBASE: password rehash-on-login, failed-login audit already exist — keep and add lockout + rate-limit.]**
- **Sessions:** short-lived access token (JWT) + refresh; **30-minute inactivity auto-logout**; an **active-session monitor with remote kill** (both already stubbed in the current `active_sessions` table). Store server-side session state in Redis so kill is instant.
- **AuthZ:** the central **RBAC policy engine** (Section 7) — roles + capabilities + scopes + **explicit CRUD per module** + **field-level visibility**. Enforced **server-side** on every endpoint; the UI merely reflects it.
- **Transport & data:** HTTPS only (HSTS); secrets in `.env`/secret store; per-tenant encryption of sensitive columns where warranted; full input validation via Zod.
- **[RULE] Watch-the-Watcher (5.7).** Admin power is itself watched.

### 5.7 "Watch-the-Watcher" governance **[NEW]**

- **[RULE]** Any change to a user's **permissions, role, capability, scope, or field-visibility**, or any **God-Mode action**, or any **role creation/edit**, MUST emit a **high-priority, immutable event** to the Event Engine and notify the **CEO/Management** layer in real time.
- **[RULE]** In the **Live** environment, the Smart Compliance Layer **blocks a Super Admin from granting themselves** operational document capabilities (Issuer/Validator/Approver). Such grants require a second authoriser (maker-checker).
- Rationale: the Super Admin configures access but must never be able to silently give themselves the power to issue and approve their own financial documents.

### 5.8 Integrations & external services

| Service                        | Use                                                                               | Module               | Notes                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| **Google Gemini**              | AI content generation (proposals, narratives, emails), document-vision extraction | MOD-23, MOD-30, 10.x | Human-review before send/finalise.                                                                |
| **DeepSeek**                   | Reasoning / the agentic assistant                                                 | 10.x                 | Function-calling over whitelisted actions; Zod-gated.                                             |
| **Groq**                       | Voice-to-text (Whisper-class)                                                     | 10.x                 | Voice notes → text attached to records.                                                           |
| **exchangerate-api**           | Live FX (USD base)                                                                | MOD-08               | **Daily midnight cron** sync, cached, per-transaction rate stamp, fallback to last-known if down. |
| **SMTP (transactional email)** | Send invoices & major documents                                                   | 5.9                  | Per-tenant sender identity; SPF/DKIM/DMARC.                                                       |

**[RULE]** No RAG / vector store. The AI obtains context by **function-calling** into the tenant's own API for the exact record it needs (10.2). **[RULE]** All provider keys live in `.env` / secret store, are **scoped per tenant where billing must be separated**, and the keys shared during discovery are considered **compromised and MUST be rotated** before build.

### 5.9 Email / SMTP & document delivery **[NEW]**

Invoices and all major documents (proforma, final invoice, receipt, PO, payslip, statements, transit order, delivery note) are generated as PDF (5.10) and **emailed from the system**.

**Sender identity — recommendation.** Do **not** use an unmonitored `noreply@`. Clients reply to invoices; a dead mailbox loses business and hurts deliverability. Use **purpose-based, monitored senders** on the tenant's own domain, with a friendly display name:

- `billing@smartls.cm` (or `invoices@`) — invoices, receipts, statements. **Display name: "SmartLS Billing".**
- `documents@smartls.cm` — operational documents (transit orders, delivery notes, PO copies).
- `notifications@smartls.cm` — system alerts/reminders (this one _may_ be no-reply, but prefer a monitored `hello@`/`support@` as the Reply-To).
- `support@smartls.cm` — support/feedback.

Multi-tenant white-label: each tenant configures its **own sending domain and addresses** in Settings; the platform sends as **"<Tenant Company Name>" via the tenant's mailbox**. Where a tenant has no domain yet, fall back to `+<tenant>@mail.praxisls.com` addressing with the tenant display name, until they set DNS.

**[RULE] Deliverability.** For each tenant sending domain, require **SPF, DKIM and DMARC** records; verify DKIM before enabling live sending. Support both **STARTTLS (587)** and **SSL (465)**. All email is queued (BullMQ) and retried; every send is logged (who/what/when/to) and linked to the source document. Bounces/complaints update the document's delivery status.

### 5.10 PDF generation (Puppeteer + Chromium) **[NEW]**

- A dedicated **PDF worker** renders bilingual HTML templates to PDF via **Puppeteer driving headless Chromium**. **[RULE]** Chromium and its system dependencies MUST be installed in the worker image (documented Dockerfile: the standard `apt` libs — `libnss3, libatk-bridge2.0-0, libcups2, libdrm2, libxkbcommon0, libgbm1, libasound2, fonts-liberation`, etc., plus **Noto fonts for correct FR accents & XAF formatting**).
- Templates are **white-labelled** (tenant logo, colours, letterhead, numbering, bank block) and **language-aware** (FR/EN). Financial figures use the monospaced font and XAF/quantity formatting.
- Every generated PDF is stored in the **Document Vault** (MOD-64) with a content hash (8.4) and a **QR verification code** (MOD-66); the stored `pdf_vault_id` links back from the source document **[FROM CODEBASE: invoice_master.pdf_vault_id already exists]**.
- Rendering is queued and rate-limited so bursts (batch statements) don't starve the API.

## 6. Environments, hosting, scaling, resilience

### 6.1 Environments

- **Local** (Docker Compose) → **Staging** → **Production**. **[RULE]** No development on production; no test files in production.
- **CI/CD:** every merge runs lint + type-check + unit/integration tests; deploys are promoted staging → prod. Database migrations are versioned (e.g. Prisma Migrate / Flyway) and run per tenant schema.
- **Observability:** centralised structured logs, error tracking (e.g. Sentry), uptime + resource monitoring, and **audit/AI-call logs** (10.5).

### 6.2 Hosting

- Single self-managed primary VPS to start (the current 12 GB / 6-core / 75 GB box). Containers: `api`, `web` (static/CDN), `postgres`, `redis`, `worker-jobs`, `worker-ai`, `worker-pdf`, `reverse-proxy` (Caddy/Nginx with automatic TLS).
- **[RULE]** The 75 GB is tight. Keep the DB and app lean; documents go to object storage (5.1) — if local-disk-for-now is used, monitor free space and alert at 70%.

### 6.3 Backup & disaster recovery

- **[RULE]** Automated **daily encrypted backups** of every tenant schema + the platform schema, shipped **off-box**, with **monthly restore tests**. Document vault backed up on the same cadence.
- Point-in-time recovery via WAL archiving for the accounting data. RPO ≤ 24h (target ≤ 1h for finance via WAL), RTO ≤ 4h.
- The **AI-scheduled weekly backup** idea from the PRD is implemented as a standard cron; AI may _trigger/report_ but the schedule is deterministic.

### 6.4 Scaling — "what happens at 10 tenants?"

Isolation is by schema, so more tenants never means data bleed — capacity is the only variable.

| Stage        | Setup                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 tenant     | The current single box.                                                                                                                                                                                                 |
| 2–4 tenants  | Step the box up as planned (24 GB / 8-core, then higher) — vertical scaling.                                                                                                                                            |
| 5–10 tenants | Split services across 2–3 servers: **app**, **PostgreSQL** (with a **read-replica**), **workers (AI/PDF/jobs)** behind the reverse proxy. The modular-monolith boundaries make this a deployment change, not a rewrite. |
| 10+          | Add a connection pooler (PgBouncer), a DB read-replica per heavy tenant if needed, and move the document store to a dedicated object-storage service.                                                                   |

**[RULE]** Because we kept clean module boundaries (5.2) and a storage abstraction (5.1), scaling is _adding hardware to a design that already expects it_, not re-architecting.

---

## 7. The RBAC policy engine (who does & sees what)

This is the single source of truth for authorization; it replaces the current system's copy-pasted role folders.

### 7.1 Model

Access = **Role** (job area) × **Capability** (document authority: Issuer/Validator/Approver) × **Scope** (entity/branch/department) × **explicit CRUD per module** × **field-level visibility rules**.

- **Roles, capabilities, scopes and permissions are configuration data**, editable by the Tenant Super Admin — **not** code or DB enums. Adding a unit (e.g. "Customs desk") is configuration, not a migration. (Fixes the current `enum` rigidity.)
- **[RULE]** Enforcement is **server-side** on every endpoint and every field resolver. The client UI hides/masks per policy but is never the gate.
- **[RULE] Field-level confidentiality** is first-class: e.g. _margins, salaries, supplier cost rates, net profit_ are masked on shared screens unless the role/capability allows them (7.3). Implemented via column-level policies and response serializers.

### 7.2 Capability workflow (segregation of duties) **[FROM CODEBASE; KB §23]**

Documents that move money pass **Issuer → Validator → Approver**; the same user cannot hold two hats on the same document. Already encoded in `costing_master`, `payroll_runs`, `purchase_order_master`. Generalise it to invoices, receipts, journals, disbursals. Approval thresholds (by amount) route to the right approver. **[RULE]** In Live, the Super Admin cannot self-assign these capabilities (5.7).

### 7.3 Field-confidentiality baseline (defaults; tenant-tunable)

| Sensitive data            | Visible to                                   | Masked from                                                   |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Job margin / net profit   | CEO, Management, Finance, Accountant         | Sales, Operations, Warehouse, Fleet, Procurement, all portals |
| Salaries / payroll detail | HR, CEO (Finance: totals only)               | Everyone else                                                 |
| Supplier cost rates       | Finance, Accountant, Procurement, Management | Sales, Operations, clients                                    |
| General ledger            | Accountant, Finance, CEO, Auditor (read)     | All operational roles                                         |
| Another tenant's data     | —                                            | Everyone (isolation)                                          |

Sales instead see the **Pricing Variance Index** (11.4) — a derived R/Y/G metric — never raw costs.

### 7.4 External portal scoping

Client → only their own dossiers/documents/messages. Investor/Board → read-only KPIs/financials (optional IFRS view). Auditor → time-boxed read-only records + immutable trail. (Detail in the User-Journey doc.)

---

## 8. Platform data conventions (the invariants every module obeys)

### 8.1 Identifiers & references

- Tenant-scoped, human-readable references with tenant prefix: clients `SLAS-CL-…`, suppliers `SLAS-SS-…`, operation files, costings `…`, etc. **[FROM CODEBASE]** Keep the existing reference styles.
- Internal keys are UUIDs; external references are the prefixed human codes.

### 8.2 Document numbering **[FROM CODEBASE → formalised]**

- Central **sequence service** backed by `doc_sequences (module_key, year, seq)` **per tenant** and **per environment** (Live vs Sandbox use separate sequences so test runs never burn Live numbers).
- Format: `{TENANT_PREFIX}-{MODULE}-{YYYY}-{NNNN}` (prefix from Settings, e.g. `SLAS`/`SLS`). **[RULE]** Numbers are allocated **only on issue/lock**, are gap-audited, and never reused.

### 8.3 Document lifecycle & locking **[FROM CODEBASE → strengthened]**

Standard state machine for financial/operational documents:
`DRAFT → (SUBMITTED_FOR_VALIDATION → SUBMITTED_FOR_APPROVAL) → ISSUED_LOCKED / APPROVED_LOCKED / POSTED_LOCKED → (UNLOCK_REQUESTED → …) → CANCELLED/REVERSED`.

- **[RULE]** Once **LOCKED/POSTED**, the document is immutable. Changes happen only by a governed **UNLOCK request** (pre-posting) or a **reversal** (post-posting, 8.5).
- Locking captures the actor, timestamp, auth code and content hash (8.4).

### 8.4 Integrity hashing **[FROM CODEBASE → formalised]**

- **[RULE]** On lock/post, compute a **content hash (SHA-256)** of the document's canonical payload (the "document DNA", already present as `document_dna_hash`/`security_hash`) and store it. The generated PDF embeds/records the same hash, and the **QR code (MOD-66)** resolves to a verification page that re-checks it. Any later mismatch is flagged.

### 8.5 Immutability, reversal & deletion policy **[NEW — critical, per client direction]**

This codifies the client's rules. There are two tiers of data:

**(a) Non-accounting operational/master data** (clients, suppliers, quotations, leads, draft documents, operation files not yet invoiced):

- **Soft-delete** (archived, recoverable). **[RULE]** Restoring an archived record requires a **second admin** (maker-checker). Every delete/restore is logged to the immutable ledger.

**(b) Accounting-connected data** (anything posted to the ledger: invoices, receipts, payments, journals, payroll postings, depreciation, tax entries):

- **[RULE] Never deletable.** Once a document is **posted**, it can only be **reversed** by a **reversal entry** that carries a **mandatory reason**, references the original, is itself posted and locked, and is written to the immutable ledger. Journal entries are corrected by **reversing entries, never by editing or deleting** **[KB §3, §13]**.
- **[RULE]** Deleting an operational record that has a **posted invoice** attached does **not** delete the transaction — it triggers the **reversal** of the accounting operation (with reason), leaving the original + its reversal both permanently on record.
- **[RULE] The immutable ledger itself is append-only. There is NEVER a hard delete from it — not even by God Mode.**

**God Mode (CEO-only purge engine)** — reconciled:

- Purpose: permanently remove **junk non-accounting data** (e.g. bad test clients, duplicate quotes, corrupted drafts) during "serious moments" only. With sandbox mode (5.5) available for training, this is rarely needed in Live.
- **[RULE]** Access is **the CEO alone**, unlocked by a **personal PIN**. Each purge writes the **full payload of what was removed** to the immutable ledger (so the purge is itself auditable by a third party).
- **[RULE]** God Mode **excludes the immutable ledger and all posted accounting records.** A booked invoice/journal can never be purged — only reversed. No role, including CEO/Super Admin, can hard-delete accounting history.

### 8.6 The immutable ledger / audit trail **[FROM CODEBASE → elevated]**

- Append-only `immutable_ledger` per tenant: `{id, actor_user_id, actor_role, action, module, entity_ref, before_hash, after_hash, payload_json, ip, created_at}`. Extends today's `audit_log`.
- **[RULE]** Every create/update/lock/post/reverse/delete/restore, every permission change (7/5.7), every God-Mode action, and every AI action (10.5) is recorded. Filterable by user/action/date/IP/module. Read-only to the Audit Terminal.
- Retention ≥ **10 years** for accounting-relevant records **[KB §1 Art. 24]**.

### 8.7 The Financial Dictionary ↔ Chart of Accounts ↔ Posting Rules seam **[KB §4 — do not merge]**

- **MOD-06 Chart of Accounts** = the statutory SYSCOHADA hierarchy (class→account→sub→detail). Seeded per tenant at onboarding from the KB Appendix.
- **MOD-05 Financial Dictionary** = the operational item catalogue (what appears on costings/invoices/disbursements), friendly-named, carrying rate/price/currency/shipping-line data. **[FROM CODEBASE: `dict_code` on lines already links here.]**
- **Layer 3 — Posting Rules (`posting_rules`)** = the account-determination engine: **every** dictionary item maps to COA account(s) + a **tax_code** + an **`is_debours` flag**. **[RULE]** No dictionary item may be saved without a complete posting rule; no invoice/costing line may reference a dict item lacking one **[KB §4, §23]**.

### 8.8 The dossier as the analytical dimension **[KB §6.7]**

- **[RULE]** Every journal line carries a `dossier_id` (operation-file) tag where applicable, so per-shipment margin = tagged service revenue − tagged own direct costs, with **débours excluded** **[KB §6]**. Implemented as a dimension on `journal_lines`, **not** as class-9 accounts.

## 9. Functional specification — the module map (70 modules, 13 groups)

Each module below gives **Purpose · Key features · Data/grounding · Access · Acceptance**. Accounting behaviour defers to the KB. Every module emits **events** to the Universal Event Engine (Section 10.6) and writes to the immutable ledger (8.6).

### Group I — Dashboard & Workspace

**MOD-00A Dashboard & My Workspace.**
_Purpose:_ role-filtered home. _Features:_ two tabs — **Dashboard** (KPIs/graphs per role) and **My Workspace** (my tasks, approvals awaiting me, alerts). Tiles configurable. _Access:_ everyone sees their own scope; margins/financial tiles per 7.3. _Acceptance:_ a Sales user never sees company margin tiles; Finance sees cash/receivables; Super Admin/CEO see all.

**MOD-00B God Mode (CEO purge console).** Per 8.5. _Access:_ **CEO only + PIN.** _Acceptance:_ attempts by any other role are blocked and alerted (5.7); purge of any ledger-connected record is refused; each purge logs full payload.

### Group II — Master Data Management

_All creates/edits push to the immutable ledger (8.6)._

**MOD-01 Corporate Entities.** Multi-entity within a tenant (each with its own books, TIN/NIU, RCCM, address, logo). _Data:_ entity table; scopes reference it. _Access:_ Super Admin. _Acceptance:_ employees/clients/suppliers and journals are entity-scoped (Section 13 consolidation optional).

**MOD-02 Human Capital (Employees).** _Grounding:_ `employee_master` (full_name, department, job_title, employment_type, CNPS number, base_salary, bank details, signatory_name for PDF signing). _Features:_ CRUD, per-entity, avatar, contract link, system authority (Issuer/Validator/Approver). _Access:_ HR + Super Admin; salaries per 7.3.

**MOD-03 Client Master.** _Grounding:_ `client_master` (client_type SHIPPER/CONSIGNEE/BOTH/BUSINESS_PARTNER, NIU, RCCM, payment_terms_days, credit_limit, KYC docs, cached_receivables/overdue). _Features:_ CRUD/export, KYC upload, credit terms, live receivable rollup. _Access:_ Sales/Ops create; costs hidden. _Acceptance:_ credit-limit breach warns at quote/costing.

**MOD-04 Supplier / Partner Master.** _Grounding:_ `supplier_master` (SLAS-SS-…, supplier_type, NIU/RCCM, payment_method incl. **MOBILE_MONEY**, momo_network/number, bank details, rating 1–5, cached_payables). _Access:_ Procurement/Finance; cost rates per 7.3.

**MOD-05 Financial Dictionary (Item Catalogue).** Per 8.7 — operational items with rate/currency/shipping-line data and a **mandatory posting rule**. _Access:_ Finance/Accountant maintain; Sales/Ops select. _Acceptance:_ cannot save an item without account(s)+tax_code+is_debours **[KB §4, §23]**.

**MOD-06 Chart of Accounts (OHADA).** The statutory SYSCOHADA hierarchy, seeded per tenant/entity **[KB §5]**. _Access:_ Accountant/Super Admin (add sub-accounts; core is regulated/locked). _Acceptance:_ every posting targets a valid COA account; class rules enforced.

**MOD-07 Tax Jurisdiction.** Configurable jurisdiction + tax codes (Cameroon: **TVA 19.25%**, withholding **2.2% / 5.5%**, minimum tax, CNPS) **[KB Part B; §21]**. _Features:_ effective-dated rates (Finance-Law changes each January), tax_code catalogue used by posting rules. _Acceptance:_ changing a rate is effective-dated and versioned, never retroactive silently.

**MOD-08 Currency & live FX.** _Grounding:_ multi-currency already on invoices/costings. _Features:_ currency list; **exchangerate-api** daily-midnight cron; cached rates; **per-transaction stored rate**; manual override; fallback to last-known. Base = XAF. Realised FX gain/loss on settlement **[KB §8 FX]**. _Access:_ Finance.

**MOD-09 Treasury Accounts.** Bank, cash, and **mobile-money wallets (MTN/Orange)** as first-class accounts, each mapped to COA (banks 521; cash 571; MoMo under 538x; internal transfers via 585) **[KB §5 class 5 note]**. _Features:_ manual reconciliation, **MoMo fee booked separately**, cash-in-transit sub-state. _Access:_ Finance/Treasury/Accountant.

**MOD-10 Expense Rates.** Per shipping line, posted onto Financial-Dictionary lines (e.g. Maersk handling), updatable. _Access:_ Finance/Commercial. _Acceptance:_ rate changes are versioned; simulators (MOD-27/28) read current rates.

### Group III — Human Capital Management (HR)

**MOD-11 Vacancies.** Post job descriptions to the public website (API). _Access:_ HR.
**MOD-12 Legal Contracts.** Offer letters, contracts, confirmation/termination tracking; PDF via signatory_name. _Grounding:_ `hr_contract_history`. _Access:_ HR; CEO approve.
**MOD-13 KPI Appraisals.** Line Manager sets targets, rates monthly. _Access:_ Line Manager (own team), HR.
**MOD-14 Attendance.** Timesheet + clock-in/out. _Grounding:_ `attendance_logs`. _Access:_ all (self), HR (all).
**MOD-15 Leave & Allowances.** Leave, salary advance, holiday, out-of-station/mission + allowance. _Accounting:_ salary advance → 4211; recovered in payroll **[KB §8.11]**. _Access:_ employee request → Line Manager/HR approve.
**MOD-16 SOPs & Onboarding.** SOP/manual library, onboarding checklists. _Access:_ all read; HR/Admin manage.
**MOD-17 Pay Slips / Payroll.** _Grounding:_ `payroll_runs` (OPEN→COMPUTED→SUBMITTED→APPROVED→VALIDATED→DISBURSED), `payroll_run_items`, config snapshot. _Features:_ auto-compute **CNPS (≈4.2% employee / 7%+ employer, capped) + IRPP/CAC/CFC/RAV** per KB §9; generate compliant payslips; link to cash request; **auto-post the payroll journal** **[KB §8.11]**. _Access:_ HR/Finance; SoD via run states. _Acceptance:_ payroll posts a balanced journal; nets to 422; remittances to 431/447.
**MOD-18 Trainings.** Schedules, calendars, records. _Access:_ HR.
**MOD-19 Talent Pool / Succession.** Succession & continuity planning. _Access:_ HR/Management.
**MOD (self-service).** Employee portal: own payslip, leave requests, SOPs. _Access:_ employee (own record only).

### Group IV — Sales & CRM

**MOD-20 Leads.** Website-API intake + manual. _Grounding:_ `smart_leads`, `quote_requests`. _Access:_ Sales.
**MOD-21 Meeting Management.** Notes, minutes, schedules; Groq voice-to-text attachable (10.4). _Access:_ Sales.
**MOD-22 Marketing Campaign Register.** Campaigns + digital-asset credentials. _Grounding:_ `marketing_campaigns`. _Access:_ Sales/Marketing.
**MOD-23 Proposal Generator.** **AI-assisted** (Gemini) drafting + image integration + document tracking; **human review before send** (10.3). _Grounding:_ `smart_proposals`, `smart_proposal_lines`, `smart_proposal_narratives`. _Access:_ Sales; margins hidden.
**MOD-24 Sales Pipeline.** Visual **Kanban**. _Grounding:_ `sales_opportunity`. _Access:_ Sales; Management sees all + margins.
**MOD-25 Inbound Intake.** 'Contact Us' + Partnership intake. _Grounding:_ `contact_enquiries`, `partnership_requests`. _Access:_ Sales/Admin.
**MOD-26 Project Portfolio Builder.** Sign-off sheet → AI-assisted push to public portfolio/success stories. _Grounding:_ `smart_success_stories`, `success_story_ops_links`. _Access:_ Sales/Management approve.

### Group V — Commercial & Pricing

**MOD-27 Margin Simulator.** Quick tech/commercial quote from costing, no full proposal. _Grounding:_ `marginpricing_simulations`, `_lines`, `_events`. _Features:_ reads Financial-Dictionary rates (MOD-10); shows margin to authorised roles only; feeds the **Pricing Variance Index** later (11.4). _Access:_ Sales/Commercial (price), Finance/Mgmt (full margin). _Acceptance:_ no GL impact **[KB §7]**.
**MOD-28 Extra-Charges Engine Simulator.** Rapid quotes for additional charges only. _Access:_ as MOD-27.

### Group VI — Logistics Operations

**MOD-29 Operations File Registry (the dossier).** _Grounding:_ `operations_file_master` — the rich core (service_type & service_territory enums; BL/MAWB, vessel/flight, incoterm, POL/POD, customs regime, weights, `details_json`, links to opportunity + costing + client). _Features:_ open/manage files; **the 360° file modal** (Section 11.3); creation triggers milestones (MOD-31). _Access:_ Operations; Finance sees costs/margin per 7.3. _Acceptance:_ file is the `dossier_id` cost object on all related journals (8.8).
**MOD-30 Transit Order.** _Grounding:_ `transit_orders` (customs_regime IM4/IM7/IM8/EX1/EX2, service_direction, declared_value, submitted_docs JSON, OT number). _Features:_ create/register/generate with notify. _Access:_ Operations.
**MOD-31 Operational Milestone Tracking.** _Grounding:_ `ops_milestone_template` (versioned per service_type) → `ops_milestone_instance`. _Features:_ stage updates **push to the Client Portal**; QA tickets; evidence documents. _Access:_ Operations; Client (read own).
**MOD-32 Delivery Note.** _Grounding:_ `delivery_notes`. Create/register/manage; PDF. _Access:_ Operations/Warehouse.

### Group VII — Warehouse Management (WMS) — full scope

_Client chose full WMS from day one (some tenants run full warehouses). Client goods are NOT SmartLS inventory — track operationally; only own consumables hit class 3 **[KB §5 class 3 note]**._

**MOD-33 Inbound Operations.** GRN → QA/QC hold & inspection (with certificate) → **directed putaway**. _Access:_ Warehouse.
**MOD-34 Space & Location Management.** Zone / aisle / rack / bin / yard; capacity utilisation. _Access:_ Warehouse.
**MOD-35 Inventory Control & Tracking.** Live stock, state management, audit. _Access:_ Warehouse; Finance (valuation only).
**MOD-36 Outbound Operations.** Pick, pack, dispatch logic. _Access:_ Warehouse.
**MOD-37 Equipment Handling.** Machinery allocation & status. _Access:_ Warehouse/Fleet.
**MOD-38 Audit & Cycle Counting.** Blind cycle counts, discrepancy resolution, **certified Rapport d'Audit**. _Access:_ Warehouse + Management sign-off.

### Group VIII — Fleet Management

**MOD-39 Vehicle / Asset Registry.** Master data & categorisation; links to MOD-54 asset (trucks → COA 245) **[KB §5 class 2]**. _Access:_ Fleet.
**MOD-40 Compliance & Periodic Expenses.** Document mgmt + renewals (insurance, **visite technique**) with an **alert engine** (Event Engine). _Access:_ Fleet; alerts to Fleet/Management.
**MOD-41 Maintenance & Work Orders.** Preventive/corrective, spare-part integration (class 3 consumables). _Access:_ Fleet.
**MOD-42 Dispatch & Allocation.** Assignments, check-out/in logs, live status. _Access:_ Fleet; Operations request.
**MOD-43 Fuel & Usage Tracking.** Odometer, fuel consumption (6053), variance flags. _Access:_ Fleet; cost posts to ledger.
**MOD-44 Driver Management.** Licence/certification tracking + expiry alerts. _Access:_ Fleet/HR.
**MOD-45 Incident & Claim Management.** Accident/insurance claim tracking. _Access:_ Fleet/Management.

### Group IX — Ops Costing (all operations)

**MOD-46 Project Costing.** Built per operation file; **posts to the ledger** and tags `dossier_id`. _Grounding:_ `costing_master`/`costing_line` (SoD states, VAT per line, multi-currency). _Access:_ Operations issue; Finance validate; Management approve **[KB §6.7]**.
**MOD-47 Cost Tracking.** Per file and per **category of disbursement**. _Grounding:_ `cost_tracking_ledger`, `cost_entries`, `view_cost_*`. _Access:_ Operations/Finance.
**MOD-48 Project Cost Reconciliation.** Budget vs actual per dossier. _Access:_ Finance/Management (full margin).
**MOD-49 Project Disbursal.** Cash/payment requests with attached approved costing + budget tracking; **régie d'avance state machine** (581) with justification workflow and aging → 4211 **[KB §6.8]**. _Grounding:_ `cash_request_master/_lines/_payments`, `funds_request_lines`. _Access:_ Operations request; Finance approve/disburse (Approver by limit).

### Group X — Finance & Treasury (+ Accounting core)

_Constraint:_ invoice layout supports **≥ 10–15 lines** (SSDC). All money events auto-post per the KB cookbook **[KB §8]**.

**MOD-50 Proforma & Advance-Payment Invoices.** _Grounding:_ `proforma_invoice` (advance %, payment tracking, unlock/rejection reasons, DIGITAL/PHYSICAL signature). _Accounting:_ client payment of a proforma → **advance (Dr 521 / Cr 4191)**, not revenue **[KB §7, §8.1]**. _Access:_ Finance issue; Validator/Approver.
**MOD-51 Final Invoice.** _Grounding:_ `invoice_master`/`invoice_lines` (dict_code lines, currency+rate, statuses incl. ISSUED_LOCKED, approval workflow, pdf_vault_id). _Accounting:_ recognise revenue → **Dr 411 / Cr 706 + Cr 4432**, clear advance (4191) and débours (4731) **[KB §6.3, §8.3]**. _Access:_ Finance; SoD. _Acceptance:_ débours lines carry **no VAT** and hit **no class 6/7**; turnover excludes débours.
**MOD-52 Smart Receivables Ledger.** _Grounding:_ `receivables-ledger`, `payment_receipts` (methods incl. MOBILE_MONEY, allocation, document_dna_hash, POSTED_LOCKED), `payment_receipt_allocations`. _Features:_ ageing, allocations, reminders. _Access:_ Finance.
**MOD-53 Project Financing.** Financing linked to dossiers; ledger view. _Grounding:_ `debt_engagements`, `debt_repayments`, `working-capital-recovery`. _Access:_ Finance/Management.
**MOD-54 Asset Management.** Lifecycle: acquisition → **barcode/tag** → **depreciation** (auto OHADA posting 681/28xx) → disposal (HAO 81/82) **[KB §8.8–8.10, §11]**. _Access:_ Finance/Accountant.
**MOD-55 Journal Entries (OHADA).** Manual + auto journals; tagged to journal (Achats/Ventes/Banque/Paie/OD) and `dossier_id`; **balanced or rejected**; **reversal-not-edit** (8.5) **[KB §3, §8]**. _Access:_ Accountant; SoD.
**MOD-56 General Ledger.** Grand livre, trial balance (balance), account drill-down — derived from journals **[KB §13]**. _Access:_ Accountant/Finance/CEO/Auditor(read).
**MOD-57 Income Statement / MOD-58 Profit & Loss / MOD-59 Cash-Flow Statement** + **Bilan, Compte de résultat, TAFIRE, Notes annexes** (full **Système normal**) with a **guided monthly close** **[KB §12]**. _Acceptance:_ statements reconcile to the trial balance; opening = prior close (intangibility).

_(Tax outputs — TVA return, IS/minimum tax, withholding, **DSF dataset**, CNPS — are produced from the ledger per **[KB Part B]** and Section 12.4.)_

### Group XI — Procurement

**MOD-60 Purchase Orders.** _Grounding:_ `purchase_order_master` (expense_category OPERATIONS/OVERHEAD, file_reference, momo, issuer/approver auth ids, security_hash, unlock workflow), `purchase_order_items`. _Access:_ Procurement issue; Approver by limit.
**MOD-61 Goods Received.** GRN; **three-way match** (PR ↔ PO ↔ GRN ↔ supplier invoice) before posting **[KB §8.5]**. _Access:_ Procurement/Warehouse/Finance.
**MOD-62 Purchase Requests.** Request → approval → PO. _Access:_ any dept request; Approver.

### Group XII — Document Vault & Data Insights

**MOD-63 Reporting & Insights.** Role dashboards + fixed reports + Excel/PDF export (sales pipeline, ops status, receivables ageing, cash position, per-dossier margin). _Access:_ per role/field rules.
**MOD-64 File Repository (Vault).** _Grounding:_ `document_vault_master` (doc_uuid, file_context OPS/OVH, folder_ref, doc_type, storage_path, version_no, status PENDING/VERIFIED/REJECTED/ARCHIVED, audit_log). Central store for all files; 10-year retention **[KB §1]**. _Access:_ per module/scope.
**MOD-65 Compliance Checker.** Auto-flags missing evidence/supporting docs (e.g. dossier without BL; unjustified régie d'avance aging **[KB §6.8]**). _Access:_ Compliance/Management alerts.
**MOD-66 Document Verification (QR).** Public/internal QR verification page that re-checks the content hash (8.4). _Access:_ public (scoped) + internal.

### Group XIII — System Clearance & Security

**MOD-67 IAM.** The RBAC engine (Section 7): root/tenant-admin/user tiers; roles/capabilities/scopes/CRUD/field rules; **Watch-the-Watcher** (5.7). _Access:_ Super Admin (watched).
**MOD-68 Session Management.** _Grounding:_ `active_sessions`. Live sessions + **remote kill**, 30-min auto-logout, health. _Access:_ Super Admin; user (own).
**MOD-69 Immutable Ledger.** The append-only audit trail (8.6); filter by user/action/date/IP/module. _Access:_ read-only; Auditor time-boxed.
**MOD-70 Settings.** System-wide config incl. **Appearance/white-label** (5.4), sandbox interval (5.5), tax rates, numbering, email senders, feature toggles, workflow/approval limits, org/compliance. Detail in Section 12. _Access:_ Super Admin (changes are watched).

## 10. AI, automation & the Universal Event Engine

### 10.1 Principles

- **No RAG / no vector store.** The assistant is grounded by **function-calling** into the tenant's own API (10.2), not by retrieval.
- **The AI never exceeds the user.** Every AI action runs with the calling user's permissions and scope; it can only read/do what that user already can, and sensitive fields are redacted before any external call (10.5).
- **Human-in-the-loop for anything that writes or sends.** Drafts and agentic actions require explicit confirmation (10.3).

### 10.2 Context via function-calling

The assistant is given a **whitelisted tool catalogue** — typed functions like `get_operation_file(ref)`, `list_supplier_invoices(dossier)`, `create_purchase_order(payload)`. DeepSeek (reasoning) plans; the backend executes the tool with the user's identity. This yields grounded answers with minimal data exposure and no retrieval infrastructure.

### 10.3 The Zod validation gate (safe agentic actions) **[NEW — per client direction]**

**[RULE]** Between LLM output and the user confirmation screen sits a strict **Zod** schema-validation layer:

1. The AI proposes an action as JSON (e.g. the `create_purchase_order` payload).
2. The backend validates it against the **exact Zod schema** for that action **and** against **business rules** (vendor exists, account/dictionary item valid, amount within the user's approval limit, tenant/scope correct).
3. On failure, the agent must **self-correct via a recursive re-prompt** — **capped at 2 retries** — and if still invalid, the flow **falls back to a pre-filled manual form**. **The user never sees a broken or hallucinated payload.**
4. On success, a **human-readable action card** is shown; only on explicit confirm does the whitelisted function run. Every step is logged (10.5).

### 10.4 Provider routing, content & voice

A thin internal **AI service** routes by job, swappable by config:

- **Gemini** — content generation (MOD-23 proposals, narratives, client emails) and **document-vision extraction** (MOD-30/OCR) with confidence + human confirmation.
- **DeepSeek** — the reasoning/agentic assistant (10.2/10.3).
- **Groq** — **voice-to-text**: voice notes/meetings transcribed and attached to the relevant record (quote, client, dossier).

### 10.5 AI governance (cost, rate, privacy)

- **[RULE]** Per-feature **usage caps** and rate-limits; per-tenant key scoping where billing must separate; **all AI calls logged** (prompt metadata, action, user, cost) to the immutable ledger.
- **[RULE] PII/financial redaction** before any external model call (mask salaries, bank numbers, personal IDs unless essential and permitted).
- Sandbox mode uses a hard low cap or a mock provider to avoid burning credits (5.5).

### 10.6 Universal Event Engine **[NEW — first-class]**

The backbone that standardises "**Trigger → Act → Approve**", notifications, compliance flags, and AI worksheets across all 70 modules.

- **Standardised events** (`entity.action`, e.g. `invoice.issued`, `costing.approved`, `permission.changed`, `vehicle.insurance.expiring`, `advance.aged_unjustified`). Modules **register their events** so new modules auto-appear in workflow/notification config.
- Events drive: notifications (in-app/email/SMS/WhatsApp), workflow steps & approvals, the Smart Compliance Layer flags, dashboard/portal live updates, and the immutable ledger.
- **[RULE]** Security-critical events (permission changes, God-Mode, role edits, field-visibility changes) are high-priority, immutable, and notify CEO/Management (5.7).

### 10.7 AI-assisted execution worksheets

Per the PRD's vision: an event can generate an **execution card** covering **Print → Sign → Mail → WhatsApp**, with **secure tokenised URLs** for remote approval (time-boxed, single-use, logged). Used for exec sign-offs and field approvals.

---

## 11. Signature features

### 11.1 Portals (external, scoped) **[KB §1 retention applies]**

- **Client Portal (5.1).** Live project/milestone view (fed by MOD-31), sprint tracker & QA feedback, document vault (own docs), **secure messaging with certified PDF export of the chat**, onboarding command centre, and **self-service quoting/booking**. _Scope:_ only the client's own data.
- **Investor / Board Terminal (5.2).** Read-only KPIs & financial statements (optional IFRS view); no operational detail.
- **Audit Terminal (5.2).** Time-boxed, read-only access to records + the immutable ledger, with a **data room** for document requests/answers.

### 11.2 Support & Feedback dashboard **[NEW — per client direction]**

An in-app channel where **tenants reach Praxis directly**: raise support tickets, report bugs, and submit feature requests/improvements, each with status (`NEW → TRIAGED → IN_PROGRESS → SHIPPED/DECLINED`). Visible to the tenant's admins; aggregated on the Platform console to feed the Praxis roadmap. Optional CSAT on resolution.

### 11.3 The Operations-File 360° modal **[NEW — per client direction]**

From MOD-29, opening a dossier reveals a **single modal that tells the whole story of the file**:

- **Header:** reference, client, service_type/territory, route (POL/POD), incoterm, vessel/flight/BL/MAWB, ETA/ATA, current stage.
- **Milestones:** the full timeline (MOD-31) with who updated what and when.
- **People:** assigned Operations/Sales owners; who issued/validated/approved each linked document.
- **Money (role-gated):** linked costing (MOD-46), **payments made** (disbursals/débours via MOD-49, supplier POs), invoices & receipts (MOD-50/51/52), and — **for authorised roles only** — budget vs actual and **dossier margin** (débours excluded). Sales/Ops see costs-incurred and status but **not** net profit (7.3).
- **Documents:** every vault file tied to the dossier (MOD-64) + compliance flags (MOD-65).
- **Comms:** the working-group thread for this file (11.5).
- **Audit:** the immutable-ledger slice for this dossier.
  **[RULE]** Every element respects field-level confidentiality; the same modal shows different money detail to Finance vs Sales.

### 11.4 Pricing Variance Index (bridge Sales ↔ Ops without exposing margin) **[NEW — per client direction]**

On **closed/won** jobs, Sales see a **derived variance metric** comparing their quick-simulator price (MOD-27/28) to the **real Ops costing** (MOD-46/48): a **Red/Yellow/Green** flag and/or a **% variance**.

- **[RULE]** It is a **computed indicator emitted by the finance boundary** — Sales **never** see supplier cost rates or net profit. Green = quote closely matched actual cost; Red = significant under/over-pricing. Helps Sales calibrate future quotes while margins stay confidential (7.3).

### 11.5 Smart Comms Portal (corporate, WhatsApp-style) **[per client direction]**

- **Real-time messaging over WebSockets**, working groups per department/project/dossier, **media sharing < 10 MB**, lazy-loaded history, read receipts, presence.
- **No in-app calling.** A contact's phone opens **`wa.me`** (WhatsApp) or a **`tel:`** dialler; email opens **`mailto:`**. The feel is "WhatsApp for the company", but corporate and auditable.
- Client-facing threads can be exported as a **certified PDF** (8.4). _Access:_ internal users (their groups); Client (own thread only); Super Admin sets policy/export.

## 12. Settings module (MOD-70) — the configuration hub **[NEW — per client direction]**

Everything configurable lives here and **pushes to the running app** (no redeploy). Provisioning of a _new tenant_ happens on the **Platform console** (separate from a tenant's own settings, per client direction). Tenant settings sections:

### 12.1 Appearance / white-label (5.4)

Company name; **light & dark logos**; favicon & PWA icons; primary/secondary/accent colours (live CSS variables); font set; login/splash reveal text; the subtle "Powered by JBS Praxis LLC" line. Live preview before save; changes versioned.

### 12.2 Company & legal identity

HQ address, phone, official email; **TIN/NIU, RCCM**; bank details block; document-numbering prefixes (SLAS/SLS); default language (EN/FR); fiscal year.

### 12.3 Operations & workflow config

Organigramme (departments, approvers); dynamic workflows (**Trigger → Act → Approve**); approval limits by amount/role; the **Smart Compliance Layer** toggles (ISO 9001 / ICS / ESG, SoD); milestone-template management per service_type (MOD-31); régie-d'avance policy window (KB §6.8); sandbox wipe interval (5.5).

### 12.4 Finance & tax config **[KB Part B]**

Chart-of-accounts seeding/management (MOD-06); Financial-Dictionary & posting rules (MOD-05/8.7); **tax rates & codes, effective-dated** (TVA 19.25%, WHT 2.2%/5.5%, min tax, CNPS, IRPP/CAC/CFC) with a January re-validation reminder; currencies & FX (MOD-08); treasury accounts (MOD-09); HT/TTC quote default **[KB §6.3]**. **Tax outputs:** TVA return, IS/minimum-tax computation, withholding, **DSF dataset**, CNPS declaration — all generated from the ledger; each output is a report + export, not a re-keyed form.

### 12.5 Communications & email

Per-tenant **SMTP** & sender identities (5.9); SPF/DKIM/DMARC status; notification channel prefs (in-app/email/SMS/WhatsApp); WhatsApp/`wa.me` and `tel:`/`mailto` behaviour (11.5).

### 12.6 Integrations & keys

Managed references to AI providers (Gemini/DeepSeek/Groq) and exchangerate-api — **keys stored server-side in `.env`/secret store, never shown in the UI** (Appendix A); per-feature AI caps (10.5).

### 12.7 Feature toggles

Enable/disable module groups per tenant (e.g. a tenant without a fleet hides Fleet), per their plan.

---

## 13. Multi-entity & consolidation

- A tenant may hold several **corporate entities** (MOD-01), each with its own books, TIN/RCCM and statements.
- Master data, journals and statements are **entity-scoped**; inter-company uses class 18 **[KB §5]**.
- **Consolidation** (group view across entities) is an optional read layer for Management/Investor terminals; not a statutory consolidation in v2 unless required.

---

## 14. Non-functional requirements

- **Performance/scale:** target ~20–50 concurrent users per tenant with OCR/AI/report bursts on the starting box; heavy jobs (PDF, OCR, reports, AI) run on **queues/workers**, never inline. p95 API < 400 ms for standard reads. (Confirm real user counts to finalise sizing.)
- **Availability:** single-node to start; DR per 6.3; scale path per 6.4.
- **Security testing:** dependency scanning, secret scanning in CI, periodic pen-test before go-live; OWASP ASVS L2 targets; all inputs Zod-validated; parameterised queries only.
- **Internationalisation:** **full EN/FR** — UI, generated documents, and **data-level** labels (service/account/milestone names) stored bilingually; per-user language; localised number/date/**XAF** formatting; French for statutory output **[KB §1 language]**. Reuse the existing website EN/FR dictionaries; a defined step keeps both in sync on every change.
- **Accessibility:** WCAG 2.1 AA targets; keyboard navigable; sufficient contrast in both themes.
- **Auditability:** every financial figure traces to its journal(s); every document to its actor, hash and vault copy.

---

## 15. Frontend & PWA

### 15.1 UX principles

- The **dossier (operation file) is the centre of gravity** — most work radiates from the 360° modal (11.3).
- One screen per function, permissions decide what's shown (no role-copied screens).
- White-label theming (5.4), dark/light, bilingual toggle in the top bar; global sidebar + top bar (clock-in, avatar, notifications, **floating AI assistant** + Smart Comms).
- Fast, keyboard-friendly, mobile-responsive; financial figures in the mono font.

### 15.2 PWA & offline scope

- Installable PWA with per-tenant manifest (5.4).
- **Offline for field tasks only:** view assigned operations, capture delivery/evidence, warehouse scans (GRN/pick/count) — queued locally and **synced when back online**, with clear pending/failed states. **[RULE]** Accounting and anything that posts to the ledger is **online-only** (no offline double-posting).

---

## 16. Data migration (MySQL → PostgreSQL)

- **Timing:** migration runs **after** the build is complete and validated, and is **owned by the client** (with our tooling/support). It is **not** part of the build phase.
- **Approach (hybrid):** re-model and cleanly map **core financial + master data** (clients, suppliers, employees, operation files, costings, invoices, payments) into the new schema, **de-duplicating** the twin tables; lift-and-shift low-risk peripheral data; reconcile in a **staging** schema with sign-off before cut-over.
- **Opening balances:** because the old system has no ledger, accounting **opening balances** are entered as an opening journal (per the accountant), not migrated from journals that don't exist. Historical documents are attached for reference.
- **Storage watch-point:** if documents stay on local disk for now, plan the move to S3-compatible object storage before the vault outgrows the 75 GB or the 3rd tenant lands (5.1/6.2).

---

## 17. Delivery roadmap (phased)

Phasing is around the **accounting core first** (the biggest gap), running old and new briefly in parallel; big-bang is explicitly rejected.

1. **Phase 0 — Foundations.** Monorepo, CI/CD, Docker, auth/2FA/sessions, **RBAC policy engine**, multi-tenancy (schema-per-tenant), white-label theming, Settings, immutable ledger, Event Engine skeleton, **Test/Live sandbox**.
2. **Phase 1 — Accounting spine.** COA + Financial Dictionary + Posting Rules, Journals/GL, treasury, tax engine, statements + DSF **[KB]**; PDF service; email/SMTP.
3. **Phase 2 — Commercial cycle.** Master data, Operations file + milestones + 360° modal, Costing, Proforma/Invoice/Receivables (auto-posting), Procurement.
4. **Phase 3 — People & assets.** HR/Payroll (auto-post), Fleet, WMS.
5. **Phase 4 — Intelligence & reach.** AI assistant (Zod-gated) + voice + vision, Pricing Variance Index, Portals (Client/Investor/Audit), Support dashboard, Comms, Reporting/BI.
6. **Phase 5 — Hardening & migration.** Pen-test, performance, restore drills; client-run data migration; go-live (hide Test/Live toggle).

---

## 18. Acceptance / definition of done (samples)

- **[DoD]** Trial balance balances at all times; a débours line never adds VAT or turnover **[KB §6]**.
- **[DoD]** A proforma payment posts to **4191** (advance), and only the final invoice recognises revenue to **706 + 4432** and clears 4191/4731 **[KB §7/§8.3]**.
- **[DoD]** A posted invoice cannot be deleted; the only removal path is a reason-bearing reversal on the immutable ledger; God Mode refuses ledger-connected records (8.5).
- **[DoD]** Changing any user's permission fires an immutable, high-priority CEO/Management alert; a Super Admin cannot self-grant Issuer/Validator/Approver in Live (5.7).
- **[DoD]** An AI-proposed action that fails Zod validation is never shown as a broken card; it self-corrects (≤2) or falls back to a manual form (10.3).
- **[DoD]** Two tenants run with zero data bleed; sandbox wipe never touches Live (5.3/5.5).
- **[DoD]** Every generated invoice/PO/payslip/statement is a white-labelled bilingual PDF, hashed, vault-stored, QR-verifiable, and emailed from a monitored sender (5.9/5.10/8.4).

---

## 19. Appendices

### Appendix A — Environment variables & keys (`.env.example`)

**[RULE]** Real values live only in the server's `.env` / secret store and are **never committed**. **The Gemini, Groq, DeepSeek and exchangerate-api keys shared during discovery are considered exposed and MUST be rotated before use.** Keys are added per environment (and per tenant where billing must separate).

```dotenv
# ---- Core ----
NODE_ENV=production
APP_BASE_DOMAIN=praxisls.com          # tenants resolve as <tenant>.praxisls.com
PORT=8080
JWT_ACCESS_SECRET=__rotate_me__
JWT_REFRESH_SECRET=__rotate_me__
SESSION_INACTIVITY_MIN=30

# ---- PostgreSQL ----
DATABASE_URL=postgresql://app:__pw__@postgres:5432/praxisls
DB_PLATFORM_SCHEMA=platform

# ---- Redis / queue ----
REDIS_URL=redis://redis:6379

# ---- AI providers (ROTATE the discovery keys) ----
GEMINI_API_KEY=__rotate_me__          # content + document vision (MOD-23/30)
DEEPSEEK_API_KEY=__rotate_me__        # reasoning / agentic assistant
GROQ_API_KEY=__rotate_me__            # voice-to-text
AI_MONTHLY_CAP_USD=__set__            # per-feature caps enforced in code (10.5)

# ---- FX ----
EXCHANGERATE_API_KEY=__rotate_me__    # exchangerate-api, USD base
FX_SYNC_CRON=0 0 * * *                # daily midnight (MOD-08)

# ---- Email / SMTP (per-tenant senders configured in Settings) ----
SMTP_HOST=__host__
SMTP_PORT=587                         # 587 STARTTLS or 465 SSL
SMTP_USER=__user__
SMTP_PASS=__rotate_me__
MAIL_DEFAULT_FROM_NAME="SmartLS Billing"
MAIL_BILLING_FROM=billing@smartls.cm  # monitored, NOT noreply
MAIL_DOCUMENTS_FROM=documents@smartls.cm
MAIL_SUPPORT_REPLYTO=support@smartls.cm

# ---- Storage (abstracted; local now, S3-compatible later) ----
STORAGE_DRIVER=local                  # local | s3
S3_ENDPOINT=                          # e.g. Hetzner/Backblaze/Wasabi/MinIO (non-AWS)
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# ---- PDF ----
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium   # Chromium installed in the worker image
```

**Chromium install (PDF worker Dockerfile note):** install `chromium` + fonts (`fonts-liberation`, `fonts-noto`, `fonts-noto-cjk` optional) and the shared libs (`libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libgbm1 libasound2`). Set `PUPPETEER_SKIP_DOWNLOAD=1` and point Puppeteer at the system Chromium.

### Appendix B — Standard status enums & numbering **[FROM CODEBASE]**

- Financial-document lifecycle: `DRAFT → SUBMITTED_FOR_VALIDATION → SUBMITTED_FOR_APPROVAL → APPROVED_LOCKED / ISSUED_LOCKED / POSTED_LOCKED → UNLOCK_REQUESTED → CANCELLED / REVERSED`.
- Payroll run: `OPEN → COMPUTED → SUBMITTED → APPROVED → VALIDATED → DISBURSED` (+ `REJECTED`).
- Document numbering: `{PREFIX}-{MODULE}-{YYYY}-{NNNN}` via `doc_sequences(module_key, year, seq)`, separate sequences per tenant **and** per environment (Live/Sandbox).
- Service taxonomy (drives milestones/costing): `service_type` ∈ {SEA/AIR*FREIGHT_IMPORT/EXPORT, HINTERLAND_TRANSIT, INLAND_TRANSPORTATION, WAREHOUSING, END_TO_END*\*, BUSINESS_REPRESENTATION}; `service_territory` ∈ {DOMESTIC_INLAND, PORT_AIRPORT_ZONE, INTERNATIONAL_IMPORT/EXPORT, TRANSIT_HINTERLAND, END_TO_END_INTERNATIONAL}.

### Appendix C — Companion documents

- **OHADA/Tax Knowledge Base** — the accounting/tax source of truth (chart of accounts, débours model, journal cookbook, payroll, VAT, fixed assets, statements, tax center, data model, validation rules). Cited throughout as **[KB §n]**.
- **Super-Admin User Journey & RBAC** — the human-readable access map this PRD encodes in Section 7.

### Appendix D — Open items to confirm with the client

1. Real concurrent-user counts (now and 2-year) to finalise sizing (14).
2. Each tenant's sending domain + DNS (SPF/DKIM/DMARC) for email (5.9).
3. HT-on-top vs TTC as the default quote model **[KB §6.3]** (recommended: HT-on-top).
4. Whether Investor terminal needs a true IFRS view or KPIs suffice (3.2/13).
5. Object-storage provider decision before the vault outgrows local disk (16).
6. Confirm fuel/asset VAT recoverability specifics with the expert-comptable **[KB §8.7 VERIFY]**.

---

_End of PRD v2.0. This specification is complete for build. Accounting mechanics are governed by the companion Knowledge Base; access rules by the companion User-Journey/RBAC document. Change control: version this file; material changes require CEO + engineering sign-off._
