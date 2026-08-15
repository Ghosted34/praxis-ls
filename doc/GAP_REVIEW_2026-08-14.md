# Praxis LS — Gap Review

**Date:** 14 August 2026 · **Repo:** `main` @ `37e5846`
**Basis:** `SmartLS_PRD_Master_Functional_Spec_v2.md` and `Praxis_LS_Kickoff_Meeting_Transcript.md`, both read in full, verified against source — `src/modules`, `client/src` (112 screens), 125 tenant migrations, `src/jobs/workers.js`, `.github/workflows/ci.yaml`.

Pure gaps only. Architecture deviations that just need the PRD amended are excluded.

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

`tests/integration/` holds 5 tests (`journal-posting`, `ledger-hardening`, `mail-imap`, `orchestration-import-freight`, `party-merge`) against 176 test files total, and CI runs `npx jest` with no Postgres service container.

Untested end-to-end: gap-free numbering under concurrency, RBAC enforcement, three-way match, receipt allocation, TAFIRE, tax returns. Highest-value next investment on this list.

### G11 · No load test

Nothing — no k6, artillery or autocannon. PRD §14 targets p95 < 400 ms at 20–50 concurrent users per tenant.

### G12 · MySQL → PostgreSQL migration tooling: zero lines

No `mysql` reference anywhere in `scripts/` or `src/`. Correctly deferred (PRD §16 makes migration client-owned, post-build) — but *"with our tooling/support"* is a commitment, and the staging-schema reconciliation approach should be designed before Phase 5 opens, not during it.

### G13 · Key rotation and history secret scan unconfirmed

CI has a working-tree secret scan, `npm audit` blocking at high with a dated exception, and CodeQL — all good. But the scan's own comment notes **git history is not covered**, and `scripts/scan-history-secrets.sh` exists outside CI.

PRD Appendix A states the discovery-shared Gemini / Groq / DeepSeek / exchangerate keys are *"considered exposed and MUST be rotated before build."* Confirm rotation happened; run the history scan once.

### G14 · Backup off-box destination and restore drill cadence

`backup-run.js` and `db:objects:sync` exist and are scheduled. PRD §6.3 additionally requires backups shipped **off-box** with **monthly restore tests** (`db:restore:drill` exists, unscheduled). Confirm the off-box destination is configured in production and put the drill on a cadence.

### G15 · Provider runtime enablement

PDF/Chromium, Groq voice, Gemini vision, SMTP, FX all throw until keys or binaries are present. Needs one documented tenant-onboarding checklist run against `/vendors/:vendor/test`.

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
15. **G13/G14** confirm rotation, off-box target, drill cadence — cheap, and they're assurances already given.
16. **G10** integration suite against real Postgres → **G11** load test → **G12** migration tooling.

---

*Read directly from source at `37e5846`, not from the repo's status docs. Addendum G16–G25 re-verified at `1e04812`.*
