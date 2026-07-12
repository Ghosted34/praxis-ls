# Praxis LS — Session Handoff

Paste-in context for a fresh session, plus a running record of the FE reskin work.
Companion to `doc/WORK_DONE.md` (full history) and `doc/WORK_TO_BE_DONE.md` (backlog).

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
    `font-display`.
  - `client/index.html` — Google Fonts links.
  - `client/src/app/layout/app-shell.tsx` — glass top command bar + left rail +
    **LIVE/TEST toggle** (flips `X-Praxis-Env` and reloads).
  - `client/src/features/dashboard.tsx` — Control Tower home renders the **full Lovable
    mock** in an isolated `<iframe srcDoc>` from `client/src/features/dashboard-mock/*.txt`.
    The mock's own topbar is hidden (`.topbar{display:none}`) so there's a single app
    chrome; the iframe's `data-theme` tracks the app's light/dark via a MutationObserver.
  - `client/src/features/auth/login-page.tsx` — reskinned brand (lux-mark + serif).
- **Phase 0 + Phase 1 FE wired to live endpoints.** Finance screens in
  `client/src/features/finance/pages.tsx`: Chart of accounts (`/chart-of-accounts`),
  Journals (`/journal-entries`), Proforma & advances (`/proformas/advances`), Invoices
  (`/final-invoices`), Receivables (`/receivables`), tabbed **Statements** (6 reports
  under `/statements/*`), tabbed **Tax center** (`/tax/vat-return`, `/tax/corporate-tax`),
  Assets (`/assets`). Routed in `client/src/app/app.tsx`, in the nav, and in
  `client/src/app/screen-registry.json`. HR Employees/Payroll wired by colleague.
  - **Write forms (2026-07-12):** Journals (post entry + **reverse** validated
    entries), Proforma (record advance → 4191), Invoices (draft → **edit** → submit
    lifecycle). Statements gained a period/date filter bar **and a "Periods / close"
    tab** (freeze/close guided monthly close). Shared
    `client/src/components/ui/modal.tsx` (Modal/Field/Select) +
    `client/src/lib/finance-api.ts` (typed writes + option loaders).
- **Auth behaviour:** logout now `localStorage.clear()`s everything (tokens, cached user,
  theme + env preferences) — nothing persists across sign-out (until told otherwise).
- **Postman** `postman/praxis-ls.phase0.postman_collection.json` — folders for Phase 0 +
  Finance (Phase 1) + Fleet/WMS/HR (Phase 3).

## First thing to do in a new session

Run these on Windows and report/fix results (authoritative validators — the sandbox
bash mount is unreliable for freshly-written files, so do NOT trust in-sandbox
`node`/`grep` on edited files):

```
npm run lint
npm test
npm run build --prefix client
```

To preview the app: `npm run dev` (backend, repo root) + `cd client && npm run dev`
(Vite). Set `VITE_TENANT_HOST` to the provisioned tenant (e.g. `smartls.praxisls.com`).

## Known remaining work / gaps

- **Finance write forms landed 2026-07-12** (see `doc/WORK_DONE.md`), in two rounds.
  Round 1: post journal entry (multi-line, live-balance, draft-vs-validate), record
  customer advance, final invoice draft→submit. Round 2 (wired the actions that already
  had a BE): **journal reverse** (`POST /journal-entries/:id/reverse`), **invoice draft
  edit** (`PATCH /final-invoices/:id`), **period freeze/close** (Statements "Periods /
  close" tab → `POST /statements/periods/close`). Backed by `ui/modal.tsx` +
  `lib/finance-api.ts`. **Still no forms for** (both lack a BE endpoint, so not
  just-wire-a-button): **tax declaration filing** (Tax Center is GET-only end to end) and
  **credit notes** (`type='CREDIT_NOTE'` in schema, nothing in `src/` creates one).
  The Statements period filter now **binds correctly** (fixed 2026-07-12): `ReportTabs`
  takes a `periodMode` — Statements uses a `period_id` dropdown from `/statements/periods`
  (entity-filtered), Tax keeps `period_code`.
- **Round-2 verify caveat:** in-sandbox `tsc` was blocked by the mount serving stale/
  truncated copies of the fresh files (phantom `TS1005`/`TS1110`); the real Windows files
  are complete. Gate this round with `npm run build --prefix client` on Windows.
- **Statement/tax period params done 2026-07-12:** `ReportTabs` has an apply-on-demand
  filter bar (entity / period_code / from / to) hitting the params the validators accept.
- Control Tower dashboard is the **static Lovable mock** (sample data in an iframe), not
  live widgets. Feeding tiles from real endpoints is a follow-on.
- Platform console UI and per-tenant PWA manifest still not built (Phase 0 items).

## Conventions

Modules = 7 files (`repo`/`service`/`controller`/`routes`/`validator`/`events`/`ai.js`);
**SQL only in `.repo.js`**, never in `.service.js`; RBAC-gated routers
(`requirePermission(M, action)`, actions view/create/edit/delete/approve — it's **"edit"
not "update"**); non-README MD files live in `doc/`. Ask before large or destructive
changes.

## Sandbox gotcha

The bash workspace mounts the Windows folder over a network FS whose page cache goes
**stale** for files written via the file tools — it can serve old/truncated copies, so
in-sandbox `node`/`grep`/`jest` on edited files give false failures. The real files are
correct (Vite/tsc/PowerShell see them fine). Fix: start a fresh session (remounts clean),
or just validate on Windows.
