# Praxis LS — Handover (end of Phase 0 → Phase 1)

Snapshot for whoever picks up **Phase 1 (Accounting spine)**. Read this first,
then `doc/WORK_TO_BE_DONE.md` (the live backlog) and `doc/WORK_DONE.md` (the
append-only history of *why* things are the way they are).

## What exists now

**Backend** — Node 20 (CommonJS) + Express + PostgreSQL 16 (pgvector) + Redis.
One Postgres DB per tenant + a shared `platform` registry DB. Phase 0
(Foundations) is substantially complete: multi-tenancy, provisioning, auth
(Argon2id + JWT access/refresh + 2FA + 30-min inactivity), the RBAC engine
(role × capability × scope × permission × field_visibility) with seeded default
grants, session store + remote kill, immutable audit ledger + soft-delete
restore, the Universal Event Engine admin API, Watch-the-Watcher, and white-label
branding. See `doc/WORK_TO_BE_DONE.md` Phase 0 for the per-item status and
`doc/RBAC_SECURITY_KICKOFF.md` for the security model.

**Frontend** — `client/` is a Vite + React 18 + TS **PWA** (see
`client/FRONTEND_PLAN.md`). Built: api-client (Bearer + refresh-on-401 +
`X-Praxis-Env`), auth (login / 2FA / logout / reload-restore), route guard,
white-label app shell, a production-quality **login**, **white-label theming**
(colour/logo/name via `/branding`), an **Appearance** settings screen (with
storage-backed logo upload), **light/dark/system** toggle, a branded **boot
splash**, and the **permission grant-matrix** editor. Other Security/Governance
screens are skeletal read-only lists over their real endpoints — build editors on
top as needed.

## Run it (two terminals)

```bash
# 1) Backend (repo root) — needs Postgres 16 + Redis up (WSL: sudo service redis-server start)
npm install
npm run db:migrate:platform
npm run db:provision -- --slug=smartls --name="Smart Logistics" --plan=full
npm run tenant:create-admin -- --slug=smartls --email=you@example.com --name="You" --password=secret123
npm run platform:create-admin -- --email=root@praxisls.com --password=root123
npm run dev                         # API on :8080

# 2) Frontend
npm install --prefix client
cd client && cp .env.example .env.local   # VITE_TENANT_HOST=smartls.praxisls.com
npm run dev                         # SPA on :5173, proxies /api + /media to :8080
```

Full detail (local vs Docker, troubleshooting, the `Host`-header tenant model) is
in `doc/SETUP.md`. API acceptance tests: `postman/` collection + its README.

## Gotchas that will bite you if you don't know them

- **Tenant resolution is by the `Host` header.** `localhost` is the *platform*
  host; tenant requests need `Host: <slug>.praxisls.com`. The Vite proxy sets
  this in dev; Postman sets it per request.
- **`.env` is single-file for local + Docker.** Keep local values in `.env`
  (`REDIS_URL=redis://localhost:6379`, `DB_HOST=localhost`); docker-compose
  overrides the host vars. Do NOT hard-code the docker hostname in `.env`.
- **The build sandbox used to write this could not `npm install`/compile the
  client.** It boots and works against the live backend, but treat the first
  `npm run build --prefix client` as the real typecheck.
- **Background worker (`src/jobs/workers.js`) is an empty stub.** BullMQ
  producers exist; the consumer isn't written. Phase 1's first PDF/email/FX job
  needs it — writing `workers.js` (register the queues + processors) is step one
  there.

## Known gaps to fold into Phase 1 (all logged in WORK_TO_BE_DONE.md)

- **File storage:** the `local` driver now works and serves at `/media` (proven
  by logo upload). Still needed: an **auth-gated download route** for *sensitive*
  documents (the flat `/media` mount is fine for public logos, not confidential
  files), and the **S3 driver** (interface only today).
- **`scopeColumn` record-level scoping:** mechanism built, no domain table has a
  `scope_id` column yet — Phase 1/2 tables (dossier, invoice, journal…) should
  add one and declare `scopeColumn` in their `makeRepo`.
- **Line Manager capability:** resolution + `requireCapability` exist; apply on
  Phase 2/3 approval flows.
- **Watch-the-Watcher self-grant block** in Live (`permission.service.js` TODO):
  needs `req.env`/`req.user` threaded to the service layer.
- **Platform console UI:** proposed in `client/FRONTEND_PLAN.md`, not built —
  awaiting a same-app-vs-separate decision.
- **Test/Live toggle, per-tenant PWA manifest:** frontend, not built.

## Where Phase 1 starts (Accounting spine)

Per `doc/WORK_TO_BE_DONE.md` Phase 1 + `doc/SmartLS_OHADA_Accounting_Tax_KnowledgeBase (1).md`:
the OHADA/SYSCOHADA Chart of Accounts, the Financial Dictionary + `posting_rule`
account-determination layer, the ledger engine invariants (many already enforced
by DB triggers — verified in `doc/SETUP.md`), the versioned tax jurisdiction
module, statements, and the PDF worker. The tenant schema for most of this
already exists in `migrations/tenant/*`; a lot of Phase 1 is services + the
worker + UI over an existing schema. Start by reading the KB and the migrations,
then wire the worker.

## New endpoints added late in Phase 0 (not in older docs)

```
GET  /api/tenant/branding                 public — white-label (colour/logo/name)
PUT  /api/tenant/branding                 gated MOD-70 — set appearance
POST /api/tenant/branding/logo            gated MOD-70 — upload logo → /media URL
GET  /api/tenant/catalogue/modules        gated MOD-67 view — the MOD-xx catalogue
PUT  /api/tenant/permissions/grant        gated MOD-67 approve — upsert role×module grant
```
