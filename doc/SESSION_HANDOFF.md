# Praxis LS — Session Handoff

Paste-in context for a fresh session, plus a running record of the FE reskin work.
Companion to `doc/WORK_DONE.md` (full history) and `doc/WORK_TO_BE_DONE.md` (backlog).

_Last updated: 2026-07-17 (session 7). **Session 7 = cross-cutting FE feature pass** — all in-sandbox
`tsc`-clean (Windows validators still authoritative, and the Control Tower iframe + new forms need a
visual check via `npm run dev`). Shipped this session: (i) **access/refresh token rotation** — FE now
captures a rotated `refresh_token` from `/auth/refresh` on boot + 401-retry (`lib/api-client.ts`,
`app/auth/auth-context.tsx`); no-op until the BE rotates. (ii) **Removed every `MOD-` label/comment
from the FE** (21 files) — kept the functional `module: "MOD-XX"` RBAC keys in `scaffold/screen-specs.ts`
and all BE `MODULE=` keys. (iii) **Search everywhere** — added `?q=` ILIKE to the registry repos that
lacked it (`corporate_entity`, `lead`, `opportunity`, `operations_file` [dossier `ref`], `final_invoice`
[`doc_number`], `financial_dictionary` [code/labels], `app_user` [name/email]; clients/suppliers already
had it), plus a shared **`SearchSelect`** in `features/sales/ui.tsx` (debounced, client-side narrowing
fallback, free-text commit, inline **"Add …"** on empty). Wired the lead-capture **Company** field and
the quotation **Client** picker; the other reference pickers are the same drop-in and remain to convert.
(iv) **Quotations** — line items now from the **financial dictionary** + a per-line **tax-code picker**
(sales VAT codes aggregated across jurisdictions via `listSalesTaxCodes` in `lib/masterdata-api.ts`), so
`total_ttc` can differ from `total_ht`. (v) **Reports** — new **Dashboard tiles** tab (`/reports/tiles`)
in `features/vault/pages.tsx`. (vi) **Marketing campaigns** — new **Templates** tab (create/edit/delete
email templates, each with its own **sender name + address**) persisted to the generic settings store
`/settings/campaign_template`; MOD-22 has no template/sender BE, so see the new
`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`. (vii) **Control Tower** — reverted to the **Lovable mock**
(restored `features/dashboard-mock/*` from `doc/reference/reference-mock-lovable`) rendered in an
`<iframe srcDoc>`, now **fed live** `/dashboard/control-tower` + `/dashboard/kpis` (live shipments list,
active count, hero line, Praxis briefing) with light/dark synced to the app (`features/dashboard.tsx`).
(viii) **Settings-tiles finding** — the generic `/settings/:section/:key` store already backs
`document_template`, `custom_field`, `email_signature` and `_policy`/`_tiers` values (and allows arbitrary
sections), so those previously-"no BE" tiles are now buildable. Also fixed a **pre-existing** build break
from the repo pull (unused `React` import in `components/ui/skeleton.tsx`). BE `q` edits touch
`operations_file`/`final_invoice`/`app_user` — heads-up for the FS colleague. Detail: session-7 log below.
Prior: **Session 6 = this stream's whole FE lane built + verified.**
Shipped, all wired to live BE and **Windows-verified (`npm run lint` + `npm run build --prefix
client` pass, user-confirmed) + in-sandbox `tsc` clean**: the **Sales & CRM funnel** (Leads & intake
[MOD-20 + folded MOD-25], Meetings [21], Opportunities Kanban [24], Proposals [23], Campaigns [22],
Success stories [26]) in `features/sales/pages.tsx`; the **Commercial group** (Quotations [27, gated
`commercial.quotation`], Margin + Extra-charge sims [27/28], Pricing variance [27]) in
`features/commercial/pages.tsx`; **Reports** [63, gated `reporting`] + **Compliance flags** [65] in
`features/vault/pages.tsx`; **Portal access** [67] in `features/portal/pages.tsx`; the **Control
Tower** now on **live data** (`features/dashboard.tsx` → `/dashboard/kpis` + `/dashboard/control-
tower`, MOD-00A) replacing the static mock. Shared FE primitives extracted to
`features/sales/ui.tsx`. Deleted the dead `dashboard-mock/*` + `placeholder/coming-soon.tsx`. Design:
Pixie "Hub" layout (recording `Recording 2026-07-17`) on the app's `--primary` tokens. Full detail:
`doc/WORK_DONE.md` (2026-07-17) + `doc/FE_IA_BUILD_MAP.md`. FE follow-ons only: tax-code picker for
Quotations, Reports tile picker, platform/godmode console. Prior:
**Session 5 = master-data trio + global AI gate + BE `ai_enabled`.** FE build (master-data + gate) **Windows-verified by the user this session**;
the **BE `ai_enabled` change still needs `npm run lint` + `npm test`** (written after that
verify). Shipped session 5: (i) **master-data trio** — Clients/Suppliers/Corporate entities
wired to live BE in `client/src/features/master/pages.tsx`, routed in `app.tsx` (replaced the
`<Planned/>` slots); (ii) **global AI gate** — `client/src/components/ai-actions.tsx`
(`useAiEnabled`/`AiGate`/`AiActions`), `screen-scaffold.tsx` refactored onto it,
`User.ai_enabled` added; (iii) **BE** — `governance.isFeatureEnabled` + `app_user
issueSessionTokens` now return `ai_enabled` on login/2FA/pin (`doc/AI_GATE_BE_HANDOFF.md`).
**Division of labour:** FS colleague owns **finance + operations**; this stream owns master
data / sales-CRM / vault / portal / settings. **Next in this lane:** ⭐ Opportunities board,
Reports, Portal access (pulling Pixie layouts), plus Leads/intake + Compliance flags on the
existing pattern. See session log "session 5" below. **Session 4 (below)** — Windows-verified
this session. Shipped: (a) **Settings tiles** (bank accounts, payment
gateways, scheduled reports, API keys/AI vendors, pipeline stages [read-only], document numbering)
in `client/src/features/settings/config-pages.tsx`, routed + registered; (b) **per-tenant PWA** —
dynamic `/manifest.webmanifest` + `/icons/app-icon-*.png` from branding via sharp
(`src/routes/pwa.js`, mounted in `server.js`; `vite.config.ts` → `manifest:false` + dev proxies;
`index.html` link); (c) **screen scaffolds** — all 47 un-built screens now render a finished
skeleton (header/tabs/planned-columns/AI-actions/BE-status) via
`client/src/features/scaffold/{screen-scaffold.tsx,screen-specs.ts}` (`<Planned/>` replaced
`ComingSoon` in `app.tsx`); (d) new **`doc/FE_IA_BUILD_MAP.md`** — work-to-be-done map + AI-
integration map. See session log "session 4" + "Recommended next screens" below. Session 3 (below)
— a big session, all Windows-verified. Shipped: (1)
**test-isolation fix** (`tests/jest.setup.js`); (2) **Finance write forms** — Tax Center filing +
Credit Notes; (3) **identity pinned to the live schema** (`req.identityDb`) so the LIVE/TEST toggle
no longer logs you out, + field-mask coherence; (4) **LIVE/TEST toggle polish** (soft switch,
segmented control, TEST banner); (5) **audit_ledger** split (identity vs env) + **portal** cleared;
(6) **Settings tiles** — Currencies + Tax rates/jurisdictions built, all remaining tile endpoints
verified. See session logs "part 1–5" below. Prior session 2: cleared the pure-FE backlog (saved
login config, live theme tokens, centered/split login, mobile bottom nav). Session 1: full IA menu
+ ⌘K palette + hover nav; Settings hub; Appearance/Login editors on the real branding backend._

## Project

Praxis LS (SmartLS) — multi-tenant OHADA/Cameroon logistics + accounting ERP.
- **Backend:** Node 20 CommonJS + Express + PostgreSQL 16/pgvector + Redis. Repo root.
- **Frontend:** Vite + React 18 + TS SPA in `client/`.
- **Working folder:** `C:\Users\Grey\Documents\work\praxiz\praxis-ls`.

## Read first

`doc/WORK_DONE.md` (newest on top), `doc/WORK_TO_BE_DONE.md` (phase backlog with dated
audit banners), `doc/CONVENTIONS.md`, `doc/BUILD_CONVENTIONS.md`, `doc/AI_READINESS.md`.
Design reference: `doc/reference/reference-mock-lovable`.

## Current state

- **Backend Phases 0–4 substantially built** (colleague merged Phases 1–2; Phase 3
  Fleet/WMS/HR built here). Tests + lint green.
- **Frontend reskinned to the Lovable "Control Tower" look**, keeping the existing
  client's working plumbing (auth, api-client with refresh-on-401, branding, theme,
  screen-registry). Approach chosen with the user: *functionality of the existing
  client, looks of Lovable.*
  - `client/src/index.css` — Lovable design tokens (orange `#F5821F` + blue `#1C9BD7`,
    off-white/navy palette, Playfair Display + Montserrat, mesh backdrop) mapped onto
    the existing semantic tokens, so every screen re-tints automatically. Signature
    classes: `lux-card`, `status` pills, `lux-topbar`, `lux-mark`, `lux-navlink`,
    `font-display`. Now also carries a `landing-*` / `login-*` block (cinematic hero +
    dark sign-in modal, fully `--primary`-driven) and `.shadow-l` + `.lux-sidebar-in`.
  - `client/index.html` — Google Fonts links.
  - `client/src/app/layout/app-shell.tsx` — glass top command bar. **Navigation lives in
    the top bar:** primary areas inline (Control Tower link + Finance/Warehouse/Fleet
    dropdowns that open on hover with a 180 ms grace + click/tap/keyboard), a **More** button
    opens the full **15-group** menu as a collapsible **overlay sidebar** (ESC / outside-click
    to close). The old persistent left rail is gone; content is full-width. Mobile hamburger
    opens the same sidebar. **Real ⌘K command palette** (`components/command-palette.tsx`)
    filters all NAV screens. **Mobile bottom nav (session 2):** `BottomNav` (Control Tower /
    Files / Finance / Search), `flex md:hidden`, active-by-route-prefix, Search opens the
    palette. **LIVE/TEST toggle** kept (flips `X-Praxis-Env` and reloads — see the logout gap).
  - `client/src/features/dashboard.tsx` — Control Tower home renders the **full Lovable
    mock** in an isolated `<iframe srcDoc>` from `client/src/features/dashboard-mock/*.txt`.
    The mock's own topbar is hidden so there's a single app chrome; the iframe's
    `data-theme` tracks the app's light/dark via a MutationObserver.
- **Pre-auth experience rebuilt (2026-07-13): cinematic landing → login modal.**
  - `client/src/features/landing/landing-page.tsx` (NEW) — the `/login` route now renders
    a full-bleed dark hero (ken-burns bg, logo + theme toggle, eyebrow, serif headline,
    subheadline, italic body, brand chips, **Enter workspace** button). Fully white-label.
    **Content source (session 2):** reads the saved login config via `fetchLogin()`
    (`GET /branding/login`) first — headline / subtext / backgroundUrl / showLogo /
    accentOverride / layout — then falls back to legacy `branding.hero`, then generic copy.
    Every accent is `--primary` (token-driven); `accentOverride` scopes `--primary` to the hero.
  - `client/src/features/auth/login-modal.tsx` (NEW) — "Welcome back / Sign in to your
    command center" modal over the dimmed hero. **PASSWORD | QUICK PIN** tabs, email +
    password (reveal), keep-me-signed-in, forgot-password, SIGN IN; the existing **2FA**
    step is retained after password. Quick PIN is a **UI stub** (no backend endpoint yet).
  - `client/src/features/auth/login-page.tsx` — now a thin re-export of `LandingPage`
    (superseded; old standalone login removed).
  - `client/src/lib/branding.ts` — `Branding` extended with an optional `hero` block
    (eyebrow / headline / subheadline / body / imageUrl / pills[]) + `BrandPill`.
    `uploadLogo` renamed to `uploadImage` (alias kept).
  - `client/src/features/settings/appearance-page.tsx` — new **"Landing page"** card to
    edit all hero fields, upload the background image, and manage brand chips; saves via
    the existing `PUT /branding` flow and applies live.
  - **Keep-me-signed-in is real:** `client/src/lib/token-store.ts` now stores the refresh
    token in `localStorage` when checked (survives restart) or `sessionStorage` when
    unchecked (gone when the tab closes); `auth-context.login(email, pw, keepSignedIn)`
    threads the choice (also covers the 2FA path).
- **Phase 0 + Phase 1 FE wired to live endpoints.** Finance screens in
  `client/src/features/finance/pages.tsx` (Chart of accounts, Journals, Proforma &
  advances, Invoices, Receivables, tabbed Statements, tabbed Tax center, Assets), routed
  in `client/src/app/app.tsx` + nav + `client/src/app/screen-registry.json`. HR
  Employees/Payroll wired by colleague. Finance write forms (post/reverse journal, record
  advance, invoice draft→edit→submit, period freeze/close) via `ui/modal.tsx` +
  `lib/finance-api.ts`.
- **Auth behaviour:** logout `localStorage.clear()`s everything — nothing persists across
  sign-out (until told otherwise).
- **Postman** `postman/praxis-ls.phase0.postman_collection.json` — Phase 0 + Finance +
  Fleet/WMS/HR folders.

## Post-merge reconciliation — 2026-07-18 (after PR #11 merged into main)

The other dev merged main on his side; both streams landed large commits the same day. **Rule applied:
his side takes precedence on BE and on any overlapping screen.** Merged tree verified **`tsc` clean**.

**Collisions found + resolved:**
1. **Migration number clash.** Both streams used 0450/0451. His keep `0450_comms_channel_flags.sql` +
   `0451_email_inbound.sql`; mine renumbered via `git mv` → **`0452_campaign_templates.sql`** and
   **`0453_session_refresh_jti.sql`**. Confirmed **no environment had applied either pair**, so no
   reconciliation of applied-migration rows was needed. All doc references updated.
2. **`/comms` registered twice.** His `CommsHub` (+ `/comms/:section`) won; my `SmartCommsPage` was
   unreachable. **Deleted `features/comms/pages.tsx`** and its route/import — his suite is richer and
   BE-backed (mail module, channel flags, `channels` on the auth payload).
3. **`/godmode` registered twice.** His `GodModePage` then a stale `<Planned/>`; **removed the dead route.**
4. **Two workspace pages.** Mine was wired, his was orphaned. Per the precedence rule, **kept his
   `features/workspace/workspace-page.tsx`** (same `WorkspacePage` export → import swap) and **deleted
   `features/workspace/pages.tsx`.**
5. **`app_user.service.js` — no conflict.** His `resolveChannels` / `channels` payload and my rotation +
   reuse-detection both survived and coexist.

**Verified intact after merge:** all my BE (dashboard KPI aggregates, refresh rotation + reuse-detection,
campaign templates/senders/send), the settings store tiles, the vault trio, the Control Tower KPI wiring,
the campaign FE, the `SearchSelect` conversions (incl. `commercial/pages.tsx`, which he also edited), and
both new unit tests.

**`features/finance/pages.tsx` — co-existence, not a conflict (checked).** He edited imports, `JournalsPage`,
`AdvancePaymentForm`, `ProformasPage`, `InvoiceDraftForm`, `InvoiceSubmitForm`, `InvoicesPage`,
`ReceivablesPage`, `ChartOfAccountsPage` and `ReportTabs`; this stream's only changes are the
`SearchSelect` conversions inside `CreditNoteCreateForm` / `CreditNoteEditForm` (~L1800+, entity / client /
reversed-invoice, the last using the optional `filter` prop to stay scoped to FINAL invoices). **Disjoint
hunks — nothing to revert or merge; the file is already best-of-both.** These four are 100% his with no
trace from this stream: `master/pages.tsx`, `masterdata/pages.tsx`, `governance/pages.tsx`,
`lib/finance-api.ts`.

**Note for whoever commits:** a stale `.git/index.lock` was created by a blocked `git rm` and has been
removed — if git complains about a lock again, delete `.git/index.lock`.

### Post-merge continuation (same day) — idiom convergence + last screens

**Idiom convergence.** The merge left three apparently-competing pairs; on inspection only one was a
real duplicate:
- **AI — no work needed.** His `ScreenAi` *imports* this stream's `AiActions`, and `PraxisCopilot`
  imports `useAiEnabled` and returns null when off. His layer already composes on the global gate.
- **Lists — both kept, they're different abstractions.** `ResourceList` self-fetches from an `endpoint`
  prop (quick read-only screens); `DataList`/`PageHeader` is presentational with 4 states + custom cells
  (page owns the data). **`DataList` is the default for new wired screens.** The real duplication was
  `cell()` existing twice *and diverging* on boolean casing — now one implementation in **`lib/format.ts`**,
  re-exported from both modules so no import path changed (his `"Yes"/"No"` casing won).
- **Tabs — both kept.** `TabbedHub` is a route-driven hub shell (`/base/:section`); `Segmented` is
  in-page state. The genuine duplicate was the Master data hub hand-rolling an identical tab bar → it now
  uses `TabbedHub`. ⚠️ `TabbedHub` publishes its bar via **context**, expecting each tab page to render
  `<HubTabs/>` (his costing/ai-control pages do). Master data's pages don't, so a naive swap would have
  made those tabs vanish — hence the new optional **`inlineTabs`** prop (default off; his four hubs
  untouched) which renders the bar in the shell.

**Screens.** **Module catalogue** built (`/settings/catalogue`, `features/settings/catalogue-page.tsx`) —
read-only MOD-xx reference on `GET /catalogue/modules`. **Business setup retired**: it duplicated the
Corporate entities editor, so `/settings/business-setup` now redirects to `/master/corporate-entities`
and the hub card was repointed.

**Corporate entity gaps closed (BE + FE).** `address` and `bank_block` were writable on the API but had
no UI anywhere; `logo_light_ref`/`logo_dark_ref` were columns the validator silently dropped. Added both
logo fields to the create/update validator plus a new **`POST /entities/:id/logo`** (`{data_url, variant}`,
512 KB cap, allowed image types, stores under `tenant_<slug>/entity/<id>/`, audited) — **gated MOD-01
edit on purpose**, since reusing the MOD-70-gated `/branding/logo` would force settings-admin rights just
to set an entity letterhead. FE: the Corporate entities editor now edits Address, a Bank details block
(bank/branch/account/IBAN/SWIFT → invoice payment block) and the letterhead logo.

**Control Tower.** The 4th KPI card (receivables overdue) is now live too — derived FE-side from the
existing `receivables_ageing` report producer (sum of the past-due buckets), so **no new BE**. Hides when
`reporting` is off rather than showing a stale mock. All four cards are real.

**Bundle.** `vite.config.ts` gained `manualChunks` (vendor-react / vendor-charts / vendor / dashboard-mock
/ `feature-*`) for the >500 kB warning. ⚠️ **Unverified in-sandbox** — `vite build` can't run here (the
Windows-generated lockfile means the Linux rollup binary is missing). If the Windows build errors, just
revert that file; nothing depends on it. Note it improves caching/parallel download but **not first-load
bytes** — routes are still eagerly imported; route-level `React.lazy` is the deferred follow-up.

**Remaining FE:** only **Factory languages** and **Help center**, both genuinely BE-blocked (no endpoint).

## Session log — 2026-07-18 (session 8: FE follow-ons + all pending BE jobs)

Two-part session. **Part A (FE follow-ons, all `tsc`-clean, recorded inline above):** converted the
remaining reference pickers to `SearchSelect` (session-7 log §4; added an optional `filter` prop);
built the Settings store tiles (`features/settings/store-pages.tsx` — document templates / custom
fields / email signatures / policies; session-7 log §9); built the **whole vault trio** (`DocumentsPage`
+ `SignaturesPage` + `VerificationPage` in `features/vault/pages.tsx`, routed); PWA `background_color`
now follows theme (`src/routes/pwa.js`); converted the opportunity win-form entity picker (and confirmed
`placeholder/coming-soon.tsx` was already deleted). QuickPIN marked done. Also built two more lane
screens: **Smart Comms** (`features/comms/pages.tsx`, `/comms` — feature `comms`; two-pane channel list
+ thread + composer + new-channel modal over `/smartcomm`) and **My Workspace** (`features/workspace/
pages.tsx`, `/workspace` — greeting + awaiting-approval + notifications + quick links), both routed
(replaced `<Planned/>`).

**Part B — all pending BE jobs, built BE-then-FE (BE `node --check` + `eslint` clean; client `tsc`
clean; `npm test` + Windows lint/build authoritative — sandbox can't run DB tests):**

1. **Dashboard KPI aggregates (BE+FE).** `dashboard.repo.js kpis()` gained guarded `revenue_final_ttc`
   (Σ locked FINAL invoice TTC — nominal, not FX-consolidated), `revenue_currency`, `fleet_active`/
   `fleet_total` (vehicle counts), and `sla_on_time_pct` (dossier `ata ≤ eta` rate; NULL-safe via a new
   `num()` helper that preserves SQL NULL). FE `features/dashboard.tsx` now feeds the Control Tower's
   three decorative KPI cards (revenue / SLA / fleet) from these via the iframe injection script and
   **hides any card whose metric is null**. The 4th card (receivables "overdue") has no aggregate → stays
   mock. Clicking a card still opens the mock's sample detail modal (not rewired).

2. **Refresh-token rotation + reuse-detection (BE).** `app_user.service.refresh()` mints a fresh refresh
   token (new jti + sliding exp) bound to the SAME session, returns it as `refresh_token` (FE already
   captures it in `lib/api-client.ts`), and **stores its jti on the session** (`user_session.refresh_jti`,
   migration `0453_session_refresh_jti.sql`). On refresh the presented token's jti must match the session's
   current one; a mismatch = a rotated-away/replayed token → the session is **revoked** (reuse-detection).
   Legacy sessions (NULL `refresh_jti`) are grandfathered until their next refresh stamps one. `issueSession
   Tokens` stamps the jti on login/2FA/pin.

3. **Campaign templates + senders + send (BE+FE).** Migration `0452_campaign_templates.sql`
   (`campaign_sender` + `campaign_template`). Extended `sales/marketing_campaign` (MOD-22) with
   `/campaigns/senders` (+ `/:id/verify`), `/campaigns/templates` CRUD, and **`POST /campaigns/:id/send`**
   (all **registered before `/:id`**). Send renders a template to every active subscriber and enqueues one
   durable "email" job per recipient (delivered by `jobs/handlers/email-send.js`), with the template's
   sender as the `from` override. FE: `TemplateForm` moved off the `/settings/campaign_template` stopgap to
   the new endpoints + a **sender picker** with inline `SenderForm`; a **Send…** button on each campaign
   card opens `SendCampaignModal` (template picker → "Queued to N subscribers"). No per-recipient merge yet.
   Details in `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

**Postman + docs.** Added collection folder **13 · Marketing / Campaigns** (subscribers → sender → verify
→ template → send → cleanup, capturing ids) and made **`POST /auth/refresh`** capture the rotated
`refresh_token` (so a stale token now 401s — reuse-detection is testable in-collection). Updated
`doc/WORK_DONE.md`, `doc/FE_IA_BUILD_MAP.md` (statuses corrected — incl. the already-built Master data
hub), and `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

**Windows validation still required:** `npm run lint`, `npm test`, `npm run build --prefix client`, and
**apply migrations 0452 + 0453** to each tenant DB. Then smoke-test the Control Tower cards, the campaign
templates/senders tab + a send, a refresh cycle (incl. that an old refresh token is rejected after one
refresh), the vault trio, Smart Comms (needs the `comms` flag on), and My Workspace.

## Session log — 2026-07-17 (session 7: cross-cutting FE feature pass)

A directed batch across the FE (and a few BE list repos). **All in-sandbox `tsc --noEmit -p client`
clean; BE edits `node --check` clean. Windows `npm run lint` + `npm run build --prefix client` +
`npm test` remain authoritative, and the Control Tower iframe + every new form need a visual pass
(`npm run dev`).**

1. **Access/refresh token rotation (FE).** The BE `/auth/refresh` returns only a new `access_token`
   today (no rotation). Made the FE forward-compatible: it now stores a rotated `refresh_token` if the
   refresh response ever includes one — on both the boot path (`app/auth/auth-context.tsx`) and the
   401-retry path (`lib/api-client.ts`, incl. `{data:…}` unwrap). No-op until the BE rotates.

2. **QuickPIN — DONE (2026-07-18).** FE fully wired to the live `/auth/pin/*` routes (`auth-context`
   `pinLogin`/`registerPin`, `lib/pin-store.ts`, login-modal Quick PIN tab); BE `user_device`
   migration has landed in the identity/live schema. QuickPIN is live — no further FE or BE work.

3. **Removed all `MOD-` from the FE** (21 files). Guarded cleanup: parenthetical mentions `(MOD-xx)` and
   standalone tokens stripped, but the functional quoted keys `module: "MOD-XX"` in
   `scaffold/screen-specs.ts` were preserved (they gate RBAC), and BE `MODULE="MOD-XX"` keys were left
   untouched. NB a first, too-aggressive script pass corrupted code (removed empty `()` on non-MOD
   lines) — `tsc` caught it; reverted via `git show HEAD:<f> > <f>` (the mount blocks `unlink`, so
   `git checkout` fails) and redid it safely.

4. **Search everywhere (BE `q` + shared FE component).** Added `?q=` ILIKE to the registry repos that
   lacked it: `master/corporate_entity` (code/legal_name), `sales/lead` (company_name/contact_name),
   `sales/opportunity` (name), `operations/operations_file` (dossier `ref`), `finance/final_invoice`
   (`doc_number`), `master/financial_dictionary` (code/label_fr/label_en), `security/app_user`
   (full_name/email; threaded through `listUsersSafe`). `client_master` + `supplier_master` already had
   it. New shared **`SearchSelect`** in `features/sales/ui.tsx` — debounced `?q=`, client-side narrowing
   as a safety net for endpoints that ignore `q`, optional free-text commit, and an inline **"Add …"**
   action on an empty result. Wired: lead-capture **Company** (`features/sales/pages.tsx`, searches
   `/clients`, free-text prospect allowed) and quotation **Client** (`features/commercial/pages.tsx`,
   id+label). **Remaining pickers — DONE (2026-07-18):** converted meeting lead/client + opportunity
   client + proposal entity/client (`features/sales/pages.tsx`), quotation entity + pricing-variance
   dossier/quotation (`features/commercial/pages.tsx`, dropping the old `EntityOptions` helper for
   `entityText`/`entityLabelOf`), credit-note entity/client/reversed-invoice (`features/finance/pages.tsx`),
   bank-account entity (`features/settings/config-pages.tsx`) and portal client-scope
   (`features/portal/pages.tsx`). `SearchSelect` gained an optional **`filter?: (row) => boolean`** prop
   (used to keep the credit-note reversed-invoice picker scoped to FINAL invoices). **No assignee/user
   picker `<Select>` exists in the built screens** (`assigned_to` is display-only in wms), so that item
   was a no-op. In-sandbox `tsc --noEmit -p client` clean; Windows build authoritative.

5. **Quotations — dictionary line items + tax-code picker** (`features/commercial/pages.tsx`
   `QuotationForm`). Each line's description is a `SearchSelect` over `/financial-dictionary` (selecting
   an item fills label + default price + `is_debours` and sets `dictionary_item_id`); free text still
   allowed. Added a per-line **tax-code `<Select>`** (disabled on débours) sourced from
   `listSalesTaxCodes()` (new in `lib/masterdata-api.ts` — aggregates VAT codes across
   `/tax-jurisdictions/:id/codes` since there's no flat endpoint). Lines now submit `dictionary_item_id`
   + `tax_code_id` (both already accepted by the BE quotation validator), so `total_ttc != total_ht`.

6. **Reports — Dashboard tiles tab** (`features/vault/pages.tsx` `ReportsPage`). New "Dashboard tiles"
   segment reads `GET /reports/tiles`, lists the catalogue with **Add tile / Show-Hide / position**
   controls, upserting via `PUT /reports/tiles` (`{tile_key,position,is_visible,config}`; tile_key ==
   report_key). Feeds the Control Tower tile store.

7. **Marketing campaigns — Templates tab** (`features/sales/pages.tsx` `CampaignsPage` + `TemplateForm`).
   Create/edit/delete reusable email templates, **each carrying its own sender name + address**, plus
   subject + body. `marketing_campaign` (MOD-22) has **no** template/sender endpoints, so these persist
   in the generic settings store: `GET/PUT/DELETE /settings/campaign_template/:key` with
   `{ value: {name,subject,from_name,from_address,body_html} }` (arbitrary sections are allowed). **Caveat:
   `/settings` is gated MOD-70**, so a pure marketing role can't manage them yet — full rationale + the
   proposed dedicated `/campaigns/templates` + `/campaigns/senders` + send endpoints are in
   **`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`** (new this session).

8. **Control Tower — Lovable look restored, on live data** (`features/dashboard.tsx`, rewritten). Session 6
   had replaced the mock with plain React tiles; per the user we reverted to the **Lovable mock**. Restored
   `client/src/features/dashboard-mock/{body.html,style.css,script.js}.txt` from
   `doc/reference/reference-mock-lovable/src/lib/dashboard`, and render them in an `<iframe srcDoc>` with:
   the mock's own chrome hidden (`.testban/.topbar/.botnav/.drawer`), an injected script that rewrites the
   **live-shipments list**, the "N active" pill, the hero subline and the Praxis briefing from
   `/dashboard/control-tower` + `/dashboard/kpis` (mapping `live_shipments` → the mock's dossier row shape),
   and **theme sync** (parent `.dark` class → iframe `data-theme`). Decorative KPI cards (revenue/SLA/fleet)
   keep the mock's sample values — no BE source for them yet. **Must be eyeballed in `npm run dev`.**

9. **Settings-tiles recheck.** The generic `/settings/:section/:key` store (`security/setting`,
   `setting.rules.js`) already validates sections `document_template` (name/status/body_html/css_vars),
   `custom_field` (array of field defs), `email_signature` (tenant brand template) and `integration_secret`,
   and allows arbitrary sections + `_policy`/`_tiers` list values. So the previously-"no BE" tiles (custom
   fields, document templates, policies, email signatures) are **now buildable** on this store — a good next
   batch (mind the MOD-70 gate). **BUILT (2026-07-18)** — new `client/src/features/settings/store-pages.tsx`
   with `DocumentTemplatesPage` (section `document_template`, key=doc type, name/status/body_html/optional
   css_vars JSON), `CustomFieldsPage` (section `custom_field`, key=entity type, repeatable field-def editor
   → array value), `EmailSignaturesPage` (section `email_signature`, single key `template`, tenant brand html)
   and `BusinessPoliciesPage` (section `policy`, key=slug, name/body_html). All list+modal on the config-pages
   primitives, MOD-70-gated with graceful error state. Routed in `app.tsx` (replaced the four `<Planned/>`
   slots: `settings/document-templates|custom-fields|email-signatures|business-policies`); settings-hub cards
   already pointed at these routes. In-sandbox `tsc --noEmit -p client` clean; Windows build authoritative.

10. **Pre-existing build break fixed.** The repo pull left an unused `import * as React` in
    `components/ui/skeleton.tsx` (fails `noUnusedLocals`); removed it so the client typechecks clean.

**New/edited this session.** FE: `lib/api-client.ts`, `app/auth/auth-context.tsx`, `features/sales/ui.tsx`
(SearchSelect), `features/sales/pages.tsx` (lead company + Campaigns Templates tab), `features/commercial/pages.tsx`
(quotation dictionary/tax/client), `features/vault/pages.tsx` (Reports tiles), `features/dashboard.tsx`
(rewrite) + restored `features/dashboard-mock/*`, `lib/masterdata-api.ts` (`listSalesTaxCodes`),
`components/ui/skeleton.tsx`, + the 21 MOD-cleanup files. BE: `q` in `corporate_entity`/`lead`/`opportunity`/
`operations_file`/`final_invoice`/`financial_dictionary` repos + `app_user` repo/service. New doc:
`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

## Session log — 2026-07-17 (session 6: Sales/CRM funnel — Leads + Meetings)

Confirmed the whole next lane is BE-unblocked, then agreed a funnel model with the user —
**marketing → leads + opportunities → sales** — and folded all 11 Commercial + Sales & CRM
screens into a build order (Phase A leads → B opportunities → C marketing → D commercial).
Started Phase A. Pixie design pulled from the user's screen recording (`Recording 2026-07-17`).

1. **BE confirmation (all merged).** Read `src/shared/http/module-loader.js` — it auto-discovers
   any `src/modules/<group>/<mod>/<mod>.routes.js` and mounts it. Verified all funnel modules are
   present with full 7-file structure + real routes: opportunity (MOD-24, `/opportunities`,
   board/stages/move/win/lose), report (MOD-63, `/reports`, **feature-gated `reporting`**), lead
   (MOD-20, `/leads`), inbound_intake (MOD-25, `/inbound`), compliance_flag (MOD-65,
   `/compliance`), portal (MOD-67, `/portals`; external client/investor/auditor views gated behind
   `portal.client|investor|audit`), plus meeting (MOD-21), marketing_campaign (MOD-22), proposal
   (MOD-23), success_story (MOD-26), quotation (MOD-27, **gated `commercial.quotation`**), the two
   simulators + pricing_variance. **Gates to remember:** Reports needs `reporting`; Quotations needs
   `commercial.quotation`; portal external views need their `portal.*` flags.

2. **Leads & intake — BUILT** (`client/src/features/sales/pages.tsx`, `LeadsPage`). Two-tab screen
   (segmented control): **Leads** and **Inbound intake**. Leads tab = Pixie *Clients*-tab layout
   (search + filter chips All/New/Contacted/Qualified/Converted/Lost + avatar list-rows) wired to
   `/leads`: capture/edit (`POST`/`PATCH`), advance (`POST /leads/:id/transition` → CONTACTED /
   QUALIFIED / LOST), and **Convert** (`POST /leads/:id/convert`, QUALIFIED only → client_master).
   Intake tab (nested segment) = **Enquiries** (`/inbound/enquiries`, **Triage** → `:id/triage`
   `{to_lead,close}`) + **Partnership requests** (`/inbound/partnerships`, **Review** → `:id/review`
   `{status}`). Gated AI panel. **Decision:** intake folded into Leads (not a standalone screen);
   `/sales/inbound-intake` now **redirects** to `/sales/leads?tab=intake` (deep-link kept in nav).

3. **Meetings — BUILT** (`MeetingsPage`). List of meetings (`/meetings`); **Schedule meeting**
   (`POST /meetings`, subject + optional lead/client picker + `scheduled_at`); click a row → detail
   modal loads `GET /meetings/:id` (notes) with **Add note** (`POST /meetings/:id/notes`,
   `{body,is_minutes}`). Gated AI panel (summarise minutes / draft follow-up).

4. **Wiring.** `app/app.tsx` — imported `LeadsPage`/`MeetingsPage`, replaced the two `<Planned/>`
   slots + added the intake redirect. `app/layout/app-shell.tsx` — nav relabelled "Leads" →
   "Leads & intake"; "Inbound intake" now deep-links `?tab=intake`.

5. **Design fidelity.** The Pixie mock is dark crimson; we take its *structure* (tabbed CRM,
   filter chips, avatar rows, segmented controls) but render through the app's `--primary` token set
   so it re-tints per tenant. New primitives (`Segmented`, `Chips`, `Avatar`, `Badge`) are local to
   `features/sales/pages.tsx` for now — promote to `components/ui` if reused by the ⭐ hubs.

**Verified:** in-sandbox `node_modules/.bin/tsc --noEmit -p tsconfig.json` → **0 errors** (mount
served full files this session). **Authoritative check still: `npm run build --prefix client` +
`npm run lint` on Windows.** New/edited: `features/sales/pages.tsx` (new), `app/app.tsx`,
`app/layout/app-shell.tsx`, `features/scaffold/screen-specs.ts`, `doc/FE_IA_BUILD_MAP.md`.

6. **Opportunities Kanban — BUILT (Phase B, session 6)** (`OpportunitiesPage` in
   `features/sales/pages.tsx`). Board + List views (segmented). **Board** = one column per
   `/opportunities/stages` (sorted); cards = OPEN opps from `/opportunities` grouped client-side by
   `pipeline_stage_id`; per-column value from `/opportunities/board`; a **forecast strip** (open
   value / weighted forecast Σ value×prob / open deals / win rate). **Drag-to-move** cards between
   columns → `POST /:id/move {pipeline_stage_id}` (a won/lost stage auto-settles server-side).
   Per-card **Win** (modal, optional `create_dossier` + entity picker → `POST /:id/win`), **Lose**
   (`POST /:id/lose`), **Edit** (`PATCH`, name/value/currency/probability only — BE locks settled +
   won't PATCH stage/links). **List** view has a stage-move `<select>`. New primitive `MetricTile`
   added locally. Route wired in `app.tsx`; gated AI panel. Design = Pixie *Pipeline* tab.
   Note: BE `board` returns only per-stage aggregates (no cards), which is why the board composes
   `/stages` + `/` (list) rather than rendering `/board` directly.

7. **Proposals — BUILT (Phase B tail, session 6)** (`ProposalsPage` in `features/sales/pages.tsx`).
   List + status filter chips + search; click a row → **detail modal** (`GET /:id`) showing narrative
   sections + a priced line table with total. Create/edit **draft** with repeatable narrative-section
   and line-item editors (`POST` / `PATCH` — PATCH replaces children, DRAFT-only per BE). Lifecycle
   via inline action panels: Submit (`→IN_REVIEW`), Send (`→SENT`, needs entity → numbers the doc),
   Back to draft, Reject (`→REJECTED`), **Accept** (`POST /:id/accept`, optional `create_quotation`
   + entity → spins a quotation from the lines). Transitions follow the BE rules
   (DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED). Gated AI panel (Draft/tighten = assist). Route wired.

8. **Marketing campaigns — BUILT (Phase C, session 6)** (`CampaignsPage`). Tabs Campaigns |
   Subscribers. Campaigns tab = metric strip (Active/Draft/Ended/Subscribers) + campaign cards with
   lifecycle buttons (`POST /campaigns/:id/transition`; DRAFT→ACTIVE→PAUSED↔ACTIVE→ENDED per BE
   rules); New campaign (`POST /campaigns`, name/channel/dates). Subscribers tab = list of active
   newsletter subscribers + Add (`POST /campaigns/subscribers`) + Unsubscribe
   (`POST /campaigns/subscribers/unsubscribe`). Pixie *Sales campaigns* layout. Gated AI panel.
9. **Success stories — BUILT (Phase C, session 6)** (`SuccessStoriesPage`). Filter chips
   (All/Draft/Signed off/Published; status derived from `is_published`/`signed_off_by`) + case-study
   cards. Create/edit **draft** (`POST` / `PATCH` — PATCH locked once published, per BE). Lifecycle
   **Sign off** (`/:id/sign-off`) → **Publish** (`/:id/publish`, BE requires prior sign-off) →
   **Unpublish** (`/:id/unpublish`). Gated AI panel (Draft/polish = assist). Both routes wired.

**Phase C complete — the whole Sales & CRM funnel is now built** (Leads/intake, Meetings,
Opportunities, Proposals, Campaigns, Success stories). `features/sales/pages.tsx` is the single file
for all six (~2000 lines, like `finance/pages.tsx`).

10. **Shared UI extracted (session 6).** The reused primitives moved out of `features/sales/pages.tsx`
    into **`client/src/features/sales/ui.tsx`** (`Row`, `errMsg`, `cell`, `when`, `fmtMoney`, `useList`,
    `Badge`, `Segmented`, `Chips`, `Avatar`, `MetricTile` + the `BADGE` colour map, now incl.
    EXPIRED/GREEN/YELLOW/RED). Both `sales/pages.tsx` and the new `commercial/pages.tsx` import from it.
11. **Commercial group — BUILT (Phase D, session 6)** in **`client/src/features/commercial/pages.tsx`**
    (the FS colleague said he'll verify the finance-side correctness):
    - **Quotations** (`/commercial/quotations`, MOD-27) — ⚠️ **feature-gated `commercial.quotation`**;
      when off, the list 403s and the page shows an "enable it" empty state (heuristic on the error).
      List + chips; detail modal (line table + HT/TTC from the BE); create/edit draft with a line
      editor incl. a **débours** (pass-through, untaxed) flag; lifecycle DRAFT→SENT (needs entity →
      numbers the doc; sends directly if the quote already has an entity)→ACCEPTED (inline "convert to
      final-invoice draft")/REJECTED/EXPIRED. **No tax-code picker yet** → lines aren't VAT-flagged from
      the FE, so total_ttc == total_ht until a tax_code_id is set; add a tax-code picker when needed.
    - **Margin simulation** (MOD-27) + **Extra-charge simulation** (MOD-28) — saved-sim cards + a modal
      with a line/tier editor, a **Preview** button (`/preview`, computes without persisting) and
      **Save** (`POST /`). Extra-charge needs a tariff — the modal has a tier editor (overrides tenant
      settings `commercial.demurrage_tariff`).
    - **Pricing variance** (MOD-27) — Sales R/Y/G list (flag + quote only; **raw cost never leaves the
      finance boundary**) + flag chips; **Compute** modal (dossier picker from `/operations`, quotation
      picker, optional quoted-price/actual-cost) → `POST /compute`. Note the dossier picker reads
      `/operations` (colleague's module) — empty/403 if this user lacks that view.

12. **Non-funnel hubs — BUILT (session 6).**
    - **Reports** (`/vault/reports`, MOD-63) in **`client/src/features/vault/pages.tsx`** — ⚠️
      **feature-gated `reporting`** (whole `/reports` router; "enable it" empty state when off).
      Catalogue tab (10 report producers) → Run modal with optional params (from/to/as_of/period_code/
      dossier_id) → generic `ResultBlock` (array→table, else JSON) → Save. Saved tab (run via
      `/saved/:id/run`, delete). Scheduling already lives in Settings → Scheduled reports (session 4);
      dashboard-tile picker (`/reports/tiles`) deferred — that's the Control Tower live-data follow-on.
    - **Compliance flags** (`/vault/compliance-flags`, MOD-65) in the same `vault/pages.tsx` — Flags
      tab: **Run checks** (`POST /compliance/run`, shows the summary), severity chips + include-resolved
      toggle, flag rows with **Resolve** (`/:id/resolve`). Rules tab = the rule catalogue.
    - **Portal access** (`/portal/access`, MOD-67) in **`client/src/features/portal/pages.tsx`** —
      active-grant list + **Grant** (client/investor/auditor; CLIENT needs a client scope) + **Revoke**
      (`/access/:id/revoke`). **Preview** buttons GET the external views (`/portals/client|investor|
      auditor`) and render the scope; each is gated `portal.client|investor|audit` → graceful "enable
      it" state when off. External-user auth (magic link) is a separate BE surface, not this screen.

13. **Control Tower — now LIVE (session 6).** `client/src/features/dashboard.tsx` **replaced** the
    static Lovable `<iframe srcDoc>` mock with real React tiles reading **`GET /dashboard/kpis`**
    (flat guarded counts) + **`GET /dashboard/control-tower`** (`operation_files {active,open,in_progress}`,
    `approvals_awaiting`, `live_shipments[]` = open/in-progress dossiers with ref/status/route/vessel/
    ETA). MOD-00A, permission-gated, no feature flag. Hero strip (active op-files / approvals / open
    compliance flags / unposted journals) + a live-shipments table + op-file breakdown + registry
    counts, all `lux-card`/token-styled + a Refresh button + gated AI panel. The mock files
    (`features/dashboard-mock/*`) are now **unused** (safe to delete). Not fed from `/reports/tiles`
    (that's a per-user tile-layout store) — the dedicated dashboard aggregate is the right source.

**Session 6 lane COMPLETE — every screen in this stream's lane (master data, Sales & CRM funnel,
Commercial, vault Reports/Compliance, Portal) is built and typechecks clean, and the Control Tower is
on live data.** New files: `features/sales/{pages,ui}.tsx`, `features/commercial/pages.tsx`,
`features/vault/pages.tsx`, `features/portal/pages.tsx`; rewrote `features/dashboard.tsx`. **Left for
later (follow-ons):** a tax-code picker for Quotations (so VAT flags from the FE); dashboard-tile
picker in Reports; delete the now-unused `dashboard-mock/*`; platform/godmode console UI. Vault
Documents/Signatures/Verification have BE gaps (see build map).

**Vault BE surface — checked 2026-07-18** (all three modules exist and are mounted; none are as thin as
"gap" implied):
- **Documents — BUILT (2026-07-18).** `document_vault` (MOD-64, `/documents`, no feature flag). GET `/`
  (list), GET `/:id`, GET `/:id/download` (confidential, not the public `/media` mount), POST `/` (upload;
  `validator.create` = `{ data_url (base64, req), doc_type?, entity_ref?, file_context? ∈ OPS|OVH,
  folder_ref?, dossier_id? }`), DELETE `/:id` (archive). Shipped `DocumentsPage` in
  `features/vault/pages.tsx` (list + status filter/search, **upload** via base64 data-URL with 25 MB cap,
  **archive**, and an **authed binary download** — a raw `fetch` with the Bearer + `X-Praxis-Env` headers
  that opens the PDF blob in a tab, since the endpoint returns bytes not JSON; 409 → "not rendered yet").
  Routed at `vault/documents` (replaced `<Planned/>`). `tsc`-clean.
- **Signatures — BUILT (2026-07-18).** `document_signature` (MOD-64, `/signatures`, **feature `signatures`**).
  GET `/?entity_ref=<ref>` (list is **keyed by entity_ref** — no all-signatures list) + POST `/` (sign, needs
  **`approve`** perm; `validator.sign` = `{ entity_ref (req), signer_name?, method? ∈ DIGITAL|PHYSICAL,
  signature_ref? }`). Shipped `SignaturesPage`: look up a document by reference → its signatures list + an
  **Add signature** modal; graceful "signatures not enabled" state (via `isGated`) when the flag/RBAC blocks it.
- **Verification — BUILT (2026-07-18).** `document_verification` (MOD-66, `/document-verification`, no flag).
  GET `/scan` (PUBLIC) + GET `/verify` (gated), query `{ hash (req, ≥4 chars), doc_id? | entity_ref? }` →
  `{ verified, doc_id, entity_ref, doc_type, version_no, content_hash }`. Shipped `VerificationPage` — a
  lookup widget (Reference|Document-ID toggle + hash → green/red tamper verdict card). Not a CRUD list.
  **Vault trio all routed** (`vault/documents|signatures|verification` replaced their `<Planned/>`); `tsc`-clean.

## Session log — 2026-07-16 (session 5: master-data trio + global AI gate)

Division of labour set with the FS colleague: **colleague owns finance + operations**;
this session (and the run to Sunday) covers everything else — master data, sales/CRM,
vault, portal, settings. QuickPIN migration has landed (colleague), so QuickPIN is live —
smoke-test register/login when convenient.

1. **Global AI gate (NEW).** All AI affordances now route through one gate:
   `client/src/components/ai-actions.tsx` — `useAiEnabled()`, `<AiGate>`, and the shared
   self-gating `<AiActions actions={…}/>` panel. AI is a per-tenant switch
   (`ai.assistant.backend` feature flag, flipped from the developer dashboard); when off,
   **no AI UI appears in any module**. The gate reads `user.ai_enabled` off the auth
   session (`app/auth/auth-context.tsx` `User` extended) and **defaults OFF** until the BE
   sends it (fail-safe — AI is opt-in). `screen-scaffold.tsx` was refactored to render its
   AI panel via `<AiActions>` (so all 47 scaffolds gate automatically).
   **BE side — DONE (2026-07-16, this session):** `ai_enabled` now ships on the login / 2FA /
   pin-login `user` payload. New `governance.isFeatureEnabled(client, key)` (tenant-level flag,
   ignores per-user grant/budget); `app_user issueSessionTokens()` resolves
   `ai_enabled = isFeatureEnabled(client, "ai.assistant.backend")` via a fail-safe
   `resolveAiEnabled()` (never throws → defaults false, can't block sign-in). Full notes in
   `doc/AI_GATE_BE_HANDOFF.md`. Toggling in the dev dashboard takes effect on next login.
2. **Master-data trio wired to live BE** — new `client/src/features/master/pages.tsx`
   (same primitives as `settings/master-data-pages.tsx`):
   - **Clients** `/master/clients` (MOD-03 `/clients`): list + create/edit (entity picker,
     NIU/RCCM, payment terms, credit limit, withholding, active) + a **Credit** modal
     (`GET /clients/:id/credit` → KYC/limit/used/available/within). Gated AI panel.
   - **Suppliers** `/master/suppliers` (MOD-04 `/suppliers`): list + create/edit (category,
     rating, payment method incl. conditional mobile-money fields, non-resident, active).
     Gated AI panel.
   - **Corporate entities** `/master/corporate-entities` (MOD-01 `/entities`): list +
     create/edit (code immutable on edit, legal name, NIU/RCCM, ISO-2 country, doc prefix,
     language, FY start month) + **Activate/Deactivate** (`POST /entities/:id/active`).
   Routed in `app.tsx` (replaced the three `<Planned/>` slots); nav already listed all
   three; `screen-registry.json` left as-is (not load-bearing for built pages — currencies/
   tax-jurisdictions have no entries either).
3. **Design fidelity:** the Lovable reference mock is dashboard-only (no per-entity Pixie
   layouts exist), so per the agreed fallback these three reuse the existing table+modal
   pattern. Pixie layouts to be pulled for the ⭐ hub screens next (Opportunities board,
   Reports, Portal access).

**Not yet Windows-verified** (batch workflow — sandbox mount unreliable for fresh files;
did not run in-sandbox `tsc`). **Authoritative check: `npm run build --prefix client` +
`npm run lint` + `npm test` on Windows.** New/edited FE files:
`components/ai-actions.tsx` (new), `features/master/pages.tsx` (new),
`app/auth/auth-context.tsx` (User type), `features/scaffold/screen-scaffold.tsx` (AI panel
→ `<AiActions>`), `app/app.tsx` (imports + 3 routes). New doc: `doc/AI_GATE_BE_HANDOFF.md`.

**Next in my lane (to Sunday):** ⭐ Opportunities Kanban (`/sales/opportunities`, MOD-24),
⭐ Reports runner (`/vault/reports`, MOD-63), ⭐ Portal access (`/portal/access`),
Leads + intake (MOD-20/25), Compliance flags (MOD-65). Pull Pixie layouts for the ⭐ ones.

## Session log — 2026-07-13 (FE)

1. **Landing → login flow** replicated from a screen recording ("The Pixie Hub" concept).
   Decisions taken with the user: data-driven white-label (Pixie is sample data);
   token-driven crimson via `--primary`; keep 2FA; wire keep-me-signed-in; Quick PIN as a
   UI stub; hero assets/copy authored on the Appearance screen. Files: `landing-page.tsx`,
   `login-modal.tsx`, `branding.ts`, `appearance-page.tsx`, `token-store.ts`,
   `auth-context.tsx`, `icons.tsx`, `index.css`, `app.tsx` route.
2. **Control-panel nav moved to the top bar** (Lovable pattern): Control Tower / Finance /
   Warehouse / Fleet inline (areas open dropdowns), **More** opens a full-menu collapsible
   overlay sidebar; left rail removed. File: `app-shell.tsx` (+ `index.css`).

`tsc --noEmit` on `client/` passes clean for both pieces.

## Session log — 2026-07-14 (FE + backend integration)

Backend was **pulled mid-session**; the colleague's Settings, IAM/security, MFA and QuickPIN
work is now in the repo (same `/api/tenant` contract — NOT the `/api/v1` Pixie doc, which is a
separate app's reference in `doc/SECURITY_BUSINESS_SETTINGS_IMPLEMENTATION.md`).

1. **IA / navigation map.** `app-shell.tsx` `NAV` expanded 7 → 15 groups across the whole
   `src/modules` map (Commercial, Sales & CRM, Operations, Procurement, Costing, Master data,
   Vault, Comms, + Settings & Admin). Unbuilt screens route to a shared `ComingSoon`
   (`client/src/features/placeholder/coming-soon.tsx`). Tab-vs-standalone plan + backend gaps in
   `doc/FE_IA_HANDOFF.md`; design tokens/classes in `doc/FE_DESIGN_RULES.md`.
2. **⌘K command palette** (`client/src/components/command-palette.tsx`) — filters all NAV
   screens; replaces the "search opens sidebar" stopgap. **More** still opens the full sidebar.
3. **Top-bar area menus open on hover** (180 ms grace close) + click/tap/keyboard. Fixed the
   transparent-dropdown bug: dropdown has an explicit `--popover` fill and the header is
   `relative z-40` (backdrop-filter stacking context was trapping it behind content).
4. **Settings hub** (`client/src/features/settings/settings-hub.tsx`) — pixie card grid
   (Identity / Money / Operations / Communication / Integrations & Security). `/settings` renders
   it (old key/value `SettingsPage` retired). "Businesses (list & provision)" tile removed per BE.
5. **Appearance + Login editors wired to the REAL branding backend** (the pull extended
   `branding.service.js`). `client/src/lib/branding.ts` now matches `GET/PUT /branding` (full
   token set: name, primary, primaryForeground, secondary, accent, accentDeep, accentGlow,
   info/success/warn/danger, logoUrl/logoAltUrl/faviconUrl, fontDisplay/Body/Mono, radius, theme)
   and adds `LoginConfig` + `fetchLogin`/`saveLogin`/`uploadLoginBackground` for
   `GET/PUT /branding/login` (backgroundUrl, headline, subtext, layout, showLogo, accentOverride).
   `appearance-page.tsx` + `login-editor.tsx` rebuilt against these — **all fields persist**.
   Shared controls in `components/settings/controls.tsx` (ImageField takes a custom `upload`).
   Speculative pixie-only fields (quotes/pillars/regionals/per-mode token bag/businesses/tagline)
   dropped — no backend.
6. **QuickPIN + MFA wired** to the colleague's auth routes (`/auth/pin/*`, `/auth/2fa/*`):
   `lib/pin-store.ts` (device registry, survives logout), `lib/security-api.ts`, self-service
   `features/security/my-security.tsx` (route `/security/my-security`, in the Security & Access
   menu), and the login modal's Quick PIN tab is now real. `auth-context.tsx` gained `pinLogin`
   + `registerPin`. **QuickPIN currently errors — missing `user_device` table (see gaps).**

**Not verified in-sandbox:** the sandbox degraded then died this session ("Failed to create
bridge sockets"), so no in-sandbox `tsc`. Files are correct on disk. **Run
`npm run build --prefix client` on Windows to confirm the FE typechecks.**

## Session log — 2026-07-14 (session 2 — pure-FE backlog cleared)

BE was **not touched** this session — all BE-blocked items (below) were parked pending the BE
dev's answers. Everything here is FE-only. `tsc -b --force` passed clean for the theme/landing
batch; the shell/CSS batch is verified by inspection but the sandbox mount cache wedged on
`app-shell.tsx` mid-session (see **Sandbox gotcha**), so confirm it with a Windows
`npm run build --prefix client`.

1. **Build fix.** Removed the unused `Input` import in `features/settings/login-editor.tsx`
   (the one `tsc` error blocking the build).
2. **Login screen now shows saved config (resolved a listed gap).** `features/landing/landing-page.tsx`
   fetches `GET /branding/login` via `fetchLogin()` and renders `headline` / `subtext` /
   `backgroundUrl` / `showLogo` / `accentOverride` / `layout`. Precedence: **saved login config →
   legacy `branding.hero` → generic copy** (hero still supplies eyebrow/body/pills, which
   `LoginConfig` doesn't carry). `accentOverride` is applied as a scoped inline `--primary` on the
   `.landing` container, so it re-tints the whole hero + login modal subtree.
3. **Login layout field is real.** `index.css` gained `.landing[data-layout="centered"]` rules;
   default / `"split"` keeps the current left-aligned hero.
4. **Full theme token set applies live (resolved a listed gap).** `lib/theme.ts` `applyBrand()`
   now sets, beyond primary: `--secondary`, `--accent`, `--brand-orange` + `--brand-orange-deep`
   (from primary / accentDeep), `--destructive` + status-pill triplets `--ok`/`--warn`/`--bad`
   (from success/warn/danger), `--info`, fonts (`--font-display/-body/-mono`) and `--radius`.
   Hex → `"R G B"` triplet conversion is done for the pill tokens (they're consumed as
   `rgb(var(--x) / a)`); non-hex values are skipped rather than written invalid. `resetBrand()`
   reverts the whole managed set. `app/branding/branding-context.tsx` `paint()` now threads the
   full token set (was primary + foreground only), so it applies on the public fetch and on save.
5. **Mobile bottom nav (Lovable pattern).** `app/layout/app-shell.tsx` gained a `BottomNav`
   (Control Tower / Files / Finance / Search), **mobile-only** (`flex md:hidden`), active-by-route-
   prefix, Search opens the ⌘K palette. Full 15-group menu still reached via the top-bar hamburger,
   exactly as in the mock. `<main>` padded `pb-24 md:pb-6` to clear the bar. Styles: `.lux-botnav` /
   `.lux-botnav-btn` in `index.css` (active tint follows `--primary`, so it re-tints per tenant).
   Note: display is driven by the `flex md:hidden` utilities, **not** by the class (a `display` in
   `.lux-botnav` would beat `md:hidden` on source order).
6. **Cleanup.** Deleted the stray `client/src/_wtest.txt`.

## Session log — 2026-07-15 (test fix + BE answers + Finance write forms)

1. **Test-isolation fix.** `tests/jest.setup.js` now blanks external-provider vars
   (`GROQ_API_KEY`, `GEMINI_API_KEY`, `SMTP_HOST`, etc.) so the local `.env` no longer leaks
   placeholder keys into unit tests. Fixed the 3 failing `services/ai/*` + email guard tests.
   Windows lint + client build pass; `npm test` green. Test-only change.
2. **BE answered the 4 open questions** (see below): identity pins to the live schema; QuickPIN
   migration + remaining Settings endpoints + Finance write endpoints are all available.
3. **Finance write forms built** (against the verified BE contracts):
   - **Tax Center → Declarations / filing tab** (`features/finance/pages.tsx` `DeclarationsPanel`
     + `FileDeclarationForm`/`SubmitDeclarationForm`): list declarations, **File a return** (kind
     ∈ TVA/IS/MIN_TAX/WHT/DSF/CNPS/DIPE/PATENTE, period_code, entity, from/to/due_on) →
     `POST /tax/declarations`; per-row **Approve** (`/approve`) and **Submit** (`/submit` with
     `filed_ref`). Status pill DRAFT→COMPUTED→APPROVED→FILED.
   - **Credit notes** (`CreditNotesPage`, route `/finance/credit-notes`): create (entity, client,
     reverses a FINAL invoice, lines with required `label`) → edit draft → **Post** (`/post`).
   - Helpers added to `lib/finance-api.ts` (tax: `listDeclarations`/`fileDeclaration`/`approve`/
     `submit`; CN: `list/get/create/update/post` + `loadFinalInvoices`). Wired in `app.tsx`, nav
     (`app-shell.tsx`), and `screen-registry.json` (`fin_credit_notes`).
   - **In-sandbox `tsc --noEmit` on `client/` passed clean** (mount served full 2103-line
     `pages.tsx`, not truncated). Confirm with a Windows `npm run build --prefix client`.

## Session log — 2026-07-15 (part 2: identity pinned to the live schema)

Implemented the answer to open question #1 — the LIVE/TEST toggle no longer logs the user out.

1. **New `req.identityDb` (always live schema)** in `middleware/tenant-context.js`, alongside the
   existing env-bound `req.tenantDb`. Both call `registry.withTenantConnection`; identityDb forces
   `env="live"`.
2. **Enforcement path pinned:** `middleware/auth.js` (`getAuthUser`) and `middleware/rbac.js`
   (`getGrants` / `getUserScopeIds` / `getUserCapabilities`) now resolve via `req.identityDb`.
3. **Auth/session/identity controllers pinned:** all of `security/app_user` (login, refresh,
   logout, verifyTotp, setup/enable/disable TOTP, pin register/login/list/revoke, user CRUD),
   `security/session` (mine/kill/killAllMine + base CRUD).
4. **RBAC-admin writes pinned** so grants edited = grants enforced: `permission` (`upsertGrant`
   + base), `iam_role`, `capability`, `scope`, `field_visibility`. Enabled by a new
   `makeController(service, label, { identity: true })` option in `shared/crud/resource.js`
   (defaults false → every business module is unchanged).
5. **Auth services untouched** — they already take a `client`; only the caller picks the schema.
6. **Verified in-sandbox:** `node --check` + `eslint` clean on all 11 changed files. **Windows
   `npm run lint` + `npm test` still required** (sandbox can't run the DB integration tests).
7. **Field-mask coherence — also fixed.** `shared/rbac/field-mask.js` gained
   `maskForUserVia(req.identityDb, user, data)`; `employees` + `operations_file` controllers read
   data on the env client but resolve masked field_keys from the identity schema, so confidential
   fields stay masked under TEST. Remaining flagged items (a BE call, not done): `audit_ledger`
   identity-vs-env, and the `portal` session model.

## Session log — 2026-07-15 (part 3: LIVE/TEST toggle polish)

Now that identity is env-independent, the toggle became a real in-app control. `app/layout/app-shell.tsx`:

1. **Soft switch (no reload).** `env` is React state (was a one-shot `tokenStore.getEnv()`).
   `switchEnv(next)` persists `X-Praxis-Env` and updates state; **`key={env}` on `<main>`**
   remounts the routed screen so every `useEffect` re-fetches under the new env. Access token +
   auth survive (no more `window.location.reload()`, no logout). `toggleEnv` removed.
2. **Segmented Live | Test control** replaces the single status pill (emerald LIVE / amber TEST,
   `aria-pressed`).
3. **TEST-MODE banner** (Lovable mock): amber bar under the header when `env==="sandbox"`
   ("you're viewing sandbox data… Switch to live").

**Sandbox gotcha recurred (again on `app-shell.tsx`):** after these edits the bash mount served a
**truncated 606-line copy** (`wc -l`=606) while the real file is 646 lines and well-formed (verified
via the file-tool Read, end to end). In-sandbox `tsc` therefore reports bogus JSX errors at
lines 532/607 against the stale snapshot. **Do NOT `cat`/`sed` it back** (would persist the
truncation). The file on disk is correct — **confirm with a Windows `npm run build --prefix client`.**

## Session log — 2026-07-15 (part 4: audit_ledger split + portal cleared)

Closed the two residual identity-coherence items from part 2.

1. **audit_ledger split** (`security/audit_ledger/audit_ledger.controller.js`): access reviews +
   security-events reads now use `req.identityDb` (they read `app_user`/`user_role` and the
   `event_log` rows that auth+RBAC now write to live); soft-delete restore + base CRUD stay on
   `req.tenantDb` (per-env business records). node/eslint blocked by the wedged mount — Windows
   `npm test` authoritative.
2. **portal**: investigated, **no change** — it manages `portal_access` (business, per-env) and
   issues no `app_user` sessions, so it doesn't share the identity model.

## Session log — 2026-07-15 (part 5: Settings tiles — currencies + tax rates)

1. **New `client/src/features/settings/master-data-pages.tsx`** — `CurrenciesPage` (currencies
   list + FX rates table + "Set rate" modal → `POST /currencies/rates`) and `TaxJurisdictionsPage`
   (jurisdictions list + "New jurisdiction" + activate/deactivate + expandable per-jurisdiction
   **tax codes** panel with "Add code" → `POST /tax-jurisdictions/:id/codes`). Same primitives as
   the finance pages (Modal/Field/Select/Table/states).
2. **Routed** at `master/currencies` + `master/tax-jurisdictions` in `app.tsx` (were `ComingSoon`);
   nav + screen-registry entries already existed.
3. **Remaining tiles mapped** — see Open question #3 below (numbering/signatures/catalogue/treasury
   are available; six others have no BE endpoint yet).
4. **Verification:** the new file typechecks clean against itself in-sandbox (540 lines, full); the
   only `tsc` errors are the **wedged-mount truncation artifacts** on the edited `app.tsx` +
   `app-shell.tsx` (both verified complete on disk via the file tool). **Windows
   `npm run build --prefix client` is the authoritative check for this session's FE.**

## Session log — 2026-07-15 (session 4: Settings tiles + per-tenant PWA + screen scaffolds)

**Not yet Windows-verified** (sandbox mount corruption recurred on the heavily-edited `app.tsx`
— in-sandbox `tsc` reports a bogus `(208,x) TS1127 Invalid character`; the real file is clean at
207 lines via the file tool). **Authoritative check: `npm run build --prefix client` + `npm run
lint` + `npm test` on Windows.** Backend `node --check` + `eslint` are clean on the new server
files.

1. **Settings tiles built** — new `client/src/features/settings/config-pages.tsx` (same primitives
   as `master-data-pages.tsx`): **Bank accounts** (`/treasury-accounts`, entity picker from
   `/entities`), **Payment gateways** (`/payment-gateways`, credentials write-only),
   **Scheduled reports** (`/reports/scheduled` + `/reports/catalogue`), **API keys & secrets**
   (`/ai/governance/vendors` + `/:vendor/test`), **Pipeline stages** (`/opportunities/stages`,
   read-only — no stage CRUD in BE), **Document numbering** (`/numbering-schemes/:moduleKey` +
   `/catalogue/modules`). Routed in `app.tsx` (replaced the `ComingSoon` slots), `screen-registry.json`
   entries added. Settings-hub cards already pointed here.
2. **Per-tenant PWA** — `src/routes/pwa.js` serves **`GET /manifest.webmanifest`** (name/short_name/
   theme_color from branding, Host-resolved) and **`/icons/app-icon-{192,512}.png`** + a maskable
   variant (tenant logo via sharp `fit:contain`, else a brand-coloured monogram; never throws;
   in-process + `Cache-Control` cache). Mounted in `server.js` **before** the SPA catch-all.
   `vite.config.ts` → `VitePWA({ manifest:false, registerType:'autoUpdate', workbox:{…} })` + dev
   proxies for `/manifest.webmanifest` and `/icons`; `index.html` adds the manifest link +
   apple-touch-icon. Subdomain-per-tenant = one origin per tenant, so manifest/SW/install are
   naturally per-tenant. `sharp@0.33.5` + `vite-plugin-pwa@0.20.5` were already in the deps.
   **Verify with Lighthouse + a real install on two tenant subdomains.**
3. **Screen scaffolds (all 47 un-built screens)** — `client/src/features/scaffold/screen-scaffold.tsx`
   (the `ScreenScaffold` + `<Planned/>` wrapper) renders a finished skeleton: area/title, a
   **BE-status badge** (ready/partial/readonly/none), primary action buttons, **tabs**, the planned
   **table columns** with an "awaiting backend integration" state, and an **AI-actions** panel.
   The catalogue is `client/src/features/scaffold/screen-specs.ts` (47 typed specs; also the source
   for the doc). `app.tsx` now points every un-built route at `<Planned/>` (was `ComingSoon`).
   `features/placeholder/coming-soon.tsx` is now **unused** (safe to delete; only referenced in
   comments).
4. **New doc `doc/FE_IA_BUILD_MAP.md`** — the work-to-be-done map (screens/pages/tabs/columns/
   actions grouped by area, for design/Pixie inspiration) **plus the AI-integration map** (every
   screen/tab where the AI model can be invoked; `assist` = genuine LLM step). Central assistant:
   `POST /api/tenant/ai/ask` (+ `/actions/:id/confirm`), feature `ai.assistant.backend`; every
   module registers `reads`+`writes` tools via `<module>.ai.js`.
5. **Correction to a prior note:** `finance/debt` is **not** partial — it's full CRUD at basePath
   **`/financing`** (GET/POST/PATCH/DELETE + `/:id/drawdown` + `/:id/repay`, MOD-53). Marked
   **ready** in the specs + build map.

## Recommended next screens (BE endpoints verified — hand to Pixie for design inspo)

All **ready** (endpoints confirmed by reading each `*.routes.js`); build by wiring, following
`config-pages.tsx` / `master-data-pages.tsx`. Route = FE path; BE = API basePath under
`/api/tenant`. ⭐ = strong Pixie-inspo candidate (distinctive layout).

| Screen | FE route | BE endpoints (module) | Notes |
|---|---|---|---|
| **Clients** | `/master/clients` | `GET/POST /clients`, `PATCH /clients/:id`, `GET /clients/:id/credit` (MOD-03) | Master registry; referenced everywhere. Easy first win. |
| **Suppliers** | `/master/suppliers` | `GET/POST /suppliers`, `PATCH /suppliers/:id` (MOD-04) | Twin of Clients. |
| **Corporate entities** | `/master/corporate-entities` | `GET/POST /entities`, `PATCH /entities/:id`, `POST /entities/:id/active` (MOD-01) | Unlocks Business setup; already consumed by Bank accounts. |
| ⭐ **Operations files (dossiers)** | `/operations/files` | `GET/POST /operations`, `PATCH /operations/:id`, `POST /operations/:id/transition`, `GET /operations/:id/360` (MOD-29) + milestones `/milestones/dossier/:id`,`/instantiate`,`/:id/advance` (MOD-31) + `/transit-orders` (MOD-30) + `/delivery-notes` (MOD-32) | The operational hub — a tabbed dossier workspace (360 view, milestones timeline, transit orders, delivery notes). Best single build. |
| ⭐ **Opportunities (pipeline)** | `/sales/opportunities` | `GET /opportunities/board\|stages`, `GET/POST /opportunities`, `PATCH /opportunities/:id`, `POST /opportunities/:id/move\|win\|lose` (MOD-24) | **Kanban board** with drag-to-move + weighted-value forecast. High-visual Pixie candidate. |
| **Leads + inbound intake** | `/sales/leads` | leads `GET/POST /leads`,`PATCH /leads/:id`,`POST /leads/:id/transition\|convert` (MOD-20); intake `/inbound/enquiries\|partnerships` + `/enquiries/:id/triage` (MOD-25) | Funnel top; AI **triage** assist. |
| ⭐ **Supplier invoices (AP + 3-way match)** | `/procurement/supplier-invoices` | `GET/POST /supplier-invoices`, `POST /supplier-invoices/:id/match`, `POST /supplier-invoices/:id/post` (MOD-61) | Invoices tab + a **three-way-match** panel (PR↔PO↔GRN↔invoice); AI-assist match. |
| **Cash requests + Régie** | `/costing/cash-requests`, `/costing/regie` | cash `/cash-requests` (+`/:id/transition\|disburse\|justify`, MOD-49); régie `/regie` (+`/issue`,`/age-due`) | Disbursement + advance lifecycle. |
| **Financing & debt** | `/finance/debt` | `GET/POST /financing`, `PATCH/DELETE /financing/:id`, `POST /financing/:id/drawdown\|repay` (MOD-53) | Full CRUD (corrected). Loan register + drawdown/repay. |
| ⭐ **Reports** | `/vault/reports` | `GET /reports/catalogue`, `GET /reports/run/:key`, `GET/POST /reports/saved`, `GET/PUT /reports/tiles` (MOD-63) | Report runner + saved reports + dashboard-tile picker. Feeds the Control Tower. |
| **Compliance flags** | `/vault/compliance-flags` | `GET /compliance/catalogue`, `GET /compliance`, `POST /compliance/run`, `POST /compliance/:id/resolve` (MOD-65) | Rules catalogue + flag queue + resolve. |
| ⭐ **Portal access** | `/portal/access` | `GET/POST /portals/access`, `POST /portals/access/:id/revoke`, `GET /portals/client\|investor\|auditor` (portal) | Grant manager + external client/investor/auditor read views. |

**My pick order if I keep going:** (1) Clients + Suppliers + Corporate entities (fast, unblock
everything), (2) ⭐ Operations files (the hub), (3) ⭐ Opportunities board, (4) ⭐ Supplier invoices
(3-way match), (5) ⭐ Reports, (6) ⭐ Portal access. The ⭐ four are the ones worth pulling Pixie
layouts for; the master-data trio reuse the existing table+modal pattern as-is.

## Open questions — ANSWERED by BE dev (2026-07-15)

1. **Shared identity across LIVE/TEST? — RESOLVED: YES + IMPLEMENTED (2026-07-15).** Identity is
   now env-independent — see the session log "Identity pinned to the live schema" below. Auth,
   RBAC, sessions, devices, 2FA and user/role/permission admin all resolve against the live
   schema via a new `req.identityDb`; only *business* data honours `X-Praxis-Env`. Backend
   `node --check` + eslint clean in-sandbox; **run `npm run lint` + `npm test` on Windows to
   confirm.**
2. **`user_device` migration (QuickPIN) — DONE (2026-07-18).** Table (columns: `device_id,
   user_id, label, pin_hash, status, failed_pin, last_used_at, created_at`) has landed in the
   **live schema**; the pin register/login/list/revoke controllers resolve via `req.identityDb`
   (live) per #1. FE was already wired — QuickPIN is now live.
3. **Endpoints for the remaining Settings tiles — AVAILABLE (2026-07-15), partially verified.**
   Confirmed in `src/modules/master/`: **currencies** (`/currency`, incl. `POST /rates`
   setRate + convert/rate reads) and **tax rates** (`/tax_jurisdiction`, incl. `POST /:id/codes`,
   `/:id/effective`). **BUILT (2026-07-15):** both wired to live endpoints as `CurrenciesPage` +
   `TaxJurisdictionsPage` in `client/src/features/settings/master-data-pages.tsx`, routed at
   `master/currencies` and `master/tax-jurisdictions` (were `ComingSoon`).
   **Remaining tiles — endpoints VERIFIED (2026-07-15, read each `*.routes.js`):**
   - numbering → `/numbering-schemes` (security/numbering_setting) — AVAILABLE.
   - email signatures → app_user `GET/PUT /:id/signature` (per-user) — AVAILABLE.
   - document catalogue → `/catalogue` — AVAILABLE.
   - **bank accounts → `/treasury-accounts`** and **payment gateways → `/payment-gateways`** —
     BOTH in `master/treasury_account` (MOD-09; one routes file, basePath `/`, two sub-routers —
     that's why it didn't surface in the basePath sweep). Full CRUD; gateway credentials write-only.
   - **scheduled reports → `/reports/scheduled`** (vault/report MOD-63) — full CRUD (GET/POST/
     PATCH/DELETE + run-due). AVAILABLE.
   - **pipeline stages → `/opportunities/stages`** (+ `/board`, `/:id/move`) (sales/opportunity
     MOD-24) — AVAILABLE.
   - **api-keys / integration secrets → `/ai/governance/vendors`** (GET/PUT/test, MOD-70) — covers
     AI provider keys; if the tile means broader 3rd-party secrets, only AI vendors exist today.
   - **NO endpoint (notify BE):** **custom fields**; **document templates** (only *milestone*
     templates + smartcomm exist, not document/letterhead templates); **business policies** (maybe
     intended for the generic `/settings` key-value store — confirm with BE).
4. **Finance write endpoints — AVAILABLE + CONTRACTS VERIFIED (2026-07-15).** Dedicated modules
   now exist:
   - **Tax filing** `finance/tax_declaration` (MOD-07, basePath `/tax`): `POST /tax/declarations`
     (validator.file → DRAFT/COMPUTED), `POST /tax/declarations/:id/approve`,
     `POST /tax/declarations/:id/submit` (validator.submit → FILED), GET `/tax/declarations`(+`/:id`).
     The existing GET-only `/tax/*-return` compute endpoints are unchanged.
   - **Credit notes** `finance/credit_note` (MOD-51, basePath `/credit-notes`, feature
     `accounting.core`): `POST /credit-notes` (validator.create), `PATCH /credit-notes/:id`
     (validator.update), `POST /credit-notes/:id/post`, GET `/credit-notes`(+`/:id`).
   **FE DONE (2026-07-15):** Tax Center **Declarations / filing** tab + **Credit notes** screen
   (`/finance/credit-notes`) both wired to these endpoints. See the session log below.

## First thing to do in a new session

**Sessions 3 + 4 are fully Windows-verified** — `npm run lint`, `npm test`, and
`npm run build --prefix client` pass. **Session 5's FE (master-data trio + AI gate) was
Windows-verified by the user; the session-5 BE change (`ai_enabled`) was written after that
and is NOT yet verified.**

**⚠️ PC SWITCH (2026-07-16):** this handoff was written just before the user moved to another
machine. Pull latest, then start at step 0.

**Pick up here (priority order):**

0. **Session 7 needs Windows validation + a visual pass.** Session 7's FE is in-sandbox `tsc`-clean and
   the BE `q` edits are `node --check`-clean, but run `npm run lint` + `npm run build --prefix client` +
   `npm test` on Windows and **open `npm run dev`** to eyeball the rebuilt **Control Tower iframe** and the
   new forms (lead **Company** search, quotation **dictionary + tax-code** pickers, Reports **Dashboard
   tiles** tab, Campaigns **Templates** tab). Files in the session-7 log above. Session 6 (prior) was also
   `tsc`-clean — confirm both and commit.
0b. **Next in this lane (session 7 leftovers):** (a) **DONE (2026-07-18)** — remaining reference pickers
   converted to `SearchSelect` (meeting, opportunity, proposal, quotation entity, credit-note, bank-account,
   pricing-variance, portal; no assignee/user select existed). See session-7 log §4; `tsc`-clean.
   (b) **DONE (2026-07-18)** — the Settings tiles on the generic `/settings` store (document templates,
   custom fields, email signatures, policies) are built in `features/settings/store-pages.tsx` and routed;
   session-7 log §9. (c) hand `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md` to the BE dev.
1. **Sales/CRM funnel — DONE (session 6).** Model: **marketing → leads + opportunities → sales**;
   build order in the session-6 log + `doc/FE_IA_BUILD_MAP.md` (Sales & CRM). All six shipped in
   `client/src/features/sales/pages.tsx`: Leads & intake (MOD-20 + folded MOD-25), Meetings (MOD-21),
   ⭐ Opportunities Kanban (MOD-24), Proposals (MOD-23), Marketing campaigns (MOD-22), Success stories
   (MOD-26). **Phase D — Commercial group also DONE (session 6):** Quotations (gated
   `commercial.quotation`), Margin + Extra-charge simulations, Pricing variance — in
   `client/src/features/commercial/pages.tsx` (FS colleague verifying finance correctness). Shared
   primitives now live in `client/src/features/sales/ui.tsx`. **Non-funnel hubs also DONE (session 6):**
   Reports (`/vault/reports`, MOD-63, gate `reporting`) + Compliance flags (`/vault/compliance-flags`,
   MOD-65) in `features/vault/pages.tsx`; Portal access (`/portal/access`, MOD-67) in
   `features/portal/pages.tsx`. **This stream's entire lane is now built.** Follow-ons (not lane work):
   Control Tower live tiles (`/reports/tiles`), a tax-code picker for Quotations, the Reports
   dashboard-tile picker, platform/godmode console. All BE modules confirmed merged (session 6).
2. **Settings tiles — DONE (session 4) + finding updated (session 7).** Bank accounts, payment gateways,
   scheduled reports, API keys, pipeline stages (read-only), numbering all built in `config-pages.tsx`.
   **DONE (2026-07-18):** document templates, custom fields, email signatures and policies are now built on
   the generic `/settings/:section/:key` store (`features/settings/store-pages.tsx`, routed; MOD-70-gated).
   Only genuinely BE-less tiles left: **factory languages** and **help center**.
3. **Per-tenant PWA — DONE (session 4)** (`src/routes/pwa.js` + `vite.config.ts` + `index.html`).
   **Polish DONE (2026-07-18):** `manifest.background_color` now follows the tenant theme mode
   (`src/routes/pwa.js` `resolveBranding` → light `#f3f6fb` / dark `#071324`, matching the app's
   `--background`), so the launch splash doesn't flash the wrong colour. Maskable icons were already
   served on-demand (`/icons/app-icon-maskable-512.png`, sharp render + cache) — no pre-gen needed.
   Left to do: **Lighthouse audit + a real install on two tenant subdomains** (manual/ops step, no code
   dependency). `node --check` clean; Windows lint/test authoritative.
4. **QuickPIN — DONE (2026-07-18).** The `user_device` migration has landed in the live schema;
   FE + controllers were already wired, so QuickPIN is live. Nothing left here.
5. **Control Tower — reverted to the Lovable mock, on live data (session 7).** `features/dashboard.tsx`
   renders the restored `features/dashboard-mock/*` in an `<iframe srcDoc>` and injects live
   `/dashboard/control-tower` + `/dashboard/kpis` (see session-7 log §8). **`dashboard-mock/*` is USED
   again — do NOT delete it.** Remaining: platform/godmode console UI; the decorative KPI cards
   (revenue/SLA/fleet) still show mock values (no BE source).

**Notify the BE dev:** (a) `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md` — proposed `/campaigns/templates` +
`/campaigns/senders` + send endpoints (MOD-22) so campaign templates move off the MOD-70 `/settings`
store. (b) The session-7 `?q=` search filters were added to `operations_file`/`final_invoice`/`app_user`
(your modules) plus the master/sales repos — confirm they survive `npm run lint`/`npm test`.
**Settings tiles with genuinely NO endpoint:** only factory languages + help center (everything else,
incl. document templates / custom fields / policies, is on the generic `/settings` store).

Run these on Windows and report/fix results (authoritative validators — the sandbox bash
mount is unreliable for freshly-written files; see **Sandbox gotcha** below):

```
npm run lint
npm test
npm run build --prefix client
```

**Windows validation done 2026-07-15 (re-confirmed after the identity + Finance + field-mask
changes):** `npm run lint`, `npm test`, and `npm run build --prefix client` all pass. Earlier that
day: fixed a **test-isolation bug** (not FE-related): `tests/jest.setup.js` now blanks the
external-provider vars (`GROQ_API_KEY`, `GEMINI_API_KEY`, `SMTP_HOST`, etc.) so the developer's
local `.env` no longer leaks placeholder keys (`__rotate*me__`, `__host__`) into unit tests and
defeats the "not configured / no sender" guards in `services/ai/*` + email. Test-only change; on a
clean checkout / CI those 3 tests already passed.

To preview the app: `npm run dev` (backend, repo root) + `cd client && npm run dev`
(Vite). Set `VITE_TENANT_HOST` to the provisioned tenant (e.g. `smartls.praxisls.com`).
Check the new `/login` landing + the top-bar nav / More sidebar first.

## Known remaining work / gaps

- **Quick PIN — DONE (2026-07-18).** FE done (login modal + `/security/my-security`, backend
  `/auth/pin/*`); the `user_device` migration (columns: `device_id, user_id, label, pin_hash,
  status, failed_pin, last_used_at, created_at`) has landed in the **identity/live schema** per
  the pin-auth-to-identity decision. QuickPIN is live; no FE or BE work remaining.
- **⌘K command palette built** (`command-palette.tsx`). **Mobile bottom nav — DONE (session 2)**
  (`app-shell.tsx` `BottomNav`).
- **Landing hero assets are tenant-authored** via Appearance (image + copy + chips). Blank
  fields fall back to generic copy; the "Pixie Hub" content in the reference video is
  sample data, not shipped defaults.
- **Finance write forms — DONE (2026-07-15).** Tax-declaration **filing** and **credit notes**
  are now wired to the new BE modules. Tax Center gained a **Declarations / filing** tab
  (file→approve→submit); new **Credit notes** screen at `/finance/credit-notes`
  (create→edit→post). Helpers in `lib/finance-api.ts`; forms in `features/finance/pages.tsx`;
  routed in `app.tsx` + nav (`app-shell.tsx`) + `screen-registry.json` (`fin_credit_notes`).
- Control Tower dashboard is **LIVE** — `features/dashboard.tsx` reads `/dashboard/kpis` +
  `/dashboard/control-tower` (MOD-00A). **Session 7:** reverted from plain React tiles to the **Lovable
  mock in an `<iframe srcDoc>`** with that live data injected; `features/dashboard-mock/*` is **restored
  and in use** (no longer safe to delete).
- Platform console UI and per-tenant PWA manifest still not built (Phase 0 items).
- **Cleanup — DONE (session 2):** the stray `client/src/_wtest.txt` was removed.
- **LIVE/TEST toggle logs the user out — architectural, not a UI bug (diagnosed 2026-07-13).**
  `X-Praxis-Env` is a *database-schema switch*: `middleware/tenant-context.js` binds every DB
  call in the request to the live or sandbox schema (`registry.service.js` → `SET search_path`).
  Crucially the **auth path is bound to that same schema**: `middleware/auth.js` loads the user
  via `req.tenantDb(getAuthUser)` and `app_user.service.refresh()` validates the session via
  `repo.getActiveSession(client, sid)` on `user_session` — both in the env-selected schema.
  Accounts are created in **live** by default (`scripts/tenant/create-admin.js --env=live`), so
  the sandbox schema has **no user and no session**. Flipping to Test therefore makes the very
  next request `401` (`USER_INACTIVE`), the client auto-refresh also runs under sandbox and
  `401`s (`SESSION_REVOKED`), and the user is bounced to `/login`. The `window.location.reload()`
  in `toggleEnv()` (app-shell) isn't the cause — it just triggers it immediately.
  **Fix — IMPLEMENTED (2026-07-15): identity pinned to the live schema.** `middleware/tenant-
  context.js` now exposes **`req.identityDb`** (always the live schema); `req.tenantDb` still
  honours `req.env` for business data. Pinned to `req.identityDb`: `middleware/auth.js`
  (`getAuthUser`), `middleware/rbac.js` (grants / scope / capabilities), the whole
  `security/app_user` controller (login, refresh, logout, verifyTotp, setup/enable/disable TOTP,
  pin register/login/list/revoke, and user CRUD), `security/session`, and the RBAC-admin writes
  (`permission` incl. `upsertGrant`, `iam_role`, `capability`, `scope`, `field_visibility`) via a
  new `makeController(service, label, { identity: true })` option in `shared/crud/resource.js`.
  The auth *services* were untouched — they already take a `client`; only the controller/middleware
  chooses which schema's client to pass (`environment` on the session row stays as metadata).
  Alternative (seed users/sessions into sandbox) was rejected as messier. **FE polish — DONE
  (2026-07-15, part 3):** soft toggle without reload (`key={env}` remount), segmented Live|Test
  control, and the yellow TEST-MODE banner — all in `app-shell.tsx`. See that session log.
  **Residual coherence items:** (a) **field-mask — DONE (2026-07-15).** `shared/rbac/field-mask.js`
  gained `maskForUserVia(identityDb, user, data)`, which resolves masked field_keys from the
  identity schema (`req.identityDb`) while the data itself is still read on the env client;
  `employees` + `operations_file` controllers switched to it, so masking stays enforced under TEST.
  (b) **audit_ledger — DONE (2026-07-15).** Split by data class: **access reviews**
  (`listReviews`/`createReview`/`getReview`/`completeReview`/`decideEntry` — `snapshotEntries`
  reads `app_user`/`user_role`) and **security-events** (`listSecurityEvents`, reads `event_log`
  which auth+RBAC now write via the live client) pinned to `req.identityDb`; **soft-delete restore**
  (`listSoftDeletes`/`requestRestore`/`restore`) + base CRUD stay `req.tenantDb` (per-env business
  records). (c) **portal — no change needed (2026-07-15).** The `portal` module manages
  `portal_access` (which external client/investor/auditor parties may view which dossier) — per-env
  **business** data — and issues **no `app_user` sessions**, so it doesn't share the identity model.
- **Search bar** now opens the ⌘K palette (was a stopgap that opened the sidebar) — resolved.
- **Login screen displays saved login config — DONE (session 2).** `landing-page.tsx` now reads
  `fetchLogin()` (backgroundUrl / headline / subtext / layout / showLogo / accentOverride) with
  hero → generic fallbacks. `centered`/`split` layout wired in `index.css`.
- **Live theme apply — DONE (session 2).** `theme.ts` `applyBrand()` + `branding-context.paint()`
  now apply the full token set (accent/secondary/info/success/warn/danger/fonts/radius), with
  hex→triplet conversion for `--ok`/`--warn`/`--bad`. `resetBrand()` reverts them all.
- **Settings tiles — nearly all built now.** Currencies, tax rates, numbering, bank accounts, payment
  gateways, pipeline stages (read-only), scheduled reports, API keys/secrets (sessions 4–5) + document
  templates, custom fields, email signatures, policies (2026-07-18, `store-pages.tsx`). Only **factory
  languages** and **help center** remain `Planned` (no BE endpoint).
- **Live/sandbox (LIVE/TEST) toggle** — detailed gap above; the shared-identity yes/no design
  question has been **sent to the BE dev, awaiting an answer**. `user_device` sits in the same
  schema model, so its fix rides on the same decision.

## Conventions

Modules = 7 files (`repo`/`service`/`controller`/`routes`/`validator`/`events`/`ai.js`);
**SQL only in `.repo.js`**, never in `.service.js`; RBAC-gated routers
(`requirePermission(M, action)`, actions view/create/edit/delete/approve — it's **"edit"
not "update"**); non-README MD files live in `doc/`. Ask before large or destructive
changes.

## Sandbox gotcha

The bash workspace mounts the Windows folder over a network FS whose page cache goes
**stale** for files written via the file tools — it can serve old/**truncated**/NUL-padded
copies, so in-sandbox `node`/`grep`/`jest` on freshly edited files give false failures.
**Confirmed again 2026-07-13:** the file tools (Write/Edit) truncated/NUL-padded several
`.tsx` files on this mount; rewriting them via a bash heredoc (`cat > file <<'EOF'`) writes
reliably (`rm`/unlink is blocked, but `>` truncates fine). Restoring a clean base from git
(`git show HEAD:path > path`) then re-applying is also reliable. Note: `client/package-lock.json`
is Windows-generated, so a Linux `vite build` fails on the missing `@rollup/rollup-linux-x64-gnu`
native binary — that's environmental; a normal `npm install` on Windows fixes it and `tsc`
is the trustworthy in-sandbox check. The real files are correct (Vite/tsc/PowerShell see them
fine). Fix: start a fresh session (remounts clean), or just validate on Windows.
**2026-07-14:** the mount degraded further and the sandbox eventually **died outright**
(`Failed to create bridge sockets`) — no in-sandbox `tsc`/bash for the tail of the session. The
file tools kept writing correct Windows files throughout. **Start a fresh session before the
next chunk so `tsc` works again**, and run `npm run build --prefix client` on Windows to confirm
this session's FE changes typecheck.
**2026-07-14 (session 2):** recurred — the page cache wedged on `app-shell.tsx` mid-session
(served a truncated 565-line copy while the file-tool view showed the correct 609-line file).
`touch` didn't refresh it. Do **not** `cat`/`sed` the cached copy back onto the mount — that
would write the truncated version to the real file; the reliable recovery is a fresh session or
a full bash-heredoc rewrite with known-good content. The earlier theme/landing edits this session
did pass `tsc -b --force` before the cache wedged.
