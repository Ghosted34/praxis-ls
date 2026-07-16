# Praxis LS — Session Handoff

Paste-in context for a fresh session, plus a running record of the FE reskin work.
Companion to `doc/WORK_DONE.md` (full history) and `doc/WORK_TO_BE_DONE.md` (backlog).

_Last updated: 2026-07-15 (session 4) — **not yet Windows-verified; run `npm run build --prefix
client` + `npm run lint` + `npm test`.** Shipped: (a) **Settings tiles** (bank accounts, payment
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
2. **`user_device` migration (QuickPIN) — BE says on the way.** Table (columns: `device_id,
   user_id, label, pin_hash, status, failed_pin, last_used_at, created_at`) must land in the
   **live schema** — the pin register/login/list/revoke controllers now use `req.identityDb`
   (live) per #1, so the table only needs to exist there. FE already wired; QuickPIN goes live
   once the migration ships.
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

**Session 3 (2026-07-15) is fully Windows-verified** — `npm run lint`, `npm test`, and
`npm run build --prefix client` all pass; commit the session-3 work if not already committed.

**Pick up here (priority order):**

0. **FIRST: Windows-verify session 4.** Run `npm run build --prefix client`, `npm run lint`,
   `npm test`; fix anything, then commit. (Sandbox couldn't typecheck `app.tsx` — mount corruption.)
1. **Wire the "ready" screens — replace scaffolds with real pages.** Every un-built screen now
   renders a `<Planned/>` skeleton from `client/src/features/scaffold/screen-specs.ts`; convert
   them to live pages following `config-pages.tsx` / `master-data-pages.tsx`. **Priorities + exact
   BE endpoints are in "Recommended next screens" above** — start with the master-data trio
   (Clients/Suppliers/Corporate entities), then the ⭐ hubs (Operations files, Opportunities board,
   Supplier invoices 3-way match, Reports, Portal access). Full screen/tab/AI map: `doc/FE_IA_BUILD_MAP.md`.
2. **Settings tiles — DONE (session 4).** Bank accounts, payment gateways, scheduled reports, API
   keys, pipeline stages (read-only), numbering all built in `config-pages.tsx`. Remaining tiles
   have **no BE** (custom fields, document templates, business policies, factory languages, help
   center) or need a BE tweak (email signatures self-service route). See build map §3.
3. **Per-tenant PWA — DONE (session 4)** (`src/routes/pwa.js` + `vite.config.ts` + `index.html`).
   Left to do: Lighthouse audit + real install on two tenant subdomains; optionally feed
   `background_color` from branding and pre-generate maskable icons.
4. **QuickPIN** — BE dev is adding the `user_device` migration (live schema); smoke-test
   register/login once it lands (FE + controllers already wired).
5. **Later:** Control Tower dashboard on live data (still the static Lovable iframe mock; feed tiles
   from `/reports/tiles` once Reports is built); platform/godmode console UI.

**Notify the BE dev — only these Settings tiles have NO endpoint:** custom fields, document
templates (only milestone/smartcomm templates exist), business policies (maybe the `/settings`
key-value store — confirm). Everything else is available.

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

- **Quick PIN wired, BE migration on the way (2026-07-15).** FE done (login modal + `/security/
  my-security`, backend `/auth/pin/*`); currently errors `relation "user_device" does not exist`
  (42P01). BE confirmed the migration is coming (columns: `device_id, user_id, label, pin_hash,
  status, failed_pin, last_used_at, created_at`) — lands in the **identity schema** per the
  pin-auth-to-identity decision. No FE work needed; QuickPIN works once the table ships.
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
- Control Tower dashboard is the **static Lovable mock** (sample data in an iframe), not
  live widgets. Feeding tiles from real endpoints is a follow-on.
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
- **Other Settings tiles still `ComingSoon`:** currencies, tax rates, document numbering, custom
  fields, pipeline stages, document templates, email signatures, scheduled reports, integration
  secrets, policies, bank accounts. Backend modules exist under `src/modules/master` etc.; each
  needs its endpoint verified + a real screen.
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
