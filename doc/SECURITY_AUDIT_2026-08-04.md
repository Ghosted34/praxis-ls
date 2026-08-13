# Production Security Audit — Phase 0 (Findings & Roadmap)

**Date:** 2026-08-04
**Scope:** Full stack — `src/` (API, middleware, services, jobs, realtime), `client/`,
`platform-console/`, `migrations/`, `scripts/`, CI workflows, Docker/compose.
**Status:** AUDIT ONLY. No code changed. Nothing below is to be implemented before review and sign-off.
**Method:** The auth, RBAC and data-access paths were reverse-engineered from the code
(not assumed from convention) — every finding cites the file and line it was read from.
Route gating was verified by introspecting the live Express router stacks of all
**684 mounted tenant routes**, not by grepping.

> **Secret handling in this document:** the credentials found in the repo are referenced by
> file, line and type only. Their values are deliberately not reproduced here. Treat every one
> of them as compromised — see C1.

---

## 1. Existing security tooling — what is already there

Checked before assuming anything was missing.

| Control                                | State                                                                                                                                                    | Location                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency audit in CI                 | **Present but non-blocking** (`continue-on-error: true`, `--audit-level=high`)                                                                           | `.github/workflows/ci.yaml`                                                                                                               |
| Secret scanning in CI                  | **Present, but with an exclusion that voids it** — `':!doc/reference'`                                                                                   | `.github/workflows/ci.yaml`                                                                                                               |
| SAST (CodeQL/Semgrep/Snyk)             | **Absent** — no config anywhere in the repo                                                                                                              | —                                                                                                                                         |
| Dependabot / renovate                  | **Absent** — no `.github/dependabot.yml`                                                                                                                 | —                                                                                                                                         |
| Lint / syntax gate / Docker build gate | Present                                                                                                                                                  | `.github/workflows/ci.yaml`                                                                                                               |
| Production secret guard                | **Present and good** — refuses to boot with default JWT/encryption secrets, or with `JWT_ACCESS_SECRET == JWT_REFRESH_SECRET`, or an empty `DB_PASSWORD` | `src/config/env.js:213-232`                                                                                                               |
| Password strength policy               | **Present and good** — 12 chars, complexity, email-local-part check, HIBP k-anonymity range check                                                        | `src/shared/security/password-policy.js`                                                                                                  |
| Anonymous-surface test                 | Present but shallow — asserts `authMiddleware` appears _somewhere_ in each module router, not per route                                                  | `tests/unit/auth-coverage.test.js`                                                                                                        |
| Refresh-rotation test                  | Present                                                                                                                                                  | `tests/unit/auth-refresh-rotation.test.js`                                                                                                |
| Prior audit artefacts                  | Present and substantial                                                                                                                                  | `doc/PHASE0_PRODUCTION_AUDIT.md`, `doc/RBAC_SECURITY_KICKOFF.md`, `doc/PERMISSION_SWEEP_BACKLOG.md`, `doc/PHASE0_4_REAUDIT_2026-07-11.md` |

**Assessment.** The security _scaffolding_ here is better than average for a product at this
stage — Argon2id, AES-256-GCM, refresh rotation with reuse detection, an allow-listed media
mount, an explicit CORS allow-list, a boot-time insecure-secret guard. Several of the prior
audits' fixes are real and correctly implemented. The problems below are not "no security was
attempted"; they are **specific load-bearing gaps in otherwise deliberate designs**, plus one
category (C1) that is straightforwardly a live incident.

**Test coverage note:** 80 test files, of which **2** concern authentication and **0** concern
authorization or tenant isolation. There is no test that would fail if any finding below were
introduced tomorrow.

---

## 2. How the system actually works (reverse-engineered)

Establishing this first, because several findings only make sense against it.

**Tenancy is database-per-tenant, not row-level.** `hostTenantResolver`
(`src/middleware/host-tenent-resolver.js`) maps the `Host` header to a tenant via
`platform.subdomain`; `tenantContext` (`src/middleware/tenant-context.js`) then exposes
`req.tenantDb(fn)` and `req.identityDb(fn)`, which take a pooled connection to _that tenant's own
Postgres database_ (`src/services/tenant/registry.service.js:79-106`) with `search_path` bound to
the `live` or `sandbox` schema. **This is a genuinely strong isolation primitive** — there is no
shared table with a `tenant_id` column to forget a `WHERE` clause on. Provisioning
(`src/services/platform/provisioning.service.js`) creates each tenant DB fresh and runs the
migrations, so seeded roles/users get per-tenant `gen_random_uuid()` values rather than being
cloned from a template. **I found no path by which one tenant's business data is readable through
another tenant's session.** The isolation weaknesses listed below (M4, M5, M7) are defence-in-depth
gaps around that primitive, not breaches of it.

**Identity is pinned to the `live` schema regardless of the LIVE/TEST toggle**
(`src/middleware/tenant-context.js:28-30`) — flipping to sandbox never signs a user out.

**There are three separate, parallel auth tiers**, all signing with the _same_
`JWT_ACCESS_SECRET` and distinguished only by a `typ` claim:

| Tier            | Entry                                | Middleware                                          | `typ`                                | Session state                           |
| --------------- | ------------------------------------ | --------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| Tenant staff    | `POST /api/tenant/auth/login`        | `src/middleware/auth.js`                            | `access` / `refresh` / `2fa_pending` | `user_session` row + Redis index        |
| Praxis platform | `POST /api/platform/auth/login`      | `src/middleware/platform-auth.js`                   | `platform` / `platform_refresh`      | **stateless — none**                    |
| External portal | `POST /api/tenant/portal/auth/login` | `src/modules/portal_auth/portal_auth.middleware.js` | `portal`                             | stateless; grant re-checked per request |

**Authorization is entirely route-middleware-based.** `requirePermission(moduleKey, action)`
(`src/middleware/rbac.js:76`) resolves a role×module grant matrix; `requireCapability(code)` adds
the segregation-of-duties overlay (ISSUER/VALIDATOR/APPROVER/LINE_MANAGER); `requireCeo()` guards
God Mode. **No business service enforces permissions itself** — only 5 security-module services do
(`capability`, `field_visibility`, `permission`, `scope`, `session`). _Any path that calls a module
service without going through its route therefore has no authorization at all._ That fact is the
root of H1.

**Client (customer) isolation on the portal is correctly enforced.** `clientView` takes its
`clientId` from the server-side `portal_access` grant, never from the request
(`src/modules/portal_auth/portal_auth.controller.js:48`, `src/modules/portal/portal.service.js:74-76`),
and the grant is re-checked on every request rather than baked into the token
(`portal_auth.middleware.js:27-31`). The auditor ledger view uses an allow-list of event prefixes
so a newly-added sensitive event is excluded by default (`portal.service.js:29-35`). **This is well
built.** The residual issue is M3 (the password policy protecting those accounts), not the scoping.

---

## 3. Findings

Severity reflects exploitability _in this system_: who can reach it, what they need, and what it
costs the business or a client.

---

### CRITICAL

#### C1 — Live production credentials and employee PII committed to the repository, in the one path CI is told not to scan

**Files:**

- `doc/reference/legacy_codebase/administration/config/db.php:9` — production MySQL password
- `doc/reference/legacy_codebase/public_html/config/db.php:9` — same
- `doc/reference/legacy_codebase/public_html/smart-logistics/administration/config/db.php:9` — same
- `doc/reference/legacy_codebase/administration/view/admin/test_smtp_mail.php:19-20` — Office365 SMTP account + password for `no-reply@smartls.cm`
- `doc/reference/legacy_codebase/public_html/test_gemini.php:6`, `administration/api/praxis/command_engine.php:86`, `administration/api/success_story_api.php:69,98,144`, `administration/api/smart_quote_api.php:141,486` — Google Gemini and Groq API keys
- `.github/workflows/ci.yaml` — the secret-scan step excludes `doc/reference`
- `doc/reference/legacy_codebase/administration/administration/uploads/employee/documents/` — ~92 PDFs and images: employee **ID cards, CVs, taxpayer cards**, plus supplier taxpayer cards and employee avatars (1,287 files tracked under `doc/reference` in total)

**Severity: Critical.**

**Why this is worse than "old code in a folder".** The CI secret scan uses exactly the patterns
that would catch these (`AIza[0-9A-Za-z_-]{35}`, `gsk_[A-Za-z0-9]{40,}`) — and then excludes the
directory they live in. Running CI's own pattern against `doc/reference` returns seven hits. The
scan reports "No secret patterns found" on every build. The workflow comment even records that
these keys "had to be rotated" after the kickoff; the rotation was performed, but **the values were
never purged from the repository, and the scanner was configured to stop looking at them.** A
control that is documented as working, and does not, is more dangerous than no control.

**Attack scenario.** Anyone with read access to this repository — a contractor, a departing
employee, an integration with repo scope, or anyone at all if the repo is ever made public or a
fork leaks — clones it and harvests the credentials from git history without touching the running
system. The Gemini and Groq keys are billable and can be run up until quota exhaustion. The SMTP
account is the more damaging one: it sends as `no-reply@smartls.cm`, a domain the tenant's own
clients are trained to trust, from a mail server whose SPF/DKIM will authenticate it — so
invoice-redirection phishing against the logistics clients is indistinguishable from genuine mail.
The MySQL password is reusable against the legacy host and, if reused elsewhere (the same value
appears in three files, so reuse is the established habit), against current infrastructure.
Independently, the employee ID cards, CVs and taxpayer cards are third-party personal data with no
lawful basis for sitting in a source repository; that is a notifiable data-protection incident on
its own, separate from the credentials.

**Fix.** Treat all listed credentials as compromised and rotate them now, regardless of prior
rotation. Remove `doc/reference/legacy_codebase` from the working tree, and purge it from git
history (`git filter-repo`) — a delete-only commit leaves every value reachable. If the legacy
tree has ongoing reference value, move it to access-controlled storage with the PII and secrets
stripped. Delete the `':!doc/reference'` exclusion from the CI secret-scan step. Add a
pre-commit/pre-push secret scan (gitleaks or trufflehog) so the next one is caught before it lands.

---

#### C2 — Logout does not end the session; the refresh token stays valid

**Files:** `src/modules/security/app_user/app_user.controller.js:47-52`,
`src/modules/security/app_user/app_user.service.js:409-428`,
`src/modules/security/app_user/app_user.service.js:134-140`,
`client/src/app/auth/auth-context.tsx:207-226`

**Severity: Critical.**

**Mechanism.** The logout controller reads the session to end from the request body:

```js
service.logout(client, {
  actor: req.user,
  sessionId: req.body.session_id || null,
});
```

and the service only revokes when that value is present:

```js
if (sessionId) { await repo.killSession(...); await sessionStore.removeSession(...); }
```

The frontend calls `POST /auth/logout` **with no body at all**
(`auth-context.tsx:209`). So `sessionId` is `null`, the `if` is skipped, and the server never
kills the session. What actually runs is a 30-second cache invalidation and two audit writes —
then it returns `{ logged_out: true }`.

This is not merely an FE omission that a body would fix: **the client is structurally incapable of
supplying the value.** `issueSessionTokens` returns `access_token`, `refresh_token`, `token_type`,
`expires_in` and `user` — it never returns the `session_id` it just created
(`app_user.service.js:134-140`). There is no path by which the caller learns its own session id at
login, so the only branch that revokes anything is dead code on the real flow.

**Attack scenario.** A dispatcher signs in on a shared workstation in the warehouse office, works
a shift, and clicks Sign Out. The UI clears local storage and returns to the login screen — the
visible, trusted signal that the session is over. Server-side the `user_session` row remains
`killed_at IS NULL` and the refresh token remains valid for its full **30-day** TTL. Anyone who
obtained a copy of that refresh token — from the shared machine's storage before the clear, from a
browser profile backup, from a cross-site scripting payload that ran at any point during the shift,
or from a synced/roamed profile — can present it to `POST /auth/refresh` and be issued a fresh
access token, then keep rotating indefinitely. Every server-side revocation lever the system
otherwise has (remote kill, the idle timeout, rotation reuse detection) is bypassed, because none
of them ever fires: the session was never marked dead and `last_seen_at` is bumped on every
refresh, so the idle timer is continuously reset by the attacker's own traffic. The user believes
they logged out; the account is still live a month later.

**Fix.** Bind the session to the credential rather than to a request field: put `sid` in the access
token (as the refresh token already does, `app_user.service.js:82-88`) so `logout` can derive the
session from `req.user` and revoke unconditionally, with no body and no ownership question. Then
kill the session, remove it from the Redis index, and invalidate the identity cache. Also fix C2's
sibling defect noted in M2 below (`killSession` has no ownership predicate).

---

#### C3 — No brute-force protection on any authentication endpoint: rate limiting is absent and the failed-login counter is never enforced

**Files:** `src/modules/security/app_user/app_user.routes.js:20-21,52,62,70`,
`src/modules/security/app_user/app_user.repo.js:39-44`,
`src/modules/security/app_user/app_user.service.js:143-201`,
`src/modules/platform/platform.routes.js:18`,
`src/modules/portal_auth/portal_auth.routes.js:32`

**Severity: Critical.**

**Mechanism — two independent controls, both missing.**

_Rate limiting._ `express-rate-limit` is imported in exactly one file and applied to exactly two
routes — `forgot-password` (5/15min) and `reset-password` (10/15min). A repository-wide search for
`rateLimit` returns those two limiters and nothing else. Unlimited by consequence:

- `POST /api/tenant/auth/login`
- `POST /api/tenant/auth/2fa/verify`
- `POST /api/tenant/auth/pin/login`
- `POST /api/tenant/auth/refresh`
- `POST /api/platform/auth/login` ← controls **every tenant**
- `POST /api/tenant/portal/auth/login`
- `POST /api/tenant/portal/auth/accept`

There is no global limiter in `src/server.js`. `rate-limit-redis` is declared in
`package.json` but never imported, so even the two limiters that exist use the in-process memory
store — they reset on every deploy and are counted separately by the `api` and `api-standby`
containers.

_Account lockout._ `recordLoginFailure` increments `app_user.failed_logins`
(`app_user.repo.js:39-44`) and `login()` calls it on every failure. **Nothing ever reads that
column for an authorization decision.** Grepping `failed_logins` across `src/` returns only the
increment, the reset-to-zero on success, and its inclusion in the `SAFE_COLS` display projection.
The `LOCKED` status exists but is only ever set manually by an administrator through
`setStatus`. The counter is a display field, not a control. The portal tier has the identical
pattern (`portal_auth.repo.js:39`).

**Attack scenario.** An attacker enumerates staff email addresses — trivial for a logistics firm,
they are on the website, on invoices, in email footers — and runs offline-scale password guessing
against `POST /auth/login` online. Nothing counts, nothing slows down, nothing locks. The generic
error message correctly avoids revealing which half failed, but that only matters when guessing is
bounded, and here it isn't; the attacker simply guesses until something returns a token. The 2FA
tier does not save an account that falls: `verifyTotp` calls `recordLoginFailure` on a bad code and
then throws (`app_user.service.js:195-198`) — again with no counter enforcement and no limiter — so
a 6-digit TOTP can be attacked exhaustively inside the 5-minute pending window, and the window can
be renewed at will by re-running the password login the attacker now controls. **This makes 2FA
non-load-bearing.** The highest-value target is `POST /api/platform/auth/login`: a platform Root
Admin governs tenant provisioning, plans, features and the deploy-wide credential store for
_every_ tenant, that tier has no 2FA at all (it returns 501, `src/services/platform/auth.service.js:79-84`),
and its login is as unprotected as the rest.

**Fix.** Apply a Redis-backed limiter (`rate-limit-redis`, already a dependency) to every
authentication route across all three tiers, keyed on a trustworthy client identifier (see H5) and
on the submitted identifier, so one account cannot be attacked from rotating IPs. Enforce the
`failed_logins` counter that is already being maintained: progressive delay, then a temporary lock
with a defined auto-unlock, on both `app_user` and `portal_user`. Cap TOTP verification attempts
per pending token and invalidate the token when the cap is hit. Add a global fallback limiter in
`src/server.js`.

_(Enforcing lockout is user-visible — see Proposal P1 in §4.)_

---

### HIGH

#### H1 — The AI assistant executes business writes with no permission check at all

**Files:** `src/services/ai/orchestrator.service.js:319` (read path), `:410-430` (confirm path),
`src/services/ai/action-registry.js:1-11,23-70`,
`src/modules/ai/assistant/assistant.routes.js:9-19`

**Severity: High.**

**Mechanism.** The AI action catalogue carries a `required_permission` column, it is populated by
the registrar from each module's manifest (`src/services/ai/action-registrar.js:81,105,184`), and
it is even selected into the tool list at `orchestrator.service.js:149`. **It is never compared
against anything.** Both execution sites call the executor directly:

```js
const out = fn ? await fn({ client, user, payload }) : { error: "no executor" }; // :319
const result = await fn({ client, user, payload }); // :430
```

The executors then call module _services_ (`action-registry.js:26-70`). As established in §2,
authorization in this codebase lives exclusively in route middleware — services do not check
grants. `action-registry.js:2-4` states "Each calls a module SERVICE with the caller's client +
identity (module RBAC/audit applies)". The audit half is true; **the RBAC half is not.** The
assistant router itself carries only `authMiddleware` plus the tenant-wide
`ai.assistant.backend` feature flag — no `requirePermission`.

Ten write actions are reachable this way: `create_client`, `open_dossier`, `update_dossier`,
`transition_dossier`, `create_costing`, `draft_quotation`, `draft_final_invoice`,
`draft_purchase_order`, `draft_supplier_invoice`, `draft_cash_request`.

**Attack scenario.** A warehouse operator holds only WMS grants — no finance, no procurement, no
commercial. Through the chat assistant, in ordinary language, they ask for a supplier invoice and a
cash request to be drafted against a dossier. The orchestrator proposes the action, the operator
confirms it in the UI, and `confirmAction` runs the executor. `finalInvoice.createDraft` and
`cashRequest` services execute with `actor: user` — creating financial documents the operator could
not create through any screen or API route available to them, and which they are not authorized to
create at all. `transition_dossier` is the sharper edge: the HTTP route for that transition is
gated by `requireTransitionPermission` and, for decision states, by `requireCapability('APPROVER')`
(`src/shared/http/transition-permission.js`) — the segregation-of-duties layer the whole
maker-checker design rests on. The AI path calls `opsFile.transition` directly and consults neither.
So the assistant is a general-purpose bypass around both the module grant matrix and
segregation of duties, available to every authenticated user in any tenant with the AI feature on.
Every action is faithfully written to the immutable ledger, which means the audit trail will
accurately record an unauthorized financial action as having been performed — it does not prevent it.

**Fix.** Enforce `required_permission` in the orchestrator before invoking any executor — on the
read path at `:319` and the confirm path at `:410`, resolving the caller's grants through
`identityCache.getGrants` exactly as `requirePermission` does, with the same CEO bypass. For
transition actions, additionally resolve the per-target-state action and the APPROVER capability so
the AI path enforces the identical gate as the HTTP route. Fail closed: an action whose
`required_permission` is null must not execute. The longer-term structural fix is to move
authorization into the service layer so no future non-HTTP caller can miss it.

---

#### H2 — Platform Console credential-store routes have no capability gate

**File:** `src/modules/platform/platform.routes.js:84-95`

**Severity: High.**

**Mechanism.** Every route in this file carries `requireCap(...)` — `tenants.read`, `plans.write`,
`users.write`, `audit.read` and so on — **except these nine**, which carry only the router-level
`platformAuth`:

```
GET  /settings                          POST /settings/push/vapid/generate
GET  /settings/:section/:key            PUT  /settings/:section/:key
POST /settings/:section/:key/test
GET  /ai-vendors                        PUT  /ai-vendors/:vendor
POST /ai-vendors/:vendor/test
```

These manage the **deploy-wide** credential store shared by all tenants: the S3 object-storage
key, the Web-Push VAPID private key, and the AI vendor API keys
(`src/services/platform/settings.service.js:19-23`). The capability catalogue has no entry
covering them (`src/middleware/platform-auth.js:78-84`), so this is an omission rather than a
deliberately open surface. The consistency of the surrounding 40 routes is what makes it clear.

The read path is well built and does limit the damage: `redact()` returns presence and last-4 only,
and `resolve()` (which decrypts) is marked internal and is not wired to a route
(`settings.service.js:31-42,96-103`). So this is not a straight secret read. **The write path is
the exposure.**

**Attack scenario.** A junior platform operator is created with a narrow role — say support triage,
holding `support.read`/`support.write` and nothing else. Their token nonetheless passes all nine
routes above. They `PUT /settings/storage/s3` and replace the object-storage credentials with keys
for a bucket they control. `settingPut` explicitly resets the storage service cache so the change
takes effect immediately without a restart (`platform.controller.js:222`). From that moment every
document the platform writes — invoices, contracts, payslips, signed PDFs, for **every tenant** —
is written to the attacker's bucket, and `/media` presigns URLs against it. The same operator can
rotate the VAPID keypair (silently breaking push for all tenants) or replace AI vendor endpoints
and keys, routing every tenant's AI traffic — which carries business documents and client data —
through an endpoint of their choosing. Nothing in the console signals a privilege boundary was
crossed, because there was none.

**Fix.** Add capabilities for this surface (e.g. `settings.read` / `settings.write`) to
`CAP_CATALOGUE` and apply `requireCap` to all nine routes, writes gated more tightly than reads.
Root Admin continues to bypass, as elsewhere. Consider requiring re-authentication for a
credential-store write.

---

#### H3 — Request-body keys become SQL column identifiers on modules using the passthrough validator

**Files:** `src/shared/db/query-helpers.js:11-40`, `src/shared/crud/resource.js:57-58,169-175`,
`src/shared/http/validate.js`

**Severity: High.**

**Mechanism.** The shared SQL builders construct their column list from the caller's object keys:

```js
const keys = Object.keys(data);
const cols = keys.join(", ");
... `INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING ${returning}`   // insertOne
const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
... `UPDATE ${table} SET ${set} WHERE ${pk} = $1 ...`                            // updateOne
```

The file's header asserts _"Table/column names are always code-provided (never user input)"_. That
holds for modules with a zod validator — `z.object` strips unknown keys and the middleware
reassigns `req.body = p.data` — which is most of them, and is why this is High rather than
Critical. **It does not hold where the validator is `passthrough`**, which is a pair of no-op
middlewares (`src/shared/http/validate.js`). There, `makeController.create/update` passes `req.body`
through untouched (`resource.js:170,172`) into `insertOne`/`updateOne`.

Modules on `passthrough`: `security/iam_role`, `security/permission`, `security/capability`,
`security/scope`, `security/session`, `security/field_visibility`, `security/audit_ledger`,
`security/app_user`, `vault/document_vault`, `dashboard/*`.

Two distinct defects follow. **Mass assignment:** any column of the target table can be written,
not only the intended ones. **Identifier injection:** the keys are concatenated into the statement
without quoting or validation, so a key is a SQL fragment.

**Attack scenario.** A tenant IAM administrator holds MOD-67 `edit` — a legitimate, delegable
role that a mid-size logistics firm would give an office manager, and which is _not_ meant to
confer database access. `PATCH /api/tenant/sessions/:id` reaches `updateOne` against
`user_session` with an unfiltered body. Via mass assignment alone they can clear `killed_at` on a
revoked session — resurrecting an administrator's session that security staff believed they had
terminated — or repoint a session's `user_id`. Via the identifier path, the same request turns a
tenant-admin grant into arbitrary SQL execution on the tenant database under the application role:
reading `password_hash` and `totp_secret_enc` for every user in the tenant, rewriting the
`permission` grant matrix directly, or editing the `immutable_ledger` and `soft_delete` tables that
the audit trail depends on — which means the escalation can be performed and then erased. Because
the application connects to _every_ tenant database with the same role and password
(`registry.service.js:70-71`, and see M7), the blast radius of that database-level foothold is
bounded by what that role has been granted across the cluster, not by the tenant boundary the rest
of the architecture works hard to maintain.

**Fix.** Do not rely on callers to filter. In `insertOne`/`updateOne`, validate every key against a
strict identifier pattern and quote it, and — better — accept an explicit allow-list of writable
columns from the module config so mass assignment is closed independently of injection. Then
replace `passthrough` with real zod schemas on the ten modules listed, prioritising the security
modules (`session`, `iam_role`, `permission`, `app_user`) since those tables are the control plane.
Add a lint rule or test forbidding `passthrough` on any write route.

---

#### H4 — MOD-67 `edit` can take over any account, including the CEO, with no re-authentication

**Files:** `src/modules/security/app_user/app_user.routes.js:40-41`,
`src/modules/security/app_user/app_user.service.js:582-638`,
`src/modules/security/app_user/app_user.repo.js:178-184`

**Severity: High.**

**Mechanism.** Two routes, both gated on MOD-67 `edit`:

- `POST /users/:id/password` → `setPassword` — sets any user's password. It applies the strength
  policy and audits, but **does not require the actor's own password**, does not require the
  target's current password, and does not exclude privileged targets.
- `PATCH /users/:id` → `updateUser` — accepts `role_ids` and replaces the target's roles wholesale
  (`repo.setRoles` does `DELETE FROM user_role` then re-inserts). The only guard present is the
  _last-CEO_ check (`service.js:605-612`), which prevents removing the CEO role from the final CEO.
  **There is no guard against adding a role**, and none against acting on oneself.

`is_ceo` is derived from holding the role whose `code = 'CEO'`
(`src/shared/cache/identity-cache.js:70`), and CEO bypasses every `requirePermission`,
`requireCapability` and `requireCeo` check in the system (`rbac.js:88-92,146-150,178`).

**Attack scenario.** An office manager is given MOD-67 `edit` so they can onboard staff and reset
forgotten passwords — an entirely ordinary delegation. They issue a single `PATCH /users/{their own
id}` adding the CEO role to themselves. The identity cache is invalidated by the same call
(`service.js:615`), so on their very next request `is_ceo` is true and every authorization check in
the product returns early without consulting a grant. They now hold God Mode purge
(`requireCeo()`), the full grant matrix, all financial approvals, and the APPROVER capability that
maker-checker depends on. The alternative route is quieter: rather than elevate themselves, they
`POST /users/{CEO id}/password`, set a password they know, and sign in as the CEO — the audit trail
then attributes everything that follows to the CEO, and the only trace of the takeover is a single
`app_user.password_set` entry. Neither action requires knowing any existing password, and neither
triggers a step-up challenge.

**Fix.** Require re-authentication (password and, where enrolled, TOTP) for administrative password
sets and for role changes. Forbid a user from modifying their own `role_ids`, and require an
explicitly higher authority — CEO, or a dedicated capability — to grant or revoke the CEO role or
to reset a CEO's password. Notify the affected user and the CEO on both events, as the self-service
reset path already does (`service.js:520-528`). Consider separating "reset a password" from
"administer roles" into two grants, since they are given for different reasons.

---

#### H5 — Rate limiting is bypassable: `trust proxy: true` with an IP-keyed in-memory store

**Files:** `src/server.js:70`, `src/modules/security/app_user/app_user.routes.js:19-21`

**Severity: High.**

**Mechanism.** `app.set("trust proxy", true)` trusts _any_ number of proxy hops, so
`req.ip` is taken from the leftmost `X-Forwarded-For` entry — a header the client sets. The two
existing limiters key on `req.ip` by default, and use the in-process memory store because
`rate-limit-redis` is never wired up.

**Attack scenario.** The `forgot-password` limiter (5 per 15 minutes) and `reset-password` limiter
(10 per 15 minutes) are the only brute-force controls in the product. An attacker varying the
forwarded-for header on each request is counted as a new client every time, so both limits are
effectively unbounded — which turns `reset-password` into an unthrottled surface for guessing
reset tokens and `forgot-password` into an unthrottled mail-bombing and enumeration surface. Even
without header manipulation, the counters are per-process: with `api` and `api-standby` both live
(`docker-compose.yml:55,96`), the real limit is double the configured one, and every deploy resets
it to zero. The same defect will silently neuter the new limiters added for C3 if it is not fixed
first — which is why these two findings must ship together.

**Fix.** Set `trust proxy` to the actual hop count or the specific proxy address rather than
`true`, so `req.ip` reflects the real client. Move the limiters to the Redis store so they are
shared across instances and survive restarts. Where a limiter protects an account rather than a
network path, key it on the submitted identifier as well as the IP.

---

#### H6 — Portal and platform accounts are protected by an 8-character password with no complexity or breach check

**Files:** `src/modules/portal_auth/portal_auth.service.js:78,84,214-216`,
`src/modules/platform/platform.validator.js:29,41,50`

**Severity: High.**

**Mechanism.** The product has a strong, well-implemented password policy —
`passwordPolicy.assertStrongPassword` (12 chars, complexity, email-local-part rejection, HIBP
breach check). Staff `app_user` paths call it. **Two tiers never do:**

- **Portal users** (external client contacts, investors, auditors) get an inline
  `String(password).length < 8` check in three places — `createUser`, `setPassword`,
  `acceptInvite`. No complexity, no HIBP.
- **Platform users and tenant admins** created through the Platform Console are validated by zod
  as `z.string().min(8)` — `userCreate`, `userPassword`, and `admin` (which creates a **tenant
  administrator**).

**Attack scenario.** The weakness is inverted relative to privilege. A platform user administers
every tenant on the deployment; a tenant admin created via `POST /tenants/:slug/admin` typically
receives the CEO role. Both may hold an 8-character, uncomplicated, known-breached password —
`password` and `12345678` both pass. Combined with C3 (no rate limit, no lockout on
`/api/platform/auth/login`) and the absence of platform-tier 2FA, guessing a platform credential is
a matter of throughput. On the portal side, a client contact's account exposes that client's
dossiers, invoices and receivables ageing; a compromised auditor or investor grant exposes the
tenant's full financial statements and general-ledger trail. Those accounts belong to people
outside the organisation, on unmanaged devices, and are the ones most likely to reuse a breached
password — which is precisely the case the HIBP check exists to catch, and precisely where it is
not applied.

**Fix.** Route every password-setting path through `passwordPolicy.assertStrongPassword` — portal
`createUser`/`setPassword`/`acceptInvite`, and the platform `userCreate`/`userPassword`/`admin`
validators. The policy already fails open on an HIBP outage, so availability is unaffected.

_(This changes what passwords are accepted — see Proposal P2 in §4.)_

---

### MEDIUM

#### M1 — Access tokens are not session-bound: revocation does not revoke

**Files:** `src/middleware/auth.js:32-83`, `src/modules/security/app_user/app_user.service.js:76-80`

`signAccessToken` emits `{ sub, jti, typ }` with no session id, and `authMiddleware` verifies the
signature and loads the user but never checks that a session is still alive. Killing a session
(`/sessions/:id/kill`), hitting the idle timeout, or tripping refresh-reuse detection therefore
blocks the _next refresh_ but leaves any already-issued access token valid for its remaining TTL
(15 min default). The code documents this as an accepted trade-off, and at 15 minutes it is a
defensible one — but it means "revoke this session now" is not what the security screen implies,
and it is what makes C2 unrecoverable rather than merely wrong. Deactivating a user has a smaller
version of the same lag: the identity cache holds the auth projection for 30 s, though
`invalidateUser` is correctly called on status change. **Fix:** carry `sid` in the access token
(needed for C2 anyway) and have `authMiddleware` reject a killed session, using the Redis session
index to keep it to a cache hit.

#### M2 — `killSession` has no ownership predicate

**File:** `src/modules/security/app_user/app_user.repo.js:82-87`

```sql
UPDATE user_session SET killed_at = now(), killed_by = $2 WHERE session_id = $1 AND killed_at IS NULL
```

No `AND user_id = ...`. The dedicated `/sessions/:id/kill` route is properly guarded in the service
layer (`session.service.js:31-44` — self always allowed, others need MOD-68 `can_update`), but
`/auth/logout` calls this repo function with a body-supplied id and no such check
(`app_user.service.js:411`). Any authenticated user who learns a session id can terminate it. Ids
are UUIDs, but a holder of MOD-68 `view` can list them all. **Fix:** add the ownership predicate to
the repo function so it is safe at the lowest layer regardless of caller.

#### M3 — Document vault authorization is module-level, not record-level

**Files:** `src/modules/vault/document_vault/document_vault.routes.js:13-20`,
`document_vault.controller.js:11-16`

`GET /documents/:id/download` requires MOD-64 `view` and nothing else — no check that the caller
has any relationship to the document. The vault holds contracts, payslips, ID documents and signed
PDFs across HR, finance and operations. Anyone granted MOD-64 `view` for any legitimate reason can
enumerate and download every document in the tenant, including HR files about colleagues. The
`field_visibility` masking layer exists for _fields_ but has no document analogue. The gating
against the public `/media` mount is correct and well documented (`shared/http/media-guard.js`) —
the gap is the granularity behind it. **Fix:** scope downloads by the owning module's grant (the
pattern `document-templates` already implements via `moduleKeyForDocType`,
`src/modules/documents/template/template.routes.js:46-73`) plus record scope where applicable.

#### M4 — The Socket.IO handshake lets the client name its own tenant

**File:** `src/realtime/index.js:64-66`

```js
const host = String(auth.host || socket.handshake.headers.host || "");
```

Client-supplied `auth.host` takes precedence over the actual Host header, so a socket client
chooses which tenant its token is resolved against. Today this fails closed — the user id from
tenant A does not exist in tenant B's `app_user` table, so `getAuthUser` returns null — but the
isolation is resting on UUID non-collision rather than on a check. It would become exploitable the
moment any tenant database is restored, cloned or seeded from another (staging refreshes, support
copies). **Fix:** derive the tenant from the handshake headers only, matching the HTTP path.

#### M5 — One JWT secret across all three auth tiers, and no tenant claim in any token

**Files:** `src/config/env.js` (single `JWT_ACCESS_SECRET`),
`app_user.service.js:76-94`, `portal_auth.service.js:37-41`,
`src/services/platform/auth.service.js:34-40`

Staff access tokens, 2FA pending tokens, portal tokens and platform tokens are all signed with the
same key and separated only by a `typ` string claim. The `typ` checks are present and correct in
every verifier — this is a design the team clearly thought about, and the history in
`app_user.service.js:14-18` shows a real cross-type replay was already caught and fixed here. The
residual risk is structural: one secret compromise forfeits all three tiers at once, and one
missing `typ` check anywhere re-opens the class. Separately, no token carries a tenant claim, so
`authMiddleware` will happily resolve a tenant-A token against tenant B's database — again failing
closed only because UUIDs differ (same latent condition as M4). **Fix:** separate signing keys per
tier, and add `tid` (tenant id) to tenant and portal tokens with an equality check in the
middleware, so isolation is asserted rather than inferred.

#### M6 — Platform tier has no session store, no revocation and no 2FA

**File:** `src/services/platform/auth.service.js:1-13,79-84,100-125`

Platform tokens are stateless. There is no `platform_session` table, so there is no remote kill and
no rotation-reuse detection; the only revocation lever is deactivating the user, which takes effect
at the next refresh. The refresh TTL is the shared 30-day default. 2FA returns 501. This tier
administers every tenant. The file documents all of this honestly as a known trade-off — it is
listed here because the combination with C3 and H6 makes it the softest target with the widest
reach. **Fix:** add a platform session table with the same kill/rotation semantics as the tenant
tier, shorten the platform refresh TTL, and implement the 2FA step-up the column already anticipates.

#### M7 — One database credential and one encryption key shared across all tenants

**Files:** `src/services/tenant/registry.service.js:64-72`, `src/services/encryption.service.js:14-16`

Every tenant pool connects as `TENANT_DB_APP_ROLE || DB_USER` with `config.DB_PASSWORD` — the
inline comment (`"per-tenant secret resolved from secret store in prod"`) describes an intent that
is not implemented, and `platform.tenant_database.secret_ref` is populated at provisioning
(`provisioning.service.js:105`) but never read. Likewise `encryption.service` derives its key
solely from the global `ENCRYPTION_KEY`, so every tenant's TOTP secrets and vault credentials —
plus the platform-wide S3/VAPID/AI secrets — are encrypted under one key. Neither is a breach by
itself; both mean a single credential compromise (or a database-level foothold such as H3 provides)
is deployment-wide rather than tenant-scoped. **Fix:** issue per-tenant database roles and resolve
their passwords through `secret_ref`; move to per-tenant data keys wrapped by a master key, with a
rotation path.

#### M8 — CSP permits `unsafe-inline` scripts application-wide

**File:** `src/server.js:81-92`

`script-src` is relaxed to `'self' 'unsafe-inline'` and `script-src-attr` to `'unsafe-inline'`
globally, to support one feature — the Control Tower's iframe-rendered mock, which uses an inline
bridge script and inline `onclick` handlers. The comment records this and names the tightening path.
The consequence is that the primary XSS mitigation is disabled for the entire application,
including the login screen and every authenticated page — which matters more than usual here
because the refresh token lives in web storage (L3), so a single XSS yields 30 days of account
access. **Fix:** serve the Control Tower mock from its own route with a per-route CSP, or migrate
its handlers to `addEventListener`, then restore helmet's defaults for everything else.

#### M9 — Dependency vulnerabilities present, gate non-blocking, no SAST or Dependabot

**Files:** `.github/workflows/ci.yaml`, `package.json`

`npm audit` currently reports **9 vulnerabilities (5 high, 3 moderate, 1 low)** — including
`socket.io-parser` (memory-exhaustion DoS; socket.io is internet-facing here), `brace-expansion`
(unbounded expansion → OOM), `body-parser` (size enforcement silently disabled on an invalid limit)
and `uuid` via `exceljs`/`node-cron`. The `socket.io-parser` and `body-parser` fixes are available
without a breaking change. The CI step is `continue-on-error: true`; the comment reasons that a
blocking gate people learn to force past is worse than an honest report, which is fair as far as it
goes, but the practical result is that these have been visible and unaddressed. There is no SAST
and no Dependabot, so nothing tracks new advisories at all. **Fix:** apply the non-breaking fixes,
schedule the `exceljs` major deliberately, enable Dependabot, add CodeQL or Semgrep to CI, and
restore the audit gate to blocking once the tree is clean.

---

### LOW

- **L1 — Containers run as root.** `Dockerfile` defines no `USER`; both `runtime` and `worker`
  stages run as root, and the compose file bind-mounts `./data` (the document vault) into them.
  _Fix:_ add a non-root user and `chown` the writable paths.
- **L2 — Redis is unauthenticated and its keyspace is not tenant-namespaced.**
  `docker-compose.yml:20-32` sets no `requirepass` (loopback-bound, which is the mitigation).
  Identity-cache keys are bare UUIDs with no tenant prefix (`identity-cache.js:27-31`), and
  `invalidateGrants()` uses `redis.keys("identity:grants:*")` (`:279`) — a blocking O(N) scan that
  flushes every tenant's grants on any one tenant's permission edit. _Fix:_ set a Redis password,
  prefix keys per tenant, and replace `KEYS` with a maintained key set or `SCAN`.
- **L3 — Refresh token in web storage.** `client/src/lib/token-store.ts:10-13` documents this
  trade-off explicitly and funnels all access through one module so the swap is a one-file change.
  Its severity is coupled to M8 (`unsafe-inline` CSP) and C2 (the token is never revoked).
  _Fix:_ httpOnly-cookie refresh with CSRF protection, once M8 and C2 are closed.
- **L4 — Logger redaction has gaps.** `src/config/logger.js:22-36` redacts `*.password`, `*.token`,
  `*.secret`, `*.api_key`, `*.pin` — but pino path matching is literal, so `refresh_token`,
  `access_token`, `password_hash`, `totp_secret_enc` and `secret_enc` are **not** covered.
  _Fix:_ add those paths.
- **L5 — The anonymous-surface test is shallow.** `tests/unit/auth-coverage.test.js:6-14` returns
  true if `authMiddleware` appears anywhere in a module's router, so a router with one gated route
  and several ungated ones passes. _Fix:_ assert per route, with an explicit allow-list for the
  intentionally public ones (login, refresh, forgot/reset, 2FA verify, PIN login, branding,
  document-verification scan, mail OAuth callbacks).
- **L6 — `src/middleware/audit.js` is dead code** — never imported or mounted; auditing happens via
  per-service `audit()` calls. _Fix:_ delete it, or wire it, so it cannot be mistaken for an active
  control during a future review.

---

## 4. Behaviour-change proposals — require sign-off before implementation

Per the non-negotiable constraint, these are listed separately because closing the finding changes
something a real user would notice. **None of these is included in the roadmap phases below as an
automatic action** — each is gated on explicit approval.

**P1 — Account lockout after repeated failed logins (from C3).**
_Change:_ an account locks temporarily after N failed attempts. _Trade-off:_ a user who mistypes
their password repeatedly is locked out, generating support load; an attacker can also lock a known
account deliberately (denial of service against a named user). _Recommendation:_ progressive delay
first (invisible to normal users, effective against automation), with a temporary auto-unlocking
lock only at a high threshold. Rate limiting alone is a large improvement and is **not**
user-visible — that part should proceed without waiting on this decision.

**P2 — Applying the full password policy to portal and platform accounts (from H6).**
_Change:_ new and changed passwords on those tiers must meet 12 chars + complexity + not-breached.
_Trade-off:_ existing weak passwords keep working until next change unless a reset is forced;
external portal users will hit more rejections at invite-acceptance. _Recommendation:_ apply to all
new/changed passwords immediately; decide separately whether to force rotation of existing ones.

**P3 — Session-bound access tokens (from C2/M1).**
_Change:_ revocation becomes immediate rather than lagging by up to the access-token TTL.
_Trade-off:_ `authMiddleware` gains a session lookup on every request (mitigated by the existing
Redis session index); users whose session is killed are cut off mid-action rather than at next
refresh — which is the intent, but is a visible change. _Recommendation:_ proceed; this is the core
of the C2 fix.

**P4 — Re-authentication for administrative password and role changes (from H4).**
_Change:_ an admin must re-enter their password (and TOTP if enrolled) to reset another user's
password or change roles. _Trade-off:_ extra friction on a routine helpdesk action.
_Recommendation:_ proceed, with a short grace window so a batch of onboarding actions needs one
challenge rather than one per user.

**P5 — Shorter platform refresh TTL (from M6).**
_Change:_ platform admins re-authenticate more often than every 30 days. _Trade-off:_ mild
inconvenience for a small number of operators. _Recommendation:_ proceed.

**P6 — Enforcing `required_permission` on AI actions (from H1).**
_Change:_ users will start seeing the assistant decline actions it previously performed. This is
the vulnerability being closed, but to a user it will read as a regression, and some users may be
relying on it today. _Recommendation:_ proceed, and pair it with a clear denial message naming the
missing grant so the helpdesk can act. Worth an advance note to tenants.

---

## 5. Remediation roadmap — 5 phases

Sequenced by severity and blast radius: what hurts the business or a client most if left unfixed
goes first. Each phase is independently shippable and independently verifiable.

---

### Phase 1 — Contain the live exposure

**Addresses:** C1
**Why grouped / why first:** These are credentials that are already outside the trust boundary and
personal data already stored where it must not be. Every other finding requires an attacker to do
something; this one requires only that someone read a file they already have access to. It also
has no dependency on any other work, so it should not queue behind design decisions.

**Files/systems:** `doc/reference/legacy_codebase/**` (1,287 files), git history,
`.github/workflows/ci.yaml`, provider consoles (Google AI, Groq), Office365 mail admin, legacy
MySQL host.

**Deliverables**

1. Rotate the Gemini key, Groq key, `no-reply@smartls.cm` SMTP password, and the legacy MySQL
   password. Confirm the old values are rejected.
2. Remove `doc/reference/legacy_codebase` from the working tree; purge from history with
   `git filter-repo`; coordinate the force-push and re-clone with all contributors.
3. Relocate any genuinely needed reference material to access-controlled storage, with employee ID
   documents, CVs and taxpayer cards stripped.
4. Delete the `':!doc/reference'` exclusion from the CI secret-scan step.
5. Add a pre-commit secret scan (gitleaks/trufflehog) and enable GitHub push protection.
6. Notify whoever owns data-protection response about the employee-PII exposure — that decision is
   not the engineering team's to make alone.

**Verification**

- `git log --all -S'<rotated value>'` returns nothing after the purge, for each secret.
- CI's own secret-scan pattern run across the full tree (no exclusions) returns zero hits — this is
  the specific check that would have caught C1 and did not.
- A test commit containing a dummy `AIza…`-shaped string is blocked pre-commit **and** fails CI.
- Each rotated credential is confirmed rejected at its provider; the new values are in the secret
  store, not in the repo.
- `git ls-files doc/reference | wc -l` returns 0.

---

### Phase 2 — Make authentication hold

**Addresses:** C2, C3, H5, M1, M2
**Why grouped:** These are one story, not five. Logout does not revoke (C2) because access tokens
are not session-bound (M1); revocation cannot be trusted while `killSession` ignores ownership (M2);
and the brute-force controls added for C3 are worthless while `trust proxy: true` lets an attacker
mint a new rate-limit identity per request (H5). Shipping C3 before H5 would produce a control that
appears to work and does not — the exact failure mode of C1. They must land together.

**Files/systems:** `src/modules/security/app_user/{routes,controller,service,repo}.js`,
`src/middleware/auth.js`, `src/server.js`, `src/shared/cache/session-store.js`,
`src/modules/platform/platform.routes.js`, `src/modules/portal_auth/portal_auth.routes.js`,
`client/src/app/auth/auth-context.tsx`, `client/src/lib/token-store.ts`.

**Deliverables**

1. Add `sid` to the access token; have `authMiddleware` reject a killed session via the Redis
   session index (**P3**).
2. Rewrite `logout` to derive the session from `req.user` and revoke unconditionally — no request
   body involved.
3. Add `AND user_id = $3` to `repo.killSession`.
4. Correct `trust proxy` to the real hop count/proxy address; wire `rate-limit-redis` into the
   existing limiters.
5. Redis-backed limiters on every auth route across all three tiers, keyed on client identity _and_
   submitted identifier; global fallback limiter in `src/server.js`.
6. Cap TOTP attempts per pending token; invalidate the token at the cap.
7. Enforce `failed_logins` — progressive delay now; lockout only if **P1** is approved.

**Verification**

- Sign in, capture the refresh token, sign out, then present the refresh token: must return
  `SESSION_REVOKED`. _(Today it returns a fresh token pair — this is the regression test for C2.)_
- Sign in, kill the session from another device, then use the still-unexpired access token: must
  return 401 immediately, not after the TTL.
- Attempt to kill another user's session via `POST /auth/logout` with their session id: no rows
  affected; their session survives.
- Scripted failed logins from a single source: throttled as configured. Repeat with a rotating
  `X-Forwarded-For`: **still throttled** — this is the H5 regression test.
- Restart the API mid-run: the counter persists (Redis-backed). Repeat against `api-standby`: the
  same budget applies across both containers.
- Exhaust the TOTP attempt cap: the pending token is dead and re-login is required.
- New unit/integration tests for each of the above, in `tests/unit` and `tests/integration`.

---

### Phase 3 — Close the authorization bypasses

**Addresses:** H1, H2, H4, M3
**Why grouped:** All four are the same class — a privileged action reachable without the check that
was meant to guard it. They also share a verification method (attempt the action as an
under-privileged principal and confirm a 403), so one test harness covers them. Sequenced after
Phase 2 because a privilege-escalation fix is only meaningful once the sessions carrying those
privileges can actually be revoked.

**Files/systems:** `src/services/ai/orchestrator.service.js`, `src/services/ai/action-registry.js`,
`src/modules/platform/platform.routes.js`, `src/middleware/platform-auth.js`,
`src/modules/security/app_user/{routes,service}.js`,
`src/modules/vault/document_vault/document_vault.routes.js`.

**Deliverables**

1. Enforce `required_permission` in the orchestrator at both execution sites; resolve transition
   actions and the APPROVER capability for `transition_*`; fail closed on a null permission (**P6**).
2. Add `settings.read`/`settings.write` to `CAP_CATALOGUE`; apply `requireCap` to all nine
   ungated platform routes.
3. Re-authentication for admin password set and role change; block self-modification of own
   `role_ids`; require CEO/dedicated capability to grant the CEO role or reset a CEO's password;
   notify on both (**P4**).
4. Scope vault downloads by the owning module's grant, following the `moduleKeyForDocType` pattern
   already used by `document-templates`.

**Verification**

- As a user with WMS grants only, drive the assistant to `draft_supplier_invoice` and
  `draft_cash_request`: both denied with the missing grant named. _(Today both succeed.)_
- As a user with module `edit` but no APPROVER capability, drive `transition_dossier` to a decision
  state: denied — matching what the HTTP route returns for the same user.
- As a platform user holding only `support.read`, attempt `PUT /settings/storage/s3` and
  `PUT /ai-vendors/:vendor`: both 403. As Root Admin: both succeed.
- As a user with MOD-67 `edit`, attempt to add the CEO role to self: denied. Attempt to reset the
  CEO's password: denied. Reset an ordinary user's password without re-auth: challenged.
- As a user with MOD-64 `view` but no HR grant, download a payslip document: denied.
- Confirm every legitimate path still works: CEO retains full access; an admin with the correct
  grants completes each action after the re-auth challenge.

---

### Phase 4 — Close the injection and data-handling gaps

**Addresses:** H3, H6, M8, L4
**Why grouped:** These are input-and-output hygiene at the boundaries — what is accepted into a SQL
statement (H3), what is accepted as a password (H6), what the browser is allowed to execute (M8),
and what leaves in logs (L4). H3 and M8 both touch broad surfaces and want their own regression run,
which is why they are not bundled into Phase 3's narrower authorization work.

**Files/systems:** `src/shared/db/query-helpers.js`, `src/shared/crud/resource.js`, the ten
`*.validator.js` files on `passthrough`, `src/modules/portal_auth/portal_auth.service.js`,
`src/modules/platform/platform.validator.js`, `src/server.js` (helmet), `src/config/logger.js`,
Control Tower mock route.

**Deliverables**

1. Validate and quote identifiers in `insertOne`/`updateOne`; add an explicit writable-column
   allow-list to the repo config so mass assignment is closed independently of injection.
2. Replace `passthrough` with real zod schemas on all ten modules, security modules first
   (`session`, `iam_role`, `permission`, `app_user`); add a test forbidding `passthrough` on write
   routes.
3. Route portal and platform password paths through `passwordPolicy.assertStrongPassword` (**P2**).
4. Move the Control Tower mock to its own route with a scoped CSP; restore helmet defaults
   application-wide.
5. Add `refresh_token`, `access_token`, `password_hash`, `totp_secret_enc`, `secret_enc` to the
   logger redaction paths.

**Verification**

- Submit a body containing an unexpected key to each formerly-`passthrough` write route: the key is
  rejected or stripped, never reaches SQL, and the response is a clean 4xx.
- Attempt to clear `killed_at` via `PATCH /sessions/:id`: rejected. _(Today it succeeds.)_
- Attempt to set a weak/known-breached password on a portal invite-accept, a platform user create,
  and a tenant-admin create: all rejected with the policy message. Confirm the HIBP fail-open path
  still allows a strong password when the API is unreachable.
- Load every authenticated page with the browser console open: zero CSP violations on legitimate
  functionality, and `script-src` no longer contains `unsafe-inline` outside the mock route.
- Trigger a login, a refresh and a 2FA setup at debug log level: no token, hash or encrypted secret
  appears in the output.
- Full regression pass over the ten affected modules' CRUD screens — this phase has the highest
  chance of breaking working behaviour, so it needs the widest functional re-test.

---

### Phase 5 — Structural hardening and continuous assurance

**Addresses:** M4, M5, M6, M7, M9, L1, L2, L3, L5, L6
**Why grouped / why last:** Every item here is either defence-in-depth on an isolation boundary
that currently holds (M4, M5, M7), a trade-off the team already documented and accepted (M6, L3),
or tooling. None is independently exploitable today; all of them determine whether the system stays
secure once the acute findings are closed. Placing them last is a deliberate ordering by blast
radius, not a judgement that they are optional — M9 in particular is what prevents the next audit
from re-finding the same class of issue.

**Files/systems:** `src/realtime/index.js`, `src/config/env.js`, `src/middleware/auth.js`,
`src/services/platform/auth.service.js`, `src/services/tenant/registry.service.js`,
`src/services/encryption.service.js`, `Dockerfile`, `docker-compose.yml`,
`.github/workflows/ci.yaml`, `.github/dependabot.yml` (new), `client/src/lib/token-store.ts`,
`tests/unit/auth-coverage.test.js`.

**Deliverables**

1. Socket handshake derives the tenant from headers only (M4).
2. Separate signing keys per auth tier; add and verify a `tid` claim on tenant and portal tokens (M5).
3. Platform session table with kill/rotation semantics; shorter platform refresh TTL (**P5**);
   platform 2FA step-up (M6).
4. Per-tenant DB roles resolved through `secret_ref`; per-tenant data keys wrapped by a master key,
   with a rotation path (M7).
5. Apply the non-breaking `npm audit` fixes; schedule the `exceljs` major; enable Dependabot; add
   CodeQL/Semgrep; restore the audit gate to blocking (M9).
6. Non-root container user; `chown` the writable mounts (L1).
7. Redis password; tenant-prefixed cache keys; replace `KEYS` with `SCAN` or a maintained key set (L2).
8. httpOnly-cookie refresh with CSRF protection (L3) — only after Phase 4's CSP work lands.
9. Per-route auth assertions with an explicit public allow-list (L5); delete dead `middleware/audit.js` (L6).

**Verification**

- A socket handshake supplying `auth.host` for a different tenant resolves the tenant from the
  header and is refused.
- A tenant-A token presented to tenant-B's host is rejected on the `tid` mismatch — explicitly, not
  by UUID accident. Confirm by minting a test token with a colliding `sub`.
- A platform session killed from the console stops working immediately; platform 2FA is required
  at login.
- Each tenant connects with its own DB role: confirm role A cannot connect to tenant B's database.
- Key rotation exercised end to end on a staging tenant: existing ciphertexts still decrypt.
- `npm audit --audit-level=high` exits zero and the CI gate is blocking; Dependabot opens PRs;
  CodeQL reports on every PR.
- `docker compose exec api whoami` returns the non-root user; the app can still write `./data`.
- The hardened auth-coverage test fails when `authMiddleware` is removed from any single route —
  verified by temporarily removing one.

---

## 6. Summary

| Severity | Count | Findings                                                                                                                                                                                      |
| -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | 3     | C1 committed credentials + PII (CI scan excluded), C2 logout does not revoke, C3 no brute-force protection                                                                                    |
| High     | 6     | H1 AI bypasses RBAC, H2 platform credential store ungated, H3 body keys → SQL identifiers, H4 MOD-67 → CEO takeover, H5 rate limiting bypassable, H6 weak password policy on privileged tiers |
| Medium   | 9     | M1–M9                                                                                                                                                                                         |
| Low      | 6     | L1–L6                                                                                                                                                                                         |

**The two things worth saying plainly.** First, database-per-tenant is the right call and it is
working — I could not find a path from one tenant's session to another tenant's business data, and
the portal's per-client scoping is correctly enforced from the server-side grant rather than from
the request. That is the hardest thing to get right in a multi-tenant ERP, and it is right here.
Second, the recurring failure mode across C1, C2, H1 and H2 is not absent security thinking but
**controls that are documented as working and are not**: a secret scanner pointed away from the
secrets, a logout that returns `{ logged_out: true }` without logging anyone out, a
`required_permission` column that is read from the database and never compared to anything, and a
capability gate applied to 40 routes and omitted on the 9 that hold the infrastructure credentials.
That pattern is worth naming explicitly, because the fix for it is not more controls — it is a test
for each control that fails when the control stops working. Every phase above is specified with
that in mind, which is why each verification step re-runs the attack rather than confirming the
diff.

**Awaiting sign-off** on the findings, the phase ordering, and each of proposals P1–P6 before any
implementation begins.
