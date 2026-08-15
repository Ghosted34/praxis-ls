# Praxis LS — Gap Review

**Date:** 14 August 2026 · **Repo:** `main` @ `37e5846`
**Basis:** `SmartLS_PRD_Master_Functional_Spec_v2.md` and `Praxis_LS_Kickoff_Meeting_Transcript.md`, both read in full, verified against source — `src/modules`, `client/src` (112 screens), 125 tenant migrations, `src/jobs/workers.js`, `.github/workflows/ci.yaml`.

Pure gaps only. Architecture deviations that just need the PRD amended are excluded.

**Re-verified 15 August 2026 at `f18833a`.** Every entry G1–G25 was re-checked against source, not against a status document. **G14 is closed and has been removed.** G10 and G15 are rewritten — both were partly addressed. G1–G9, G11–G13 and G16–G25 are unchanged and still open; the specific evidence checked for each is the same evidence cited in its entry (the God Mode regex is still at `godmode.service.js:19`; `payroll.service.js:58` still spreads `DEFAULTS` over a request body; the extra-charge rules file is still 199 lines and still counts tier days from *after* the free period; `transit_order.service.js:23` still filters on `inventory_item_id`; `success_story_dossier` still does not exist). Addendum II (G26–G36) covers Sales & CRM.

---

## P0 — unmet `[RULE]`s

### G1 · Bilingual EN/FR missing from the app UI

PRD §14/§15.1 require full EN/FR with a top-bar toggle; the meeting (§11.3) was emphatic that OHADA account names are French-only and rough translations won't do.

- **Done:** data-level labels (`label_fr`/`name_fr` on `chart_of_accounts`, `dictionary_item`, `service_type`, `milestone_template` — migrations `0200`, `0310`, indexed in `0504`); PDF templates bilingual (`title: { fr, en }` in `documents/templates/registry.js`, `fr-FR` XAF formatting).
- **Missing:** the entire UI layer. No i18n dependency in `client/package.json`, no locale files under `client/src`, no toggle in `app-shell.tsx`. All 112 screens hardcoded English.

Compounds with every screen shipped. Land the runtime and shell now even if per-screen translation trails.

**DoD:** i18n runtime + `en`/`fr` dictionaries at the shell; language on the existing `preference` module; top-bar toggle; statutory output defaults to FR; CI check blocking new hardcoded user-facing strings.

### G2 · Sandbox doesn't sandbox its side-effects

PRD §5.5 `[RULE]`: in Test mode — no real client emails, no real AI spend (or hard cap), separate numbering, watermarked PDFs.

| | |
|---|---|
| Separate numbering | ✅ falls out of schema separation (`doc_sequences` is per-schema) |
| No real client emails | ❌ `jobs/handlers/email-send.js` uses `env` only to pick the connection, then sends |
| No real AI spend / cap | ❌ nothing in `services/ai/*` or `ai/governance` branches on env |
| Watermarked PDFs | ❌ `templates/kit.js` supports watermarks, `registry.js` sets `PAID`/`COPY` — nothing sets TEST/SANDBOX |

Concrete failure: a training session in Test, on a tenant with SMTP configured, emails a real invoice to a real client. Training is precisely what the sandbox was specified for, so this gets exercised on day one of the first rollout.

**DoD:** env-aware guard in the email service (suppress or redirect to a logged sink); sandbox AI budget forced to a hard low cap or mock vendor; `watermark: "TEST"` on any non-live render; one test per leg.

### G3 · Sandbox auto-wipe is never scheduled

PRD §5.5 and the meeting both lock a wipe cron, default 14 days. `scripts/db/sandbox-wipe.js` exists and `tenant.sandbox_wipe_days` is read in `registry.service.js` — but `src/jobs/workers.js` registers repeatables for orchestration, mail-sync, webhook-renew, retention, health, FX, backup, prune and object-sync, and **nothing for sandbox wipe**. It only runs if someone remembers the CLI.

Also silently breaks the space rationale (PRD §6.2 — the 75 GB box is tight).

**DoD:** repeatable in `workers.js` reading `sandbox_wipe_days` per tenant; a test asserting Live schemas are unreachable from the wipe path.

### G4 · "Powered by JBS Praxis LLC" missing from login/splash

PRD §5.4 `[RULE]`, and the founder raised it twice (meeting §11.1 — the login page as marketing surface). Currently appears only in `client/src/features/portal/portal-chrome.tsx:50`. Not on tenant login, not on splash.

Minutes of work, highest external visibility of anything on this list.

---

## P1 — feature surface

### G5 · God Mode: regex accounting guard, no dependency preview

`godmode.service.js` correctly requires an Argon2-verified PIN and writes the full removed payload to the ledger. Two problems:

**The accounting exclusion is a naming convention, not a referential check.** PRD §8.5 `[RULE]` excludes all posted accounting records. The implementation:

```js
if (/^(invoice|journal|receipt|payment|asset|payroll):/i.test(row.entity_ref || "")) { … refuse }
```

`credit_note:`, `supplier_invoice:`, `cash_request:`, `regie:`, `depreciation:` are all plausible today and all purgeable. Every new posting module depends on someone remembering to edit a regex in an unrelated file.

**No dependency preview.** Meeting §11.2 is specific: *"It shows every file connected to the record and asks whether to delete across everything."* `POST /god-mode/purge` takes a `softDeleteId` and acts.

**DoD:** replace the regex with a real check — does this entity carry any `journal_entry` / `immutable_ledger` reference, discovered by catalogue the way `party_merge` already discovers FKs (the technique is already in-house). Add `GET /god-mode/:id/dependencies`. Add a test enumerating every posting-linked table and asserting each is refused.

### G6 · No public, website-facing surfaces

Only unauthenticated tenant routes are `/maintenance` and the QR `/document-verification/scan` — verified by scanning every `*.routes.js` for auth (only the deprecated, unmounted `ai/ai.routes.js` lacks one; that coverage is genuinely good). So four specified public surfaces don't exist:

- **Website lead / quote-request intake API** (meeting §11.5; MOD-20/25) — `inbound_intake` is internal-only.
- **Public job-application UI** (meeting §11.4) — *"candidates upload CVs and answer a few questions, feeding applications straight in."* `vacancy` has `addApplicant`, no public path to it.
- **Vacancy posting to the tenant website** (MOD-11).
- **Portfolio / success-story push to the tenant website** (meeting §11.5; MOD-26) — the stated point was *"no back-end engineer needed to hand-code portfolio updates."*

Commercially load-bearing: the meeting positions website connection as a sellable package.

### G7 · Expense Rates has no Excel import

Locked as a ✅ Decision in the meeting (§11.3): onboarding collects rates and shipping lines via *"an Excel template the client fills, which we import."* `exceljs` is a dependency (used for export) but there's no import path in `master/expense_rate`.

Matters more than it looks — the rate card is the entire mechanism behind the costing speed-up the founder highlighted (*"~a day to ~10 seconds"*), and it's a per-tenant onboarding task. Without import, every new tenant's rate card is hand-keyed.

### G8 · Support & Feedback: context capture never wired

The module is otherwise right — `platform.support_ticket` in the central platform DB keyed by `tenant_id` (console triages across tenants with no cross-tenant fan-out), every tenant query scoped, `submitCsat` refused until `SHIPPED`/`DECLINED`, and `platform-console/src/features/Support.tsx` renders the full `NEW → TRIAGED → IN_PROGRESS → SHIPPED → DECLINED` kanban.

**Gap:** the meeting's Pixie Girl model (§11.16) — *"Need help? Send this to your system admin"* capturing an auto-screenshot plus full context (hub, area, page, action, error). The `context` jsonb column exists and the service accepts it; `support-page.tsx` posts only `{ kind, title, body }`. Nothing populates it.

`client/src/lib/error-reporting.ts` already captures route + error (ErrorBoundary + `window.onerror` + `unhandledrejection`, deduped, `sendBeacon` on unload). Wiring it to pre-fill `context` closes most of this; the screenshot is the only new piece.

### G9 · Multi-entity consolidation: schema exists, nothing reads it

`corporate_entity` carries `parent_entity_id`, `relationship_type`, `ownership_percent`, `consolidates`, `is_group_parent` — unconsumed. The MOD-63 report registry has nine producers (income statement, bilan, trial balance, TAFIRE, receivables ageing, reminders, cash position, procurement spend, dossier margin), none consolidated.

PRD §13 and Settings §12 both call for a group read layer for Management/Investor. A tenant with two entities gets two sets of books and no group view.

---

## P2 — readiness

### G10 · Integration coverage is 5 files

**Re-verified 15 Aug at `f18833a` — the CI half of this is now done.** `ci.yaml` has a `migrations` job running a real `pgvector/pgvector:pg16` service, provisioning a tenant from nothing, applying the tenant migration set twice to prove idempotency, seeding a corporate entity + journals + an OPEN period as a fixture, and running `npx jest tests/integration --runInBand`. The suites used to self-skip on `!process.env.DATABASE_URL` and nothing ever set it; that is fixed.

Two things remain:

- **Still 5 test files** (`journal-posting`, `ledger-hardening`, `mail-imap`, `orchestration-import-freight`, `party-merge`) against 176 total. Untested end-to-end: gap-free numbering under concurrency, RBAC enforcement, three-way match, receipt allocation, TAFIRE, tax returns.
- **The run cannot fail the build** — the step ends `|| true` and writes JSON to `/tmp/integration.json`. A regression in a covered path goes green.

Still the highest-value next investment on this list, but the expensive part (a real database in CI) is already paid for.

### G11 · No load test

Nothing — no k6, artillery or autocannon. PRD §14 targets p95 < 400 ms at 20–50 concurrent users per tenant.

### G12 · MySQL → PostgreSQL migration tooling: zero lines

No `mysql` reference anywhere in `scripts/` or `src/`. Correctly deferred (PRD §16 makes migration client-owned, post-build) — but *"with our tooling/support"* is a commitment, and the staging-schema reconciliation approach should be designed before Phase 5 opens, not during it.

### G13 · Key rotation and history secret scan unconfirmed

CI has a working-tree secret scan, `npm audit` blocking at high with a dated exception, and CodeQL — all good. But the scan's own comment notes **git history is not covered**, and `scripts/scan-history-secrets.sh` exists outside CI.

PRD Appendix A states the discovery-shared Gemini / Groq / DeepSeek / exchangerate keys are *"considered exposed and MUST be rotated before build."* Confirm rotation happened; run the history scan once.

### G15 · Provider runtime enablement

PDF/Chromium, Groq voice, Gemini vision, SMTP, FX all throw until keys or binaries are present. **Re-verified 15 Aug:** the endpoint exists — `POST /ai-vendors/:vendor/test` (`platform.routes.js:117`, capability-gated on `settings.write`). What does not exist is the documented tenant-onboarding checklist that runs against it; `doc/` has `PHASE4_CHECKLIST` / `PHASE5_CHECKLIST` / `INCIDENT_RUNBOOK` and no onboarding equivalent. Narrower than first written: a document, not code.

---

# Addendum — checked against the legacy PHP source

**Date:** 14 August 2026 · **Repo:** `main` @ `1e04812` · 128 tenant migrations
**Basis:** `doc/reference/legacy_codebase/` read directly — 631 PHP files under `administration/` (ERP) and `public_html/` (website). G1–G15 above were derived from the PRD and the kick-off transcript; this pass asks a different question: **what does the system the client uses today do that the rebuild cannot?**

No `.sql` export exists in the repo (`administration.zip` holds uploaded documents, not a dump), so the schema comparison below is derived from the table names appearing in live SQL statements — ~90 legacy tables recovered against the 233 tables the tenant migrations create. Legacy debt the PRD explicitly says to remove (hard-coded credentials, hard-delete God Mode, the five copy-pasted role folders, raw SQL, no ledger) is excluded, as are the twin directories `api/financial_dictionary/` + `api/financial-dictionary/` — both hit the same `financial_dictionary` table under mutually incompatible column names, so one of the pair is already dead code, and `api/marginpricing-old/` + `api/margin_pricingold/` are likewise dead: all five live views wire to `api/marginpricing/` only.

Pure gaps, continuing from G16.

---

## P0 — breaks at cut-over

### G16 · Extra-charge simulator: one charge family out of five, and demurrage counts differently

The founder asked for this one "copied as-is" (meeting §11.6 — *"the calculator was already built perfectly"*, port PHP→Node only). It was not copied.

`administration/view/*/extra-charges-simulator.php:819–1030` computes **five** charge families per container, over a container list parsed from free text (`2x40HC, 1x20RF` → `{q, s, t}` via regex, sizes 20/40/45, types DC/RF/HC/FR):

| Family | Legacy rule |
|---|---|
| Demurrage | two tiers, per size **and** type key (`20`, `40`, `20RF`, `40HC`, `20FR` …) |
| Storage | four absolute day bands — 12–20, 21–40, 41–70, 71+ |
| Yard occupancy | one-off charge per container once port stay ≥ 14 days |
| Plugging | reefers only, ATA+1 → gate-out inclusive |
| Detention | (empty-return − gate-out) − 2 free days, dry vs reefer rates |

plus 19.25 % VAT per line, XAF/USD/EUR conversion, and prefill from the live ops file (`?ajax=search_files` / `?ajax=file_details` against `operations_file_master` — BL, consignee, gross weight, ATA, containers) with a manual-entry escape hatch.

`src/modules/commercial/extra_charge_simulation/` (199 lines, all files) computes demurrage and nothing else. `extra_charge_simulation.rules.js:26` is the whole engine: `chargeable = occupied − free`, then one flat per-day loop over generic tiers. No storage, no yard, no plugging, no detention, no VAT, no FX, no dossier prefill — and **no container quantity at all**: the table (`0345_commercial.sql:64`) carries a single `container_variant` text and no count, so a ten-container file returns one container's worth of charge.

The day arithmetic also disagrees, which is worse than the missing families because it looks like it works. Legacy tiers are **absolute port-stay day numbers** with a hard floor: tier 1 runs `max(12, free+1) … 21`, tier 2 from `max(22, free+1)`. So with 7 free days legacy bills nothing until day 12 and switches tier on day 22 regardless. The rebuild rebases day 1 to the first day *after* the free period, so the same tariff and the same 7 free days start billing on day 8 and switch tier five days early. Same inputs, different invoice.

**DoD:** port the five families and the container-list parser from the PHP verbatim; add container quantity to the schema; keep the tariff in `settings.commercial.demurrage_tariff` (that part is an improvement over the legacy's JS-hardcoded `STATE`) but make the tier day numbers absolute port-stay days to match; VAT and FX on the response; a golden-case test per family taken from a real file.

### G17 · Public shipment tracking by reference is gone

`public_html/smart-track.php` is a **top-level item in the live website's nav** (`partials/header.php:81`) and the home page routes straight to it (`index.php:869`). It calls `api/public_track/get.php` — unauthenticated, keyed on the file reference alone — and returns the full milestone timeline (14 stages with due date, completion, location, reference and notes), computed status, current stage, and origin/destination labels resolved per service type (air → `air_origin`/`air_dest`, sea → `port_of_loading` falling back to `sea_pol`, hinterland → `place_receipt`/`place_delivery`).

The rebuild has no unauthenticated tracking path. Its only public tenant routes are `/maintenance` and `/document-verification/scan`; `/portal` and `/portals` both sit behind `authMiddleware`. G6 lists four missing public surfaces — this is a fifth, and unlike the others it is a surface the client's customers use today without an account.

**DoD:** public `GET /track/:ref` returning the client-visible subset only (`milestone_instance.is_client_visible` already exists), rate-limited, no client name unless the reference matches; the origin/destination fallback chain above.

### G18 · Payroll rates have no stored configuration at all

`payroll-management.php:164` reads the rate table through `get_master_config($conn, $targetDate)` — *"the most recent config effective on or before the target date"* — from `payroll_config_history (effective_date, config_json, created_by)`. Saving a new config writes a history row dated to the period start **and** propagates it to every future `OPEN` run (`:855–865`). That is what makes a CNPS-ceiling or IRPP-band change a one-afternoon admin task and keeps a re-run of March payroll in June honest.

The rebuild has the snapshot but not the source. `payroll_run.config_snapshot` exists (`0330_hr_fleet_wms.sql:25`) and is written on compute, but `payroll.service.js:59` builds it as:

```js
const cfg = { ...DEFAULTS, ...(config || {}) };
```

`DEFAULTS` is hard-coded in `payroll.rules.js`, and `config` is whatever the caller put in the request body. There is no `payroll_config` table, no effective dating, no `getSetting` call. Two people computing the same run with different bodies get different payslips and both are recorded as authoritative; changing a statutory rate means editing source and redeploying.

**DoD:** effective-dated `payroll_config` (or a `settings` section keyed by effective date); `compute` resolves the config for the run's period rather than accepting it from the request; propagate on save to `OPEN` runs; a test that computes the same period before and after a rate change and asserts the earlier run is unmoved.

---

## P1 — capability the rebuild has not reached

### G19 · Operational Cost Reconciliation is a signed document in the legacy, a query in the rebuild

`api/ocr/` is not optical character recognition — it is **Operational Cost Reconciliation** (`view/*/operational-cost-reconciliation.php`, module 22 in the client's own spec pack). It is the budget-vs-actual close-out of a dossier, and it is a controlled document:

- `ocr_master` — one record per ops file, `DRAFT → SUBMITTED → VALIDATED | REJECTED`, with `submitted_by/at`, `validated_by/at`, `rejected_by/at` and a `reject_reason` (`submit.php`, `validate.php`, `reject.php`).
- `ocr_line` — **per costing line**: `costing_line_id`, `item_code`, `budget_ttc`, `actual_ttc`, `doc_ref`, `doc_required` (`save_draft.php:163`).
- Validation writes back to the ops file — `ocr_id`, `ocr_amount`, `ocr_status='VALIDATED'` on `operations_file_master` (`validate.php:64`). The sign-off is what closes the file financially.

The rebuild has `GET /cost-tracking/dossier/:dossierId/reconcile`, and `costing.rules.js:33` is the whole of it — two numbers:

```js
{ budget, actual, variance, variance_percent, over_budget }
```

No persisted reconciliation, no line-level comparison, no document reference per line, no maker-checker, no reject reason, nothing stamped on the dossier. An ops lead cannot hand a validator a reconciliation to approve, and there is no record afterwards of who agreed the file closed at that number. `pricing_variance` is a different thing (sales-visible R/Y/G on quoted price vs cost) and does not fill this.

**DoD:** `cost_reconciliation` + `cost_reconciliation_line` on the existing document-lifecycle pattern, seeded from the approved costing's lines and the dossier's `cost_entry` rows; `SUBMITTED → VALIDATED/REJECTED` through the same approval chain as costing; write-back to `dossier`; the existing `reconcile()` becomes the preview.

### G20 · Milestone stages lose where it happened, against what, and interim progress

`api/operations_milestones/save_milestone.php` writes four things per stage: `m{i}_completed_at`, `m{i}_location`, `m{i}_reference`, `m{i}_notes` — and it has **two modes**. `mark_completed=1` completes the stage (with a retroactive completion date if supplied) and advances `current_stage_index` only if the index is at or ahead of the current one, so fixing stage 1 late does not rewind a file at stage 3. `mark_completed=0` is an *interim* update: location, reference and notes on a stage that is still in progress, without transitioning it. Those three fields are what the public tracking page shows the client per stage (G17).

`milestone_instance` has none of them. The re-baselining engine (`milestone.schedule.js`, 452 lines) is a genuine advance on the legacy calculator — the three-date model, water-filling compression, owner-tier attribution and the working calendar are all better than `MilestoneCalculator::adjustForWeekend()`, which only pushes Sundays. But the columns the operator actually types into are gone: the only free text is `cause_note` (max 500, delay attribution) and it is only writable through `POST /:id/advance`, which requires a status transition. There is no way to say "cleared customs at Douala Port, ref BAE-4471" without also moving the stage.

**DoD:** `location`, `stage_reference`, `progress_note` on `milestone_instance`; a `PATCH /milestones/:id` that writes them without a transition; surface them on the client-visible timeline.

### G21 · Tokenised public proposal link, and no signal that the client opened it

`smart_proposals.token` backs `api/public_quote_api.php` — explicitly *"strictly public (no role_guard.php), relies securely on the unique Token"*. Sales sends a prospect a link; the prospect opens their branded proposal with no account, no portal invite, no password. The payload joins the lead, the sales rep, and `smart_proposal_narratives`, which stores each narrative section **in both languages** — `client_context_en/fr`, `case_study_title/body_en/fr`, `operational_strategy_en/fr`, `custom_slas_en/fr`. `api/marginpricing-old/quote_downloaded.php` records the open.

The rebuild's `proposal` (`0350_sales_crm.sql:62`) has no token, no public route, and no open/download tracking; `proposal_narrative` has a single `body` and no French column, so a bilingual proposal cannot be stored even before the UI question in G1. Reaching a prospect requires provisioning them a `portal_user` — which is the wrong instrument for someone who has not bought anything yet.

**DoD:** signed, expiring, revocable proposal token + public `GET /proposals/public/:token`; `viewed_at` / `downloaded_at` back on the proposal; `body_fr` on `proposal_narrative`.

### G22 · Smart Comms notifies nobody

`api/cron_mail_digest.php` sweeps every 5–10 minutes for messages that are unread and `email_notified = 0` and older than a 5-minute grace period (deliberate — *"gives the user a chance to reply instantly without getting an email"*), groups them by receiver so five messages from one sender make one email, sends an HTML digest, and marks them notified. `chat_controller.php` also has `acknowledge`, which stamps `acknowledged_at` on a specific message — a read receipt on a directive, distinct from having read the channel.

The rebuild's Smart Comms is the better chat by some distance — threads, drafts, reactions, stars, quick replies, cross-channel search, channel certification, and a permission model that took its RBAC seriously. But `smartcomm.service.js` never calls the notification service: posting a message writes `comms_message` and stops. No in-app notification, no email, no web-push — all three of which exist and work for other modules (`notification.service.js` fans out IN_APP + EMAIL + push against per-category preferences). And `comms_message` has no acknowledgement column.

An instruction sent in Smart Comms is invisible to anyone who is not looking at the app, which the legacy explicitly solved four years of operator habit ago.

**DoD:** `notify()` on message post, category `COMMS`, honouring existing preferences; a digest job on the same grace-period logic as the cron; `acknowledged_at` on `comms_message` plus an acknowledge endpoint and a sender-visible list of who has.

### G23 · Transit order and delivery note silently drop their free-text lines

Both new services do the same thing:

```js
if (!l || !l.inventory_item_id) continue;    // transit_order.service.js:21, delivery_note.service.js:21
```

The validator marks `inventory_item_id` optional and `label` free text, so a caller who sends `{ label: "30 sacs ciment", packages: 30 }` — which is exactly what a forwarding transit order carries, and what the legacy print view produces — gets a 201, an allocated OT number, a captured document, and zero lines. No error, no warning. `transit_order_line`/`delivery_note_line` (`0476_document_lines.sql`) both define `label NOT NULL` and neither has an `inventory_item_id` column in the migration, so the filter is guarding a field the table does not carry.

Two fields are also not carried across. `create_transit_order.php` writes `insurance_type` and `transit_departure_date`; the new `transit_order` has neither, and the legacy print template renders the insurance clause from it (`transit-order.php:715`, *"Assurance non couverte par SMART LOGISTICS / Insurance not covered by SMART LOGISTICS"*). `delivery_notes` carries `client_address`, `client_phone` and `delivery_date`; the new `delivery_note` has `consignee`, `city_zone` and `contact_person` only — a delivery note with no address and no date.

**DoD:** drop the `inventory_item_id` filter and insert on `label` (reject empty labels instead of skipping); add `insurance_type` + `departure_date` to `transit_order`, `address` + `phone` + `delivery_date` to `delivery_note`; a test asserting a free-text line survives the round trip.

---

## P2 — controls

### G24 · The God Mode PIN never rotates and never expires

`cron_password_generator.php` mints a fresh 6-character token weekly from an unambiguous alphabet, hashes it, stores it against the ISO week with `expires_at = +7 days`, and emails it to the CEO. `god_mode_api.php:40` refuses any token past `expires_at`. The destructive credential is therefore short-lived by construction, out-of-band by delivery, and impossible to leave lying around.

`godmode.service.js:10` verifies an Argon2 hash held on the CEO's user row. Stronger hashing, but it is a standing secret: set once, no expiry column, no rotation job, nothing in `workers.js`. A PIN shared over someone's shoulder in month one still purges records in month nine.

**DoD:** expiry on the God Mode credential and a repeatable that rotates it and delivers the new one out-of-band (the notification EMAIL channel already exists and forces delivery for `security` categories); refuse an expired PIN.

### G25 · Success stories bind to one dossier; the legacy binds to many

`success_story_ops_links (story_id, operations_file_reference)` is a join table — a case study is evidenced by every ops file that fed it, and `success_story_api.php` builds the picker from eligible files across `IN_PROGRESS / OPERATIONALLY_COMPLETED / FINANCIALLY_PENDING / CLOSED`. `success_story.dossier_id` is a single nullable FK, so "we moved 40 containers for this client over six months" loses 39 of its receipts. Small, but it is the evidence the story rests on, and MOD-26 pushes these to the tenant website (G6).

**DoD:** `success_story_dossier` join table; the multi-select in the composer.

---

*Legacy read directly at `doc/reference/legacy_codebase/`; rebuild read at `1e04812`. Neither side taken from a status document.*

---

---

# Addendum II — Sales & CRM (Group IV), against the live system and the legacy source

**Date:** 15 August 2026 · **Repo:** `main` @ `f18833a`
**Basis:** a screen recording of the **live** PHP system (`SMART LS`, admin session, 15 Aug 10:53–10:55) covering all six CRM & Acquisition screens, read against the eleven legacy files the lead nominated — `sales-pipelining.php`, `smart-quote-intake.php`, `smart-quote-leads.php`, `success-stories-builder.php`, `market-campaign-registration.php`, `public_portfolio_api.php`, `public_quote_api.php`, `smart_quote_api.php`, `success_story_api.php`, `public_html/quote.php`, `public_html/portfolio.php` — and against PRD §9 Group IV (MOD-20 … MOD-26).

The earlier passes derived Group IV from the schema. This one asks what the module **does** in front of a user, and what the rebuild would have to do to replace it. G21 and G25 already touch this area; both are corrected below rather than duplicated.

**Decisions taken (15 Aug).** These are settled; the entries below are written to them.

1. **Clean start — no legacy data migration.** Removes the whole migration fork. `PRICING_IN_PROGRESS` (G28) drops from blocker to a design choice; intake and lead-conversion (G31, G32) become plain schema work with no mapping obligation.
2. **Keep the rebuild's `lead → opportunity` split.** The legacy fuses them (G31); the fusion is not worth preserving.
3. **Company DNA is per-tenant configuration**, authored through a profile UI (PDF upload, forms, or entry) and generated where possible from the tenant's own data — clients, corporate entities, dossiers. See G37.
4. **All five public surfaces in one pass** — quote intake, contact, partnership, shipment tracking, proposal links. One decision on rate limiting, anti-spam, CORS and anonymous uploads rather than five (G6, G17, G21, G35).
5. **French lands in the schema now, UI later.** Proposal narratives carry both languages from day one; the app-wide toggle stays with G1.
6. **Campaigns follow the legacy model** — budget, targets, approval workflow, manually-keyed actuals. No `campaign_id` attribution in this pass (G34).
7. **New-system numbering throughout.** No legacy ref formats are preserved; `SQ-YYYY-NNNNNN` and `QT-YYYYMMDD-rand` both go.
8. **Proposal generation is new capability, not a replacement.** Sales cannot reach the legacy builder today (see below), so it is scoped deliberately rather than ported under time pressure (G26).
9. **An approved vendor partnership creates a DRAFT supplier** through the existing supplier module (G36).

**Reachability, which reframes several entries below.** `smart-quote-leads.php` and `success-stories-builder.php` exist **only** under `view/admin/`. The "Leads & Proposal Generator" menu item is emitted in the sales and management role folders too, where the file does not exist — so a SALES user clicking it gets a 404. Nothing anywhere links to `success-stories-builder.php`; it is reachable only by typing the URL. Whatever these two modules do, they have not been doing it for the sales team.

**Scope note:** we are adding, not removing. Where a legacy vocabulary and a rebuild vocabulary disagree, the entries below say which one the data forces.

---

## P0 — cut-over and disclosure

### G26 · There is no AI generation path for proposals or success stories

MOD-23's defining sentence in the PRD is *"**AI-assisted** (Gemini) drafting + image integration + document tracking; **human review before send**"*. The review half exists and is good. The drafting half does not exist at all.

`src/modules/sales/proposal/proposal.ai.js` and `success_story.ai.js` are **not** generators — they are tool-catalogue registrations for the function-calling assistant (PRD §10.2), exposing `list_/get_/draft_/transition_/accept_` to DeepSeek. Nothing in `src/modules/sales/` calls a content model. `services/ai/` has `vision`, `transcription`, `llm`, `redact`, `orchestrator` — no content-generation entry point wired to a sales entity. `proposal.service.js` takes `narratives` straight off the request body, so **`proposal.ai_generated` is a boolean the caller asserts about itself**, and the same is true of `success_story.ai_generated`.

What the legacy actually has is more than a call to Gemini — the prompt is the asset (`smart_quote_api.php:139–237`):

- **~1 200 characters of hard-coded company DNA** — slogan, Douala/Kribi gateways, 2000+ sqm warehousing, 150+ trucks, 72-hour clearance benchmark, WCA/JCTrans membership, three named past projects with their real metrics.
- **Anti-hallucination constraints that name the failure mode**: *"You MUST adhere to these exact facts and never invent metrics"*, and four case-study archetypes (`ENERGY` 250+ TEU / 150M+ FCFA saved / 15 days cut · `PHARMA` UNFPA 100+ reefer cartons / suspensive UN regimes · `HEAVY` temporary admission to Ivory Coast and Mayotte · `SANITIZED` macro-metrics only) with an explicit *"Do not invent fake projects or fake financial values."*
- **Exactly four SLAs** on fixed themes (customs, visibility, cost/transit, handling) with formatting caps — titles under 30 chars, values under 40 — because they render into a fixed-width table.
- **Both languages in one call**, returned as a single JSON object with `_en`/`_fr` pairs, forced by `response_mime_type: application/json` plus a backtick-stripping regex for when the model disobeys anyway.

`success_story_api.php:130` is the same shape for case studies: aggregate real ops-file rows, hand them to Gemini with the messy sales notes, get back `title` / `exec_summary` / `ops_execution` / `hard_kpis[3–4]`.

Porting the plumbing without porting the prompt gives a generator that invents metrics about a logistics company — worse than having none, because it goes out under the company's name.

**DoD:** a content-generation service behind `services/ai/`, called from `proposal.service` and `success_story.service`, with the company-DNA block and the archetype constraints held as **tenant configuration** (Settings, MOD-70) rather than in source; Zod validation of the model's JSON per §10.3 with the 2-retry self-correction and manual-form fallback; `ai_generated` set by that path and by nothing else.

### G27 · Success-story generation sends dossier margin to Google

`success_story_api.php:139` selects, for every ops file feeding a story:

```sql
SELECT service_type, commodity, gross_weight, weight_unit,
       port_of_loading, port_of_delivery, eta, ata, margin
FROM operations_file_master WHERE operations_file_reference IN (...)
```

— and interpolates the whole result set into the Gemini prompt as `Raw Operations Data from Database`. **`margin` goes to an external model to write a public marketing page.**

That breaches two things the rebuild has already committed to: PRD §10.5 `[RULE]` PII/financial redaction before any external model call, and MOD-23's *"margins hidden"* from Sales — the role that drafts these. `services/ai/redact.js` exists in the rebuild and is exactly the right instrument; the risk is porting this query verbatim because it is the one that produces good copy.

Two smaller disclosure defects in the same file, worth fixing rather than reproducing:

- `public_portfolio_api.php:62` serves `SELECT s.*` on an **unauthenticated** endpoint with `Access-Control-Allow-Origin: *` — every column of `smart_success_stories`, including internal authoring fields, to anyone with the slug.
- `fetch_eligible_ops` (`:33`) offers `IN_PROGRESS` files to the story picker, so a case study can be published about a job that has not finished.

**DoD:** margin and any cost field excluded from the generator's input set at the query, not by redaction downstream; the public portfolio endpoint returns an explicit column allow-list; the eligible-file picker restricted to `OPERATIONALLY_COMPLETED` / `FINANCIALLY_PENDING` / `CLOSED`.

### G28 · The pipeline stage the live data sits in does not exist in the rebuild's seed

Correcting the earlier pass, which recorded these as unseeded: `migrations/seeds/9030_seed_reference.sql:17` **does** seed `pipeline_stage`, as `NEW · QUALIFIED · PROPOSAL · NEGOTIATION · WON · LOST`.

The legacy set (`api/sales_pipeline/_common.php:26`) is `NEW · QUALIFIED · PRICING_IN_PROGRESS · QUOTATION_SENT · NEGOTIATION · WON · LOST`. Two differences, and the second one bites:

- `QUOTATION_SENT` → `PROPOSAL`. Cosmetic; map at import.
- **`PRICING_IN_PROGRESS` has no counterpart.** It is not decorative — it is the stage that means "with the margin simulator", i.e. the handoff from MOD-24 to MOD-27, and it carries `prob: 50` in the legacy's stage config (`sales-pipelining.php:518`).

The recording shows live rows sitting in it right now: the intake register renders `SP-PRICING IN PROGRESS` on the two most recent quote requests. A migration run today drops those rows into no stage at all.

**DoD:** add `PRICING_IN_PROGRESS` to the seed with the legacy's sort order and probability, or an explicit documented mapping decision for the rows that hold it; keep `is_won`/`is_lost` as they are.

### G37 · Tenant company profile ("company DNA") — specified, nowhere in either system

Per decision 3. This exists in neither system in a usable form: the legacy has it as ~1 200 characters of prose hard-coded into a PHP string (`smart_quote_api.php:152–164`), and the rebuild has nothing at all. It is a build item in its own right, not a sub-task of G26, because the generator is useless without it and every future AI content feature will want the same thing.

The legacy block carries seven distinct kinds of fact, and they do not share a source:

| Fact type | Legacy example | Source |
|---|---|---|
| Positioning / voice | *"Going Beyond Your Expectations"* | Declared |
| Physical capability | 150+ trucks, 2000+ sqm warehousing | **Derived** — MOD-39 fleet registry, MOD-34 space management |
| Geographic footprint | Douala & Kribi gateways, CEMAC | **Derived** — POL/POD frequency across dossiers |
| Verticals | Energy, Pharma, Heavy Machinery | **Derived** — service type + commodity mix |
| Performance benchmarks | 72-hour customs clearance | **Both** — the promise is declared, the evidence is derived from milestone timestamps |
| Credentials | WCA member, JCTrans network | Declared — not transactional data |
| Proof points | L&T: 250+ TEU, 150M FCFA saved, 15 days cut | **Derived** from dossiers, but gated on consent |

**Anything measurable should be derived, never typed.** Not for convenience — a typed number is a number that goes stale silently. *"800M+ FCFA turnover"* was true when someone wrote it into the PHP and has been true-ish ever since by nobody checking. A figure computed from the ledger with an as-of date cannot drift.

**Three layers, built separately:**

1. **Declared profile** — slogan, positioning, memberships, certifications, service promises. Small, stable, human-authored; this is what the upload UI collects.
2. **Derived fact sheet** — a scheduled recomputation from the tenant's own data: fleet count, warehouse capacity, top lanes, vertical mix, average clearance time, client count, turnover band. **Typed fields, not free text**, each with a computed-at timestamp, so the generator cannot misread its own inputs.
3. **Proof points** — individual case studies linked to real dossiers, each separately approved for external use. This is also what MOD-26 publishes (G35), so the two should share a store rather than diverge.

**Five constraints that belong in the design, not in review comments:**

- **Client consent is the gap nobody has raised.** The legacy names UNFPA and L&T outright, hard-coded. A client's name cannot go into a proposal or a public portfolio page without permission, and for NGO or government-adjacent work that permission is often contractual. Needs a `may_be_referenced_publicly` flag on `client_master`, set deliberately, with a fallback to anonymised phrasing when absent. The legacy already has the pattern — its `SANITIZED` archetype — it just never gates on anything.
- **PDF extraction must populate the same fields as the derived path.** If an uploaded profile lands as a text blob while derived facts are typed fields, there are two incompatible sources and the model will favour whichever is longer. Extraction fills the declared-profile fields with human confirmation per field, which PRD §10.4's vision rule requires anyway.
- **Anti-hallucination is structural, not prose.** The legacy writes *"never invent metrics"* into the prompt and hopes. Pass a closed, numbered fact set; require each generated claim to reference the fact it rests on; reject output citing a fact not in the set. That is §10.3's Zod gate applied to content rather than actions.
- **Margin and cost never enter the fact set.** The derived layer touches the ledger, so the exclusion is drawn once, at the query — same boundary as G27.
- **Schema-scoped, and sandbox-capped.** One tenant's proof points appearing in another's proposal is a commercial incident, not a bug; and regenerating the fact sheet is an AI spend that has to respect the sandbox cap (G2), or a training session burns live credits.

**DoD:** `tenant_profile` (declared) + `tenant_fact_sheet` (derived, timestamped, typed) + proof-point store shared with `success_story`; a profile UI accepting form entry and PDF extraction into the same fields; a scheduled recompute job; `may_be_referenced_publicly` on `client_master` with anonymised fallback; the fact set passed to the generator as a closed numbered list with citation validation.

**Open:** refresh cadence (scheduled vs. on composer open), and who sets the client consent flag.

---

## P1 — capability the rebuild has not reached

### G29 · `proposal` holds none of the commercial substance of a legacy proposal

G21 covers the token, the public route and `body_fr`. This is the rest of the record, and it is most of it.

`smart_proposals` carries, and `proposal` (`0350_sales_crm.sql:62`) does not: `language`, `currency`, `service_category`, `incoterm`, `origin_location`, `destination_location`, `cargo_description`, `estimated_weight`, `project_cargo_flag`, `customs_clearance_target`, `transit_time_target`, `free_days_demurrage`, `payment_conditions`, `validity_days`, `converted_client_id`, `converted_quote_id`. The rebuild's proposal has `title`, `status`, `ai_generated`, `reviewed_by`, `pdf_vault_id` and its lines — a document header with no commercial terms, so the public renderer would have nothing to put on the page (`public_quote_api.php:59–78` reads every one of the above).

`smart_proposal_narratives` additionally keeps the **raw AI inputs** beside the output — `raw_client_operations`, `raw_pain_points`, `raw_proposed_strategy`, `raw_tone` — which is what makes a regenerate-with-a-different-tone possible without re-interviewing the client. `proposal_narrative` is `(section, body, sort_order)`.

One thing that **is** already right and should not be rebuilt: `proposal_line.dictionary_item_id` (`:79`) exists and references `dictionary_item`. The legacy reaches the same place by borrowing the proforma module's endpoint (`proforma-api.php?action=search_dictionary`, `smart-quote-leads.php:1334`) and only takes the description — the unit-price prefill is commented out at `:1371`. The rebuild's model is better; the gap is the autocomplete in the composer, not the schema.

**DoD:** the commercial-terms columns on `proposal`; `language` on `proposal_narrative` (with G21's `body_fr` folded in) plus the four `raw_*` inputs; dictionary autocomplete in the proposal composer, with the unit-price prefill as a decision rather than a commented-out line.

### G30 · Proposal delivery: WhatsApp share, and a PDF that is never stored

The legacy's send is not an email. `showShareModal()` (`smart-quote-leads.php:1634`) builds `https://smartls.cm/quote.php?token=…`, pre-fills the lead's phone and a canned covering message, and `sendWhatsApp()` opens `wa.me/<digits>?text=<encoded>`. Copy-link and open-in-tab sit beside it. This matches PRD §11.5's *"a contact's phone opens `wa.me`"* convention, so it is house style rather than a legacy quirk.

The PDF is generated **in the client's browser**: `quote.php:617` walks `.a4-page` nodes through `html2canvas` at scale 2, pastes each as a full-page JPEG into `jsPDF`, and calls `pdf.save()`. So it is a rasterised image PDF — unsearchable, unsigned, never uploaded, and never seen by the server. `proposal.pdf_vault_id` exists in the rebuild and nothing writes it; the rebuild's server-side PDF kit (bilingual templates, XAF formatting, watermarks) is strictly better and already built.

Correction to G21, which credits `api/marginpricing-old/quote_downloaded.php` with recording the open: that file exists, but `generatePDF()` never calls it and neither does `quote.php` on load. **Legacy open/download tracking is dead code.** There is no signal today that a client opened a proposal — the rebuild would be adding the capability, not restoring it.

**DoD:** server-side proposal PDF into the vault on `SENT`, written to `pdf_vault_id`; a share action producing the tokenised link with a `wa.me` and a copy option; `viewed_at`/`downloaded_at` stamped by the public route (G21).

### G31 · Quote-request intake has no home, and its status column does two jobs

`quote_requests` is live and busy — 26 rows, refs running to `SQ-2026-000027`, `intake_channel` rendered under each ref. PRD MOD-20 grounds Leads in *both* `smart_leads` **and** `quote_requests`, so folding intake into `lead` is the intended target shape, and decision 1 above confirms it. The fold has to answer two things the schema alone does not show.

**The status column is overloaded.** `chipStatus(s, isPipeline)` (`smart-quote-intake.php:701–707`) prefixes `SP-` and forces dark styling whenever `converted_opportunity_id` is set, then prints the raw status. So `quote_requests.status` holds intake values (`RECEIVED`, `UNDER_REVIEW`, `CLARIFICATION_REQUIRED`, `QUOTED`, `CONVERTED_TO_OPPORTUNITY`, `CLOSED_NO_ACTION`) **and** pipeline stages, with `sales_pipeline/_common.php:24` mapping `'' | RECEIVED → NEW` on read. One row, one column, two state machines.

**Which is why the KPIs on that screen do not add up.** The recording shows `TOTAL 26 · RECEIVED 3 · UNDER REVIEW 0 · QUOTED 2 · CONVERTED 0`. Five of twenty-six. The other twenty-one hold pipeline stages that no intake counter matches, and `CONVERTED 0` is false — rows have converted and moved on past the value the counter looks for.

There is also a live inconsistency not to port: `isConverted` is computed from `converted_opportunity_id` in the row renderer (`:847`) and from `status === 'CONVERTED_TO_OPPORTUNITY'` in the drawer (`:1019`), so a converted row greys out in the list while the drawer still offers Convert.

Fields with no home in `lead` today: `public_quote_ref` (`SQ-YYYY-NNNNNN` via `doc_sequences`), `intake_channel` (`WEBSITE` / `MANUAL_ENTRY` / `SMART_QUOTE`), `submission_datetime`, `requester_*` (pre-client, no `client_id` yet), `service_category`, `service_type`, `incoterm` — **required on the intake form**, confirmed on screen — `origin_location`, `destination_location`, `warehouse_location`, `warehouse_duration`, `estimated_weight`, `estimated_value_xaf`, `project_cargo_flag`, `cargo_description`, plus single-file attachment columns and the `quote_request_documents` multi-doc table.

**DoD:** intake fields onto `lead` (or a `lead_request_detail` child) with `intake_channel` and the public ref; the intake lifecycle expressed as `lead.status` values distinct from `pipeline_stage`, so nothing is ever both; KPI counters that partition the whole set; a documented mapping for the 26 live rows.

### G32 · Lead conversion still cannot produce a complete client

`lead` has `company_name`, `contact_name`, `email`, `phone`, `source`, `service_interest`, `status`, `owner_user_id`, `client_id`, `details_json`. `smart_leads` also has **`country`, `address`, `niu`, `rccm`** — captured on the Register New Lead modal, seen in the recording, with NIU and RCCM marked optional.

Those four are exactly what `convert_lead` (`smart_quote_api.php:389`) needs to write a complete `client_master` row in one transaction, alongside creating a `quote_requests` row and back-linking `converted_client_id` / `converted_quote_id` on the proposal. Without them the rebuild's conversion produces a client stub that Finance has to re-key before it can be invoiced.

Two legacy defaults in that transaction are **not** worth porting: `client_type` hard-coded to `'BOTH'` and `payment_terms_days` hard-coded to `30`, both regardless of what the lead is. And `$data` is reassigned to `random_bytes(16)` mid-transaction at `:423`, shadowing the request payload — harmless only because nothing reads it afterwards.

**DoD:** `country`, `address`, `niu`, `rccm` on `lead`; conversion carries them into `client_master`; client type and payment terms prompted or defaulted from settings, not constants.

### G33 · Meeting discovery is a structured instrument in the legacy, free text in the rebuild

The Live Meeting button opens **Supply Chain Diagnostic — Client Discovery Framework**: select a lead, meeting date, location, then three named sections — Business & Operations Context, pain points, proposed strategy — **each with its own microphone button**, each printed with scripted consultative probing questions (*"What is the core nature of your imported/exported goods…"*, *"What are your average monthly container/tonnage volumes?"*, *"Who are your primary end-users, and how critical is delivery timing to your revenue?"*). Saving writes `meeting_ops` / `meeting_pain` / `meeting_strategy` on the lead (`save_meeting_notes`), and **those three fields are the input to the proposal generator** (`generate_ai_content` takes exactly `client_operations`, `pain_points`, `proposed_solution`, `tone`).

The rebuild's `meeting` + `meeting_note` is the better structure — a real meeting entity, minutes flag, author — but it is unstructured free text with no route into anything. So the chain *discovery → draft* is broken at both ends: nothing captures the three inputs, and nothing consumes them (G26).

On transcription, correcting the earlier pass: the rebuild **does** have a transcription path — `services/ai/transcription.service.js` and the `ai-transcribe` job handler, governed through `ai/governance`. The gap is narrower than "unwired": `meeting.transcript_vault_id` is set from the request body at create time (`meeting.service.js:10`) and nothing in the meeting flow enqueues `ai-transcribe`. The legacy does it inline — `transcribe_audio` posts base64 webm to Groq `whisper-large-v3`, writes an ephemeral temp file and unlinks it immediately.

**DoD:** a discovery-note structure on `meeting_note` (typed sections rather than free `body`) or typed fields on `lead`; per-section dictation that enqueues `ai-transcribe` and lands the text in the section; the generator reads the lead's latest discovery set.

### G34 · Marketing campaigns: an email sender where a budget-and-ROI record is specified

`marketing_campaign` is `name`, `channel` (free text), `status` (`DRAFT/ACTIVE/PAUSED/ENDED`), `starts_on`, `ends_on`, `assets_json` — plus the rebuild's own `campaign_sender`, `campaign_template`, `newsletter_subscriber` and `/campaigns/:id/send`, which the legacy has no answer to and which should stay.

`marketing_campaigns` is a different instrument: `platform` (`META` · `GOOGLE` · `LINKEDIN` · `EMAIL` · `OFFLINE` · `OTHER`), `owner_name`, `target_service`, `budget_amount` + currency, `remarks`, plan-vs-actual on three axes (`target_leads`/`target_opportunities`/`target_won` against `leads`/`opportunities`/`won`), a KPI roll-up (total spend, total leads, total won, average conversion), CSV export, and an approval workflow — `PLANNED → PENDING_APPROVAL → ACTIVE`, with `rejection_reason` and a guard stopping a SALES user editing while pending. The live screen shows the four KPI tiles and the filter set; it also shows the register empty and an on-screen banner reading *"Performance metrics (Leads, Wins) are currently in **Manual Entry Mode**. Update these figures weekly based on external ad manager reports."*

That banner is the point. The legacy actuals are **typed integers**, because nothing attributes a lead to a campaign. `lead.source` has a `CAMPAIGN` enum value and no `campaign_id`; `opportunity` has no campaign reference; the pipeline's Attribution tab is labelled "(Locked)" and ships the literal `campaign: 'N/A'` (`sales-pipelining.php:581`). Adding `campaign_id` to `lead` and `opportunity` makes the actuals derived and the ROI real — it is the one place in this addendum where the honest recommendation is to exceed the legacy rather than match it, and it is a data-model change, so it needs a decision.

**Decided (6):** port the legacy model — manually-keyed actuals, no attribution link. Noted once and not relitigated: `campaign_id` on `lead` and `opportunity` would make ROI self-computing, and adding it later is a migration rather than a schema addition, so the door narrows over time. Not a blocker.

**DoD:** budget + currency, platform, owner, target service and remarks on `marketing_campaign`; plan-vs-actual on the three axes; `PENDING_APPROVAL` with `rejection_reason` and the edit guard that stops a SALES user editing while pending; the four-tile KPI roll-up; CSV export.

### G35 · Public portfolio: the surface exists in the PRD and the legacy, nowhere in the rebuild

MOD-26 is *"Sign-off sheet → AI-assisted push to public portfolio/success stories"*, and the meeting's stated point was *"no back-end engineer needed to hand-code portfolio updates"*. The legacy delivers it: `public_portfolio_api.php` serves `get_all_stories` (published only, lightweight — slug, title, service category, cover image, client logo, client name, publish month) and `get_story_details&slug=`, consumed by `public_html/portfolio.php` as a grid and `portfolio-case.php` as the SEO detail page.

`success_story` is `title`, `dossier_id`, `summary`, `body`, `ai_generated`, `is_published`, `signed_off_by`, `published_at`. Missing against `smart_success_stories`: **`slug`** (the public URL key, and the join key for the whole public surface), the `doc_sequences`-issued story ref, `client_id` + `client_logo_path`, `service_category`, the three structured sections `exec_summary` / `ops_execution` / `hard_kpis` (the last a JSON array of `{label, value}` that the AI is instructed to emit as exactly 3–4 items and the page renders as a KPI strip), `cover_image_path` and `gallery_images` — there is no media on the rebuild's story at all, and `upload_assets` in the legacy handles cover, logo and gallery.

This extends G6 (public surfaces) and G25 (one dossier vs many). G25's `success_story_dossier` join table is still absent — the only match in `migrations/` is the index name `idx_success_story_dossier_id` on the singular FK.

**DoD:** `slug` (unique, published-scoped), `client_id`, `service_category`, the three structured sections, cover/logo/gallery media; the G25 join table; public `GET /portfolio` + `GET /portfolio/:slug` on an explicit column allow-list (G27), rate-limited, alongside the other public surfaces in G6.

### G36 · Inbound intake loses its classification fields, and its vendor link

**Contact enquiries.** `contact_enquiry` has `name`, `email`, `phone`, `subject`, `message`, `source`, `status`, `lead_id`. `contact_enquiries` also has `enquiry_type` (`GENERAL_ENQUIRY` · `PARTNERSHIP` · `CAREERS` · `MEDIA` — the live screen filters on it and shows all four current rows as `GENERAL_ENQUIRY`), `company_name`, and `internal_notes` (5 000 char cap). Status vocabularies differ: legacy `NEW / READ / RESPONDED / CLOSED` against the rebuild's `NEW / TRIAGED / CLOSED` — the rebuild cannot record that someone replied. The live screen's KPI row is total / new (unread) / responded / closed, which needs `RESPONDED` to exist. The rebuild's `triage → lead` conversion is new and good; the legacy has no equivalent.

**Partnership requests.** `partnership_request` has `company_name`, `contact_name`, `email`, `proposal_text`, `status`. `partnership_requests` also has `country_of_origin`, `network_memberships` (JSON array — WCA, JCTrans and similar, which is the whole point of vetting a forwarding agent), `contact_title`, `proposal_type` (`AGENCY_PARTNERSHIP` · `VENDOR_REGISTRATION`), `corporate_profile_ref` (the uploaded company profile) and `internal_notes`. Statuses are `NEW / IN_REVIEW / APPROVED / REJECTED` against `NEW / REVIEWING / ACCEPTED / DECLINED`; the live KPI row is total / agency / vendor / pending, which needs `proposal_type`.

**On vendor onboarding, an earlier recommendation in this document was wrong.** The live Partnership screen prints *"This module captures intake only. It does not auto-create suppliers. Approved vendors must be manually onboarded in the Supplier Master Registry"*, and that was read here as a deliberate control to preserve. It is a limitation of the legacy, not a control — and the rebuild has already outgrown it.

`supplier_master.service.js:24` creates every supplier as `registration_status: "DRAFT"`. `POST /:id/verify` is gated on the `approve` permission, `/block` and `/unblock` take a reason, changes in LIVE open a maker-checker request needing `approve`, `masterConfig.enforceRequired(client, "SUPPLIER", …)` applies the tenant's field policy, registrations are validated per country, the ref is allocated through `numbering.service`, and the auxiliary COA account is only allocated on activation. The gate the legacy achieves by making a human retype everything is already in the module, enforced, and audited.

So an approved `VENDOR_REGISTRATION` should **create a DRAFT supplier** carrying across what intake already collected — company name, country, contact, and the uploaded corporate profile into the vault — and stop there. Nothing becomes payable, no COA account is allocated, and no purchase order can draw on it until someone with `approve` verifies it. That removes the re-keying without removing the check.

**DoD:** `enquiry_type`, `company_name`, `internal_notes` and a `RESPONDED` state on `contact_enquiry`; `country_of_origin`, `network_memberships`, `contact_title`, `proposal_type`, profile-document reference and `internal_notes` on `partnership_request`; KPI counters on both; `approve` on a `VENDOR_REGISTRATION` creates a DRAFT `supplier_master` row with the profile document attached, and back-links it on the partnership request.

---

## Corrections to earlier entries

- **G21** — two public token endpoints exist, not one: `public_quote_api.php` (full, with narratives) and `smart_quote_api.php?action=get_proposal_public` (same shape, narratives omitted). The token is `'SLAS-' . bin2hex(random_bytes(4))` — **32 bits of entropy**, no expiry column, no revocation; `signature_hash` is `sha256(token · ref · time())` and is displayed but never re-verified. `proposal_ref` is `'QT-' . date('Ymd') . '-' . rand(100,999)` — random, not `doc_sequences`, and collision-prone within a day. The claim that `quote_downloaded.php` records the open is wrong: nothing calls it (see G30).
- **G25** — still open; `success_story_dossier` does not exist. Folded into G35's DoD.
- **Pipeline stages** — recorded in an earlier pass as unseeded. They are seeded (`9030_seed_reference.sql:17`); the real defect is the missing `PRICING_IN_PROGRESS`. See G28.
- **Meeting transcription** — recorded earlier as an unwired worker. The worker and service exist; only the meeting-flow enqueue is missing. See G33.

## Still open

1. **The domain list for the public surfaces** (decision 4). One pass covering all five needs to know which origins call it before CORS, rate limiting and anti-spam can be specified. This is now the blocking input for that workstream.
2. **Derived-facts refresh cadence** (G37) — scheduled, or on demand when the composer opens.
3. **Which clients may be named publicly** (G37) — needs a flag on the client record and a decision on who sets it.

---

## Suggested order

1. **G2** sandbox side-effects — smallest fix here, and the only one that embarrasses you in front of a client during training. Before the first rollout.
2. **G3** schedule the wipe — one repeatable in `workers.js`.
3. **G4** login strapline — minutes.
4. **G23** transit-order / delivery-note line drop — a silent data-loss bug on two documents the meeting said to import as-is. Two lines of code and two migrations.
5. **G16** extra-charge simulator — the founder asked for this verbatim and it is the most visibly unfinished thing on the list. The day arithmetic before the missing families: it is currently confidently wrong.
6. **G17** public tracking — it is in the live site's top nav today, so it breaks the moment the old system goes off. Pair with **G6**'s public intake; same infrastructure decision.
7. **G18** payroll config — before the first live payroll, not after. A rate change should not be a deploy.
8. **G1** start bilingual EN/FR — land the runtime and shell now; it only gets worse. **G21**'s `body_fr` belongs in this pass.
9. **G5** God Mode referential guard — before another posting module ships. The legacy's fifteen hand-written cascade lists in `god_mode_api.php:150–320` are a ready-made dependency map to check the catalogue discovery against. **G24** rides along.
10. **G19** cost reconciliation — the missing close-out step for every dossier; needed before the first month-end run on real files.
11. **G7** Excel rate import + **G6** public intake — onboarding and commercial blockers for tenant #2. **G21** proposal tokens sit here too: it is how sales reaches a prospect who has no portal account.
12. **G22** Smart Comms notifications — cheap (the fan-out already exists), and the feature is close to unusable without it.
13. **G20** milestone location / reference / notes — needed by **G17** to have anything to show.
14. **G8** wire `error-reporting.ts` into ticket `context` (small), then **G9** consolidation, then **G25**.
15. **G13** confirm key rotation and run the git-history secret scan once — cheap, and it's an assurance already given. (**G14** closed 15 Aug: `backup-storage.service.js` ships an S3 offsite driver and `backup-run.js` carries a `drill` mode on `RESTORE_DRILL_CRON` that restores the least-recently-drilled tenant into a scratch database and treats a failed drill as terminal.)
16. **G10** integration suite against real Postgres → **G11** load test → **G12** migration tooling.

**Group IV inserts (Addendum II), against the 15 Aug decisions.** **G27** margin-to-Gemini is a disclosure defect — settle it before any generator work starts. **G37** (tenant company profile) is the prerequisite for **G26**, and **G26** is now scoped as new capability rather than a rushed port, so the sequence is G37 → G29's columns → G26. **G28** is a one-line seed decision, no longer migration-blocking. **G35** joins **G6**'s public-surface pass, which decision 4 makes one piece of work covering **G6**, **G17**, **G21** and **G35** together — the domain list is the blocking input. **G30**'s proposal PDF joins the vault work. **G31**, **G32**, **G34** and **G36** are field-level catch-up that can trail; **G36**'s DRAFT-supplier link is small and removes real re-keying.

---

*Addendum II written 15 August 2026 against a screen recording of the live system and the legacy source at `doc/reference/legacy_codebase/`; rebuild re-read at `f18833a`. Decisions 1–9 taken with the lead the same day.*
