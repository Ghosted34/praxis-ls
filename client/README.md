# Praxis LS — Frontend

Vite + React 18 + TypeScript SPA. Served single-origin by the Node API in
production (`src/server.js` mounts `client/dist`), proxied in development.

> Rewritten 2026-08-02. This file used to say "there is no working frontend in
> this repo yet" and presented the router choice as an open decision. Both had
> been untrue for roughly fifteen sessions — the app is built and shipping. It is
> kept short on purpose: `doc/SESSION_HANDOFF.md` is the living document, and a
> second one that drifts is worse than none.

## Stack — decided

**react-router-dom** + hand-rolled UI primitives on Lovable design tokens.

The `doc/reference/reference-mock-lovable` scaffold uses TanStack Router +
TanStack Query + the full shadcn set, and `doc/FRONTEND_REVIEW_2026-07-12.md`
recommended migrating to match it. **That recommendation is stale**, and it is
worth knowing why rather than rediscovering the argument: it was made to close a
_design-fidelity_ gap, and the gap was closed another way — the Lovable tokens
were mapped onto the existing semantic tokens in `src/index.css` (session 6) and
the kit-fidelity pass finished in session 15. Migrating now would mean rewriting
routing across ~50 screens to arrive at a look the app already has.

The one thing TanStack Query would still buy is caching and refetch behaviour. If
that becomes the itch, adopt it incrementally behind the existing `useList`
helper and leave the router alone.

## Layout

```
client/src/
  app/            router, layout shell, auth context, branding, boot gate
  features/<group>/   one folder per backend module group
  components/     shared UI primitives + document viewer
  lib/            api-client, token-store, branding, formatters
```

## Two apps in one bundle

- **Staff app** — everything under `RequireAuth` + `AppShell`.
- **External client portal** — `/client-portal/*` (`features/portal/portal-app.tsx`),
  outside both. It has its own token store and fetch client
  (`lib/portal-api.ts`), because a portal user has no `app_user` row, no role and
  no refresh token. **Do not route it under `/portal`**: the staff grant screen
  owns `/portal/access`, and an authentication boundary should not depend on
  React Router's route ranking.

## Commands

```
npm run dev                  # Vite dev server (proxies /api and /media)
npm run build                # tsc -b && vite build
npx tsc -b --force           # type-check only
```

Set `VITE_TENANT_HOST` to a provisioned tenant (e.g. `smartls.praxisls.com`) so
the dev proxy sends the right Host header — the tenant is resolved server-side
from it, and the browser never needs to know the subdomain.

## Conventions

`doc/FE_DESIGN_RULES.md` (incl. §5 human-readable data), `doc/CONVENTIONS.md`.
New wired screens use `DataList`/`PageHeader`; `ResourceList` is the quick
read-only path. Anything a user reads — enums, dates, booleans, FK ids — goes
through `lib/format.ts` rather than being rendered raw.
