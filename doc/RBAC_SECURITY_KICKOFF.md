# Security / RBAC (Module XIII, MOD-67) — Kickoff

## Note

This repo is much further along than "new project" — the backend already has
~70 modules scaffolded, a fully-migrated RBAC schema, and no Oso anywhere in
`src/` despite the README naming it as the intended engine. So "start work on
RBAC, disregard Oso, use our own model" isn't a build-from-zero task — it's
**finish wiring the RBAC model that's already designed and half-built**, then
move to the frontend. Everything below was found by reading the actual code
and migrations, not assumed from the docs — several things the docs/README
describe as done are not actually wired into the running app.

## Work Done Already

**Real and working:**
- Full RBAC schema (`migrations/tenant/0110_rbac.sql`): `role`, `capability`
  (ISSUER/VALIDATOR/APPROVER/LINE_MANAGER), `scope` (entity/branch tree),
  `permission` (role x module_key x CRUD booleans), `field_visibility`,
  plus `user_role`/`user_capability`/`user_scope`. Seeded with 11 default
  roles including `CEO` (`migrations/seeds/9020_seed_rbac_events.sql`).
- `src/modules/security/{app_user,iam_role,session,audit_ledger,setting}` —
  working generic CRUD (list/get/create/update/soft-delete) via the
  `makeRepo/makeService/makeController/makeRouter` kit in
  `src/shared/crud/resource.js`.
- No Oso in `src/` at all — the README's "Oso as RBAC engine" line was never
  implemented. Nothing to strip out; just don't add it.

**Built but not actually wired (the real state before this kickoff):**
- `src/middleware/auth.js` and `src/middleware/rbac.js` both
  `require("../shared/cache/identity-cache")` — **that file did not exist
  anywhere in the repo.** Requiring either middleware would throw.
- `authMiddleware` was never called by any route file or by the central
  `src/routes/index.js` — every one of the ~70 tenant modules was reachable
  with **zero authentication**, token or not.
- `auth.js` read `config.JWT_SECRET`, which isn't defined in
  `src/config/env.js` (only `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are) —
  so even if wired, token verification would always fail. It also checked
  `user.status !== "active"` (lowercase) against a column whose CHECK
  constraint only allows `'ACTIVE'|'SUSPENDED'|'LOCKED'` (uppercase) —
  active users would have been rejected.
- **No login endpoint existed anywhere** — grepped the whole `src/` tree for
  `jwt.sign(`: zero hits outside what this kickoff adds. There was no way
  to obtain a JWT at all.
- `requirePermission()` was referenced in only 2 of ~70 route files
  (`ai/insights`, `ai/governance`), using module keys (`ai_insights`,
  `ai_governance`) and an action vocabulary (`view/create/edit/delete/
  approve/export/publish`) that don't correspond to the real `permission`
  table (`module_key` mirrors `MOD-xx` catalogue codes; columns are
  `can_create/read/update/delete/approve`, no `record_scope`). The
  middleware's own docstring described a `shared.permissions` table that
  doesn't exist in any migration.
- Only `role` has an admin module (`iam_role`); `capability`, `scope`,
  `permission`, `field_visibility` had no API at all despite full tables.
- Provisioning a tenant (`npm run db:provision`) creates **zero `app_user`
  rows and zero `permission` grants for any role** — a freshly provisioned
  tenant has nobody who can log in, and even a manually inserted user would
  get 403 everywhere.
- `iam_role`/`session`/`audit_ledger`/`setting` route files call
  `makeRouter()` with no `authMiddleware`/`requirePermission` at all — they
  were never gated, despite CONVENTIONS.md's stated rule ("RBAC: gate
  writes with the tenant RBAC check").

**Orphaned dead code, not in the critical path (flagged, not fixed):**
- `src/middleware/index.js` (`applyGlobalMiddleware`) and
  `src/middleware/customer-auth.js` are leftovers from a prior storefront
  project (comments literally say "Storefront CUSTOMER authentication",
  "shopper", "cart/checkout"; DB_ARCHITECTURE.md's AI-governance section
  independently confirms tables were "re-homed from the Pixie Girl
  `shared.*` schema"). Neither is required by `src/server.js` or
  `src/routes/index.js`. `middleware/index.js` also reads config keys that
  don't exist in `env.js`'s Zod schema (`CORS_ORIGINS`, `SESSION_SECRET`,
  `TRUSTED_PROXIES`, `REDIS_HOST`, etc.) — if anyone ever wires it in as-is
  it will crash on `config.CORS_ORIGINS.split(",")`. Recommend deleting
  both once confirmed unused, rather than fixing config drift in dead code.
- `src/config/redis.js` reads `config.REDIS_HOST/PORT/PASSWORD/DB`, none of
  which exist in `env.js` (only `REDIS_URL` does) — currently harmless
  because `ioredis` falls back to `127.0.0.1:6379`, which matches
  `REDIS_URL`'s default, but a custom `REDIS_URL` (password, non-default
  db) would silently be ignored. Left alone here (out of RBAC scope) — flag
  for whoever owns `config/redis.js`.

## Template — what this kickoff added

```
src/shared/cache/identity-cache.js          NEW — the missing dependency
src/middleware/auth.js                       FIXED — real secret, tenant-scoped lookup, status casing
src/middleware/rbac.js                       FIXED — matches the real `permission` schema
src/modules/security/auth/                   NEW — login (real), refresh (real), logout (real), 2FA (stubbed, see file)
src/modules/security/capability/             NEW — CRUD + auth/RBAC gating, demonstrates the pattern
src/modules/security/scope/                  NEW — CRUD + auth/RBAC gating
src/modules/security/permission/             NEW — the grant-matrix editor + cache invalidation
src/modules/security/field_visibility/       NEW — CRUD + auth/RBAC gating
scripts/tenant/create-admin.js               NEW — bootstraps the first login for a tenant (CEO role)
client/README.md                             NEW — frontend kickoff outline (not started yet)
```

> Update (2026-07-08): `src/modules/security/auth/` above was merged into
> `src/modules/security/app_user/` — auth's login/refresh/logout operate on
> the same `app_user` table/entity, so it's one module now instead of two.
> External URLs are unchanged (`/api/tenant/auth/*`, `/api/tenant/users/*`
> still both work — see `doc/WORK_DONE.md`). Left the table above as-written
> since it's the historical record of what this kickoff added.

Every new module follows CONVENTIONS.md's 6-file layout exactly
(`.repo/.service/.controller/.routes/.validator/.events`) so
`module-loader.js` auto-mounts it — no wiring elsewhere. `capability` /
`scope` / `field_visibility` are close copies of the `iam_role` pattern but
with real auth/RBAC gating added (per-verb: `view` for reads, `create`/
`edit`/`delete` for writes). `permission` is gated tighter — only `approve`
can touch it, since editing grants is the highest-leverage write in the
system — and invalidates the identity cache on every write so a permission
change takes effect within one cache TTL (30s), not up to it.

## What To Do (in order)

1. **Verify boot + login work end-to-end** (see Local Setup below) — this
   is the actual "does the fix work" test, since none of it could be
   exercised before.
2. **Wire `authMiddleware`/`requirePermission` into the existing security
   modules** (`iam_role`, `session`, `audit_ledger`, `setting`) — they
   still use bare `makeRouter()` with no gating. Follow the pattern in
   `capability.routes.js`.
3. **Decide the module_key for `ai_insights`/`ai_governance`** — those two
   call `requirePermission("ai_insights", ...)` / `requirePermission
   ("ai_governance", ...)`, neither of which matches a `platform.
   module_catalogue` row, so no role will ever have a matching `permission`
   row. Either add those as real MOD-xx entries or point them at an
   existing one.
4. **Record-level scope** (`own`/`team`/`all`) — `rbac.js` currently grants
   full-module access on any matching row; `scope`/`user_scope` exist but
   aren't consulted yet. Needs a decision on where the WHERE-clause filter
   lives (repo layer, per CONVENTIONS.md's original comment) before every
   other module's repo can honor it.
5. **Watch-the-Watcher** — `permission.changed`/`role.changed`/
   `field_visibility.changed` events are emitted (this kickoff wires the
   emit calls) but nothing consumes them yet to notify CEO/Management, and
   the Live-mode self-grant block (Super Admin can't grant themselves
   Issuer/Validator/Approver) isn't implemented — flagged as TODO in
   `permission.service.js`.
6. **2FA step-up** — `auth.service.js` throws `501` on
   `user.is_2fa_enabled`; needs a decision on the pending-2FA token shape
   before building it (not invented here — see the TODO comment in that
   file).
7. **Extend `db:provision` to seed a first tenant admin**, or keep using
   `scripts/tenant/create-admin.js` as the documented manual step — pick
   one so onboarding a real tenant isn't a silent dead end.
8. **Then the frontend** — see `client/README.md`. Build order: login →
   protected shell → the Security screens (role list already has an API;
   this kickoff adds capability/scope/permission-matrix/field-visibility
   screens), which exercise the whole auth+RBAC round-trip before any
   other module's UI depends on it.

## Local Setup (this is a fresh checkout — nothing has been run yet)

Prereqs: **Node 20** (`nvm use`), **PostgreSQL 16** with `pgcrypto`,
`citext`, `vector` extensions, **Redis 6+**. Docker Compose can provide
Postgres+Redis even if you run the API itself locally for faster iteration.

```bash
# 1. Infra — either:
docker compose up -d postgres redis          # containers only
# ...or install Postgres 16 (pgvector) + Redis locally yourself.

# 2. Install deps
npm install

# 3. Configure environment
cp .env.example .env
```

`.env.example` is missing several keys `src/config/env.js` actually reads
(it was copied from a prior project) — set at least these in `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=praxis_platform
DB_USER=praxis-admin
DB_PASSWORD=changeme          # matches docker-compose.yml's postgres service
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev-access-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
TENANT_DB_SUPERUSER=praxis-admin
TENANT_DB_SUPERUSER_PASSWORD=changeme
```

```bash
# 4. Platform DB — creates it, migrates, seeds the 70-module catalogue
npm run db:migrate:platform

# 5. Provision a tenant (creates its DB, migrates live+sandbox, seeds RBAC/COA/tax)
npm run db:provision -- --slug=smartls --name="Smart Logistics"

# 6. Bootstrap someone who can actually log in (provisioning creates no users)
npm run tenant:create-admin -- --slug=smartls --email=you@example.com --name="You" --password=secret123

# 7. Run it
npm run dev            # API, nodemon, http://localhost:8080 (PORT default)
npm run dev:worker     # background worker, separate terminal

# 8. Smoke test the fix — needs the tenant resolved by subdomain, so either
#    add a hosts-file entry (smartls.localhost -> 127.0.0.1) or send the
#    Host header directly:
curl -s http://localhost:8080/api/tenant/auth/login \
  -H "Host: smartls.praxisls.com" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret123"}'
# -> { data: { access_token, refresh_token, user: {...} } }
```

If step 8 returns a token, the fix works end-to-end: tenant resolution ->
`identity-cache` -> JWT issuance -> (next) `requirePermission` against the
real schema.
