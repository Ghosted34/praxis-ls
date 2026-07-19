# Praxis LS — Work Done Log

Running log of substantive changes landed against `doc/WORK_TO_BE_DONE.md`,
newest entry on top. Companion to that file: WORK_TO_BE_DONE.md is the
backlog (checkboxes get ticked in place), this file is the append-only
record of *what actually happened and why*, for anyone picking up context
later without re-reading every diff.

---

## 2026-07-18 — Post-merge: idiom convergence, last screens, entity gaps

**Context.** After PR #11 merged and both streams' work was reconciled (see `SESSION_HANDOFF.md`
"Post-merge reconciliation"), this pass converged the duplicated UI idioms and closed the last
buildable FE items. **Client `tsc` clean; changed BE files `node --check` + `eslint` clean.**

**Idiom convergence.** Of the three apparent conflicts, only one was real:
- **AI** — no work: his `ScreenAi`/`PraxisCopilot` already import this stream's `AiActions`/`useAiEnabled`,
  so they compose on the global gate rather than competing with it.
- **Lists** — kept both (`ResourceList` self-fetches; `DataList` is presentational, and is now the default
  for new wired screens). Real duplication was `cell()` existing twice and **diverging** on boolean casing
  → single implementation in `lib/format.ts`, re-exported from `components/data-list.tsx` and
  `features/sales/ui.tsx` so no import path changed.
- **Tabs** — kept both (`TabbedHub` = route-driven shell, `Segmented` = in-page state). Master data was
  hand-rolling an identical bar → now uses `TabbedHub`, via a new optional `inlineTabs` prop (default off)
  because that hub's pages don't render `<HubTabs/>` and would otherwise lose their tabs.

**Screens.**
- **Module catalogue** built — `features/settings/catalogue-page.tsx` over `GET /catalogue/modules`
  (MOD-67 view, read-only): group chips, search, counts, link to the permission matrix.
- **Business setup retired** — it duplicated the Corporate entities editor; the route now redirects to
  `/master/corporate-entities` and the Settings-hub card was repointed.

**Corporate entity gaps (BE + FE).** `address`/`bank_block` were API-writable with no UI; the logo columns
were unwritable (validator dropped them). Added both logo fields to the validator and a new
**`POST /entities/:id/logo`** — 512 KB cap, allowed image types, stored per tenant+entity, audited, and
**gated MOD-01 edit** (not the MOD-70 `/branding/logo`, which would force settings-admin rights). FE: the
editor now covers Address, a Bank details block (→ invoice payment block) and the letterhead logo.

**Control Tower.** 4th KPI card (receivables overdue) now derived FE-side from the `receivables_ageing`
report producer — no new BE; hides when `reporting` is off. All four cards live.

**Bundle.** `manualChunks` added to `vite.config.ts` for the >500 kB warning. **Unverified in-sandbox**
(`vite build` needs the Linux rollup binary the Windows lockfile omits) — revert that file if the Windows
build errors. Improves caching, not first-load bytes; route-level `React.lazy` deliberately deferred.

## 2026-07-18 — Session 8: FE follow-ons + every pending BE job (build BE then FE)

**Context.** Cleared this stream's FE follow-on backlog, then built out **all pending BE jobs** end to
end (BE first, then the FE wiring). Sandbox-validated as far as it can: **`node --check` + `eslint`
clean on all BE files; `tsc --noEmit -p client` clean.** `npm run lint`/`test`/`build` + **applying the
two new migrations** remain the authoritative Windows checks (sandbox can't run the DB tests).

**Part A — FE follow-ons (all `tsc`-clean):**
- **Reference pickers → `SearchSelect`** across sales/commercial/finance/settings/portal (meeting,
  opportunity, proposal entity/client, quotation entity, pricing-variance, credit-note entity/client/
  reversed-invoice, bank-account, portal client-scope, opportunity win-form). Added an optional
  `filter` prop to `SearchSelect` (keeps the credit-note reversed-invoice picker scoped to FINAL).
- **Settings store tiles** — new `features/settings/store-pages.tsx`: Document templates, Custom fields,
  Email signatures, Business policies on the generic `/settings/:section/:key` store (MOD-70), routed.
- **Vault trio built** — `DocumentsPage` (upload/download/archive over `/documents`, authed binary
  download), `SignaturesPage` (per-`entity_ref` list + sign, feature-gated), `VerificationPage` (hash
  lookup → tamper verdict) in `features/vault/pages.tsx`, routed (replaced `<Planned/>`).
- **PWA** `manifest.background_color` now follows the tenant theme (`src/routes/pwa.js`).
- **Smart Comms** — new `features/comms/pages.tsx` (`/comms`, feature `comms`): two-pane channel list
  (search + New-channel modal with kind/topic/member picker, unread badges) | thread + composer, over
  `/smartcomm`; marks read on open. Routed.
- **My Workspace** — new `features/workspace/pages.tsx` (`/workspace`): greeting + metric tiles +
  Awaiting-your-approval (`/approvals?status=PENDING`) + Recent notifications (`/notifications`) + quick
  links. Composes existing read endpoints. Routed.
- **Build-map correction** — the Master data hub (incl. Expense rates + Financial dictionary) was already
  built; `FE_IA_BUILD_MAP.md` corrected (no rebuild).

**Part B — pending BE jobs (BE + FE):**
- **Dashboard KPI aggregates.** `dashboard.repo.js kpis()` gained guarded `revenue_final_ttc`
  (Σ locked FINAL invoice TTC), `revenue_currency`, `fleet_active`/`fleet_total`, `sla_on_time_pct`
  (dossier `ata ≤ eta`; NULL-preserving `num()` helper). `features/dashboard.tsx` feeds the Control
  Tower's revenue/SLA/fleet cards from these and hides any null card (the 4th "overdue" card has no
  aggregate → stays mock).
- **Refresh-token rotation + reuse-detection.** `app_user.service.refresh()` mints a fresh refresh
  token (sliding exp), returns it, and stores its jti on the session (`user_session.refresh_jti`,
  migration `0453`). On refresh the jti must match the session's current one; a mismatch revokes the
  session (replay/theft signal). Legacy NULL-jti sessions grandfathered. `issueSessionTokens` stamps
  the jti on login/2FA/PIN.
- **Campaign templates + senders + send (MOD-22).** Migration `0452` (`campaign_sender` +
  `campaign_template`). Extended `sales/marketing_campaign` with `/campaigns/senders` (+ `/:id/verify`),
  `/campaigns/templates` CRUD, and `POST /campaigns/:id/send` (fan-out: one durable "email" queue job
  per active subscriber, template's sender as the `from` override), all registered before `/:id`. FE:
  `TemplateForm` moved off the `/settings/campaign_template` stopgap to the new endpoints + a sender
  picker with inline `SenderForm`; a **Send…** button on each campaign card opens `SendCampaignModal`.

**Tests (new).** `tests/unit/auth-refresh-rotation.test.js` (reuse-detection predicate `refreshTokenReused`
— extracted as a pure exported seam) and `tests/unit/campaign-send.test.js` (`sendCampaign` orchestration
with repo/emit/queue mocked). `node --check`-clean and house-style; **jest couldn't boot in-sandbox
(no Redis/Postgres) — run on CI/Windows.**

**Postman.** Added folder **13 · Marketing / Campaigns** (subscribers → sender → verify → template →
send → cleanup, capturing ids) and made **`POST /auth/refresh`** capture the rotated `refresh_token`
(so a stale token now 401s — reuse-detection is testable in-collection).

**Migrations to apply:** `0452_campaign_templates.sql`, `0453_session_refresh_jti.sql` (renumbered from
0450/0451 post-merge — those numbers were taken by the other dev's comms/mail migrations).

## 2026-07-17 — Session 6: whole Sales/CRM + Commercial + Vault/Portal FE lane + live Control Tower

**Context.** Continuation of the FE reskin, this stream's lane (master data / sales-CRM / vault /
portal / settings; the FS colleague owns finance + operations). Agreed a funnel model with the user
— **marketing → leads + opportunities → sales** — and built the whole lane against the already-merged
BE modules. Design pulled from the user's Pixie "Hub" CRM screen recording (`Recording 2026-07-17`):
its *layout* (tabbed CRM, filter chips, avatar list-rows, segmented controls, metric strips) reused
but driven by the app's `--primary` tokens, not the mock's crimson — so every screen re-tints per
tenant. All wired to live endpoints; **in-sandbox `tsc --noEmit` clean throughout; `npm run lint` +
`npm run build --prefix client` pass on Windows (user-confirmed).**

**BE confirmation first.** Read `src/shared/http/module-loader.js` — modules auto-discover/mount from
`src/modules/<group>/<mod>/<mod>.routes.js`, so verified all target modules are merged with full
7-file structure + real routes before building. Gates to remember: Reports needs `reporting`;
Quotations needs `commercial.quotation`; portal external views need `portal.client|investor|audit`.

**Sales & CRM funnel — `client/src/features/sales/pages.tsx` (all six):**
- **Leads & intake** (`/sales/leads`, MOD-20) — two-tab (Leads + Inbound intake). Leads = Pixie
  Clients-tab layout (search + status chips + avatar rows) → capture/edit, advance
  (`/transition` → CONTACTED/QUALIFIED/LOST), **Convert** (`/convert`, QUALIFIED→client_master).
  Intake (nested segment) = Enquiries (**Triage** `/inbound/enquiries/:id/triage {to_lead,close}`) +
  Partnership requests (**Review** `/:id/review {status}`). **Inbound intake folded in as a tab, not
  a standalone screen** (user decision); `/sales/inbound-intake` now redirects to `?tab=intake`; nav
  relabelled "Leads & intake" + a deep-link.
- **Meetings** (`/sales/meetings`, MOD-21) — list + Schedule (subject + lead/client picker +
  `scheduled_at`); row → detail modal (`GET /:id` notes) with Add note (`/:id/notes {body,is_minutes}`).
- **Opportunities** (`/sales/opportunities`, MOD-24) — Board + List (segmented). Board = one column
  per `/opportunities/stages`; cards = OPEN opps grouped client-side by stage; per-column value from
  `/opportunities/board`; a forecast strip (open value / weighted Σ value×prob / open deals / win
  rate). **Drag-to-move** → `/:id/move` (won/lost stage auto-settles server-side); per-card Win
  (modal, opt. `create_dossier`+entity → `/:id/win`), Lose (`/:id/lose`), Edit. Note: BE `/board`
  is aggregates-only, so the board composes `/stages` + `/` (list) rather than rendering `/board`.
- **Proposals** (`/sales/proposals`, MOD-23) — list + chips; detail modal (narrative sections +
  priced line table + total); create/edit draft with narrative + line editors (PATCH replaces
  children, DRAFT-only); lifecycle via inline panels: Submit → Send (entity-numbered) → Reject /
  Accept (`/:id/accept`, opt. spin a quotation).
- **Marketing campaigns** (`/sales/campaigns`, MOD-22) — Pixie Sales-campaigns layout: metric strip
  (Active/Draft/Ended/Subscribers) + campaign cards with lifecycle buttons (`/:id/transition`,
  DRAFT→ACTIVE→PAUSED↔ACTIVE→ENDED); Subscribers tab (add `/subscribers`, unsubscribe).
- **Success stories** (`/sales/success-stories`, MOD-26) — filter chips + case-study cards;
  create/edit draft; Sign off (`/:id/sign-off`) → Publish (BE requires sign-off) → Unpublish.

**Shared UI extracted — `client/src/features/sales/ui.tsx`.** `Row`, `errMsg`, `cell`, `when`,
`fmtMoney`, `useList`, `Badge` (+ colour map), `Segmented`, `Chips`, `Avatar`, `MetricTile` — imported
by every sales/commercial/vault/portal/dashboard screen (was inline in `sales/pages.tsx`).

**Commercial group — `client/src/features/commercial/pages.tsx` (FS colleague verifying finance
correctness):**
- **Quotations** (`/commercial/quotations`, MOD-27) — **gated `commercial.quotation`** ("enable it"
  empty state when off). List + chips; detail (line table + HT/TTC from BE); create/edit draft with
  a line editor incl. a **débours** (untaxed pass-through) flag; lifecycle DRAFT→SENT (entity →
  numbers doc; sends directly if the quote already has an entity)→ACCEPTED (inline convert→final-
  invoice draft)/REJECTED/EXPIRED. **No tax-code picker yet** → FE doesn't VAT-flag lines, so
  total_ttc==total_ht until a `tax_code_id` is set (follow-on).
- **Margin simulation** (MOD-27) + **Extra-charge/demurrage simulation** (MOD-28) — saved-sim cards +
  a modal with a line/tier editor, **Preview** (`/preview`, no persist) then **Save** (`POST /`).
  Extra-charge tier editor overrides tenant settings `commercial.demurrage_tariff`.
- **Pricing variance** (MOD-27) — Sales R/Y/G list (flag + quote only; raw cost never leaves the
  finance boundary) + flag chips; Compute modal (dossier picker from `/operations`, quotation picker,
  optional quoted-price/actual-cost) → `/compute`.

**Vault hubs — `client/src/features/vault/pages.tsx`:**
- **Reports** (`/vault/reports`, MOD-63) — **gated `reporting`**. Catalogue (10 producers) → Run
  modal (optional from/to/as_of/period_code/dossier_id → generic table/JSON result → Save); Saved
  tab (run via `/saved/:id/run`, delete). Scheduling stays in Settings; tile picker deferred.
- **Compliance flags** (`/vault/compliance-flags`, MOD-65) — Flags tab: **Run checks** (`/run`) +
  severity chips + include-resolved toggle + Resolve (`/:id/resolve`); Rules tab = rule catalogue.

**Portal — `client/src/features/portal/pages.tsx`:**
- **Portal access** (`/portal/access`, MOD-67) — grant list + Grant (client/investor/auditor; CLIENT
  needs a client scope) + Revoke (`/access/:id/revoke`); Preview buttons GET the external views
  (`/portals/client|investor|auditor`), each gated `portal.*` → graceful "enable it" state.

**Control Tower — now LIVE (`client/src/features/dashboard.tsx`).** Replaced the static Lovable
`<iframe srcDoc>` mock with real React tiles: `GET /dashboard/kpis` (guarded flat counts) +
`GET /dashboard/control-tower` (op-file counts, approvals awaiting, live-shipments list = open/
in-progress dossiers with ref/status/route/vessel/ETA). MOD-00A, permission-gated, no feature flag.
Hero strip + live-shipments table + op-file breakdown + registry counts + Refresh + gated AI panel.
**Not** wired to `/reports/tiles` (that's a per-user tile-layout store) — the dashboard aggregate is
the right source.

**Cleanup.** Deleted the now-unused `client/src/features/dashboard-mock/{body.html,script.js,
style.css}.txt` and `client/src/features/placeholder/coming-soon.tsx` (+ their folders); nothing
imported them (verified). Routes wired in `client/src/app/app.tsx`; nav in `app-shell.tsx`.

**Every AI affordance drops in via `<AiActions>` (globally gated, session 5) — no AI UI appears when
the tenant flag is off.** Follow-ons (not built): tax-code picker for Quotations; Reports
dashboard-tile picker; platform/godmode console UI. Docs: `FE_IA_BUILD_MAP.md` + `SESSION_HANDOFF.md`
updated screen-by-screen.

## 2026-07-12 — Phase 1 finance FE (round 2): wire the actions that already had a BE

**Context.** Follow-on to the write-forms round below. Gap audit found three actions
whose **backend already exists** but had no UI; wired those. (Two other gaps — tax
declaration *filing* and credit-note *creation* — are left because they have **no BE
endpoint** either, so they're not just-wire-a-button; noted in the backlog.)

**Wired (`client/src/features/finance/pages.tsx` + `client/src/lib/finance-api.ts`).**
- **Journal reverse** (`POST /journal-entries/:id/reverse`, MOD-55 approve):
  `JournalsPage` converted from a generic `ResourceList` to a real table; validated
  entries (and not themselves reversals — `corrects_entry_id` shown as a "reversal"
  chip) get a per-row **Reverse** button → modal (reversal date + reason) that posts
  the linked contra entry. BE rejects reversing a draft (`NOT_REVERSIBLE`), surfaced.
- **Invoice draft edit** (`PATCH /final-invoices/:id`, MOD-51 edit): **Edit** action on
  DRAFT rows opens a modal that loads `GET /final-invoices/:id` (returns `.lines`),
  prefills client + lines (amount from `line_ht`, `is_debours`, dictionary item), and
  saves the patch. Sits next to the existing Submit action.
- **Guided monthly close** (`GET /statements/periods` + `POST /statements/periods/close`,
  MOD-59 edit): new **"Periods / close"** tab in `StatementsPage`. Lists periods with a
  status pill (OPEN/FROZEN/CLOSED); OPEN → Freeze/Close, FROZEN → Close, CLOSED → locked.
  A confirm modal calls the endpoint with `to: 'FROZEN'|'CLOSED'`; the BE's
  `CLOSE_BLOCKED` (unbalanced TB) / `ALREADY_CLOSED` errors surface inline.

**Plumbing.** `finance-api.ts` gained `getInvoice`/`updateInvoiceDraft`/
`reverseJournalEntry`/`listPeriods`/`closePeriod` (+ `InvoiceDetail`/`Period` types).
`ReportTabs` refactored to allow a **custom-render tab** (`render?: () => ReactNode`,
`path` now optional) so the Periods panel lives beside the report tabs without faking a
report fetch; the fetch effect early-returns for custom tabs.

**Also fixed (same day).** The Statements period filter was sending `period_code`, which
the statement endpoints ignore — they key on `period_id` (tax reports use `period_code`).
`ReportTabs` now takes a `periodMode` prop: Statements renders a **`period_id` dropdown**
loaded from `/statements/periods` and filtered by the selected entity; Tax keeps the
`period_code` text input. `Params`/`toQuery` carry both and send whichever is set, so the
Statements filter now actually binds.

**Verify status — blocked by the sandbox mount, not by the code.** In-sandbox `tsc`
could not validate this round: the network mount served **stale/truncated** copies of
the just-written files (e.g. `finance-api.ts` frozen at 3422 bytes / cut mid-type on
line 104; `pages.tsx` cut mid-statement on line 933), producing phantom
`TS1005 ')' expected` / `TS1110 Type expected`. Confirmed artifacts by reading the real
files through the file API — both lines are complete and valid on Windows. The prior
round typechecked clean once NUL-padding was stripped; **run `npm run build --prefix
client` on Windows as the authoritative gate for this round.**

## 2026-07-12 — Phase 1 finance FE: write forms on the read-only surfaces

**Context.** Handoff's next depth layer: the Phase 1 finance screens were read-only
lists + computed reports. Added the write/action forms that post to the ledger,
keeping the existing client plumbing (`tenant()` api-client, refresh-on-401, design
tokens). All new UI typechecks clean (`tsc --noEmit` = 0 once the sandbox NUL-padding
artifact is stripped — see the sandbox gotcha; validate on Windows with
`npm run build --prefix client`).

**New shared UI + plumbing.**
- `client/src/components/ui/modal.tsx` — portal-based `Modal` (backdrop + Escape +
  body-scroll-lock), a `Field` label/hint/error wrapper, and a native `Select`
  styled to match `Input`. First reusable dialog in the client.
- `client/src/lib/finance-api.ts` — typed write wrappers (`postJournalEntry`,
  `payAdvance`, `createInvoiceDraft`, `submitInvoice`) + option loaders
  (`loadEntities`/`loadClients`/`loadDictionaryItems`/`loadPostableAccounts`) feeding
  the form dropdowns from real master-data endpoints (`/entities`, `/clients`,
  `/financial-dictionary`, `/chart-of-accounts` filtered to `is_postable`). `today()`
  helper for date defaults.
- `client/src/components/resource-list.tsx` — added an optional `action(reload)`
  header-toolbar render prop + internal reload nonce, so a list can host a "New…"
  button and re-fetch after a successful write. Backwards-compatible.

**Forms wired (`client/src/features/finance/pages.tsx`).**
- **Post journal entry** (`POST /journal-entries`, MOD-55): multi-line editor with
  per-line account (postable-only) + debit/credit (mutually exclusive inputs), live
  balance indicator (blocks submit until Dr=Cr and >0), entity/journal-code (datalist
  VT/AC/BQ/PAIE/OD)/date/**mandatory source_doc_ref**, and a "Validate immediately
  (locks entry)" checkbox vs save-as-draft.
- **Record customer advance** (`POST /proformas/pay`, MOD-50): entity/client/amount/
  treasury-account/date/source-ref → posts to 4191, not revenue.
- **Final invoice lifecycle** (MOD-51): rebuilt `InvoicesPage` as a custom table
  (was a generic `ResourceList`) with a **New draft** modal (`POST /final-invoices`,
  optional dictionary-item lines with `is_debours`) and a per-row **Submit** action
  (`POST /final-invoices/:id/submit`, `entry_date` + `source_doc_ref`) shown only on
  DRAFT rows. Columns matched to the real `invoice` table (`doc_number`, `type`,
  `status`, `total_ttc`, `created_at`; PK `invoice_id`).
- **Statement + Tax period filters** (listed gap): `ReportTabs` now has an
  apply-on-demand filter bar (entity dropdown, `period_code` YYYY/YYYY-MM, `from`/`to`
  dates) that appends the query string the `financial_statement`/`tax_declaration`
  validators already accept (`entity_id`/`from`/`to`/`period_code`). Draft-vs-applied
  split so typing doesn't refetch on every keystroke.

**Also fixed while here.** `client/src/components/splash-screen.tsx` imported
`* as React` but never referenced it — a real `noUnusedLocals` error that would have
failed `tsc`/`npm run build`; removed the dead import (react-jsx needs no React
import).

**Verify caveat (sandbox gotcha, again).** In-sandbox `tsc` on freshly-written files
reports phantom `TS1127 Invalid character` errors — the network-mount pads the cached
copy with trailing NUL bytes past EOF. Confirmed benign: copying `src` to a local
tmpfs and `tr -d '\000'` before `tsc --noEmit` → **0 errors**. The Windows files are
correct; the authoritative gate is still `npm run build --prefix client`.

## 2026-07-12 — Doc reconciliation after colleague merge + FE pivot to Lovable look

**Context.** Pulled the colleague's merged work (`889f77d`): the codebase now spans
Phases 0–4. Reconciled `WORK_TO_BE_DONE.md` against the actual modules by presence +
`*.service.js` depth and the passing unit suites (not a line-by-line invariant
re-audit — noted as such inline).

**What the audit found landed (previously all-unchecked in the backlog):**
- **Phase 1 (accounting spine) — substantially done:** COA + financial dictionary +
  determination/posting-rules, journal engine + invariants (`journal_entry.rules.js`
  + ledger triggers), reversal-not-edit, régie aging, tax jurisdiction (versioned
  tax_code), statements (Bilan/CR/TAFIRE), tax center, PDF worker + vault + QR,
  per-tenant SMTP. Backed by `journal-*`, `final-invoice-lifecycle`, `invoicing`,
  `statements`, `tax-center`, `determination`, `numbering` suites.
- **Phase 2 (commercial cycle) — substantially done:** master data
  (entity/employee/client/supplier), currency+FX, dossier + service types, milestone
  engine (versioned templates), transit/delivery, costing + cost-tracking + régie
  disbursal, margin/extra-charge simulators, proforma (4191), final invoice, smart
  receivables, procurement (PR→PO→GRN + supplier invoice). Only the Ops-File 360°
  **modal** is left to the FE.
- **Phase 4 — partial:** AI service layer (DB-first vendor resolution + env fallback,
  transcribe/vision jobs, batch actions), Zod action gate + confirmation flow, AI
  governance, pricing variance index. Portals/smart-comms/reporting are backend
  scaffolds; settings hub is partial.

Ticked those boxes in the backlog with a dated audit banner per phase. No code changed
in this pass — documentation only.

**FE decision (this session).** Halting BE; the frontend gets reskinned to the Lovable
**Control Tower** mock (`doc/reference/reference-mock-lovable`) while keeping the
current `client/`'s working plumbing (auth, api-client with refresh-on-401, branding,
theme, screen-registry). The mock's UI is a static HTML/CSS/JS dashboard (3 views:
home/ops/finance) + a shadcn/ui component set; we adopt its **look**, not its
TanStack-Start stack. Next: port the design tokens + shadcn components into `client/`,
reskin the shell, then wire Phase 0 + Phase 1 screens to the live endpoints.

## 2026-07-11 — Phase 3: Fleet, WMS & HR modules (BE + FE + Postman)

**Phase:** 3 — People & assets (ledger-independent scope). Built after reverting
the earlier Phase-2 work so the colleague owns Phase 1 & 2.

**Verify caveat:** the build sandbox mount is stale for freshly-written files, so
in-sandbox `node --check` reports false truncation errors — disproven by reading
the real files through the file API. The definitive gate is `npm run lint`
(backend, PowerShell) which the user ran at **0 errors**; for the client the
equivalent is `npm run build --prefix client` (tsc).

### Backend — 21 tenant modules brought from stub → full convention
Each module now ships the 7-file layout (repo/service/controller/routes/validator/
events/**ai.js**), RBAC-gated routers (`requirePermission`), real Zod validators,
and keeps **all SQL in repos** (services do logic + `emitEvent`/`audit` only).

- **Fleet (7):** vehicle (MOD-39), vehicle_compliance (40), work_order (41,
  lifecycle OPEN→IN_PROGRESS→DONE/CANCELLED), fleet_dispatch (42, ASSIGNED→OUT→
  RETURNED + odometer/check-in-out), fuel_log (43), driver (44), incident (45,
  OPEN→UNDER_REVIEW→CLOSED).
- **WMS (6):** warehouse_location (34), inbound/GRN (33, QA gate HOLD→PASSED/
  REJECTED), inventory (35, state machine + append-only `stock_movement` journal
  via `/:id/move`), outbound (36, order status + `outbound_line` pick/pack),
  equipment (37, status), cycle_count (38).
- **HR ledger-independent (8):** vacancy (11, status + `job_applicant` pipeline),
  hr_contract (12, DRAFT→ISSUED→SIGNED→ENDED), appraisal (13), attendance (14,
  clock-out action), leave_allowance (15, REQUESTED→APPROVED/REJECTED decision),
  sop_onboarding (16, SOP docs), training (18, status + `training_attendance`
  roster), talent_pool (19).

Status transitions live in the service layer with validated transition maps,
dedicated events (`*.status_changed` etc.) + audit. Multi-table modules
(inventory, outbound, training, vacancy) add custom repo methods over the shared
`query-helpers` — still repo-only SQL.

**Deferred (need Phase 1 ledger posting):** payroll, asset depreciation, and the
GL legs of fuel_log/work_order (`entry_id`) and leave salary-advance (→4211).

### Frontend (`client/`)
Added `features/fleet/pages.tsx` (7), `features/wms/pages.tsx` (6),
`features/hr/pages.tsx` (8) on the existing `ResourceList` pattern; wired 26
routes in `app/app.tsx`; added **Fleet**, **Warehouse** and **People & HR** nav
groups in `app/layout/app-shell.tsx`. Registered all 27 Phase-3 screens (with
their `ai.js` action keys) in `app/screen-registry.json` — the AI/nav map now
has 37 screens. Page components follow the repo pattern and can be superseded by
the Lovable rebuild without touching routes/registry.

### Postman
`postman/praxis-ls.phase0.postman_collection.json` gained "9 · Fleet" (17 reqs)
and "10 · WMS" (21 reqs) folders under `/api/tenant/*`, chaining created IDs
through the lifecycle actions via test-script variable capture.

## 2026-07-09 (2) — Frontend build: client scaffold, white-label, theming, grant-matrix

**Phase:** 0 → sets up the frontend and closes the white-label item; last
session before handover to Phase 1 (see `doc/HANDOVER.md`).

**Verify caveat (same as the batch below):** the build environment could not
`npm install`/`tsc` the client. It boots and works against the live backend
(login, branding, upload, matrix all exercised by the user during the session);
treat the first `npm run build --prefix client` as the real typecheck.

### Client scaffold (`client/`)
Vite + React 18 + TS **PWA** (React Router, Tailwind v3 + the Lovable mock's
oklch tokens, hand-rolled shadcn-style primitives — minimal deps). api-client
(Bearer + refresh-on-401 + `X-Praxis-Env`, unwraps `{data}`), token store, auth
context (login / 2FA / logout / reload-restore), route guard, white-label app
shell (LIVE/TEST badge, mobile slide-over), a production-quality **login** (field
icons, password reveal, segmented 2FA OTP). Single-origin prod serving wired in
`src/server.js` (Express serves `client/dist` when present).

### White-label (backend + frontend)
New `src/modules/branding/`: **public** `GET /branding` (Host-resolved, pre-auth
so the login is branded) + **gated** `PUT /branding` (MOD-70) upserting `setting`
section='appearance'. FE applies colour/logo/name via CSS variables
(`lib/theme.ts` `applyBrand`), a `BrandingProvider` fetches on boot, and an
**Appearance** screen sets it live. Storage-backed **logo upload**: fixed
`storage.service.js` (`STORAGE_LOCAL_ROOT`→`STORAGE_LOCAL_PATH`, added
`CDN_BASE_URL`), served `/media` in Express (local driver, excluded from SPA
fallback, proxied by Vite), and `POST /branding/logo` stores to
`./data/vault/tenant_<slug>/branding/…`. Verified end-to-end by the user (file on
disk + logged-out login shows it).

### Theming + boot polish
Light/dark/**system** toggle (`lib/theme-mode.ts` + top-bar control; Tailwind
`darkMode:"class"`, applied pre-paint). Branded **boot splash** (`boot-gate.tsx`
+ `splash-screen.tsx`) inspired by the JBS Praxis "Pixie Hub" loader — centered
glowing logo + progress, themed by tenant colour. Two fixes after user testing:
(1) the splash **withholds identity until branding is `ready`** so the default
"Praxis LS" never flashes before the tenant's; (2) the login defers autofocus via
a `bootSignal` until the splash is gone (was popping the browser autofill over
the splash).

### Permission grant-matrix (the real RBAC editor)
Backend: new tenant `GET /catalogue/modules` (reads `platform.module_catalogue`
via the platform pool, gated MOD-67 view) and `PUT /permissions/grant` — an
upsert by `(role_id, module_key)` (`ON CONFLICT`), which invalidates the grant
cache and emits `permission.changed` (→ Watch-the-Watcher). Frontend
`permission-matrix-page.tsx`: roles across the top, modules down the side grouped
+ collapsible by `group_key`, each cell five toggles (R/C/U/D/A) mapping to the
`permission` booleans; optimistic upsert with revert-on-error. Wired at
`/security/permissions`.

### Not done / deferred (see HANDOVER.md)
Auth-gated download route for sensitive vault files; S3 storage driver; platform
console UI; Test/Live toggle; per-tenant PWA manifest; `scopeColumn` adoption;
Line-Manager application; the Live self-grant block.

---

## 2026-07-09 — Phase 0 close-out: /users gating, inactivity, Watch-the-Watcher, capabilities, event engine, CI + setup split

**Phase:** 0 (Foundations). Goal: close the remaining *backend* Phase 0 gaps
(everything not blocked on `client/`), fix a setup blocker the user hit, and
make local-vs-Docker setup unambiguous. Frontend-blocked items (platform
console UI, sandbox toggle/banner, white-label rendering) are untouched — still
waiting on `client/`.

**Verification note (read this):** the shell sandbox's view of the repo was
**stale/inconsistent this session** — files written by the host editor showed
up truncated or NUL-padded through the mount, so `node --check` via the sandbox
reported false syntax errors on valid files (it flagged JSDoc `/**` openings and
lines the host copy shows intact). Verification was therefore done by reading
every changed file back through the host-authoritative editor and reviewing the
logic, **not** by a sandbox `node --check`/`require()` smoke test. Whoever picks
this up next: run `npm run lint` + boot the app (module-loader logs
`skipped module (load error)` on any require failure) once, on a machine where
the checkout is consistent, to get the syntax/boot check this session couldn't.

### A — app_user `/users` CRUD gated (the last open security route)

`app_user.routes.js`'s `/users` sub-router was the one deliberately-ungated
security module (see the 2026-07-08 entry). Now built explicitly (not
`makeRouter`) so each verb carries `authMiddleware` + `requirePermission('MOD-67',
…)` — user administration is IAM & user access → MOD-67, the same grant the rest
of the IAM screen group uses. `/auth/*` stays public (that's how you get a token
in the first place). Bootstrap is unaffected: the first admin still comes from
`scripts/tenant/create-admin.js` (direct DB write), not this API.

### B — 30-min inactivity auto-logout enforced

`SESSION_INACTIVITY_MIN` was configured but never checked anywhere. Now enforced
at the refresh boundary: `app_user.repo.getActiveSession()` returns
`idle_seconds` (`EXTRACT(EPOCH FROM now() - last_seen_at)`), and
`app_user.service.refresh()` kills the session + returns `401 SESSION_EXPIRED`
when idle beyond the window. `last_seen_at` is bumped on every refresh, so an
active client keeps its session; an idle one (no refresh) gets logged out on its
next attempt. Same tradeoff already documented for remote kill: an
already-issued access token stays valid until its own ≤15-min expiry — this
blocks the *refresh* that extends the session, it doesn't retroactively revoke a
live access token. Refresh is the only place session state is consulted (access
tokens are stateless and carry no `sid`), so it's the correct enforcement point.

### C — Watch-the-Watcher consumer (security-critical events → CEO/MANAGEMENT)

The three high-priority events were seeded and firing but **nobody consumed
them**. Implemented centrally in `shared/events/emit.js` rather than wired into
each service separately (so the next security-critical event anyone adds is
covered automatically): `emitEvent()` now (1) forces `event_log.priority = HIGH`
for any event whose `event_type.is_security_critical` is set, resolved in-SQL,
and (2) fans out a HIGH in-app `notification` to every **active CEO/MANAGEMENT**
user — a single `INSERT…SELECT` guarded by `EXISTS(is_security_critical)`, so
it's a zero-row no-op for the ~99% of events that are NORMAL. Runs in the
caller's transaction, so the alert is atomic with the change that triggered it.

Bug this exposed and fixed: `iam_role` emitted `iam_role.created/updated/archived`
— **not** the seeded security-critical `role.changed` — so role edits never
reached the watchers. Repointed `iam_role.events.js` to `role.changed` (same
map-all-verbs-to-one-key convention as `permission.changed` /
`field_visibility.changed`).

Prerequisite fixed: the `notification` module didn't load at all — `service`/
`controller`/`validator` used a `../../../shared` require path (three levels) but
the module is flat (`src/modules/notification/`, two levels), so
`module-loader` had been silently skipping it. Fixed to `../../shared`, and added
`authMiddleware` to its router (it was about to go live). **Flagged, not fixed:**
its generic `list()` isn't self-scoped yet — returns every tenant notification,
not just the caller's; noted in `notification.routes.js` and `WORK_TO_BE_DONE.md`
as a Phase 2 follow-up before it's exposed to non-admin roles.

### D — Line Manager / capability mechanism

The columns existed (`role.is_line_manager`, the `LINE_MANAGER` capability code,
`user_capability`) but nothing resolved them. Added
`identity-cache.getUserCapabilities()` (30s-cached like grants/scope; returns
`{capabilities[], is_line_manager}` where `is_line_manager` is true if any role
flags it *or* the user holds `LINE_MANAGER`), invalidated alongside the other
per-user cache keys. Added `middleware/rbac.requireCapability(code)` — a gate for
the segregation-of-duties overlay, usable independently of the module CRUD grant
(`requireCapability('APPROVER')` etc.), with the same CEO bypass; it also
attaches `req.capabilities` / `req.is_line_manager`. **Mechanism only, by
design:** no Phase 0 route needs it — the actions it gates (leave approvals,
appraisals, disbursal routing) land with Phase 2/3, which opt in per route.

### E — Universal Event Engine: registration + workflow-designer API

New `src/modules/workflow/` (flat module, gated `authMiddleware` +
`requirePermission('MOD-67', …)` — per the 2026-07-08 conflict note, "AI & event
engine" shares MOD-67 until it earns its own module_key). The schema and the
emit side already existed; this adds the missing admin surface so event types
and approval chains stop being DB-hand-edits:
- `GET/POST /event-types` — list + register (upsert on the UNIQUE key, idempotent).
- `GET/POST /workflows`, `GET/PATCH /workflows/:id` — a workflow binds to an
  **approvable** event type (rejected otherwise); detail returns its ordered steps.
- `GET/POST /workflows/:id/steps`, `DELETE …/steps/:stepId` — VALIDATE|APPROVE
  steps (role/capability/scope + amount-threshold routing, matching the
  `workflow_step` schema).
- `GET /approvals` — read-only runtime `approval_task` queue (`?status=`).
Every write emits an event + writes the immutable audit trail, same contract as
the generic `makeService` path (hand-written because it spans four tables). Zod
validators on the write bodies; the module's own event keys (`workflow.created`
etc.) are descriptive labels (`event_log.event_type_key` has no FK, so unseeded
keys are fine).

### F — CI + the local/Docker setup split (the user's actual blocker)

The user hit `getaddrinfo ENOTFOUND redis` on a local run. **Root cause:** `.env`
had `REDIS_URL` defined **twice** — `redis://localhost:6379` then
`redis://redis:6379` (a Docker value) — and dotenv keeps the **last** occurrence,
so the app tried to resolve the Docker service name `redis` on a local run.
`NODE_ENV=production` was also set locally (hence `"env":"production"` in the
logs). Fixes:
- `.env`: removed the duplicate `REDIS_URL` (localhost wins), set
  `NODE_ENV=development`.
- `docker-compose.yml`: so the *same* `.env` works for both, the `api`/`worker`
  `environment:` blocks now override `REDIS_URL=redis://redis:6379` (the code
  reads `REDIS_URL`, **not** the dead `REDIS_HOST` that was there — removed) plus
  `NODE_ENV=production` and `PORT`. Also fixed two real compose bugs found in
  passing: the `redis` service mounted an **undeclared** volume
  (`pixie_redisdata` vs the declared `praxis_redisdata`), and the `api` port
  mapped `3000:3000` while the app listens on `8080` → now `3000:8080`. And the
  `Dockerfile` worker `CMD` pointed at `src/jobs/worker.js` while the file is
  `src/jobs/workers.js` (still an empty stub — worker itself is Phase 1+).
- `.env.example`: rewritten from the stale Docker-only template to match
  `env.js` — full DB block, `ENCRYPTION_KEY`, local-friendly values, with the
  "Docker overrides these, don't hard-code the service name" note inline.
- `doc/SETUP.md`: restructured into **Option A — Local** and **Option B —
  Docker** (they share one `.env`), plus a **Troubleshooting** section for the
  exact `ENOTFOUND redis` error, and a 2026-07-09 upgrade/endpoints block.
- CI: `.github/workflows/deploy.yaml` was an empty (0-byte) file → replaced with
  `ci.yaml` (checkout, Node 20, `npm ci`, `node --check` across `src`/`scripts`,
  `npm run lint`, `jest --passWithNoTests`, plus a no-push `docker build` to
  catch Dockerfile breakage). `deploy.yaml` is now a valid manual-only
  placeholder (deploy target/secrets are Phase 5) instead of an empty file
  GitHub reports as invalid.

### Explicitly NOT done (and why)

- **`scopeColumn` adoption** — the mechanism (built 2026-07-08) is complete, but
  **no existing tenant table has a `scope_id` column** to adopt it on (confirmed
  by grepping every `migrations/tenant/*.sql`: `scope_id` appears only in the RBAC
  tables `scope`/`user_scope` and in `workflow_step`, never on a business/record
  table). The tables that need record-level scoping (dossier, invoice, journal…)
  are Phase 1/2 and don't exist yet. Adoption is a per-table schema decision that
  lands with those modules — not something to fake now with a throwaway migration.
- **Line Manager application** — see D: mechanism built, application is Phase 2/3.
- **Self-grant block in Live** (`permission.service.js` TODO) — still needs
  `req.env`/`req.user` threaded to the service layer, which arrives with the
  Live/Sandbox toggle work; not forced this pass.
- **Frontend** — no `client/` yet; all UI-gated Phase 0 items stay open.

---

## 2026-07-08 (2) — Phase 0 push: gating, platform login, 2FA, Redis sessions, scope, restore

**Phase:** 0 (Foundations). Goal for the session: close out as much of Phase
0 as responsibly possible so the frontend (see `client/README.md`) has a
real backend to build against, not just CEO-bypass access.

**Housekeeping first:** the previous entry's `src/modules/security/auth/`
deletion had been left for the user to do manually because the shell
sandbox was down for that entire session. It was still present at the
start of this session (confirmed via `ls`) — deleted now, sandbox came
back up partway through this session. `node --check` run against every
file touched below plus a `require()` smoke test of the changed
services/routes — all clean. Flagging for the record: three **pre-existing,
unrelated** broken modules surfaced during that smoke test
(`ai/governance`, `ai/insights` — `require("../../config/database")`,
which doesn't exist; `notification` — wrong relative path to
`shared/crud/resource`). `module-loader.js` already skips-with-a-warning on
any module `require()` failure, so these were silently broken before this
session too; not fixed here, out of scope, just noted so nobody assumes
this session introduced them.

### A — Gated the 4 remaining ungated security modules

`iam_role` (→ MOD-67, same grant as capability/scope/permission/
field_visibility — one module_key covers the whole IAM screen group),
`session` (→ MOD-68), `audit_ledger` (→ MOD-69, view-only — it's a
read-only ledger), `setting` (→ MOD-70). All four now require
`authMiddleware` + `requirePermission`, following `capability.routes.js`'s
existing pattern exactly. `app_user`'s own generic `/users` CRUD is the one
deliberate exception, left ungated — same gap, not folded into this pass
(see the 2026-07-07 entry's scope decision).

### B — Platform login endpoint (a gap this session found, not pre-flagged)

`platform.routes.js` required `platformAuth` on **every** route with no
login endpoint anywhere to obtain the token in the first place —
`scripts/platform/create-admin.js` only ever wrote a password hash.
Grepped the whole repo for `jwt.sign` + `typ:"platform"` before adding
this: zero hits. Added `src/services/platform/auth.service.js` (mirrors
`app_user`'s login shape against `platform.platform_user`) and
`POST /api/platform/auth/login` in `platform.routes.js`, registered before
the router's global `platformAuth` gate. No refresh/session infra exists
at the platform tier in the schema (`0030_platform_ops.sql` has no
platform-session table) — this issues a stateless access token only;
noted in the service file rather than inventing a session model that
isn't there.

### C — Prerequisite fixes: Redis config + missing ENCRYPTION_KEY

Two bugs found while building the features below, both fixed as
prerequisites rather than worked around:
- `src/config/redis.js` read `config.REDIS_HOST/PORT/PASSWORD/DB` — none
  of which exist in `env.js`'s Zod schema (only `REDIS_URL` does). Flagged
  as dead config drift in `RBAC_SECURITY_KICKOFF.md` and left alone at the
  time; now actually fixed — `ioredis` takes the connection string
  directly. Also: `initRedis()` was never called anywhere in the app at
  all (server.js's own comment said "Redis/Socket.IO/worker wiring is
  added as those land") — wired into `server.js`'s `start()`, best-effort
  (a Redis outage at boot degrades caching/session-kill, doesn't crash
  boot, matching `identity-cache.js`'s existing philosophy).
- `src/services/encryption.service.js` read `config.ENCRYPTION_KEY`
  unconditionally — not in the Zod schema at all, so it was `undefined`
  and `Buffer.from(undefined, "hex")` would throw on first use. Added to
  `env.js` with a fixed (not random-per-boot) 64-hex-char dev default,
  same pattern as the JWT secrets — **must be overridden in production**.
  (Caught my own typo here too: first draft of the default was 62 hex
  chars, not 64 — Zod's regex rejected it at boot. `node --check` doesn't
  catch that, only actually requiring `env.js` does; that's why the smoke
  test above matters.)

### D — Redis session store + remote kill

`shared/cache/session-store.js` (new) — indexes active sessions in Redis
on login (`session:active:<id>`, `session:user:<userId>` set), removed on
logout/kill. Postgres (`user_session`) stays the source of truth per
existing design; Redis is purely a fast index, best-effort like
`identity-cache.js` (an outage degrades to "index unavailable", never
breaks login/logout).

`session` module gained two actions generic CRUD doesn't cover:
- `GET /sessions/mine` — self-scoped, no MOD-68 grant needed, just
  authentication. Matches the RBAC journey doc's "Everyone... only their
  own sessions."
- `POST /sessions/:id/kill` — self-kill always allowed; killing someone
  else's session requires the MOD-68 `can_update` grant (or CEO). This is
  the concrete "own vs all" check that motivated part C's record-level
  scope work below, implemented ad hoc here rather than through the
  generic mechanism (session ownership isn't a `scopeColumn` in the same
  sense as entity/branch scoping).

Limitation worth flagging: killing a session blocks future **refreshes**
(checked in `app_user.service.js`'s `refresh()`); it does **not**
invalidate an already-issued access token, which is a stateless JWT valid
until its own (short, 15 min default) expiry. True instant revocation
would need access-token checks to consult a blocklist on every request —
not built, would add a Redis round-trip to every authenticated request for
a rarely-exercised path. Flagging the tradeoff rather than silently
shipping partial "remote kill" as if it were absolute.

### E — 2FA pending-token step-up (closes the `auth.service.js` TODO)

Decision taken (previously an explicit "needs a decision, not invented
here"): the pending-2FA token is a JWT signed with the same
`JWT_ACCESS_SECRET`, `typ:"2fa_pending"`, 5-minute TTL, `sub:userId`. It
carries no session — a session is only created once the TOTP code checks
out (`POST /auth/2fa/verify`).

This only works as a real security boundary because of a bug it exposed:
**`middleware/auth.js` didn't check the JWT `typ` claim at all.** A
refresh token (`typ:"refresh"`) could have been replayed as an access
token before this session; `platform-auth.js` already had the equivalent
check, the tenant side didn't. Fixed: `authMiddleware` now rejects any
`typ` other than `"access"`.

Also added, since `verifyTotp` would otherwise be unreachable — nothing
populated `totp_secret_enc` anywhere before this: `POST /auth/2fa/setup`
(generates+stores a secret, does NOT enable yet), `POST /auth/2fa/enable`
(requires proving one valid code first — can't lock yourself out by
fat-fingering enrollment), `POST /auth/2fa/disable`. Uses the existing
`otplib` dependency (already in `package.json`, unused until now) and
`services/encryption.service.js` for the secret at rest.

### F — Record-level scope: mechanism built, not yet adopted

`middleware/rbac.js`'s `requirePermission()` previously hardcoded
`req.permission_scope = "all"` with a comment saying scope wasn't
consulted. Now: `identity-cache.js` gained `getUserScopeIds()` (reads
`user_scope`, 30s-cached like grants); `requirePermission()` resolves
`req.scope_ids` — `null` if the user has no scope assignments (today's
behavior, unchanged, so tenants that never assigned scopes aren't
suddenly locked out) or an array if they do. `shared/crud/resource.js`'s
`makeRepo()` gained an opt-in `scopeColumn` config key: when set, `list()`
filters `WHERE <scopeColumn> = ANY(scope_ids)` whenever the caller has
scope_ids. **No existing module declares `scopeColumn` yet** — this wires
the plumbing end-to-end (verified working) but deciding which column
means "scope" on each of the 70 module tables is a real per-module call,
not something to bulk-guess in one pass.

### G — Restore from soft-delete

`audit_ledger` module (already MOD-69-gated from part A) gained the
maker-checker restore flow `WORK_TO_BE_DONE.md` flagged as entirely
missing:
- `GET /audit/soft-deletes` — open (unrestored) soft-deletes.
- `POST /audit/soft-deletes/:id/request-restore` — step 1, flags intent.
- `POST /audit/soft-deletes/:id/restore` — step 2, a **different** admin
  confirms (checked in the service layer for a clean 403, on top of the
  DB's own `CHECK (restored_by <> deleted_by)`).

New `shared/crud/entity-registry.js` resolves a `soft_delete.entity_ref`
prefix (e.g. `"iam_role"`) to its real table — necessary because those
strings don't reliably match table names (`iam_role.service.js` uses
`entity:"iam_role"` for table `role`; `corporate_entity.service.js` uses
`entity:"entity"` for table `corporate_entity`). Built by walking every
module's `*.service.js` and reading a `__entityMeta` that
`makeService()` now attaches (`{ entity, table, pk, activeColumn }`) —
derived from the actual code, not guessed. Verified against real modules
in the smoke test (`iam_role` → `{table:"role", pk:"role_id"}`, correctly
distinct from its entity string).

Restore behavior depends on whether the table has an `activeColumn`:
if yes, flips it back to `true`; if no (true of most modules —
`archive()` in `resource.js` only ever flips `activeColumn`, it never
actually removes the row), there was nothing hiding the record in the
first place, so marking the `soft_delete` row restored is the complete
fix. A defensive fallback re-inserts from `payload_json` if the row is
ever found missing outright — future-proofing, since nothing in this
codebase does a real `DELETE` today.

### Explicitly not done this session

- 30-min inactivity auto-logout (`SESSION_INACTIVITY_MIN` still
  unenforced).
- `Line Manager` capability wiring.
- Watch-the-Watcher consumer (events fire, nobody's notified).
- Permission-matrix seeding (item B below — blocked on a user decision,
  not started).
- Any frontend work.

### Item B — permission-matrix seeded

Mapped `doc/SmartLS_SuperAdmin_User_Journey_and_RBAC.docx`'s 18-row
role×module-group matrix onto the 70 `MOD-xx` catalogue codes, resolved
two real conflicts with the user, then wrote
`migrations/seeds/9021_seed_default_permissions.sql`.

**Conflicts found and how they were resolved (user's call, not mine):**
1. `MOD-67` is the only catalogue entry for **both** "IAM & user access"
   and "AI & event engine" (`feature_catalogue` ties
   `ai.assistant`/`ai.assistant.backend`/`ai.vectorization` to MOD-67 as a
   proxy — no distinct AI module_key exists). Contradictory grant
   patterns, and `permission` has `UNIQUE (role_id, module_key)` — can't
   seed both. **Resolved:** MOD-67 carries the IAM & user access pattern;
   the AI & event engine row is not seeded. When AI work starts for real
   (Phase 4), it should get its own module_key via migration rather than
   reusing MOD-67.
2. "Comms & portals admin" has no matching module_key at all — no
   `comms`/`portal` group_key in `platform.module_catalogue`; the one
   candidate, MOD-64, is already claimed by "Document vault & compliance"
   with a materially different (much more permissive) pattern.
   **Resolved:** not seeded. Revisit once comms/portals get a real
   catalogue entry.

**Also resolved while mapping** (non-blocking, no `permission`
UNIQUE-constraint conflict, just judgment calls): `MOD-01` (Corporate
Entities) → "Master data" row only, not also "Tenant/company setup";
`MOD-09` (Treasury Accounts) → "Master data" row only, not also "Finance &
treasury" — both driven by the catalogue's own `group_key: 'master'` on
those two modules. `MOD-63` (Reporting & Insights) and `MOD-00A`
(Dashboard) aren't covered by any of the doc's 18 rows at all — seeded
nowhere, flagged rather than guessed.

**The seed file:** 16 `INSERT INTO permission ... SELECT ... FROM role r
JOIN (VALUES ...) ... CROSS JOIN (VALUES ...) ... ON CONFLICT DO NOTHING`
blocks, one per matrix row actually seeded — same VALUES+JOIN idiom
`9020_seed_rbac_events.sql` already uses for `field_visibility`, not 393
individual literal rows. Covers all 11 default roles × 70 of 72 catalogue
module_keys.

Full role→module grant table (● full, ◑ create/edit, ○ view, ▲ approve,
– none — same legend as the source doc):

| Module group (source doc row) | MOD-xx codes | SA | CEO | MGT | FIN | ACC | SAL | OPS | WH | FLT | PRC | HR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tenant / company setup | 70 | ● | ○ | ○ | – | – | – | – | – | – | – | – |
| IAM & user access | 67, 68 | ● | ▲ | ○ | – | – | – | – | – | – | – | – |
| Master data & dictionary | 01, 03, 04, 05, 09, 10 | ● | ○ | ○ | ◑ | ● | ○ | ○ | – | – | – | – |
| Chart of accounts / tax | 06, 07, 08 | ● | ○ | ○ | ◑ | ● | – | – | – | – | – | – |
| HR & payroll | 02, 11–19 | ○ | ○ | ○ | ○ | – | – | – | – | – | – | ● |
| Sales & CRM | 20–26 | ○ | ○ | ▲ | ○ | – | ● | – | – | – | – | – |
| Commercial / pricing | 27, 28 | ○ | ○ | ▲ | ▲ | – | ◑ | – | – | – | – | – |
| Operations | 29–32 | ○ | ○ | ○ | ○ | – | – | ● | ○ | ○ | – | – |
| Warehouse (WMS) | 33–38 | ○ | ○ | ○ | – | – | – | ○ | ● | – | – | – |
| Fleet | 39–45 | ○ | ○ | ○ | ○ | – | – | ○ | – | ● | – | – |
| Ops costing | 46–49 | ○ | ○ | ▲ | ● | ○ | – | ◑ | – | – | – | – |
| Finance & treasury | 50–54 | ○ | ▲ | ▲ | ● | ● | – | – | – | – | – | – |
| Accounting / GL / statements | 55–59 | ○ | ○ | ○ | ○ | ● | – | – | – | – | – | – |
| Procurement | 60–62 | ○ | ○ | ▲ | ▲ | – | – | ○ | ○ | – | ● | – |
| Document vault & compliance | 64, 65, 66 | ● | ○ | ○ | ○ | ○ | ◑ | ◑ | ◑ | ◑ | ◑ | ◑ |
| Security / God Mode purge | 69, 00B | ○ | ● | – | – | – | – | – | – | – | – | – |
| ~~AI & event engine~~ | (MOD-67 conflict) | — not seeded, see above — |
| ~~Comms & portals admin~~ | (no module_key) | — not seeded, see above — |

**Not yet run against a real Postgres** — no `psql`/local DB in this
sandbox. Verified instead by: cross-checking every role code used against
`9020_seed_rbac_events.sql`'s actual `INSERT INTO role` (exact match,
11/11) and every `MOD-xx` used against `9100_seed_platform_catalogue.sql`
(exact match, 70/70, and confirmed the only two omissions are the two
intentionally-unmapped modules); a global parenthesis-balance check (273
open, 273 close); 16 `INSERT` statements, 16 `ON CONFLICT` clauses,
matching the 16 rows above. This is a reasonable substitute for a syntax
check but **is not the same as actually applying it** — run
`npm run db:migrate:tenants` (existing tenants) or a fresh `db:provision`
and log in as a non-CEO role before trusting this in anger.

## 2026-07-08 — Merge `security/auth` into `security/app_user`

**Phase:** 0 (Foundations) — Auth line item.

**What:** `src/modules/security/auth/` (login/refresh/logout, added in the
RBAC kickoff — see `doc/RBAC_SECURITY_KICKOFF.md`) and
`src/modules/security/app_user/` (the pre-existing generic CRUD module on
the `app_user` table) were two separate module directories both operating
on the same entity. Folded `auth/`'s six files into `app_user/`'s six files
one-for-one, per CONVENTIONS.md's module layout (`.repo/.service/.controller
/.routes/.validator/.events`), then deleted `security/auth/`.

**Why:** auth *is* app_user — login/session issuance reads and writes the
`app_user` table directly (`auth.repo.js`'s `findByEmail`,
`recordLoginSuccess/Failure` were already raw SQL against `app_user`, not a
separate table). Two module directories for one entity was incidental
history (auth was bolted on later in the RBAC kickoff), not a deliberate
split.

**How, per file:**
- `app_user.repo.js` — generic CRUD repo (`makeRepo`) spread together with
  auth's `findByEmail`/`recordLoginSuccess`/`recordLoginFailure`/
  `createSession`/`getActiveSession`/`touchSession`/`killSession`.
- `app_user.service.js` — generic CRUD service (`makeService`) spread
  together with `login`/`refresh`/`logout`, logic unchanged.
- `app_user.controller.js` — generic CRUD controller (`makeController`)
  spread together with the `login`/`refresh`/`logout` HTTP handlers.
- `app_user.routes.js` — **one router, two sub-routers**: `/users` (the
  existing CRUD router, unchanged, still ungated) and `/auth` (`login`/
  `refresh` public, `logout` behind `authMiddleware`, unchanged). Exported
  `basePath: "/"` so module-loader mounts both sub-paths at the tenant
  router root — external URLs are **unchanged**:
  `/api/tenant/users/*` and `/api/tenant/auth/*` both still resolve exactly
  as before. This was a deliberate choice (see options considered below) so
  nothing else in the codebase, and no already-documented client/curl
  usage, needed to change.
- `app_user.validator.js` — passthrough `create`/`update` (unchanged) plus
  the real Zod `login`/`refresh` schemas from `auth.validator.js`.
- `app_user.events.js` — both event sets merged into one file, keys
  untouched (`app_user.created/updated/archived` +
  `auth.login_succeeded/login_failed/logged_out/token_refreshed`). Confirmed
  via grep that no migration seed references either event-type-key set, so
  nothing depends on their exact spelling — left them as-is rather than
  renaming to `app_user.*` across the board, since "login succeeded" reads
  more clearly under an `auth.*` namespace than `app_user.*` regardless of
  which file it lives in.

**Explicitly out of scope for this change** (confirmed with the user
before starting):
- `app_user`'s CRUD routes (`/users/*`) remain **ungated** — no
  `authMiddleware`/`requirePermission`, same gap already flagged for
  `iam_role`/`session`/`audit_ledger`/`setting` in `WORK_TO_BE_DONE.md`.
  Gating `app_user` belongs with that same pass, not bundled into a pure
  file-reorganization change.
- No other Phase 0 items were touched this session.

**Verification:**
- Grepped the full repo for `security/auth`, `security\auth`, and
  `auth.(repo|service|controller|routes|validator|events)` before starting
  — zero references outside the auth module's own directory, confirming
  the merge would be self-contained (no other file requires those paths
  directly; everything goes through module-loader's auto-discovery).
- Grepped for `app_user.(repo|service|controller|routes|validator|events)`
  — only ever referenced from within `app_user/` itself, same story.
- Read back all six new `app_user/*.js` files after writing them and
  confirmed content/structure against the source files line-for-line.
- **Not done:** the shell sandbox was unavailable for the entire session
  (stuck on "still starting"), so `node --check` / `npm run lint` couldn't
  be run against the merged files, and `src/modules/security/auth/` could
  not be `rm -rf`'d programmatically. The user opted to delete that
  directory manually. **Follow-up for whoever picks this up next:** confirm
  `src/modules/security/auth/` is actually gone, and run `node --check` on
  the six `app_user/*.js` files (or just boot the app — module-loader logs
  a "skipped module (load error)" warning on any require() failure) before
  treating this as fully verified.

**Docs touched:** `doc/WORK_TO_BE_DONE.md` (path reference fixed on the
JWT access+refresh line), `doc/RBAC_SECURITY_KICKOFF.md` (append-only note
added below the historical "what this kickoff added" table — the table
itself was left as originally written).
