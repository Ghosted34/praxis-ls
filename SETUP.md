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
Key vars: `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (the **platform** DB the app boots against), `TENANT_DB_SUPERUSER[_PASSWORD]` (used by provisioning to `CREATE DATABASE`), `REDIS_URL`, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, AI keys (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` for embeddings), `EMBEDDINGS_DIM` (must match `ai_chunk.embedding vector(N)` = 1536).

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
> TENANT_DB_SUPERUSER=praxis-admin
> TENANT_DB_SUPERUSER_PASSWORD=changeme
> ```

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

> **Boot:** `npm run dev` serves `/api/platform` (dashboard) and `/api/tenant` (app). `src/server.js` is a lean Express boot; Redis/Socket.IO/worker wiring is added as those land.
> **Note:** running the JS requires `npm install` (the deps in package.json). The provisioning/registry SQL was verified against a real PostgreSQL 16; the JS passes `node --check`.
