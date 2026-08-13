# Phase 0 — Remediation Applied (2026-07-09)

Follows `doc/PHASE0_PRODUCTION_AUDIT.md`. Every P0 showstopper and the actioned
P1 items are fixed and verified in-sandbox (lint + unit tests + live boot).

## P0 — fixed

1. **Async-middleware crash → clean 401/403.** Added `src/shared/http/async-safe.js`
   (a dependency-free port of `express-async-errors`) and require it first in
   `src/server.js` and `src/jobs/workers.js`. Every async middleware/handler
   rejection now routes to the error handler instead of crashing the process.
   Added `unhandledRejection`/`uncaughtException` guards as defense-in-depth.
   _Verified:_ booting the real app and hitting `/api/platform/tenants` with no
   token now returns `401 AUTH_REQUIRED` with **no process crash** (was: full
   crash). Regression test: `tests/unit/async-safe.test.js`.

2. **Production secret guard.** `src/config/env.js` now refuses to boot when
   `NODE_ENV=production` and any of the published default secrets
   (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`) or an empty
   `DB_PASSWORD` are in place, and rejects identical access/refresh secrets.
   Dev ergonomics (defaults) preserved outside production. Regression test:
   `tests/unit/env-guard.test.js`.

3. **Real tests + meaningful CI.** Added `tests/jest.setup.js` and 7 passing
   specs. Removed `--passWithNoTests` from `.github/workflows/ci.yaml` so the
   test gate now fails on regressions. `jest.config.js` coverage path corrected
   (`workers.js`).

## P1 — fixed

4. **Foreign "Pixie Girl" code removed / app renamed.** Deleted dead storefront
   files (`middleware/customer-auth.js`, `middleware/index.js`,
   `middleware/geo-currency.js`, `services/geoip.js`). Rewrote the buggy
   storefront `middleware/error-handler.js` into a clean single handler (reads
   the real `AppError.status`/`.code`; no more `err.http_status`) and wired it
   plus `notFoundHandler` in `server.js`, removing the duplicate inline handler.
   Renamed the service identity from `pixiegirl-hub-backend` to `praxis-ls-api`
   (`config/logger.js` + `APP_NAME` in `env.js`).

5. **Worker runtime implemented.** `src/jobs/workers.js` was a 0-byte stub; it is
   now a real BullMQ consumer runtime with a `PROCESSORS` registry, per-queue
   Worker creation, structured logging, graceful shutdown, and process guards.
   Ships with an empty registry (no invented jobs) — Phase 1 registers PDF/email/
   FX here.

6. **CORS locked down.** Replaced wildcard `cors()` with an allowlist that
   reflects only `*.APP_BASE_DOMAIN` + the apex, any exact `CORS_ORIGINS`, and
   (dev only) localhost. Credentialed.

7. **Request IDs.** `requestIdMiddleware` now mounted globally so error responses
   carry a correlation id.

8. **Lint gate actually green.** `eslint .` was red with 295 pre-existing errors
   (it was linting `.cache/` Chromium resources, the `doc/reference/legacy_codebase`
   tree, and stray files). Added a global `ignores` block to `eslint.config.js`
   and fixed two undefined-rule disable directives. `npm run lint` now exits 0
   (backend + tests: 0 errors).

## Verified in sandbox

- `npm run lint` → exit 0 (0 errors).
- `find src scripts -name '*.js' | xargs -n1 node --check` → all parse.
- `npx jest --runInBand` → 2 suites, 7 tests, all pass.
- Live boot: unauthenticated gated request → 401, process stays up.
- `NODE_ENV=production` with defaults → boot refused with a clear message.

## Still open (tracked, not P0 — needs a real Postgres/decision)

- Run `9021_seed_default_permissions.sql` against a real Postgres + non-CEO login
  spot-check (audit §7). No DB in the build sandbox.
- DB-gated integration tests (tenant A cannot read tenant B; ledger UPDATE/DELETE
  rejected by trigger) — scaffolding ready, needs a Postgres service in CI.
- Auth-gated `/media` download route for sensitive docs; S3 driver (audit §8).
- RBAC record-level `scopeColumn` adoption lands with Phase 1/2 tables.
- Remaining deeper foreign services (excel/media-compression/welcome-email) left
  in place — not in the live request path; remove opportunistically.
