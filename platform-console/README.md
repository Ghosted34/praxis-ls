# Praxis Platform Console

Praxis-side ("Root Admin") console for the platform registry — the UI over
`/api/platform/*`. Its own **React 18 + Vite + TypeScript** app (same toolchain as
the tenant `client/`, so `npm install` not `npm ci` — the Windows lockfile omits
Linux/musl binaries), kept separate from the tenant client because it has its own
platform auth and never touches tenant business data.

## What it does

- **Login** — `POST /api/platform/auth/login` (Root Admin; stateless access token, no refresh).
- **Overview** — tenant counts by status, plan distribution, recent platform activity.
- **Tenants** — searchable list; provision a new tenant (slug / name / plan / subdomain).
- **Tenant detail** — go-live, suspend/resume, run migrations, wipe sandbox; set capacity tier
  (S/M/L/XL) and sandbox auto-wipe interval; database + subdomains; per-tenant feature toggles
  (with plan/override/default source and clear-override); recent per-tenant audit.
- **Plans** and **Catalogue** (modules + features) — reference views.
- **Audit** — the platform audit trail (append-only Watch-the-Watcher), filterable.
- **Support & Feedback** — live triage board over `platform.support_ticket`: lanes by status, kind/tenant
  filters, per-ticket detail with status transitions (NEW→TRIAGED→IN_PROGRESS→SHIPPED/DECLINED) and CSAT.

Platform users see tenant **metadata and health only** — never tenant business rows.

## Serving model (important)

The console is **host-gated**. `src/server.js` serves the built `dist/` **only** when the request
`Host` equals `PLATFORM_CONSOLE_HOST` (an env var, e.g. `admin.praxisls.com`), at the **root** of
that host. On tenant hosts it is never served — there is **no `/console` path** and
`tenant.example.com/console` cannot reach it. The tenant SPA is likewise not served on the admin
host. Full deploy notes: `doc/DEPLOYMENT.md` §5b.

The app ships in the Docker image via the `consolebuild` stage; to go live you set
`PLATFORM_CONSOLE_HOST` and point DNS `admin` at the same A record as the wildcard.

## Local development

```
cd platform-console
npm install
npm run dev          # Vite dev server on http://localhost:5174, proxies /api → :8080
```

Set `VITE_API_TARGET` if your API isn't on `http://localhost:8080`. Because platform routes ignore
the Host header, no tenant/Host rewrite is needed (unlike the tenant client).

Build: `npm run build` → `dist/` (this is what the api serves in production).

## First login

The console can't bootstrap the first platform user. On the server:

```
node scripts/platform/create-admin.js   # writes platform.platform_user (argon2 hash)
```

Leave TOTP unset — platform-tier 2FA verify isn't wired yet (the API returns 501 if a secret is set).

## Support & Feedback (PRD §11.2) — built

Tickets live centrally in `platform.support_ticket` (keyed by tenant), so the console triages across
all tenants with no cross-tenant fan-out. Tenants raise them via `POST /api/tenant/support/tickets`
(ungated); Praxis triages via `/api/platform/support/*`. The one remaining piece is the **tenant-app
page** where tenant users raise/track tickets — the backend is ready for it.

## Structure

```
src/
  lib/         api.ts (typed /api/platform client + token store), types.ts, format.ts, useAsync.ts
  components/  ui.tsx (Button/Field/Pill/Card/Modal/Confirm…), Shell.tsx, Toast.tsx
  features/    Login, Overview, Tenants, TenantDetail, Plans, Catalogue, Audit, Support
  App.tsx      HashRouter routes + auth gate
```

## Backend contract

Base `/api/platform`. Success `{ data }`, error `{ error: { code, message, fields? } }`,
auth `Authorization: Bearer <access_token>`.

| Method | Path | Body |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` |
| GET | `/tenants` · `/tenants/:slug` | — |
| POST | `/tenants` | `{ slug, name, plan?, subdomain? }` |
| POST | `/tenants/:slug/{suspend,resume,go-live,migrate}` · `/sandbox/wipe` | — |
| PATCH | `/tenants/:slug/capacity` · `/sandbox` | `{ tier }` · `{ days }` |
| GET | `/tenants/:slug/features` | — |
| PATCH · DELETE | `/tenants/:slug/features/:key` | `{ state }` · — |
| GET | `/plans` · `/catalogue/modules` · `/catalogue/features` | — |
| GET | `/audit` | `?tenant=<slug>&limit=<n>` |
| GET | `/support/tickets` · `/support/tickets/:id` | `?status=&kind=&tenant=` |
| PATCH | `/support/tickets/:id` | `{ status }` |
