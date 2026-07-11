# Praxis LS — Work Done Log

Running log of substantive changes landed against `doc/WORK_TO_BE_DONE.md`,
newest entry on top. Companion to that file: WORK_TO_BE_DONE.md is the
backlog (checkboxes get ticked in place), this file is the append-only
record of *what actually happened and why*, for anyone picking up context
later without re-reading every diff.

---

## 2026-07-11 — Phase 3: Fleet, WMS & HR modules (BE + FE + Postman)

**Phase:** 3 — People & assets (ledger-independent scope). Built after reverting
the earlier Phase-2 work so the colleague owns Phase 1 & 2.

**Verify caveat:** the build sandbox mount is stale for freshly-written files, so
in-sandbox `node --check` reports false truncation errors — disproven by reading
the real files through the file API. The definitive gate is `npm run lint`
(backend, PowerShell) which the user ran at **0 errors**; for the client the
equivalent is `npm run build --prefix client` (tsc).

### Backend — 21 tenant modules brought from stub → full convention
Each module now ships the 7-file layout (repo/service/controller/routes/validator/
events/**ai.js**), RBAC-gated routers (`requirePermission`), real Zod validators,
and keeps **all SQL in repos** (services do logic + `emitEvent`/`audit` only).

- **Fleet (7):** vehicle (MOD-39), vehicle_compliance (40), work_order (41,
  lifecycle OPEN→IN_PROGRESS→DONE/CANCELLED), fleet_dispatch (42, ASSIGNED→OUT→
  RETURNED + odometer/check-in-out), fuel_log (43), driver (44), incident (45,
  OPEN→UNDER_REVIEW→CLOSED).
- **WMS (6):** warehouse_location (34), inbound/GRN (33, QA gate HOLD→PASSED/
  REJECTED), inventory (35, state machine + append-only `stock_movement` journal
  via `/:id/move`), outbound (36, order status + `outbound_line` pick/pack),
  equipment (37, status), cycle_count (38).
- **HR ledger-independent (8):** vacancy (11, status + `job_applicant` pipeline),
  hr_contract (12, DRAFT→ISSUED→SIGNED→ENDED), appraisal (13), attendance (14,
  clock-out action), leave_allowance (15, REQUESTED→APPROVED/REJECTED decision),
  sop_onboarding (16, SOP docs), training (18, status + `training_attendance`
  roster), talent_pool (19).

Status transitions live in the service layer with validated transition maps,
dedicated events (`*.status_changed` etc.) + audit. Multi-table modules
(inventory, outbound, training, vacancy) add custom repo methods over the shared
`query-helpers` — still repo-only SQL.

**Deferred (need Phase 1 ledger posting):** payroll, asset depreciation, and the
GL legs of fuel_log/work_order (`entry_id`) and leave salary-advance (→4211).

### Frontend (`client/`)
Added `features/fleet/pages.tsx` (7), `features/wms/pages.tsx` (6),
`features/hr/pages.tsx` (8) on the existing `ResourceList` pattern; wired 26
routes in `app/app.tsx`; added **Fleet**, **Warehouse** and **People & HR** nav
groups in `app/layout/app-shell.tsx`. Registered all 27 Phase-3 screens (with
their `ai.js` action keys) in `app/screen-registry.json` — the AI/nav map now
has 37 screens. Page components follow the repo pattern and can be superseded by
the Lovable rebuild without touching routes/registry.

### Postman
`postman/praxis-ls.phase0.postman_collection.json` gained "9 · Fleet" (17 reqs)
and "10 · WMS" (21 reqs) folders under `/api/tenant/*`, chaining created IDs
through the lifecycle actions via test-script variable capture.

## 2026-07-09 (2) — Frontend build: client scaffold, white-label, theming, grant-matrix

**Phase:** 0 → sets up the frontend and closes the white-label item; last
session before handover to Phase 1 (see `doc/HANDOVER.md`).

**Verify caveat (same as the batch below):** the build environment could not
`npm install`/`tsc` the client. It boots and works against the live backend
(login, branding, upload, matrix all exercised by the user during the session);
treat the first `npm run build --prefix client` as the real typecheck.

### Client scaffold (`client/`)
Vite + React 18 + TS **PWA** (React Router, Tailwind v3 + the Lovable mock's
oklch tokens, hand-rolled shadcn-style primitives — minimal deps). api-client
(Bearer + refresh-on-401 + `X-Praxis-Env`, unwraps `{data}`), token store, auth
context (login / 2FA / logout / reload-restore), route guard, white-label app
shell (LIVE/TEST badge, mobile slide-over), a production-quality **login** (field
icons, password reveal, segmented 2FA OTP). Single-origin prod serving wired in
`src/server.js` (Express serves `client/dist` when present).

### White-label (backend + frontend)
New `src/modules/branding/`: **public** `GET /branding` (Host-resolved, pre-auth
so the login is branded) + **gated** `PUT /branding` (MOD-70) upserting `setting`
section='appearance'. FE applies colour/logo/name via CSS variables
(`lib/theme.ts` `applyBrand`), a `BrandingProvider` fetches on boot, and an
**Appearance** screen sets it live. Storage-backed **logo upload**: fixed
`storage.service.js` (`STORAGE_LOCAL_ROOT`→`STORAGE_LOCAL_PATH`, added
`CDN_BASE_URL`), served `/media` in Express (local driver, excluded from SPA
fallback, proxied by Vite), and `POST /branding/logo` stores to
`./data/vault/tenant_<slug>/branding/…`. Verified end-to-end by the user (file on
disk + logged-out login shows it).

### Theming + boot polish
Light/dark/**system** toggle (`lib/theme-mode.ts` + top-bar control; Tailwind
`darkMode:"class"`, applied pre-paint). Branded **boot splash** (`boot-gate.tsx`
+ `splash-screen.tsx`) inspired by the JBS Praxis "Pixie Hub" loader — centered
glowing logo + progress, themed by tenant colour. Two fixes after user testing:
(1) the splash **withholds identity until branding is `ready`** so the default
"Praxis LS" never flashes before the tenant's; (2) the login defers autofocus via
a `bootSignal` until the splash is gone (was popping the browser autofill over
the splash).

### Permission grant-matrix (the real RBAC editor)
Backend: new tenant `GET /catalogue/modules` (reads `platform.module_catalogue`
via the platform pool, gated MOD-67 view) and `PUT /permissions/grant` — an
upsert by `(role_id, module_key)` (`ON CONFLICT`), which invalidates the grant
cache and emits `permission.changed` (→ Watch-the-Watcher). Frontend
`permission-matrix-page.tsx`: roles across the top, modules down the side grouped
+ collapsible by `group_key`, each cell five toggles (R/C/U/D/A) mapping to the
`permission` booleans; optimistic upsert with revert-on-error. Wired at
`/security/permissions`.

### Not done / deferred (see HANDOVER.md)
Auth-gated download route for sensitive vault files; S3 storage driver; platform
console UI; Test/Live toggle; per-tenant PWA manifest; `scopeColumn` adoption;
Line-Manager application; the Live self-grant block.

---

## 2026-07-09 — Phase 0 close-out: /users gating, inactivity, Watch-the-Watcher, capabilities, event engine, CI + setup split

**Phase:** 0 (Foundations). Goal: close the remaining *backend* Phase 0 gaps
(everything not blocked on `client/`), fix a setup blocker the user hit, and
make local-vs-Docker setup unambiguous. Frontend-blocked items (platform
console UI, sandbox toggle/banner, white-label rendering) are untouched — still
waiting on `client/`.

**Verification note (read this):** the shell sandbox's view of the repo was
**stale/inconsistent this session** — files written by the host editor showed
up truncated or NUL-padded through the mount, so `node --check` via the sandbox
reported false syntax errors on valid files (it flagged JSDoc `/**` openings and
lines the host copy shows intact). Verification was therefore done by reading
every changed file back through the host-authoritative editor and reviewing the
logic, **not** by a sandbox `node --check`/`require()` smoke test. Whoever picks
this up next: run `npm run lint` + boot the app (module-loader logs
`skipped module (load error)` on any require failure) once, on a machine where
the checkout is consistent, to get the syntax/boot check this session couldn't.

### A — app_user `/users` CRUD gated (the last open security route)

`app_user.routes.js`'s `/users` sub-router was the one deliberately-ungated
security module (see the 2026-07-08 entry). Now built explicitly (not
`makeRouter`) so each verb carries `authMiddleware` + `requirePermission('MOD-67',
…)` — user administration is IAM & user access → MOD-67, the same grant the rest
of the IAM screen group uses. `/auth/*` stays public (that's how you get a token
in the first place). Bootstrap is unaffected: the first admin still comes from
`scripts/tenant/create-admin.js` (direct DB write), not this API.

### B — 30-min inactivity auto-logout enforced

`SESSION_INACTIVITY_MIN` was configured but never checked anywhere. Now enforced
at the refresh boundary: `app_user.repo.getActiveSession()` returns
`idle_seconds` (`EXTRACT(EPOCH FROM now() - last_seen_at)`), and
`app_user.service.refresh()` kills the session + returns `401 SESSION_EXPIRED`
when idle beyond the window. `last_seen_at` is bumped on every refresh, so an
active client keeps its session; an idle one (no refresh) gets logged out on its
next attempt. Same tradeoff already documented for remote kill: an
already-issued access token stays valid until its own ≤15-min expiry — this
blocks the *refresh* that extends the session, it doesn't retroactively revoke a
live access token. Refresh is the only place session state is consulted (access
tokens are stateless and carry no `sid`), so it's the correct enforcement point.

### C — Watch-the-Watcher consumer (security-critical events → CEO/MANAGEMENT)

The three high-priority events were seeded and firing but **nobody consumed
them**. Implemented centrally in `shared/events/emit.js` rather than wired into
each service separately (so the next security-critical event anyone adds is
covered automatically): `emitEvent()` now (1) forces `event_log.priority = HIGH`
for any event whose `event_type.is_security_critical` is set, resolved in-SQL,
and (2) fans out a HIGH in-app `notification` to every **active CEO/MANAGEMENT**
user — a single `INSERT…SELECT` guarded by `EXISTS(is_security_critical)`, so
it's a zero-row no-op for the ~99% of events that are NORMAL. Runs in the
caller's transaction, so the alert is atomic with the change that triggered it.

Bug this exposed and fixed: `iam_role` emitted `iam_role.created/updated/archived`
— **not** the seeded security-critical `role.changed` — so role edits never
reached the watchers. Repointed `iam_role.events.js` to `role.changed` (same
map-all-verbs-to-one-key convention as `permission.changed` /
`field_visibility.changed`).

Prerequisite fixed: the `notification` module didn't load at all — `service`/
`controller`/`validator` used a `../../../shared` require path (three levels) but
the module is flat (`src/modules/notification/`, two levels), so
`module-loader` had been silently skipping it. Fixed to `../../shared`, and added
`authMiddleware` to its router (it was about to go live). **Flagged, not fixed:**
its generic `list()` isn't self-scoped yet — returns every tenant notification,
not just the caller's; noted in `notification.routes.js` and `WORK_TO_BE_DONE.md`
as a Phase 2 follow-up before it's exposed to non-admin roles.

### D — Line Manager / capability mechanism

The columns existed (`role.is_line_manager`, the `LINE_MANAGER` capability code,
`user_capability`) but nothing resolved them. Added
`identity-cache.getUserCapabilities()` (30s-cached like grants/scope; returns
`{capabilities[], is_line_manager}` where `is_line_manager` is true if any role
flags it *or* the user holds `LINE_MANAGER`), invalidated alongside the other
per-user cache keys. Added `middleware/rbac.requireCapability(code)` — a gate for
the segregation-of-duties overlay, usable independently of the module CRUD grant
(`requireCapability('APPROVER')` etc.), with the same CEO bypass; it also
attaches `req.capabilities` / `req.is_line_manager`. **Mechanism only, by
design:** no Phase 0 route needs it — the actions it gates (leave approvals,
appraisals, disbursal routing) land with Phase 2/3, which opt in per route.

### E — Universal Event Engine: registration + workflow-designer API

New `src/modules/workflow/` (flat module, gated `authMiddleware` +
`requirePermission('MOD-67', …)` — per the 2026-07-08 conflict note, "AI & event
engine" shares MOD-67 until it earns its own module_key). The schema and the
emit side already existed; this adds the missing admin surface so event types
and approval chains stop being DB-hand-edits:
- `GET/POST /event-types` — list + register (upsert on the UNIQUE key, idempotent).
- `GET/POST /workflows`, `GET/PATCH /workflows/:id` — a workflow binds to an
  **approvable** event type (rejected otherwise); detail returns its ordered steps.
- `GET/POST /workflows/:id/steps`, `DELETE …/steps/:stepId` — VALIDATE|APPROVE
  steps (role/capability/scope + amount-threshold routing, matching the
  `workflow_step` schema).
- `GET /approvals` — read-only runtime `approval_task` queue (`?status=`).
Every write emits an event + writes the immutable audit trail, same contract as
the generic `makeService` path (hand-written because it spans four tables). Zod
validators on the write bodies; the module's own event keys (`workflow.created`
etc.) are descriptive labels (`event_log.event_type_key` has no FK, so unseeded
keys are fine).

### F — CI + the local/Docker setup split (the user's actual blocker)

The user hit `getaddrinfo ENOTFOUND redis` on a local run. **Root cause:** `.env`
had `REDIS_URL` defined **twice** — `redis://localhost:6379` then
`redis://redis:6379` (a Docker value) — and dotenv keeps the **last** occurrence,
so the app tried to resolve the Docker service name `redis` on a local run.
`NODE_ENV=production` was also set locally (hence `"env":"production"` in the
logs). Fixes:
- `.env`: removed the duplicate `REDIS_URL` (localhost wins), set
  `NODE_ENV=development`.
- `docker-compose.yml`: so the *same* `.env` works for both, the `api`/`worker`
  `environment:` blocks now override `REDIS_URL=redis://redis:6379` (the code
  reads `REDIS_URL`, **not** the dead `REDIS_HOST` that was there — removed) plus
  `NODE_ENV=production` and `PORT`. Also fixed two real compose bugs found in
  passing: the `redis` service mounted an **undeclared** volume
  (`pixie_redisdata` vs the declared `praxis_redisdata`), and the `api` port
  mapped `3000:3000` while the app listens on `8080` → now `3000:8080`. And the
  `Dockerfile` worker `CMD` pointed at `src/jobs/worker.js` while the file is
  `src/jobs/workers.js` (still an empty stub — worker itself is Phase 1+).
- `.env.example`: rewritten from the stale Docker-only template to match
  `env.js` — full DB block, `ENCRYPTION_KEY`, local-friendly values, with the
  "Docker overrides these, don't hard-code the service name" note inline.
- `doc/SETUP.md`: restructured into **Option A — Local** and **Option B —
  Docker** (they share one `.env`), plus a **Troubleshooting** section for the
  exact `ENOTFOUND redis` error, and a 2026-07-09 upgrade/endpoints block.
- CI: `.github/workflows/deploy.yaml` was an empty (0-byte) file → replaced with
  `ci.yaml` (checkout, Node 20, `npm ci`, `node --check` across `src`/`scripts`,
  `npm run lint`, `jest --passWithNoTests`, plus a no-push `docker build` to
  catch Dockerfile breakage). `deploy.yaml` is now a valid manual-only
  placeholder (deploy target/secrets are Phase 5) instead of an empty file
  GitHub reports as invalid.

### Explicitly NOT done (and why)

- **`scopeColumn` adoption** — the mechanism (built 2026-07-08) is complete, but
  **no existing tenant table has a `scope_id` column** to adopt it on (confirmed
  by grepping every `migrations/tenant/*.sql`: `scope_id` appears only in the RBAC
  tables `scope`/`user_scope` and in `workflow_step`, never on a business/record
  table). The tables that need record-level scoping (dossier, invoice, journal…)
  are Phase 1/2 and don't exist yet. Adoption is a per-table schema decision that
  lands with those modules — not something to fake now with a throwaway migration.
- **Line Manager application** — see D: mechanism built, application is Phase 2/3.
- **Self-grant block in Live** (`permission.service.js` TODO) — still needs
  `req.env`/`req.user` threaded to the service layer, which arrives with the
  Live/Sandbox toggle work; not forced this pass.
- **Frontend** — no `client/` yet; all UI-gated Phase 0 items stay open.

---

## 2026-07-08 (2) — Phase 0 push: gating, platform login, 2FA, Redis sessions, scope, restore

**Phase:** 0 (Foundations). Goal for the session: close out as much of Phase
0 as responsibly possible so the frontend (see `client/README.md`) has a
real backend to build against, not just CEO-bypass access.

**Housekeeping first:** the previous entry's `src/modules/security/auth/`
deletion had been left for the user to do manually because the shell
sandbox was down for that entire session. It was still present at the
start of this session (confirmed via `ls`) — deleted now, sandbox came
back up partway through this session. `node --check` run against every
file touched below plus a `require()` smoke test of the changed
services/routes — all clean. Flagging for the record: three **pre-existing,
unrelated** broken modules surfaced during that smoke test
(`ai/governance`, `ai/insights` — `require("../../config/database")`,
which doesn't exist; `notification` — wrong relative path to
`shared/crud/resource`). `module-loader.js` already skips-with-a-warning on
any module `require()` failure, so these were silently broken before this
session too; not fixed here, out of scope, just noted so nobody assumes
this session introduced them.

### A — Gated the 4 remaining ungated security modules

`iam_role` (→ MOD-67, same grant as capability/scope/permission/
field_visibility — one module_key covers the whole IAM screen group),
`session` (→ MOD-68), `audit_ledger` (→ MOD-69, view-only — it's a
read-only ledger), `setting` (→ MOD-70). All four now require
`authMiddleware` + `requirePermission`, following `capability.routes.js`'s
existing pattern exactly. `app_user`'s own generic `/users` CRUD is the one
deliberate exception, left ungated — same gap, not folded into this pass
(see the 2026-07-07 entry's scope decision).

### B — Platform login endpoint (a gap this session found, not pre-flagged)

`platform.routes.js` required `platformAuth` on **every** route with no
login endpoint anywhere to obtain the token in the first place —
`scripts/platform/create-admin.js` only ever wrote a password hash.
Grepped the whole repo for `jwt.sign` + `typ:"platform"` before adding
this: zero hits. Added `src/services/platform/auth.service.js` (mirrors
`app_user`'s login shape against `platform.platform_user`) and
`POST /api/platform/auth/login` in `platform.routes.js`, registered before
the router's global `platformAuth` gate. No refresh/session infra exists
at the platform tier in the schema (`0030_platform_ops.sql` has no
platform-session table) — this issues a stateless access token only;
noted in the service file rather than inventing a session model that
isn't there.

### C — Prerequisite fixes: Redis config + missing ENCRYPTION_KEY

Two bugs found while building the features below, both fixed as
prerequisites rather than worked around:
- `src/config/redis.js` read `config.REDIS_HOST/PORT/PASSWORD/DB` — none
  of which exist in `env.js`'s Zod schema (only `REDIS_URL` does). Flagged
  as dead config drift in `RBAC_SECURITY_KICKOFF.md` and left alone at the
  time; now actually fixed — `ioredis` takes the connection string
  directly. Also: `initRedis()` was never called anywhere in the app at
  all (server.js's own comment said "Redis/Socket.IO/worker wiring is
  added as those land") — wired into `server.js`'s `start()`, best-effort
  (a Redis outage at boot degrades caching/session-kill, doesn't crash
  boot, matching `identity-cache.js`'s existing philosophy).
- `src/services/encryption.service.js` read `config.ENCRYPTION_KEY`
  unconditionally — not in the Zod schema at all, so it was `undefined`
  and `Buffer.from(undefined, "hex")` would throw on first use. Added to
  `env.js` with a fixed (not random-per-boot) 64-hex-char dev default,
  same pattern as the JWT secrets — **must be overridden in production**.
  (Caught my own typo here too: first draft of the default was 62 hex
  chars, not 64 — Zod's regex rejected it at boot. `node --check` doesn't
  catch that, only actually requiring `env.js` does; that's why the smoke
  test above matters.)

### D — Redis session store + remote kill

`shared/cache/session-store.js` (new) — indexes active sessions in Redis
on login (`session:active:<id>`, `session:user:<userId>` set), removed on
logout/kill. Postgres (`user_session`) stays the source of truth per
existing design; Redis is purely a fast index, best-effort like
`identity-cache.js` (an outage degrades to "index unavailable", never
breaks login/logout).

`session` module gained two actions generic CRUD doesn't cover:
- `GET /sessions/mine` — self-scoped, no MOD-68 grant needed, just
  authentication. Matches the RBAC journey doc's "Everyone... only their
  own sessions."
- `POST /sessions/:id/kill` — self-kill always allowed; killing someone
  else's session requires the MOD-68 `can_update` grant (or CEO). This is
  the concrete "own vs all" check that motivated part C's record-level
  scope work below, implemented ad hoc here rather than through the
  generic mechanism (session ownership isn't a `scopeColumn` in the same
  sense as entity/branch scoping).

Limitation worth flagging: killing a session blocks future **refreshes**
(checked in `app_user.service.js`'s `refresh()`); it does **not**
invalidate an already-issued access token, which is a stateless JWT valid
until its own (short, 15 min default) expiry. True instant revocation
would need access-token checks to consult a blocklist on every request —
not built, would add a Redis round-trip to every authenticated request for
a rarely-exercised path. Flagging the tradeoff rather than silently
shipping partial "remote kill" as if it were absolute.

### E — 2FA pending-token step-up (closes the `auth.service.js` TODO)

Decision taken (previously an explicit "needs a decision, not invented
here"): the pending-2FA token is a JWT signed with the same
`JWT_ACCESS_SECRET`, `typ:"2fa_pending"`, 5-minute TTL, `sub:userId`. It
carries no session — a session is only created once the TOTP code checks
out (`POST /auth/2fa/verify`).

This only works as a real security boundary because of a bug it exposed:
**`middleware/auth.js` didn't check the JWT `typ` claim at all.** A
refresh token (`typ:"refresh"`) could have been replayed as an access
token before this session; `platform-auth.js` already had the equivalent
check, the tenant side didn't. Fixed: `authMiddleware` now rejects any
`typ` other than `"access"`.

Also added, since `verifyTotp` would otherwise be unreachable — nothing
populated `totp_secret_enc` anywhere before this: `POST /auth/2fa/setup`
(generates+stores a secret, does NOT enable yet), `POST /auth/2fa/enable`
(requires proving one valid code first — can't lock yourself out by
fat-fingering enrollment), `POST /auth/2fa/disable`. Uses the existing
`otplib` dependency (already in `package.json`, unused until now) and
`services/encryption.service.js` for the secret at rest.

### F — Record-level scope: mechanism built, not yet adopted

`middleware/rbac.js`'s `requirePermission()` previously hardcoded
`req.permission_scope = "all"` with a comment saying scope wasn't
consulted. Now: `identity-cache.js` gained `getUserScopeIds()` (reads
`user_scope`, 30s-cached like grants); `requirePermission()` resolves
`req.scope_ids` — `null` if the user has no scope assignments (today's
behavior, unchanged, so tenants that never assigned scopes aren't
suddenly locked out) or an array if they do. `shared/crud/resource.js`'s
`makeRepo()` gained an opt-in `scopeColumn` config key: when set, `list()`
filters `WHERE <scopeColumn> = ANY(scope_ids)` whenever the caller has
scope_ids. **No existing module declares `scopeColumn` yet** — this wires
the plumbing end-to-end (verified working) but deciding which column
means "scope" on each of the 70 module tables is a real per-module call,
not something to bulk-guess in one pass.

### G — Restore from soft-delete

`audit_ledger` module (already MOD-69-gated from part A) gained the
maker-checker restore flow `WORK_TO_BE_DONE.md` flagged as entirely
missing:
- `GET /audit/soft-deletes` — open (unrestored) soft-deletes.
- `POST /audit/soft-deletes/:id/request-restore` — step 1, flags intent.
- `POST /audit/soft-deletes/:id/restore` — step 2, a **different** admin
  confirms (checked in the service layer for a clean 403, on top of the
  DB's own `CHECK (restored_by <> deleted_by)`).

New `shared/crud/entity-registry.js` resolves a `soft_delete.entity_ref`
prefix (e.g. `"iam_role"`) to its real table — necessary because those
strings don't reliably match table names (`iam_role.service.js` uses
`entity:"iam_role"` for table `role`; `corporate_entity.service.js` uses
`entity:"entity"` for table `corporate_entity`). Built by walking every
module's `*.service.js` and reading a `__entityMeta` that
`makeService()` now attaches (`{ entity, table, pk, activeColumn }`) —
derived from the actual code, not guessed. Verified against real modules
in the smoke test (`iam_role` → `{table:"role", pk:"role_id"}`, correctly
distinct from its entity string).

Restore behavior depends on whether the table has an `activeColumn`:
if yes, flips it back to `true`; if no (true of most modules —
`archive()` in `resource.js` only ever flips `activeColumn`, it never
actually removes the row), there was nothing hiding the record in the
first place, so marking the `soft_delete` row restored is the complete
fix. A defensive fallback re-inserts from `payload_json` if the row is
ever found missing outright — future-proofing, since nothing in this
codebase does a real `DELETE` today.

### Explicitly not done this session

- 30-min inactivity auto-logout (`SESSION_INACTIVITY_MIN` still
  unenforced).
- `Line Manager` capability wiring.
- Watch-the-Watcher consumer (events fire, nobody's notified).
- Permission-matrix seeding (item B below — blocked on a user decision,
  not started).
- Any frontend work.

### Item B — permission-matrix seeded

Mapped `doc/SmartLS_SuperAdmin_User_Journey_and_RBAC.docx`'s 18-row
role×module-group matrix onto the 70 `MOD-xx` catalogue codes, resolved
two real conflicts with the user, then wrote
`migrations/seeds/9021_seed_default_permissions.sql`.

**Conflicts found and how they were resolved (user's call, not mine):**
1. `MOD-67` is the only catalogue entry for **both** "IAM & user access"
   and "AI & event engine" (`feature_catalogue` ties
   `ai.assistant`/`ai.assistant.backend`/`ai.vectorization` to MOD-67 as a
   proxy — no distinct AI module_key exists). Contradictory grant
   patterns, and `permission` has `UNIQUE (role_id, module_key)` — can't
   seed both. **Resolved:** MOD-67 carries the IAM & user access pattern;
   the AI & event engine row is not seeded. When AI work starts for real
   (Phase 4), it should get its own module_key via migration rather than
   reusing MOD-67.
2. "Comms & portals admin" has no matching module_key at all — no
   `comms`/`portal` group_key in `platform.module_catalogue`; the one
   candidate, MOD-64, is already claimed by "Document vault & compliance"
   with a materially different (much more permissive) pattern.
   **Resolved:** not seeded. Revisit once comms/portals get a real
   catalogue entry.

**Also resolved while mapping** (non-blocking, no `permission`
UNIQUE-constraint conflict, just judgment calls): `MOD-01` (Corporate
Entities) → "Master data" row only, not also "Tenant/company setup";
`MOD-09` (Treasury Accounts) → "Master data" row only, not also "Finance &
treasury" — both driven by the catalogue's own `group_key: 'master'` on
those two modules. `MOD-63` (Reporting & Insights) and `MOD-00A`
(Dashboard) aren't covered by any of the doc's 18 rows at all — seeded
nowhere, flagged rather than guessed.

**The seed file:** 16 `INSERT INTO permission ... SELECT ... FROM role r
JOIN (VALUES ...) ... CROSS JOIN (VALUES ...) ... ON CONFLICT DO NOTHING`
blocks, one per matrix row actually seeded — same VALUES+JOIN idiom
`9020_seed_rbac_events.sql` already uses for `field_visibility`, not 393
individual literal rows. Covers all 11 default roles × 70 of 72 catalogue
module_keys.

Full role→module grant table (● full, ◑ create/edit, ○ view, ▲ approve,
– none — same legend as the source doc):

| Module group (source doc row) | MOD-xx codes | SA | CEO | MGT | FIN | ACC | SAL | OPS | WH | FLT | PRC | HR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tenant / company setup | 70 | ● | ○ | ○ | – | – | – | – | – | – | – | – |
| IAM & user access | 67, 68 | ● | ▲ | ○ | – | – | – | – | – | – | – | – |
| Master data & dictionary | 01, 03, 04, 05, 09, 10 | ● | ○ | ○ | ◑ | ● | ○ | ○ | – | – | – | – |
| Chart of accounts / tax | 06, 07, 08 | ● | ○ | ○ | ◑ | ● | – | – | – | – | – | – |
| HR & payroll | 02, 11–19 | ○ | ○ | ○ | ○ | – | – | – | – | – | – | ● |
| Sales & CRM | 20–26 | ○ | ○ | ▲ | ○ | – | ● | – | – | – | – | – |
| Commercial / pricing | 27, 28 | ○ | ○ | ▲ | ▲ | – | ◑ | – | – | – | – | – |
| Operations | 29–32 | ○ | ○ | ○ | ○ | – | – | ● | ○ | ○ | – | – |
| Warehouse (WMS) | 33–38 | ○ | ○ | ○ | – | – | – | ○ | ● | – | – | – |
| Fleet | 39–45 | ○ | ○ | ○ | ○ | – | – | ○ | – | ● | – | – |
| Ops costing | 46–49 | ○ | ○ | ▲ | ● | ○ | – | ◑ | – | – | – | – |
| Finance & treasury | 50–54 | ○ | ▲ | ▲ | ● | ● | – | – | – | – | – | – |
| Accounting / GL / statements | 55–59 | ○ | ○ | ○ | ○ | ● | – | – | – | – | – | – |
| Procurement | 60–62 | ○ | ○ | ▲ | ▲ | – | – | ○ | ○ | – | ● | – |
| Document vault & compliance | 64, 65, 66 | ● | ○ | ○ | ○ | ○ | ◑ | ◑ | ◑ | ◑ | ◑ | ◑ |
| Security / God Mode purge | 69, 00B | ○ | ● | – | – | – | – | – | – | – | – | – |
| ~~AI & event engine~~ | (MOD-67 conflict) | — not seeded, see above — |
| ~~Comms & portals admin~~ | (no module_key) | — not seeded, see above — |

**Not yet run against a real Postgres** — no `psql`/local DB in this
sandbox. Verified instead by: cross-checking every role code used against
`9020_seed_rbac_events.sql`'s actual `INSERT INTO role` (exact match,
11/11) and every `MOD-xx` used against `9100_seed_platform_catalogue.sql`
(exact match, 70/70, and confirmed the only two omissions are the two
intentionally-unmapped modules); a global parenthesis-balance check (273
open, 273 close); 16 `INSERT` statements, 16 `ON CONFLICT` clauses,
matching the 16 rows above. This is a reasonable substitute for a syntax
check but **is not the same as actually applying it** — run
`npm run db:migrate:tenants` (existing tenants) or a fresh `db:provision`
and log in as a non-CEO role before trusting this in anger.

## 2026-07-08 — Merge `security/auth` into `security/app_user`

**Phase:** 0 (Foundations) — Auth line item.

**What:** `src/modules/security/auth/` (login/refresh/logout, added in the
RBAC kickoff — see `doc/RBAC_SECURITY_KICKOFF.md`) and
`src/modules/security/app_user/` (the pre-existing generic CRUD module on
the `app_user` table) were two separate module directories both operating
on the same entity. Folded `auth/`'s six files into `app_user/`'s six files
one-for-one, per CONVENTIONS.md's module layout (`.repo/.service/.controller
/.routes/.validator/.events`), then deleted `security/auth/`.

**Why:** auth *is* app_user — login/session issuance reads and writes the
`app_user` table directly (`auth.repo.js`'s `findByEmail`,
`recordLoginSuccess/Failure` were already raw SQL against `app_user`, not a
separate table). Two module directories for one entity was incidental
history (auth was bolted on later in the RBAC kickoff), not a deliberate
split.

**How, per file:**
- `app_user.repo.js` — generic CRUD repo (`makeRepo`) spread together with
  auth's `findByEmail`/`recordLoginSuccess`/`recordLoginFailure`/
  `createSession`/`getActiveSession`/`touchSession`/`killSession`.
- `app_user.service.js` — generic CRUD service (`makeService`) spread
  together with `login`/`refresh`/`logout`, logic unchanged.
- `app_user.controller.js` — generic CRUD controller (`makeController`)
  spread together with the `login`/`refresh`/`logout` HTTP handlers.
- `app_user.routes.js` — **one router, two sub-routers**: `/users` (the
  existing CRUD router, unchanged, still ungated) and `/auth` (`login`/
  `refresh` public, `logout` behind `authMiddleware`, unchanged). Exported
  `basePath: "/"` so module-loader mounts both sub-paths at the tenant
  router root — external URLs are **unchanged**:
  `/api/tenant/users/*` and `/api/tenant/auth/*` both still resolve exactly
  as before. This was a deliberate choice (see options considered below) so
  nothing else in the codebase, and no already-documented client/curl
  usage, needed to change.
- `app_user.validator.js` — passthrough `create`/`update` (unchanged) plus
  the real Zod `login`/`refresh` schemas from `auth.validator.js`.
- `app_user.events.js` — both event sets merged into one file, keys
  untouched (`app_user.created/updated/archived` +
  `auth.login_succeeded/login_failed/logged_out/token_refreshed`). Confirmed
  via grep that no migration seed references either event-type-key set, so
  nothing depends on their exact spelling — left them as-is rather than
  renaming to `app_user.*` across the board, since "login succeeded" reads
  more clearly under an `auth.*` namespace than `app_user.*` regardless of
  which file it lives in.

**Explicitly out of scope for this change** (confirmed with the user
before starting):
- `app_user`'s CRUD routes (`/users/*`) remain **ungated** — no
  `authMiddleware`/`requirePermission`, same gap already flagged for
  `iam_role`/`session`/`audit_ledger`/`setting` in `WORK_TO_BE_DONE.md`.
  Gating `app_user` belongs with that same pass, not bundled into a pure
  file-reorganization change.
- No other Phase 0 items were touched this session.

**Verification:**
- Grepped the full repo for `security/auth`, `security\auth`, and
  `auth.(repo|service|controller|routes|validator|events)` before starting
  — zero references outside the auth module's own directory, confirming
  the merge would be self-contained (no other file requires those paths
  directly; everything goes through module-loader's auto-discovery).
- Grepped for `app_user.(repo|service|controller|routes|validator|events)`
  — only ever referenced from within `app_user/` itself, same story.
- Read back all six new `app_user/*.js` files after writing them and
  confirmed content/structure against the source files line-for-line.
- **Not done:** the shell sandbox was unavailable for the entire session
  (stuck on "still starting"), so `node --check` / `npm run lint` couldn't
  be run against the merged files, and `src/modules/security/auth/` could
  not be `rm -rf`'d programmatically. The user opted to delete that
  directory manually. **Follow-up for whoever picks this up next:** confirm
  `src/modules/security/auth/` is actually gone, and run `node --check` on
  the six `app_user/*.js` files (or just boot the app — module-loader logs
  a "skipped module (load error)" warning on any require() failure) before
  treating this as fully verified.

**Docs touched:** `doc/WORK_TO_BE_DONE.md` (path reference fixed on the
JWT access+refresh line), `doc/RBAC_SECURITY_KICKOFF.md` (append-only note
added below the historical "what this kickoff added" table — the table
itself was left as originally written).
