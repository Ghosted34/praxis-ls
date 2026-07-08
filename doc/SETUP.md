# Praxis LS — Local Setup

Backend is **Node 20 (CommonJS) + Express + PostgreSQL 16 (pgvector) + Redis**. Tenancy is **one Postgres database per tenant** plus a shared **platform** database (see `doc/DB_ARCHITECTURE.md`).

## Prerequisites
- Node 20 (`.nvmrc` → `nvm use`)
- PostgreSQL 16 with the `pgcrypto`, `citext`, and `vector` (pgvector) extensions available
- Redis 6+
- (PDF worker) Chromium — installed by the Docker image; locally set `PUPPETEER_EXECUTABLE_PATH`

## 1. Install & configure
```bash
npm install
cp .env.example .env      # then edit — see below, .env.example is missing several vars
```
Key vars: `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (the **platform** DB the app boots against), `TENANT_DB_SUPERUSER[_PASSWORD]` (used by provisioning to `CREATE DATABASE`), `REDIS_URL`, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (2026-07-08, see below), AI keys (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` for embeddings), `EMBEDDINGS_DIM` (must match `ai_chunk.embedding vector(N)` = 1536).

> **`.env.example` is stale** (inherited from a prior project — it has `JWT_ACCESS_SECRET`/`REFRESH_SECRET`
> missing entirely, no `DB_HOST/PORT/NAME/USER/PASSWORD` block). `src/config/env.js` is the actual source of
> truth for every var + default — when in doubt, read that file, not `.env.example`. Minimum to boot locally:
> ```
> DB_HOST=localhost
> DB_PORT=5432
> DB_NAME=praxis_platform
> DB_USER=praxis-admin
> DB_PASSWORD=changeme          # matches docker-compose.yml's postgres service
> REDIS_URL=redis://localhost:6379
> JWT_ACCESS_SECRET=dev-access-secret-change-me
> JWT_REFRESH_SECRET=dev-refresh-secret-change-me
> ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
> TENANT_DB_SUPERUSER=praxis-admin
> TENANT_DB_SUPERUSER_PASSWORD=changeme
> ```
> `ENCRYPTION_KEY` (added 2026-07-08) has that same fixed dev default baked into `env.js` if you omit it — fine
> for local dev, but it's what encrypts 2FA TOTP secrets at rest, so **generate a real random 64-hex-char key
> for anything beyond a laptop** (`openssl rand -hex 32`). `config/redis.js` also had a bug fixed the same day:
> it used to read `REDIS_HOST/PORT/PASSWORD/DB`, none of which exist in this schema — a non-default `REDIS_URL`
> (custom password, non-default DB) used to be silently ignored. Not anymore; `REDIS_URL` is the only Redis var
> that does anything, and it's no longer optional in practice — sessions and the identity cache both depend on
> Redis actually being reachable now (see the upgrade section below).

> Rotate every AI/FX key shared during discovery before first use.

## 2. Create & migrate the platform database
```bash
npm run db:migrate:platform
```
Creates the platform DB if missing, applies `migrations/platform/*`, and seeds the module/feature/plan catalogue (all 70 modules).

## 3. Provision a tenant (the onboarding tool)
```bash
npm run db:provision -- --slug=smartls --name="Smart Logistics" --plan=full
# optional: --subdomain=smartls.praxisls.com   (defaults to <slug>.<APP_BASE_DOMAIN>)
```
This single command:
1. creates the tenant's own database `tenant_smartls`,
2. runs the full tenant migration set into **both** `live` and `sandbox` schemas,
3. seeds OHADA chart of accounts, Cameroon tax codes, RBAC, events, currencies,
4. registers the tenant + DB connection + subdomain in the platform DB,
5. projects the plan's resolved feature flags into `feature_state`.

No hand-editing of any tenant database is ever required — everything is driven from here / the company console.

**Provisioning creates no users.** Bootstrap someone who can log in before anything else:
```bash
npm run tenant:create-admin -- --slug=smartls --email=you@example.com --name="You" --password=secret123
# --env=sandbox to also (or only) seed the sandbox schema; both can coexist for testing
```
Defaults to the `CEO` role (bypasses RBAC checks by design) since no `permission` grants are seeded for any
other role yet — see `doc/WORK_TO_BE_DONE.md` Phase 0. Use the new `permission` module once logged in to grant
scoped access to everyone else instead of making every user CEO.

## 4. Run
```bash
npm run dev            # API (nodemon)
npm run dev:worker     # background worker (BullMQ)
# or: docker compose up
```

## Upgrading an existing checkout (2026-07-08 changes)

A batch of Phase 0 work landed 2026-07-08 (see `doc/WORK_DONE.md` for the full rationale) — gated the 4
remaining ungated security modules, added platform login + full 2FA + Redis-backed sessions with remote kill
+ record-level scope + soft-delete restore, and — the actual frontend blocker — seeded default role×module
`permission` grants for the first time. What you need to do depends on whether you're starting fresh or
already had this repo running.

**Fresh install** (never run `db:provision` before): nothing extra to do. Steps 1–4 above already pick
everything up — the new seed file (`migrations/seeds/9021_seed_default_permissions.sql`) runs automatically
as part of `db:provision`'s normal tenant-seeding pass, same as the COA/tax/RBAC/event seeds always have.

**Existing checkout** (you already have a provisioned tenant from before 2026-07-08):
1. `git pull` (or however you're syncing between machines), then `npm install` — no new dependencies were
   added, but `otplib` (already in `package.json`) is used for the first time by the 2FA work, so confirm
   `node_modules/otplib` actually exists if you're not sure your last `npm install` was clean.
2. Add `ENCRYPTION_KEY` to your `.env` (see above) — encryption.service.js would previously have thrown on
   first use since the var didn't exist in the schema at all; now it has a dev default, but set a real one
   before this touches anything beyond your laptop.
3. Make sure Redis is actually running and reachable at `REDIS_URL` — it's no longer just configured-but-
   unused. `initRedis()` is now called at boot (`server.js`); a Redis outage degrades gracefully (sessions/
   cache just stop working, boot doesn't crash) rather than blocking startup, but you want it up for real
   testing.
4. **The important one:** `npm run db:migrate:tenants` — this is what actually applies the new
   `9021_seed_default_permissions.sql` (and the RBAC-gating changes to `iam_role`/`session`/`audit_ledger`/
   `setting`, which are code, not migrations, so they apply the moment you deploy the new `src/`) to every
   already-provisioned tenant. Skipping this step means your existing tenants stay in the old
   "nobody-but-CEO-can-do-anything" state — the whole point of this batch of work was to fix that.
5. Confirm `src/modules/security/auth/` is gone from your checkout — it was merged into `app_user/` on
   2026-07-07/08; if it somehow reappeared (e.g. a merge conflict resurrected it), delete it. Two modules
   both trying to mount `/auth` is a real bug, not just clutter.
6. **Smoke test — don't skip this:** bootstrap or use an existing non-CEO user
   (`npm run tenant:create-admin -- --slug=<slug> --email=someone@example.com --name="Test Sales" --role=SALES`)
   and confirm they can log in and get exactly the access the new seed says they should (see the role×module
   table in `doc/WORK_DONE.md`'s 2026-07-08 entry). CEO-only testing won't catch a bad seed — CEO bypasses
   RBAC by design.

### New/changed endpoints (all under `/api/tenant/*` unless noted)
```
POST   /api/platform/auth/login          NEW — platform login didn't exist at all before this
POST   /auth/2fa/setup                   NEW — generate+store a TOTP secret (not yet enabled)
POST   /auth/2fa/enable                  NEW — {code} confirm one valid code, flips is_2fa_enabled
POST   /auth/2fa/disable                 NEW — {code}
POST   /auth/2fa/verify                  NEW — {pending_token, code} exchanges login's 2FA challenge for real tokens
GET    /sessions/mine                    NEW — self-scoped, no permission grant needed
POST   /sessions/:id/kill                NEW — self always allowed; others need the MOD-68 grant or CEO
GET    /audit/soft-deletes                NEW — open (unrestored) soft-deletes
POST   /audit/soft-deletes/:id/request-restore   NEW — maker-checker step 1
POST   /audit/soft-deletes/:id/restore           NEW — maker-checker step 2 (different admin than the deleter)
GET|POST|PATCH|DELETE /roles             CHANGED — now requires authMiddleware + requirePermission (was open)
GET|POST|PATCH|DELETE /sessions          CHANGED — same
GET /audit, GET /audit/:id               CHANGED — same
GET|POST|PATCH|DELETE /settings          CHANGED — same
```
`login`/`refresh`/`logout` are unchanged in shape (still `/auth/login`, `/auth/refresh`, `/auth/logout`) —
`login` now additionally returns `{pending_2fa: true, pending_token, expires_in}` instead of real tokens when
the user has 2FA enabled, instead of the old `501`.

## Scheduled jobs
- **Sandbox wipe** (kickoff §6, default every 14 days): `npm run db:sandbox:wipe` — drops+rebuilds each tenant's `sandbox` schema and re-seeds; never touches `live`. Wire to cron: `0 3 */14 * *`.
- **FX sync** (daily midnight): `FX_SYNC_CRON` drives the exchangerate-api pull into `fx_rate_daily`.

## Handy scripts (package.json)
| Script | Does |
|---|---|
| `npm run setup` | install + migrate platform |
| `npm run db:migrate:platform` | create/migrate platform DB + catalogue seed |
| `npm run db:provision -- --slug=… --name="…"` | provision a tenant (live+sandbox) |
| `npm run db:sandbox:wipe [-- --slug=…]` | rebuild sandbox schema(s) |
| `npm run db:reset:local` | migrate platform + provision a `smartls` demo tenant |
| `npm run dev` / `dev:worker` | API / worker with reload |
| `npm run lint` / `format` / `test` | eslint / prettier / jest |

## Verification done
The migration set has been applied against a real PostgreSQL 16: **151 tenant tables** in both `live` and `sandbox`, **12 platform tables**, seeds loaded (COA, 20 tax codes, 47 event types, 11 roles, 5 currencies, 72 modules, 32 features). The KB §23 accounting invariants are enforced by DB triggers and were tested to reject unbalanced entries, débours in class 6/7, non-postable/analytic violations, edits to validated entries, and mutations of the immutable ledger.

> **Caveat on the 2026-07-08 batch specifically:** unlike the verification above, `9021_seed_default_permissions.sql` and the code changes listed in the upgrade section were **not** run against a real Postgres/Redis — that session's sandbox had neither available. They were checked by `node --check`, a `require()` smoke test of every changed module, and cross-referencing every role code / module_key in the new seed against the actual `role`/`module_catalogue` seed files (exact match). That's a reasonable substitute for a syntax check, not a substitute for actually running it. Do the smoke test in the upgrade section above before treating this as verified.

## Note on the AI layer (next phase)
The schema already includes the per-tenant AI corpus (`ai_document`/`ai_chunk` with pgvector), assistant sessions, the Zod-gated `ai_action_run`, and governance/usage tables — all inside each tenant DB so embeddings never cross tenants. The next build is the ingestion/self-learning pipeline that indexes the tenant DB + platform + codebase into those tables and wires function-calling + vector recall.

---

## Company dashboard API & the service/middleware split

The provisioning logic now lives in **services** (reusable by both the CLI and the dashboard), request-time tenant resolution lives in **middleware**, and only pure terminal ops stay in `scripts/`.

### Layers
- `src/services/platform/migrator.js` — migration-file applier + a per-DB migration ledger (`public.schema_migration`) so applies are idempotent and existing tenants can be upgraded.
- `src/services/platform/provisioning.service.js` — `migratePlatform`, `provisionTenant`, `migrateTenant`/`migrateAllTenants` (upgrades), `wipeSandbox`, `projectFeatures`.
- `src/services/platform/tenants.service.js` — dashboard controls: list/health, suspend/resume, go-live, capacity, sandbox interval, feature on/off (+re-project), catalogue reads. Every write → `platform.platform_audit`.
- `src/services/tenant/registry.service.js` — per-tenant connection pool manager; `resolveByHost`, `withTenantConnection(meta, env, fn)`.
- `src/middleware/host-tenent-resolver.js` — Host header → tenant (or platform); 404/403/423 as appropriate.
- `src/middleware/tenant-context.js` — picks live/sandbox, binds request context, exposes `req.tenantDb(fn)`.
- `src/middleware/platform-auth.js` — platform JWT + `PLATFORM_ROOT_ADMIN` guard.

### Dashboard endpoints (mounted at `/api/platform`, Praxis-only)
```
GET    /catalogue/modules            list the 70 modules
GET    /catalogue/features           list switchable features
GET    /plans                        list plans
GET    /tenants                      list tenants + health
POST   /tenants                      provision {slug,name,plan,subdomain}
GET    /tenants/:slug                tenant detail (db, subdomains)
POST   /tenants/:slug/suspend        suspend
POST   /tenants/:slug/resume         resume
POST   /tenants/:slug/go-live        mark Live (hides Test/Live toggle)
PATCH  /tenants/:slug/capacity       {tier: S|M|L|XL}
PATCH  /tenants/:slug/sandbox        {days}
POST   /tenants/:slug/sandbox/wipe   rebuild sandbox now
POST   /tenants/:slug/migrate        upgrade this tenant to latest migrations
GET    /tenants/:slug/features       resolved feature state
PATCH  /tenants/:slug/features/:key  {state: on|off}   ← the toggle
DELETE /tenants/:slug/features/:key  clear override (revert to plan)
```
Tenant app: `/api/tenant/*` runs behind `hostTenantResolver` + `tenantContext` (subdomain-resolved, live/sandbox bound). `GET /api/tenant/whoami` is a smoke endpoint.

### Terminal-only scripts (run regardless of the frontend)
```
npm run db:migrate:platform            create/migrate platform DB + catalogue
npm run db:provision -- --slug --name  provision a tenant
npm run db:migrate:tenants [--slug]    upgrade existing tenant(s) after new migrations
npm run db:sandbox:wipe   [--slug]     rebuild sandbox schema(s)  (cron)
npm run platform:create-admin -- --email --password    dashboard login (Argon2id)
```

> **Boot:** `npm run dev` serves `/api/platform` (dashboard) and `/api/tenant` (app). `src/server.js` is a lean Express boot; Redis is now wired in (`initRedis()`, 2026-07-08, best-effort — a Redis outage degrades caching/sessions rather than blocking boot), Socket.IO/worker wiring still isn't.
> **Note:** running the JS requires `npm install` (the deps in package.json). The provisioning/registry SQL was verified against a real PostgreSQL 16; the JS passes `node --check`.
