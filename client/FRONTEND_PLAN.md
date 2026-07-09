# Praxis LS — Frontend plan & status

## Stack (decided)

Plain **Vite + React 18 + TypeScript**, **PWA** via `vite-plugin-pwa`, routing
with **React Router v6**, styling with **Tailwind v3** using the Lovable mock's
design tokens (oklch) and shadcn-style component patterns — hand-rolled as thin
primitives so we carry only `react`, `react-dom`, `react-router-dom`, `clsx`,
`tailwind-merge` at runtime. No TanStack/SSR: the mock's `@tanstack/react-start`
is a full-stack SSR framework, which fights the "static SPA served by the Node
app" model below. Any React dev can pick this up.

## Single-origin serving (tech-lead decision) + PWA

- **Dev:** `npm --prefix client run dev` runs the Vite dev server (HMR) and
  proxies `/api/*` to the Node API. `client/dist` doesn't exist, so the API
  serves API only.
- **Prod:** `npm --prefix client run build` emits `client/dist`. `src/server.js`
  now detects that and serves it: `/api/*` → API, every other path →
  `index.html` (client-side routing). One origin per tenant
  (`https://<slug>.praxisls.com`), so the **PWA is same-origin with its API** —
  installable to home screen, offline via service worker, no CORS. That
  same-origin requirement is exactly why the tech lead wants Node to serve the
  build rather than a separate static host.
- Icons: drop `client/public/icon-192.png` and `icon-512.png` (referenced by the
  manifest) before shipping; until then the app runs, it just isn't installable.

## Structure

```
client/src/
  app/            router (app.tsx), auth (context + guard), layout (shell)
  features/
    auth/         login-page.tsx        ← FINAL quality (review artifact)
    security/     pages.tsx             ← skeletal: users, roles, permissions,
                                          capabilities, scopes, field-visibility, sessions
    governance/   pages.tsx             ← skeletal: audit, notifications, workflows, approvals, settings
    dashboard.tsx
  components/     ui/* primitives, resource-list.tsx (generic list skeleton)
  lib/            api-client.ts (Bearer + refresh-on-401), token-store.ts, theme.ts, cn.ts
```

## What's built now

- **Login** — production quality: white-label (logo + tenant colour tokens),
  real loading/error states, password → 2FA step transition, mobile-correct,
  "Powered by JBS Praxis LLC" footer. **This is the page to review.**
- **Auth plumbing** — `api-client` attaches the Bearer token + `X-Praxis-Env`,
  transparently refreshes once on 401; `auth-context` handles login / 2FA /
  logout / reload-restore; `RequireAuth` guards the shell.
- **App shell** — white-label sidebar + top bar with LIVE/TEST badge, user, sign
  out; mobile slide-over.
- **Skeletal screens** — every Security & Governance screen lists its endpoint
  through a generic `ResourceList` (real loading/empty/error/403 states). These
  are deliberately plain — build create/edit and the permission grid on top.

## Run it

```bash
cd client
cp .env.example .env.local      # set VITE_TENANT_HOST to your provisioned tenant
npm install
npm run dev                     # http://localhost:5173  (proxies /api to :8080)
```
Log in with the tenant admin you created (`tenant:create-admin`).

## First screens to flesh out (after login sign-off)

Per `client/README.md`: the **permission grant-matrix** grid (role × module
checkboxes) is the highest-value first real screen — it lets a Super Admin
configure access without SQL and exercises the whole auth+RBAC round-trip.

---

## Platform console — PROPOSAL (for your review, not yet built)

The platform (Praxis-internal) console is a **different audience and auth** from
the tenant app: it's the Praxis ops team managing tenants, using
`POST /api/platform/auth/login` (a `PLATFORM_ROOT_ADMIN`, not a tenant user) and
the `/api/platform/*` API that's already done.

**What I propose to build:**

- **Where it lives:** the *same* `client/` build, under a `/platform/*` route
  area, activated when the host is `admin.praxisls.com` (already a platform host
  in `host-tenent-resolver.js`). One build, one deploy; the app shows the
  platform console on the admin host and the tenant app on tenant hosts. (The
  alternative — a separate `console/` app — is cleaner isolation but doubles the
  build/deploy; I'd only split it out if the console grows large.)
- **Separate auth surface:** a `platform-auth-context` using the platform login +
  its own token (kept apart from the tenant token), since platform tokens are
  stateless and not tenant-scoped.
- **Screens (all against endpoints that already exist):**
  1. **Platform login** — same craft bar as the tenant login, Praxis-branded.
  2. **Tenants** — list with health/status badges (LIVE / SUSPENDED /
     PROVISIONING); search; "New tenant" (provision) drawer.
  3. **Tenant detail** — status + DB + subdomains; actions: suspend / resume /
     **go-live** / set capacity (S–XL) / set sandbox interval / wipe sandbox /
     run migrations.
  4. **Feature flags** — per-tenant resolved feature state with on/off toggles
     and "revert to plan".
  5. **Catalogue** — read-only modules / features / plans (the 70-module
     catalogue), useful reference while configuring.

**What I'd want from you before building it:** confirm (a) same-app-on-admin-host
vs a separate console app, and (b) whether the first cut is just
**Tenants list + provision + go-live** (enough to onboard a tenant end-to-end)
or the full set above. I'll wireframe it for sign-off before writing screens —
same as we're doing with the tenant login now.
