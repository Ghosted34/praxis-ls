# Praxis LS — Work To Be Done

Derived from the PRD (Master Functional Spec v2) and the kickoff meeting. Organised by delivery phase, per the accounting-first roadmap (no big-bang cutover). Update statuses as work lands; this file is the running backlog, not a historical record — the transcript/PRD stay unchanged as source of truth.

## Frontend build status — 2026-07-17 (session 6)

This stream's FE lane (master data / sales-CRM / vault / portal / dashboard) is **substantially
complete**. Screens wired to live BE this session (all typecheck clean; lint + `npm run build
--prefix client` pass on Windows). See `doc/WORK_DONE.md` (2026-07-17) + `doc/FE_IA_BUILD_MAP.md`.

- [x] **Sales & CRM funnel** (`client/src/features/sales/pages.tsx`): Leads & intake (MOD-20 + folded
  MOD-25), Meetings (MOD-21), Opportunities Kanban (MOD-24), Proposals (MOD-23), Marketing campaigns
  (MOD-22), Success stories (MOD-26).
- [x] **Commercial group** (`client/src/features/commercial/pages.tsx`): Quotations (MOD-27, gated
  `commercial.quotation`), Margin sim (MOD-27), Extra-charge sim (MOD-28), Pricing variance (MOD-27).
- [x] **Vault hubs** (`client/src/features/vault/pages.tsx`): Reports (MOD-63, gated `reporting`),
  Compliance flags (MOD-65).
- [x] **Portal access** (`client/src/features/portal/pages.tsx`, MOD-67).
- [x] **Control Tower** live (`client/src/features/dashboard.tsx`, MOD-00A) — replaced the static mock.
- [x] Shared FE primitives extracted to `client/src/features/sales/ui.tsx`.
- [x] Master-data trio (Clients/Suppliers/Corporate entities) — session 5.

**FE follow-ons still open:** tax-code picker for Quotations (so VAT flags from the FE); Reports
dashboard-tile picker (`/reports/tiles`) feeding the Control Tower; ~~platform/godmode console UI~~ **(the
Platform Console shipped 2026-07-23 — standalone `platform-console/` app; see SESSION_HANDOFF session 13)**;
vault Documents/Signatures/Verification (BE gaps). Not this stream: finance + operations screens (FS colleague).

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

**Still not built (frontend):** ~~platform console UI (proposal pending, see above)~~ **— built 2026-07-23,
standalone `platform-console/` app (session 13)**, the Test/Live toggle, per-tenant PWA manifest, and richer editors on the other skeletal Security/Governance screens. **Handover to Phase 1: see `doc/HANDOVER.md`.**

**Verify caveat:** the client was written but could not be `npm install`/`tsc`-checked in the build sandbox — it boots and login works against the live backend (confirmed 2026-07-09); treat the first `npm run build` as the real typecheck.

## Phase 1 — Accounting spine

> **Audit 2026-07-12 (post-colleague-merge).** Reconciled against the merged
> codebase by module presence + `*.service.js` depth (not a line-by-line invariant
> re-verification — the `[x]` below means "the module and its core logic exist and
> pass `npm test`", not "every OHADA rule re-audited"). Phase 1 is substantially
> landed; unit suites `journal-*`, `final-invoice-lifecycle`, `invoicing`,
> `statements`, `tax-center`, `numbering`, `determination` all pass.
>
> **Phase 1 frontend status (2026-07-12).** The BE modules are `[x]`; the boxes
> below track the *backend*. FE write coverage on top of them:
> - [x] Post journal entry (multi-line, live-balance, draft-vs-validate) → `POST /journal-entries`
> - [x] Record customer advance (→ 4191) → `POST /proformas/pay`
> - [x] Final invoice draft → submit lifecycle → `POST /final-invoices` (+ `/:id/submit`)
> - [x] Statements + Tax Center period/date filter bar (entity/period_code/from/to)
> - [x] Close / lock an accounting period — **wired 2026-07-12**: "Periods / close" tab in Statements lists periods with Freeze/Close (confirm modal) → `POST /statements/periods/close`
> - [x] Journal-entry **reverse** from the UI — **wired 2026-07-12**: per-row Reverse on validated entries → `POST /journal-entries/:id/reverse` (reason + date)
> - [x] Invoice draft **edit** — **wired 2026-07-12**: Edit action on DRAFT rows loads `GET /final-invoices/:id` and saves via `PATCH /final-invoices/:id`
> - [ ] Run / file a tax declaration — Tax Center is **report-only in BE too** (`tax_declaration.routes.js` is all GET); needs a BE submit/file action *and* FE (no BE endpoint to wire yet)
> - [ ] Credit notes (invoice `type='CREDIT_NOTE'` exists in schema; **no BE or FE create flow** — nothing in `src/` references it)
> - [x] Statements period filter now binds — **fixed 2026-07-12**: `ReportTabs` gained a `periodMode` prop; Statements uses a **`period_id` dropdown** fed from `/statements/periods` (filtered by the chosen entity), Tax keeps the `period_code` text input. `toQuery` sends whichever is set.
> See `client/src/features/finance/pages.tsx` + `doc/WORK_DONE.md` (2026-07-12).

- [x] Chart of Accounts (OHADA/SYSCOHADA) — `master/chart_of_accounts/` + `migrations/tenant/0200_coa_dictionary.sql` + `seeds/9000_seed_coa.sql`, hierarchical, `is_postable`/`requires_analytic`
- [x] Financial Dictionary as a distinct layer from the COA — `master/financial_dictionary/` (`dictionary_item`), separate from the account tree
- [x] `posting_rule` / account-determination glue — `src/services/accounting/determination` resolves dictionary item → debit/credit + `tax_code` + context (covered by `determination.test.js`)
- [x] Ledger engine invariants (hard-reject) — `finance/journal_entry/journal_entry.rules.js` + DB triggers in `0220_ledger.sql` / `0221_ledger_invariants.sql` (balanced, postable-leaf-only, débours class rules, gap-free entry_no, mandatory source_doc_ref) — `journal-rules.test.js`
- [x] Reversal-not-edit — validated entries immutable; linked reversal+replacement (`journal_entry.service.js`, 164 ln)
- [x] Régie d'avance aging: 581 → 4211 reclass past policy window — `costing/regie/` (100 ln) + `jobs/handlers/regie-aging.js`; Compliance Checker via `vault/compliance_flag`
- [x] Tax Jurisdiction module: versioned `tax_code` — `master/tax_jurisdiction/` (106 ln) + `0210_tax.sql` + `seeds/9010_seed_tax.sql` (TVA 19.25%, WHT, IS, CNPS, CFC, FNE, IRPP, CAC), effective-dated
- [x] Journals & General Ledger (manual + auto-posted, balanced-or-rejected) — `finance/journal_entry/`
- [x] Treasury accounts (bank/cash/mobile-money mapped to COA) — `master/treasury_account/` (51 ln)
- [x] Statements: Bilan, Compte de résultat, TAFIRE, Notes annexes — `finance/financial_statement/` (`statements.test.js`)
- [x] Tax Center outputs (TVA, IS, WHT, DSF, CNPS) — `finance/tax_declaration/` (`tax-center.test.js`)
- [x] PDF worker + document vault storage + QR verification — `jobs/handlers/pdf-render.js`, `vault/document_vault`, `vault/document_verification`; storage driver fixes carried from Phase 0 (`pdf-email.test.js`)
  - **Storage bugs found & FIXED 2026-07-09:** `storage.service.js` read `config.STORAGE_LOCAL_ROOT` (nonexistent) → now `STORAGE_LOCAL_PATH`; `CDN_BASE_URL` added to `env.js`. `/media/<key>` is now served by Express for the `local` driver (`server.js`, guarded by `STORAGE_DRIVER==='local'`, excluded from the SPA fallback; Vite proxies `/media` in dev). Proven by the white-label logo upload (`POST /api/tenant/branding/logo` → `storage.put` → tenant-namespaced key under `./data/vault/tenant_<slug>/branding/…`). **Still TODO for the vault:** an **auth-gated** download route for _sensitive_ documents — the flat `/media` static mount is fine for public assets (logos) but must not serve confidential files.
  - **S3 driver — IMPLEMENTED 2026-07-22:** `storage.service.js` now ships two interchangeable drivers behind `STORAGE_DRIVER` (`local` | `s3`). The `s3` driver targets any S3-compatible store (AWS S3, MinIO, Wasabi, B2, Cloudflare R2) via `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_FORCE_PATH_STYLE` (all in `env.js`), with an optional `CDN_BASE_URL` for public URLs and a `signedUrl(key, ttl)` for temporary access (presigned GET). The AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) is **lazily required** so `local` deployments don't need it installed — run `npm install` (both are now in `package.json`) before setting `STORAGE_DRIVER=s3`. Interface (`put`/`get`/`delete`/`publicUrl`/`signedUrl`) is unchanged, so no module edits were needed. NB this supersedes the PRD §8 "self-hosted, no S3" line — S3 is now an opt-in deployment choice, local stays the default.
- [x] Email/SMTP service — per-tenant SMTP from tenant `setting` (refactored 2026 by colleague), queued sends via jobs; SPF/DKIM/DMARC domain setup stays an ops/DNS open item (see open questions)

## Phase 2 — Commercial cycle

> **Audit 2026-07-12 (post-colleague-merge).** Commercial cycle is largely landed
> across `master/`, `operations/`, `costing/`, `commercial/`, `procurement/`.
> `[x]` = module + core logic present and unit-tested where a suite exists;
> deep OHADA/pricing edge cases not exhaustively re-verified here.

- [x] Master data: corporate entities, employees, client master (KYC, credit limit), supplier master (mobile money) — `master/{corporate_entity,employees,client_master,supplier_master}/`
- [x] Currency & live FX — `master/currency/` (40 ln) + FX job; per-transaction stamped rate + manual override
- [x] Operations File Registry (dossier) + service_type taxonomy — `operations/operations_file/` (82 ln)
- [x] Milestone engine: versioned templates → instances — `operations/milestone/` (74 ln, versioned templates per colleague's `df1a2ea`)
- [~] Operations-File 360° modal — backend surfaces exist (milestones/people/money/documents/comms); the combined **FE modal** lands with the Lovable reskin
- [x] Transit orders, delivery notes — `operations/{transit_order,delivery_note}/`
- [x] Project costing (ledger-posting, dossier-tagged), cost tracking, disbursal (régie state machine) — `costing/{costing,cost_tracking,cash_request,regie}/`
- [x] Margin Simulator / Extra-Charges Simulator (no GL impact) — `commercial/{margin_simulation,extra_charge_simulation}/`
- [x] Proforma & advance-payment invoices (advance → 4191) — `finance/proforma/` (52 ln)
- [x] Final invoice (revenue recognition, clears advance + débours) — `finance/final_invoice/` (152 ln, `final-invoice-lifecycle.test.js`)
- [x] Smart Receivables Ledger (ageing, allocations, reminders) — `finance/smart_receivables/` (112 ln)
- [x] Procurement: purchase requests → POs → goods received (three-way match) + supplier invoice — `procurement/{purchase_request,purchase_order,goods_received,supplier_invoice}/`

## Phase 3 — People & assets

- [x] HR (ledger-independent): vacancies+applicants (MOD-11), contracts (MOD-12), KPI appraisals (MOD-13), attendance (MOD-14), leave/allowances (MOD-15), SOPs (MOD-16), trainings+roster (MOD-18), talent pool (MOD-19) — *remaining:* onboarding checklists, succession, employee self-service portal
- [ ] Payroll: CNPS + IRPP/CAC/CFC/RAV auto-compute, payslip generation, auto-posted payroll journal, SoD via run states — **deferred: needs Phase 1 ledger posting**
- [x] Fleet: vehicle registry (MOD-39), compliance & renewal alerts (MOD-40), maintenance/work orders (MOD-41), dispatch (MOD-42), fuel tracking (MOD-43), driver management (MOD-44), incident/claim tracking (MOD-45) — *fuel/work-order GL posting deferred to Phase 1*
- [x] Warehouse (WMS): inbound/GRN + QA hold + putaway (MOD-33), location management (MOD-34), inventory control + stock-movement journal (MOD-35), outbound pick/pack/dispatch (MOD-36), equipment handling (MOD-37), cycle counting (MOD-38)
- [ ] Asset management: acquisition → depreciation (auto-posting) → disposal — **deferred: needs Phase 1 ledger posting**

## Phase 4 — Intelligence & reach

> **Audit 2026-07-12.** Partially landed by the colleague's AI merges
> (`45b1bc1` batch AI actions + transcribe/vision jobs, `03593d5` DB-first vendor
> resolution + env fallback). AI spine and governance exist; portals/comms/reporting
> are backend-scaffold or pending FE.

- [x] AI service layer — DB-first vendor resolution + env fallback, transcribe (Groq) + vision (Gemini) jobs, batch action processing (`ai/`, `src/services/ai/*`, `jobs/handlers/ai-*`); per-tenant AI toggle in settings. *Pending:* per-tenant spend dashboard (FE)
- [x] Zod validation gate for AI actions + action-card confirmation flow — `src/services/ai/action-registrar.js` + batch confirm (`action-registrar.test.js`, batch-confirm tests)
- [x] AI governance: usage caps, PII/financial redaction, full AI-call logging — `ai/governance/` (148 ln)
- [x] Pricing Variance Index (R/Y/G, no raw cost exposure) — `commercial/pricing_variance/` (52 ln)
- [~] Portals: Client / Investor / Audit Terminal — `portal/` backend (staff grant + scoped views) **plus external-user auth (2026-07-22, new `portal_auth/` module + migration `0460_portal_user.sql`)**: public `POST /portal/auth/login` issues a portal-scoped JWT (`typ:"portal"`, off the RBAC path); `portalAuth(type)` re-checks the `portal_access` grant per request (revoke takes effect immediately) and injects the scope; `GET /portal/{me,client,investor,auditor}` reuse `portal.service`'s scoped views; staff invite/manage external users via `MOD-67`-gated `/portal/users`. **Apply migration 0460 to each tenant (live+sandbox) before use.** **FE portals (the external-facing pages) still pending.**
- [~] Support & Feedback dashboard (ticket lifecycle, PRD §11.2) — **BE + platform-console triage built (2026-07-23)**. Central `platform.support_ticket` (already in `0030_platform_ops.sql`) is the store — no cross-tenant fan-out. Tenant-side API: new `src/modules/dashboard/support/` (ungated, `authMiddleware`) — `POST/GET /api/tenant/support/tickets`, `GET /tickets/:id`, `POST /tickets/:id/csat` (CSAT only on SHIPPED/DECLINED), scoped to `req.tenant.tenant_id`, stamped with `req.user.email`, written to the platform DB via `services/platform/db`. Platform-side: `services/platform/support.service.js` + `GET /api/platform/support/tickets` (aggregate across tenants + `?status/kind/tenant` filters), `GET /tickets/:id`, `PATCH /tickets/:id` status transition (audited `support.status_changed`). Console **Support** tab is now a live triage board (lanes by status, filters, per-ticket detail + transitions). **Tenant-app FE built too** — `client/src/features/support/support-page.tsx` (route `/support`, nav under Overview): raise a ticket (kind/title/body), track status, and rate resolved tickets (CSAT). Full loop is complete. **Not yet run against a live API** (Windows `npm run lint`/`test`/`build` + a click-through owed, per the usual rule).
- [~] Smart Comms Portal — `smartcomm/` scaffold only (thin service); WebSocket/threads/certified-export pending
- [~] Reporting & Insights dashboards — `vault/report/` scaffold; per-role Excel/PDF export pending
- [~] Settings module (MOD-70): configuration hub — partial: `security/setting`, `security/numbering_setting`, `branding/` (appearance) exist; unified hub + remaining sections pending

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
