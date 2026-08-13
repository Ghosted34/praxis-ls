# Praxis LS — Phase 0 Production-Readiness Audit (Brutal)

**Date:** 2026-07-09
**Scope:** Phase 0 (Foundations) as defined in `WORK_TO_BE_DONE.md`, verified against the
actual code in `src/`, `migrations/`, and config — **not** against the self-reported status docs.
**Method:** direct source inspection + a live Express-4 repro of the auth-failure path.

---

## Verdict: NOT production-ready. Do not deploy.

The design is genuinely good — the RBAC model, the immutable-ledger triggers, the
multi-tenant DB-per-tenant architecture, and the middleware _logic_ are well thought out and
mostly implemented. Phase 0 is roughly **80% built as a demo, ~35% ready for production.**
But there are **three independent showstoppers**, any one of which fails a production gate,
and each is triggerable by an anonymous attacker or by simply deploying the repo as-is.

The self-assessment in `WORK_TO_BE_DONE.md` / `HANDOVER.md` is honest about _feature_
completeness but silent on _operational safety_: it tracks "did we build the feature" and
almost never "does it survive contact with a hostile or misconfigured production."

---

## P0 — Showstoppers (block any deploy)

### 1. Any unauthenticated request to a gated route CRASHES the whole API

**Severity: Critical — trivial remote DoS + total outage for all tenants.**

`src/middleware/auth.js` (`authMiddleware`) and `src/middleware/rbac.js`
(`requirePermission`, `requireCapability`) are `async` functions that **`throw`** on failure
instead of calling `next(err)`. They are mounted directly (`router.use(authMiddleware)` in
every gated route file, e.g. `capability.routes.js`). Express **4** (confirmed: `express@4.22.2`)
does **not** catch rejcounted promises from async middleware. There is **no**
`express-async-errors`, no `asyncHandler` wrapper on the middleware, and **no
`process.on('unhandledRejection')` / `uncaughtException` guard anywhere in `src/`**.

Verified empirically with the repo's own Express: a single async middleware that throws
produces an **uncaught exception that terminates the Node process** — the error handler is
never reached. In production one anonymous `GET /api/tenant/capabilities` (no token) takes the
entire process down, and with it **every tenant** on that process.

Note the inconsistency that proves this is an oversight, not a pattern: `hostTenantResolver`
_does_ it correctly (`try/catch → next(err)`). The security-critical middleware does not.

**Fix:** wrap every async middleware/handler in `asyncHandler` (already defined in
`utils/errors.js`) or add `require('express-async-errors')` at boot, OR convert the auth/RBAC
middleware to `next(err)`. Add `unhandledRejection`/`uncaughtException` process guards
regardless. This is ~1 hour of work and must ship before anything else.

### 2. All secrets have public hardcoded defaults and there is no production guard

**Severity: Critical — full auth bypass / token forgery in any misconfigured deploy.**

`src/config/env.js`:

- `JWT_ACCESS_SECRET` defaults to `"__dev_access__"`
- `JWT_REFRESH_SECRET` defaults to `"__dev_refresh__"`
- `ENCRYPTION_KEY` (used to encrypt 2FA TOTP secrets) defaults to a fixed, in-repo
  all-hex constant

The Zod schema **validates successfully with these defaults**, so the app boots clean with
`NODE_ENV=production` and no `.env` (confirmed — booting with `NODE_ENV=production` yields
`JWT_ACCESS_SECRET === "__dev_access__"`). The shipped `.env` is **0 bytes**. Anyone with the
repo (i.e. the whole team, and anyone who ever gets read access) can forge a valid JWT for any
user in any tenant, and decrypt every stored 2FA secret.

**Fix:** in `env.js`, when `NODE_ENV==='production'` require these to be set and reject the
defaults (Zod `superRefine`). Fail boot loudly instead of silently running insecure.

### 3. Zero automated tests

**Severity: Critical for a financial/multi-tenant system.**

`find tests -type f -name "*.test.js"` → **0**. CI runs `jest --passWithNoTests`, i.e. the
pipeline is green with no coverage. There is **not one test** exercising: auth, JWT
verification, the RBAC grant check, tenant isolation (can tenant A read tenant B?), the
immutable-ledger triggers, 2FA, or session kill. For a system whose entire value proposition
is correct money + hard permission boundaries, shipping Phase 0 with no regression net is not
defensible. Every "verified by reading the code" note in the status docs is exactly the manual,
un-repeatable check that a test suite exists to replace.

**Fix:** before Phase 1, minimum bar — integration tests for (a) unauth request → 401 not
crash, (b) tenant A token rejected on tenant B, (c) non-CEO blocked on a gated write,
(d) ledger UPDATE/DELETE rejected by trigger, (e) 2FA challenge/verify round-trip.

---

## P1 — Serious (fix before real users, not necessarily before internal demo)

### 4. Foreign "Pixie Girl" storefront code is still in the running service

The service still identifies itself as **`pixiegirl-hub-backend`** (`config/logger.js` default
`APP_NAME`). 17 `src/` files reference storefront concepts (cart/checkout/shopper/buyer),
including live middleware and services (`geo-currency.js`, `media-compression.service.js`,
`welcome-email.js`, `services/excel/`). The elaborate `middleware/error-handler.js` is **dead
code** (server.js uses its own inline handler) and, if ever wired, would crash: it reads
`err.http_status`/`err.user_message` while the real `AppError` exposes `err.status`/`err.message`.
`middleware/index.js`, `customer-auth.js`, and parts of `config/redis.js` read env keys that
don't exist in the Zod schema — latent crashes waiting for someone to import them. This is
supply-chain/maintenance risk: nobody can cleanly reason about what runs.

**Fix:** delete confirmed-dead foreign modules; rename the app; reconcile the two error
handlers into one.

### 5. Background worker is an empty file

`src/jobs/workers.js` is **0 bytes**. BullMQ producers exist; nothing consumes the queues. Any
job enqueued today (and Phase 1's PDF/email/FX all depend on this) silently never runs, with no
error surfaced. Documented in HANDOVER but it's a Phase-0-incomplete item, not a Phase-1 nicety.

### 6. RBAC record-level scoping: mechanism only, zero enforcement

`requirePermission` resolves `scope_ids` and `makeRepo` accepts `scopeColumn`, but **no table
declares it** and no business table even has a `scope_id` column (grep-confirmed: only the RBAC
tables + `workflow_step`). So today RBAC is **module-level only** — any user with a module grant
sees _all_ rows in that module regardless of branch/entity. Correct for Phase 0's own tables;
must not be forgotten when Phase 1/2 tables land, or "scoped" access silently means "all access."

### 7. Default-permission seed never run against a real Postgres

`9021_seed_default_permissions.sql` was hand-verified by string-matching, never executed
(the author had no DB). Two matrix rows deliberately unseeded; `MOD-00A`/`MOD-63` seeded
nowhere. Until a `db:migrate:tenants` run + a non-CEO login spot-check, treat the whole grant
matrix as unproven.

### 8. `/media` is a flat public static mount

Fine for logos (as noted), but there is **no auth-gated download route**, and Phase 1 puts
confidential financial PDFs through the same storage. The S3 driver is interface-only. Must land
before any sensitive document is stored.

---

## P2 — Notable gaps / debt

- **CORS is wide open** (`app.use(cors())` with no origin allowlist) on a multi-tenant auth API.
- **Watch-the-Watcher** Live-mode self-grant block is still a TODO (`permission.service.js`);
  `notification.list()` returns all tenant rows, un-self-scoped — don't expose to non-admins yet.
- **Universal Event Engine** runtime is a stub: `emitEvent` doesn't create `approval_task` rows,
  so approvable events don't actually enter a queue yet (designer API exists; executor doesn't).
- **Frontend never type-checked / never `npm install`-ed** in the build env; "boots and login
  works" is the only evidence. Treat first `npm run build` as the real compile.
- **CI is parse+lint+empty-jest+no-push-build only** — no dependency/secret scanning
  (that's deferred to Phase 5, but #2 above shows why secret scanning matters now).
- Inactivity logout and remote-kill both act on `refresh()`, not the live access token — a
  killed session survives up to the 15-min access-token TTL. Acceptable, but document it as a
  known window, not "auto-logout."

---

## What is genuinely solid (credit where due)

- Immutable ledger is real and DB-enforced: `trg_ledger_ro` (`BEFORE UPDATE OR DELETE →
forbid_mutation`) on `immutable_ledger`, plus validated-journal-entry immutability triggers in
  `0220_ledger.sql`. This is the hardest thing to fake and it's done right.
- Multi-tenancy (DB-per-tenant + platform registry + Host-header resolution) is coherent and the
  tenant-resolution middleware handles errors correctly.
- The RBAC model (role × capability × scope × permission × field_visibility) is well-designed and
  the middleware logic (CEO bypass, cache + invalidation, capability overlay) is sound — it just
  needs the crash-safety and enforcement gaps closed.
- Auth substance is real: Argon2id, JWT access/refresh with `typ` discrimination, 2FA
  enrollment+verify, Redis session store with remote kill.

---

## Minimum path to "production-ready for Phase 0"

1. Fix async-middleware crash (#1) + add process-level rejection guards. **~1 hr.**
2. Production secret guard in `env.js` (#2). **~1 hr.**
3. Write the 5 integration tests in #3; make CI fail without them. **~1–2 days.**
4. Run the RBAC seed against real Postgres + non-CEO login spot-check (#7). **~2 hrs.**
5. Delete/rename foreign Pixie Girl code + collapse duplicate error handlers (#4). **~half day.**
6. Lock down CORS to the tenant/platform host allowlist (P2). **~1 hr.**

Items 1, 2, 3 are non-negotiable. Until they land, this is a promising internal build, not a
production system.
