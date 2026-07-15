# Praxis LS — Session Handoff

Paste-in context for a fresh session, plus a running record of the FE reskin work.
Companion to `doc/WORK_DONE.md` (full history) and `doc/WORK_TO_BE_DONE.md` (backlog).

_Last updated: 2026-07-14 (session 2) — session focus: cleared the pure-FE backlog. Login
screen now renders saved login config; full theme token set applies live; centered/split login
layout; mobile bottom nav (Lovable). Prior session 1 focus: full IA menu + ⌘K palette + hover
nav; Settings hub; Appearance/Login editors wired to the real branding backend; QuickPIN + MFA
wiring._

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

## Open questions (awaiting the BE dev — FE is parked on these)

1. **Shared identity across LIVE/TEST?** The core question: should `getAuthUser` /
   `getActiveSession` / login's session-write be pinned to the live/identity schema regardless of
   `X-Praxis-Env`, so only *business* data is sandboxed? (Detail under the LIVE/TEST gap below.)
   **The `user_device` (QuickPIN) fix rides on the same decision** — same schema model. Sent; no
   answer yet. Until answered: the FE LIVE/TEST toggle stays as-is (reload + logout) and QuickPIN
   stays wired-but-erroring.
2. **`user_device` migration** — needs the table added (columns: `device_id, user_id, label,
   pin_hash, status, failed_pin, last_used_at, created_at`) in whichever schema auth resolves
   against. Blocks QuickPIN register/list.
3. **Endpoints for the remaining Settings tiles** (currencies, tax rates, numbering, custom fields,
   pipeline stages, templates, signatures, scheduled reports, integration secrets, policies, bank
   accounts) — modules exist under `src/modules/master` etc.; each needs its endpoint confirmed
   before the FE screen can be built.
4. **Finance write endpoints** for tax-declaration filing (Tax Center is GET-only) and credit notes
   (`type='CREDIT_NOTE'` exists in schema; nothing creates one).

## First thing to do in a new session

**Session 2's FE changes are uncommitted and were not verified by a full Windows build**
(sandbox mount wedged on `app-shell.tsx` — the theme/landing batch passed `tsc` in-sandbox,
the shell/CSS batch did not get re-checked). Touched files: `features/settings/login-editor.tsx`,
`features/landing/landing-page.tsx`, `lib/theme.ts`, `app/branding/branding-context.tsx`,
`app/layout/app-shell.tsx`, `index.css`. **First: run the Windows build below** and fix anything
it flags in those files.

Run these on Windows and report/fix results (authoritative validators — the sandbox bash
mount is unreliable for freshly-written files; see **Sandbox gotcha** below):

```
npm run lint
npm test
npm run build --prefix client
```

To preview the app: `npm run dev` (backend, repo root) + `cd client && npm run dev`
(Vite). Set `VITE_TENANT_HOST` to the provisioned tenant (e.g. `smartls.praxisls.com`).
Check the new `/login` landing + the top-bar nav / More sidebar first.

## Known remaining work / gaps

- **Quick PIN wired but blocked on a missing DB table.** FE done (login modal + `/security/
  my-security`, backend `/auth/pin/*`), but register/list error `relation "user_device" does
  not exist` (42P01) — the table isn't in the tenant schema. BE must add the migration (columns:
  `device_id, user_id, label, pin_hash, status, failed_pin, last_used_at, created_at`) in
  whichever schema auth resolves against.
- **⌘K command palette built** (`command-palette.tsx`). **Mobile bottom nav — DONE (session 2)**
  (`app-shell.tsx` `BottomNav`).
- **Landing hero assets are tenant-authored** via Appearance (image + copy + chips). Blank
  fields fall back to generic copy; the "Pixie Hub" content in the reference video is
  sample data, not shipped defaults.
- **Finance:** still no forms for **tax declaration filing** (Tax Center is GET-only) and
  **credit notes** (`type='CREDIT_NOTE'` in schema, nothing creates one) — both lack a BE
  endpoint.
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
  **Fix (design decision, not yet done):** make identity env-independent — pin `getAuthUser`,
  `getActiveSession`, and login's session-write to the **live/identity schema** regardless of
  `req.env`, so only *business* data is sandboxed (matches the Lovable "same you, sandbox data"
  intent). ~3 focused backend spots. Alternative (seed users/sessions into sandbox) is messier
  and not recommended. FE polish (soft toggle without reload; segmented Live|Test control +
  the yellow TEST-MODE warning banner from the Lovable mock) is secondary and only *works* once
  identity is shared.
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
