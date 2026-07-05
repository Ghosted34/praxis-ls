# Praxis LS — Work To Be Done

Derived from the PRD (Master Functional Spec v2) and the kickoff meeting. Organised by delivery phase, per the accounting-first roadmap (no big-bang cutover). Update statuses as work lands; this file is the running backlog, not a historical record — the transcript/PRD stay unchanged as source of truth.

## Immediate / pre-build (from kickoff)

- [ ] Victor: create the GitHub repo (PR-based workflow) and publish the initial README
- [ ] Victor: confirm/collect GitHub accounts for repo access
- [ ] Blake: share all source docs (PRD, OHADA KB, RBAC/User-Journey, Lovable FE export, MySQL `.sql` dump, meeting recording) into the group/`doc/` folder
- [ ] Blake: prepare yearly contracts; deposit advances
- [ ] Blake: fund Claude Pro accounts per engineer
- [ ] Blake: create the team WhatsApp group
- [ ] David: review the full kickoff recording (missed logistics & sales portions)
- [ ] All: rotate every AI/FX provider key shared during discovery (Gemini, DeepSeek, Groq, exchangerate-api) before first use — treat as compromised

## Phase 0 — Foundations

- [ ] Monorepo scaffold (pnpm/Turborepo): `apps/api`, `apps/web`, `apps/workers`, `packages/shared`
- [ ] Docker Compose for local dev; Dockerfiles for `api`, `web`, `worker-jobs`, `worker-ai`, `worker-pdf`, reverse proxy (Caddy/Nginx, auto TLS)
- [ ] CI/CD: lint, type-check, unit/integration tests on every merge; staged promotion (local → staging → prod)
- [ ] Auth: Argon2id password hashing, JWT access+refresh, 2FA (TOTP), 30-min inactivity auto-logout, Redis session store with remote kill
- [ ] RBAC policy engine: Role × Capability (Issuer/Validator/Approver) × Scope × per-module CRUD × field-level visibility, as configuration data
- [ ] Seed default role × module-group access matrix and the Issuer/Validator/Approver-by-document-type table from `doc/SuperAdmin_UserJourney_RBAC.docx` (Tenant Super Admin can tune per tenant); implement `Line Manager` as a capability layered on any role, not a standalone role
- [ ] Multi-tenancy: **one Postgres database per tenant** (not schema-per-tenant in a shared cluster) + shared `platform` database; per-tenant connection registry; subdomain resolution middleware; tenant-context guard on all queries
- [ ] Tenant provisioning tooling: script/CLI to create a new tenant database, run the full migration set against it, and seed branding + COA — this replaces a one-line schema-create, so build it as first-class tooling, not a manual step
- [ ] Platform console (Praxis-only): create/suspend tenants, assign subdomain + database, seed branding + COA, set capacity, toggle tenant Live
- [ ] White-label theming: Settings → Appearance, light/dark logos, colour tokens as CSS vars, per-tenant PWA manifest
- [ ] Test/Live sandbox: Live + Sandbox environment inside each tenant's own database, top-bar toggle, TEST MODE banner, sandboxed side-effects, configurable wipe cron (default 14 days)
- [ ] Oso RBAC integration: model roles/capabilities/scopes as Oso policy data; guard/interceptor layer that calls `oso.authorize()` per endpoint + field resolver
- [ ] Immutable ledger service (append-only, filterable by user/action/date/IP/module)
- [ ] Universal Event Engine skeleton: event registration API, standardised `entity.action` naming
- [ ] Watch-the-Watcher: permission/role/God-Mode change → high-priority immutable event + CEO/Management notification; block Super Admin self-granting Issuer/Validator/Approver in Live
- [ ] Two-tier deletion model: everyday **soft-delete** (any authorised user; restore requires a second admin's co-approval) distinct from **God Mode hard purge** (CEO + PIN only, refuses ledger-connected records, full removed payload logged to the immutable ledger)

## Phase 1 — Accounting spine

- [ ] Chart of Accounts (OHADA/SYSCOHADA) seeded per tenant/entity — full 4-digit reference chart, hierarchical (`chart_of_accounts.parent_code`), `is_postable` / `requires_analytic` flags per account
- [ ] Financial Dictionary as a distinct layer from the COA (`dictionary_item` table: code, labels, category, `is_debours`, price/currency/shipping-line) — never duplicate the account hierarchy inside it
- [ ] `posting_rule` table (the account-determination glue): dictionary item → debit/credit accounts + `tax_code` + context (sale/purchase/disbursement); reject saving a dictionary item without a complete mapping
- [ ] Ledger engine invariants (hard-reject on violation): balanced entries, one side per journal_line, postable-leaf-only, débours never in class 6/7 or VAT-bearing, no compensation, advance≠revenue, gap-free `entry_no`, mandatory `source_doc_ref`, `dossier_id` required on 4731/706/707/direct-cost lines, tax postings pinned to the `tax_code` version effective at entry date
- [ ] Reversal-not-edit: validated journal entries are immutable; corrections are linked reversal+replacement entries (`source = HUMAN_CORRECTION`, `corrects_entry_id`)
- [ ] Régie d'avance aging: cash advance (581) auto-reclassifies to holder receivable (4211) — never auto-allocated to 4731 — past its policy window; Compliance Checker flags it
- [ ] Tax Jurisdiction module: versioned `tax_code` table (kind, rate_percent, base_rule, recoverable, COA posting links, `effective_from/to`) seeded with TVA 19.25%, WHT 2.2%/5.5%, IS 33%/minimum tax 2.2%/5.5%, CNPS (pension 4.2% EE / family 7% ER capped, injury 1.75–5% ER), CFC 1%/1.5%, FNE 1%, IRPP bracket table, CAC 10% — effective-dated, never overwritten
- [ ] Journals & General Ledger (manual + auto-posted, balanced-or-rejected, reversal-not-edit)
- [ ] Treasury accounts: bank, cash, mobile-money wallets (MTN/Orange) mapped to COA
- [ ] Statements: Bilan, Compte de résultat, TAFIRE, Notes annexes, guided monthly close
- [ ] Tax Center outputs: TVA return, IS/minimum tax, withholding, DSF dataset, CNPS declaration
- [ ] PDF worker (Puppeteer + Chromium, bilingual templates, Noto fonts, mono font for figures) + document vault storage + QR verification hash
- [ ] Email/SMTP service: per-tenant sender identities, SPF/DKIM/DMARC verification, queued+retried sends, delivery logging

## Phase 2 — Commercial cycle

- [ ] Master data: corporate entities, employees, client master (KYC, credit limit), supplier master (incl. mobile money)
- [ ] Currency & live FX: exchangerate-api daily cron, per-transaction stamped rate, manual override/fallback
- [ ] Operations File Registry (the dossier) + service_type/service_territory taxonomy
- [ ] Milestone engine: versioned templates per service_type → instances, push to Client Portal
- [ ] Operations-File 360° modal (header, milestones, people, role-gated money, documents, comms, audit)
- [ ] Transit orders, delivery notes
- [ ] Project costing (posts to ledger, tagged `dossier_id`), cost tracking, cost reconciliation, project disbursal (régie d'avance state machine)
- [ ] Margin Simulator / Extra-Charges Simulator (no GL impact)
- [ ] Proforma & advance-payment invoices (advance posts to 4191, not revenue)
- [ ] Final invoice (revenue recognition, clears advance + débours, débours carry no VAT)
- [ ] Smart Receivables Ledger (ageing, allocations, reminders)
- [ ] Procurement: purchase requests → POs → goods received with three-way match

## Phase 3 — People & assets

- [ ] HR: contracts, KPI appraisals, attendance, leave/allowances, SOPs/onboarding, trainings, succession, employee self-service portal
- [ ] Payroll: CNPS + IRPP/CAC/CFC/RAV auto-compute, payslip generation, auto-posted payroll journal, SoD via run states
- [ ] Fleet: vehicle/asset registry, compliance & renewal alerts (insurance, visite technique), maintenance/work orders, dispatch, fuel tracking, driver management, incident/claim tracking
- [ ] Warehouse (WMS): inbound/GRN + QA hold + putaway, space/location management, inventory control, outbound (pick/pack/dispatch), equipment handling, cycle counting with certified audit report
- [ ] Asset management: acquisition → depreciation (auto-posting) → disposal

## Phase 4 — Intelligence & reach

- [ ] AI service layer: **DeepSeek as primary provider** (reasoning/agentic, content, document vision) with **Gemini as automatic fallback**; **self-hosted Whisper** primary / **Groq** fallback for voice-to-text; per-tenant AI EMV toggle (front-end UI flag + back-end action flag) and per-tenant spend dashboard
- [ ] Zod validation gate for AI-proposed actions (self-correct ≤2 retries → manual form fallback); action-card confirmation flow
- [ ] AI governance: per-feature usage caps, PII/financial redaction before external calls, full AI-call logging
- [ ] Pricing Variance Index (Sales-visible R/Y/G variance vs. real Ops costing, no raw cost exposure)
- [ ] Portals: Client (milestones, docs, secure messaging, self-service quoting), Investor/Board (read-only KPIs/statements), Audit Terminal (time-boxed, data room)
- [ ] Support & Feedback dashboard (ticket lifecycle, feeds Praxis roadmap)
- [ ] Smart Comms Portal (WebSocket messaging, working groups, media sharing, certified PDF export of threads)
- [ ] Reporting & Insights dashboards (per-role, Excel/PDF export)
- [ ] Settings module (MOD-70): full configuration hub across appearance, legal identity, workflow, finance/tax, comms, integrations, feature toggles

## Phase 5 — Hardening & migration

- [ ] Security: dependency + secret scanning in CI, penetration test, OWASP ASVS L2 pass
- [ ] Performance: load-test to target concurrency (confirm real user counts with client), p95 API < 400ms on standard reads
- [ ] Backup/DR: automated daily encrypted backups of every tenant's full Postgres database + the platform database, shipped to Google Drive/OneDrive initially (path to S3 later), monthly restore-test drills, WAL-based PITR for finance data
- [ ] Data migration tooling: MySQL → PostgreSQL, core financial/master data re-modelled and de-duplicated, staging reconciliation, client sign-off before cutover (client-owned, post-build)
- [ ] Go-live: Platform Root Admin marks tenant Live, Test/Live toggle hidden from tenant users

## Open questions to resolve before/during build

- [ ] Per-tenant encryption keys: mint per tenant vs. hashed-in-DB (not settled)
- [ ] Maps provider: free-tier now, migrate to Google Maps later — provider TBD
- [ ] "Validate Invoice" vs "Approve Invoice": one combined event or two in the Universal Event System
- [ ] Finalize pricing/setup process for the tenant-owned-Postgres-access add-on (isolation itself is now default — one DB per tenant; this open item is only about handing the tenant admin credentials to their own instance, indicative ~2–3M XAF setup + ~500k/yr)
- [ ] Real concurrent-user counts (now and 2-year) to finalise server sizing
- [ ] Each tenant's sending domain + DNS (SPF/DKIM/DMARC) — needed before live email
- [ ] HT-on-top vs TTC as default quote model (recommended: HT-on-top)
- [ ] Whether the Investor terminal needs a true IFRS view or KPIs alone suffice
- [ ] Object-storage provider decision before local disk outgrows capacity
- [ ] Fuel/asset VAT recoverability specifics — verify with the expert-comptable
- [ ] Which tenants get a website package (build-from-scratch vs. connect-existing) and pricing
