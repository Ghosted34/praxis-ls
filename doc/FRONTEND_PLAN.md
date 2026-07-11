# Praxis LS — Frontend plan & status

> **Status note (moved to `doc/` per the MD convention).** The frontend direction
> has since changed: **the FE is being rebuilt to replicate the Lovable mock**
> (`doc/reference/reference-mock-lovable`). The hand-rolled `client/` described
> below (Vite + React 18 + hand-rolled shadcn primitives) is the earlier Phase-0
> foundation and is being **superseded** by that replication. Kept here for
> history and because the **platform-console proposal** at the bottom is still
> open. Phase 2 frontend should follow the Lovable replication, not this stack.

## Stack (earlier, hand-rolled)

Plain **Vite + React 18 + TypeScript**, **PWA** via `vite-plugin-pwa`, routing
with **React Router v6**, styling with **Tailwind v3** using the Lovable mock's
design tokens (oklch) and shadcn-style component patterns — hand-rolled as thin
primitives (`react`, `react-dom`, `react-router-dom`, `clsx`, `tailwind-merge`).

## Single-origin serving (tech-lead decision) + PWA

- **Dev:** `npm --prefix client run dev` runs the Vite dev server (HMR) and
  proxies `/api/*` (and `/media`) to the Node API.
- **Prod:** `npm --prefix client run build` emits `client/dist`; `src/server.js`
  serves it: `/api/*` → API, `/media` → files, every other path → `index.html`.
  One origin per tenant → the PWA is same-origin with its API (installable,
  offline, no CORS).
- Icons: drop `client/public/icon-192.png` + `icon-512.png` before shipping.

## What was built in Phase 0 (hand-rolled client/)

Login (white-label, 2FA), auth plumbing (Bearer + refresh-on-401), app shell
(LIVE/TEST badge, mobile slide-over), white-label theming + Appearance screen +
storage-backed logo upload, light/dark/system toggle, branded boot splash, the
**permission grant-matrix** editor, and skeletal Security/Governance list screens.
See `doc/WORK_DONE.md` for detail.

---

## Platform console — PROPOSAL (still open, not built)

The platform (Praxis-internal) console is a **different audience and auth** from
the tenant app: the Praxis ops team managing tenants via
`POST /api/platform/auth/login` (`PLATFORM_ROOT_ADMIN`) and the `/api/platform/*`
API (already done).

**Proposed:**
- **Where it lives:** same build, `/platform/*` route area, activated on host
  `admin.praxisls.com` (already a platform host). Or a separate `console/` app —
  cleaner isolation, double the deploy.
- **Separate auth surface:** a `platform-auth-context` with its own token.
- **Screens (endpoints exist):** platform login; Tenants list (health/status);
  Tenant detail (suspend/resume/go-live/capacity/sandbox/migrate); per-tenant
  feature toggles; read-only module/feature/plan catalogue.

**Open decisions:** (a) same-app-on-admin-host vs separate console app; (b) first
cut = Tenants list + provision + go-live, or the full set. Wireframe for sign-off
before building.
