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

> Status below was verified against the actual code/migrations on 2026-07-07
> (not assumed from this doc or the README — several lines here were stale).
> See `doc/RBAC_SECURITY_KICKOFF.md` for the full audit trail behind the
> Auth/RBAC lines. Anyone picking up an unchecked item: re-verify before
> starting, this list rots fast in a repo this size.

- [x] Monorepo scaffold — done, plain npm workspace (`src/`, `migrations/`, `scripts/`), not the pnpm/Turborepo `apps/*` layout this line describes. Works; just not literally as specced. `client/` does not exist yet (see Phase 2+ / frontend note at the bottom).
- [x] Docker Compose for local dev (`docker-compose.yml`: postgres/pgvector, redis, api, worker) + a root `Dockerfile`. No separate `worker-ai`/`worker-pdf`/reverse-proxy containers — one `worker` service covers all queues for now.
- [ ] CI/CD — not started. `.github/workflows/deploy.yaml` exists but is an empty placeholder (1 line) — correcting an earlier pass of this doc that said the folder didn't exist at all; it does, it's just empty.
- [ ] Auth — **partially done as of this kickoff**:
  - [x] Argon2id password hashing (verified in `auth.service.js`, `godmode.service.js`)
  - [x] JWT access+refresh (`src/modules/security/auth/` — login/refresh are real)
  - [ ] 2FA (TOTP) — `app_user.totp_secret_enc`/`is_2fa_enabled` columns exist; login throws `501` on a 2FA user. Needs a pending-2FA-token design decision before building (see TODO in `auth.service.js`).
  - [ ] 30-min inactivity auto-logout — `SESSION_INACTIVITY_MIN` is configured but not enforced anywhere.
  - [ ] Redis session store with remote kill — sessions are written to Postgres (`user_session`) on login/logout; no Redis-backed active-session store, no dedicated "kill this session remotely" endpoint (only generic CRUD via the `session` module).
- [ ] RBAC policy engine — **schema was already there; API layer was not, now is**:
  - [x] `role`/`capability`/`scope`/`permission`/`field_visibility` tables + `user_role`/`user_capability`/`user_scope` (pre-existing, `migrations/tenant/0110_rbac.sql`)
  - [x] Admin CRUD + auth/RBAC gating for all five, now via `src/modules/security/{iam_role,capability,scope,permission,field_visibility}` (the last four added this kickoff — `iam_role` itself still isn't gated, see below)
  - [ ] `iam_role`/`session`/`audit_ledger`/`setting` still use the ungated `makeRouter()` — no `authMiddleware`/`requirePermission` on them yet, unlike the four new modules
  - [ ] Record-level scope (`own`/`team`/`all`) enforcement — `scope`/`user_scope` tables exist but nothing reads them yet; every grant is currently treated as full-module access
- [ ] Seed default role × module-group access matrix from `doc/SuperAdmin_UserJourney_RBAC.docx` — **not done**. Zero `permission` rows are seeded for any of the 11 default roles (confirmed by reading every seed file). A freshly provisioned tenant has no one who can do anything except a manually-bootstrapped `CEO` user (bypasses RBAC by design — see `scripts/tenant/create-admin.js`). This is the next real blocker: without it, RBAC has an API but no actual grants to manage for non-CEO roles.
- [ ] `Line Manager` as a capability layered on any role — `is_line_manager` column + `LINE_MANAGER` capability code exist in schema; no service logic actually applies it yet.
- [x] Multi-tenancy — one Postgres DB per tenant, `platform` registry DB, per-tenant connection pool (`registry.service.js`), subdomain resolution (`host-tenent-resolver.js`), tenant-context guard (`tenant-context.js`). Verified working end-to-end via the login smoke test in `RBAC_SECURITY_KICKOFF.md`.
- [x] Tenant provisioning tooling — `npm run db:provision` / `provisioning.service.js`: creates the DB, migrates live+sandbox, seeds COA/tax/RBAC/events, registers + projects features. Gap: seeds no users (see `scripts/tenant/create-admin.js` above).
- [ ] Platform console — backend API is done (`/api/platform/*` in `tenants.service.js`: list/create/suspend/resume/go-live/capacity/sandbox/feature-toggle, all audited). **No UI** — there is no `client/` at all yet, Praxis-only or tenant-facing.
- [ ] White-label theming — `setting` table (`section/key/value jsonb`) and `corporate_entity` (logo refs, doc prefix) exist; not verified whether anything actually generates CSS vars or a per-tenant PWA manifest from them. Needs a look before marking done either way.
- [ ] Test/Live sandbox — backend mechanics are done (separate `live`/`sandbox` schemas, `X-Praxis-Env` header switch in `tenant-context.js`, `npm run db:sandbox:wipe`). Top-bar toggle + TEST MODE banner are frontend — don't exist (no `client/`).
- [x] ~~Oso RBAC integration~~ — **superseded by explicit decision**: no Oso anywhere in `src/`; RBAC is our own role×capability×scope×permission×field_visibility model instead (see `RBAC_SECURITY_KICKOFF.md`). Leaving this line struck-through rather than deleted so nobody re-adds Oso thinking it was never decided.
- [x] Immutable ledger service — `immutable_ledger` table is genuinely append-only (`trg_ledger_ro` blocks UPDATE/DELETE at the DB level), `audit()` helper writes to it, `audit_ledger` module reads it. Minor wrinkle: `audit_ledger.routes.js` still exposes a generic DELETE (soft-delete) endpoint via `makeRouter()`'s default — harmless (writes to a separate `soft_delete` table, doesn't touch the ledger row) but semantically odd for an "immutable" resource; worth a `softDeletable: false` fix.
- [ ] Universal Event Engine — schema exists (`event_type`, `workflow`, `workflow_step`, `event_log`, `approval_task` — `migrations/tenant/0120_events_workflow.sql`) and the emit side works (`emitEvent`, used by every module service). No event-registration API and no workflow-designer endpoints (no `workflow` module anywhere in `src/modules`) — modules currently don't "auto-appear" in any config UI because there's no UI or registration endpoint yet, just the seeded event-type rows.
- [ ] Watch-the-Watcher — the three high-priority events (`permission.changed`, `role.changed`, `field_visibility.changed`) are seeded and now actually fire (`permission`/`field_visibility` services emit them as of this kickoff). Nothing consumes them to notify CEO/Management yet, and the Live-mode self-grant block isn't implemented (flagged as TODO in `permission.service.js`).
- [ ] Two-tier deletion model — soft-delete write path is done and DB-enforced (`soft_delete` table, `CHECK (restored_by <> deleted_by)` for maker-checker); God Mode hard purge is done (`godmode.service.js`: PIN-gated, refuses ledger-connected records). **Restore is not implemented anywhere** — `soft_delete` rows can be written but nothing reads them back to actually restore a record.

**Frontend note:** several boxes above are unchecked purely because `client/` doesn't exist yet (platform console UI, sandbox toggle/banner, white-label rendering). See `client/README.md` for the kickoff outline — backend Auth/RBAC needs to be further along (seeded grants, at minimum) before that's worth starting for real.

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
