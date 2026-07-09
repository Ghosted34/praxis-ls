# Praxis LS — Work To Be Done

Derived from the PRD (Master Functional Spec v2) and the kickoff meeting. Organised by delivery phase, per the accounting-first roadmap (no big-bang cutover). Update statuses as work lands; this file is the running backlog, not a historical record — the transcript/PRD stay unchanged as source of truth.

## Immediate / pre-build (from kickoff)

- [x] Victor: create the GitHub repo (PR-based workflow) and publish the initial README
- [x] Victor: confirm/collect GitHub accounts for repo access
- [x] Blake: share all source docs (PRD, OHADA KB, RBAC/User-Journey, Lovable FE export, MySQL `.sql` dump, meeting recording) into the group/`doc/` folder
- [x] Blake: prepare yearly contracts; deposit advances
- [x] Blake: fund Claude Pro accounts per engineer
- [x] Blake: create the team WhatsApp group
- [x] David: review the full kickoff recording (missed logistics & sales portions)
- [x] All: rotate every AI/FX provider key shared during discovery (Gemini, DeepSeek, Groq, exchangerate-api) before first use — treat as compromised

## Phase 0 — Foundations

> Status below was verified against the actual code/migrations on 2026-07-07
> (not assumed from this doc or the README — several lines here were stale).
> See `doc/RBAC_SECURITY_KICKOFF.md` for the full audit trail behind the
> Auth/RBAC lines. Anyone picking up an unchecked item: re-verify before
> starting, this list rots fast in a repo this size.

- [x] Monorepo scaffold — done, plain npm workspace (`src/`, `migrations/`, `scripts/`), not the pnpm/Turborepo `apps/*` layout this line describes. Works; just not literally as specced. `client/` does not exist yet (see Phase 2+ / frontend note at the bottom).
- [x] Docker Compose for local dev (`docker-compose.yml`: postgres/pgvector, redis, api, worker) + a root `Dockerfile`. No separate `worker-ai`/`worker-pdf`/reverse-proxy containers — one `worker` service covers all queues for now.
- [x] CI/CD — **started 2026-07-09**: `.github/workflows/ci.yaml` (checkout → Node 20 → `npm ci` → `node --check` across `src`/`scripts` → `npm run lint` → `jest --passWithNoTests` → no-push `docker build`). The empty `deploy.yaml` is now a valid manual-only placeholder. Real deployment (registry/secrets/target) is still Phase 5 — this is the parse/lint/test/build gate only.
- [ ] Auth — **further along as of 2026-07-08, one real gap left**:
  - [x] Argon2id password hashing (verified in `app_user.service.js`, `godmode.service.js`)
  - [x] JWT access+refresh (`src/modules/security/app_user/` — login/refresh are real; `security/auth/` was merged into `app_user/` on 2026-07-08, see `doc/WORK_DONE.md` — auth operates on the same table/entity, external URLs unchanged)
  - [x] 2FA (TOTP) — pending-2FA-token design decided and built (2026-07-08, see `doc/WORK_DONE.md`): login returns a 5-min `typ:"2fa_pending"` token when `is_2fa_enabled`; `POST /auth/2fa/verify` exchanges it (otplib against the decrypted secret) for the real pair. Enrollment lifecycle (`/2fa/setup`, `/2fa/enable`, `/2fa/disable`) added too — didn't exist at all before, so verify would've been unreachable without it.
  - [x] 30-min inactivity auto-logout — **enforced 2026-07-09**: `refresh()` rejects with `401 SESSION_EXPIRED` and kills the session once idle > `SESSION_INACTIVITY_MIN` (`getActiveSession` now returns `idle_seconds`). Same tradeoff as remote kill — blocks the refresh that extends the session, doesn't retroactively kill a live ≤15-min access token. See `doc/WORK_DONE.md`.
  - [x] Redis session store with remote kill (2026-07-08) — `shared/cache/session-store.js` indexes active sessions in Redis on login/logout; `session` module gained `GET /sessions/mine` (self-scoped, no grant needed) and `POST /sessions/:id/kill` (self-kill always allowed; killing someone else's session needs the MOD-68 grant or CEO). `config/redis.js` was actually broken for any non-default `REDIS_URL` (read nonexistent `REDIS_HOST/PORT/PASSWORD/DB` env vars) and `initRedis()` was never called anywhere — both fixed as prerequisites. See `doc/WORK_DONE.md`.
  - [x] Platform (company dashboard) login — **not previously tracked as a gap, but there was none**: `platform.routes.js` gated every route with `platformAuth` and nothing ever issued a platform JWT. Added `POST /api/platform/auth/login` (2026-07-08).
- [ ] RBAC policy engine — **API layer now fully gated; grants still unseeded**:
  - [x] `role`/`capability`/`scope`/`permission`/`field_visibility` tables + `user_role`/`user_capability`/`user_scope` (pre-existing, `migrations/tenant/0110_rbac.sql`)
  - [x] Admin CRUD + auth/RBAC gating for all five, via `src/modules/security/{iam_role,capability,scope,permission,field_visibility}`, **plus `session`/`audit_ledger`/`setting`, gated 2026-07-08** — every security module now requires `authMiddleware`/`requirePermission`. (`app_user`'s generic `/users` CRUD is the one deliberate exception — left ungated per this session's scope decision, same gap, tracked separately below.)
  - [x] Record-level scope enforcement — **mechanism built 2026-07-08, not yet adopted by any module**: `requirePermission()` now resolves the caller's `scope_ids` from `user_scope`/`scope` (null = unrestricted, unchanged default for tenants with no scope assignments); `makeRepo()` gained an opt-in `scopeColumn` config key that `list()` filters by when set. No existing module declares `scopeColumn` yet — deciding which column means "scope" on each table is a per-module call outside this pass. `session.kill` is the one concrete self-vs-all check built ad hoc (not yet generalized through this mechanism). See `doc/WORK_DONE.md`. **2026-07-09 confirmed adoption is genuinely blocked, not just skipped:** grepping every `migrations/tenant/*.sql`, `scope_id` appears only on the RBAC tables (`scope`/`user_scope`) and `workflow_step` — **no business/record table has a scope column** to filter on. The tables that need it (dossier, invoice, journal…) are Phase 1/2; adoption is a per-table schema call that lands with them.
  - [x] `app_user`'s own `/users` CRUD routes — **gated 2026-07-09**: rebuilt explicitly (not `makeRouter`) with `authMiddleware` + `requirePermission('MOD-67', …)` per verb, matching `capability.routes.js`. `/auth/*` stays public; bootstrap (`tenant:create-admin`, direct DB) unaffected. This was the last open security route.
- [x] Seed default role × module access matrix from `doc/SmartLS_SuperAdmin_User_Journey_and_RBAC.docx` — **written 2026-07-08**: `migrations/seeds/9021_seed_default_permissions.sql`, 16 `INSERT` blocks (one per matrix row actually seeded — 18 in the source doc, 2 skipped by decision, see below), covering all 11 default roles × 70 of 72 catalogue module_keys. Picked up automatically by `npm run db:migrate:tenants` for already-provisioned tenants too (seed files are tracked per-filename in `schema_migration`, applied-not-reapplied — confirmed by reading `migrator.js`, not assumed). Two matrix rows deliberately NOT seeded (decided with the user): "AI & event engine" (`MOD-67` already carries a different, contradictory grant for "IAM & user access" — `permission` has `UNIQUE(role_id, module_key)`, can't seed both; revisit once AI work earns its own module_key) and "Comms & portals admin" (no module_key exists for it at all; the only candidate, `MOD-64`, is already claimed by "Document vault & compliance" with a different pattern). `MOD-00A` (Dashboard) and `MOD-63` (Reporting & Insights) aren't in the source matrix at all — seeded nowhere, flagged not guessed. **Not yet run against a real Postgres** — no `psql`/local DB in this environment to dry-run against; verified instead by cross-checking every role code and module_key against the actual seed/catalogue source files (exact match, 70/70, 11/11) and a parenthesis-balance check. Run `npm run db:migrate:tenants` (or a fresh `db:provision`) and spot-check a non-CEO login before trusting this in anger.
- [~] `Line Manager` as a capability layered on any role — **mechanism built 2026-07-09, application pending**: `identity-cache.getUserCapabilities()` resolves `user_capability` + `role.is_line_manager` (`is_line_manager` = any role flags it OR the user holds `LINE_MANAGER`), and `middleware/rbac.requireCapability('LINE_MANAGER'|'APPROVER'|…)` gates on it (CEO bypass; attaches `req.capabilities`/`req.is_line_manager`). No Phase 0 route uses it — the actions it gates (leave approvals, appraisals, disbursal routing) are Phase 2/3, which opt in per route. See `doc/WORK_DONE.md`.
- [x] Multi-tenancy — one Postgres DB per tenant, `platform` registry DB, per-tenant connection pool (`registry.service.js`), subdomain resolution (`host-tenent-resolver.js`), tenant-context guard (`tenant-context.js`). Verified working end-to-end via the login smoke test in `RBAC_SECURITY_KICKOFF.md`.
- [x] Tenant provisioning tooling — `npm run db:provision` / `provisioning.service.js`: creates the DB, migrates live+sandbox, seeds COA/tax/RBAC/events, registers + projects features. Gap: seeds no users (see `scripts/tenant/create-admin.js` above).
- [ ] Platform console — backend API is done (`/api/platform/*` in `tenants.service.js`: list/create/suspend/resume/go-live/capacity/sandbox/feature-toggle, all audited). **UI proposed, not built** (2026-07-09): the tenant `client/` now exists but the platform console does not — see the platform-console proposal at the bottom of `client/FRONTEND_PLAN.md`. Blocked on a tech-lead decision: same `client/` build served on the `admin.` host vs a separate console app, and first-cut scope (tenants list + provision + go-live, vs the full set).
- [x] White-label theming — **built & working end-to-end 2026-07-09**. FE applies tenant colour/logo/name through CSS variables (`client/src/lib/theme.ts` `applyBrand()` sets `--primary`/`--ring` on `:root`; every `bg-primary`/`ring` utility re-tints live), fed by a new **public** `GET /api/tenant/branding` (Host-resolved, pre-auth so the _login itself_ is branded) and a **gated** `PUT /api/tenant/branding` (MOD-70) that upserts `setting` section='appearance' (`src/modules/branding/`). In-app **Appearance** screen (`client/src/features/settings/appearance-page.tsx`): colour picker + presets, display name, and logo (drag-drop/click upload) with a live preview; a save re-tints the whole app instantly and shows on the logged-out login. **Still TODO:** per-tenant PWA manifest (icons/name still static in `vite.config.ts`). Logo upload is now **storage-backed** (2026-07-09): drag-drop → `POST /branding/logo` → the `local` storage driver writes to `./data/vault/tenant_<slug>/branding/…` and it's served at `/media/<key>` (the earlier `storage.service` config bugs were fixed — see Phase 1 PDF/vault line).
- [ ] Test/Live sandbox — backend mechanics are done (separate `live`/`sandbox` schemas, `X-Praxis-Env` header switch in `tenant-context.js`, `npm run db:sandbox:wipe`). Frontend now **partial** (2026-07-09): the app shell shows a LIVE / TEST MODE badge driven by the `X-Praxis-Env` value (`client/src/app/layout/app-shell.tsx` + `token-store` env). Still missing: the actual top-bar **toggle** to switch env and persist it (the badge only reflects state, it doesn't change it yet).
- [x] ~~Oso RBAC integration~~ — **superseded by explicit decision**: no Oso anywhere in `src/`; RBAC is our own role×capability×scope×permission×field_visibility model instead (see `RBAC_SECURITY_KICKOFF.md`). Leaving this line struck-through rather than deleted so nobody re-adds Oso thinking it was never decided.
- [x] Immutable ledger service — `immutable_ledger` table is genuinely append-only (`trg_ledger_ro` blocks UPDATE/DELETE at the DB level), `audit()` helper writes to it, `audit_ledger` module reads it. The "still exposes a generic DELETE via `makeRouter()`'s default" line that used to be here was stale — checked 2026-07-08, `audit_ledger.routes.js` has been a custom GET-only router (no `makeRouter()`, no DELETE) since before this session touched it; correcting the record.
- [x] Universal Event Engine — **admin API built 2026-07-09**: new `src/modules/workflow/` (gated MOD-67) exposes event-type registration (`GET/POST /event-types`, upsert-idempotent), workflow CRUD (`GET/POST /workflows`, `GET/PATCH /workflows/:id` — bind to an _approvable_ event only), step design (`GET/POST /workflows/:id/steps`, `DELETE …/steps/:stepId`), and the read-only runtime queue (`GET /approvals`). Schema + emit side were already there; this is the missing designer surface. **Still backend-only** (no config UI — no `client/`), and the _runtime_ side is minimal: `emitEvent` doesn't yet auto-create `approval_task` rows when an approvable event fires — that's the execution engine, next.
- [x] Watch-the-Watcher — **consumer built 2026-07-09**: `shared/events/emit.js` now forces `event_log.priority=HIGH` for any `is_security_critical` event and fans out a HIGH in-app `notification` to every active CEO/MANAGEMENT user, atomically in the caller's transaction (single `INSERT…SELECT` guarded by `EXISTS(is_security_critical)` — a no-op for NORMAL events). Fixed a real gap while here: `iam_role` emitted `iam_role.*`, not the seeded `role.changed`, so role edits never notified — repointed to `role.changed`. Also fixed the `notification` module's broken require paths (it wasn't loading at all). **Still open:** the Live-mode self-grant block (`permission.service.js` TODO — needs `req.env`/`req.user` at the service layer), and `notification.list()` isn't self-scoped yet (returns all tenant rows — Phase 2 follow-up before non-admin exposure).
- [x] Two-tier deletion model — soft-delete write path is done and DB-enforced (`soft_delete` table, `CHECK (restored_by <> deleted_by)` for maker-checker); God Mode hard purge is done (`godmode.service.js`: PIN-gated, refuses ledger-connected records). **Restore added 2026-07-08**: `audit_ledger` module gained `GET /audit/soft-deletes`, `POST /audit/soft-deletes/:id/request-restore`, `POST /audit/soft-deletes/:id/restore` (maker-checker enforced in the service layer too, not just the DB CHECK). Restoring a record whose table has no `activeColumn` just marks the `soft_delete` row restored (nothing was ever actually hidden in that case — see `doc/WORK_DONE.md` for why). A new `shared/crud/entity-registry.js` resolves `entity_ref` prefixes to real tables (they don't reliably match — `iam_role`'s entity string is `"iam_role"` but its table is `role`).

**Frontend note (updated 2026-07-09):** `client/` now exists — a Vite + React 18 + TS **PWA** (see `client/FRONTEND_PLAN.md`). Built: api-client (Bearer + refresh-on-401 + `X-Praxis-Env`), auth context (login / 2FA / logout / reload-restore), route guard, white-label app shell (LIVE/TEST badge, mobile slide-over), a **production-quality white-label login** (field icons, password reveal, segmented 2FA code), working **white-label theming** (colour/logo/name — see that line above), and an **Appearance** settings screen. Also **skeletal** (read-only lists wired to the real endpoints, build editors on top): Security — users, roles, permission matrix, capabilities, scopes, field-visibility, sessions; Governance — audit, notifications, workflows, approvals, settings. Single-origin prod serving (Express serves `client/dist`) is wired in `src/server.js`.

**Built since (2026-07-09):** the permission **grant-matrix editor** (`client/src/features/security/permission-matrix-page.tsx` — roles × modules, grouped/collapsible, five R/C/U/D/A toggles per cell → `PUT /api/tenant/permissions/grant` upsert, fires Watch-the-Watcher); **light/dark/system** theme toggle; a branded **boot splash**. Backing endpoints added: `GET /api/tenant/catalogue/modules` (the MOD-xx list from the platform catalogue) and `PUT /api/tenant/permissions/grant`.

**Still not built (frontend):** platform console UI (proposal pending, see above), the Test/Live toggle, per-tenant PWA manifest, and richer editors on the other skeletal Security/Governance screens. **Handover to Phase 1: see `doc/HANDOVER.md`.**

**Verify caveat:** the client was written but could not be `npm install`/`tsc`-checked in the build sandbox — it boots and login works against the live backend (confirmed 2026-07-09); treat the first `npm run build` as the real typecheck.

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
  - **Storage bugs found & FIXED 2026-07-09:** `storage.service.js` read `config.STORAGE_LOCAL_ROOT` (nonexistent) → now `STORAGE_LOCAL_PATH`; `CDN_BASE_URL` added to `env.js`. `/media/<key>` is now served by Express for the `local` driver (`server.js`, guarded by `STORAGE_DRIVER==='local'`, excluded from the SPA fallback; Vite proxies `/media` in dev). Proven by the white-label logo upload (`POST /api/tenant/branding/logo` → `storage.put` → tenant-namespaced key under `./data/vault/tenant_<slug>/branding/…`). **Still TODO for the vault:** an **auth-gated** download route for _sensitive_ documents — the flat `/media` static mount is fine for public assets (logos) but must not serve confidential files; and the S3 driver is unimplemented (interface only).
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
