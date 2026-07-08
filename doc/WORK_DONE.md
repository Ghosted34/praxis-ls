# Praxis LS — Work Done Log

Running log of substantive changes landed against `doc/WORK_TO_BE_DONE.md`,
newest entry on top. Companion to that file: WORK_TO_BE_DONE.md is the
backlog (checkboxes get ticked in place), this file is the append-only
record of *what actually happened and why*, for anyone picking up context
later without re-reading every diff.

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
