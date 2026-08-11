# Praxis LS — Work Done Log

Running log of substantive changes landed against `doc/WORK_TO_BE_DONE.md`,
newest entry on top. Companion to that file: WORK_TO_BE_DONE.md is the
backlog (checkboxes get ticked in place), this file is the append-only
record of *what actually happened and why*, for anyone picking up context
later without re-reading every diff.

---

## 2026-08-02 — Session 19b: the approval engine made to enforce; the organigramme wired

**Parallel stream to session 19, merged the same day.** Reference document with file+line evidence:
`doc/ORGANOGRAMME_AUDIT_2026-08-02.md`. Test script: `doc/APPROVAL_VERIFICATION.md`. Follow-ups:
`doc/PERMISSION_SWEEP_BACKLOG.md`.

### What was actually wrong

The workflow engine was well designed and wired to nothing. `workflow_step` binds a step to a role, a
capability, **a scope** and an amount band — that scope reference is the organigramme link and it is the
right design. The executor honoured exactly one of the four: the amount. `createTask` discarded role and
scope; `executor.act` verified only that the task was still `PENDING`. **A chain routed notifications,
not authority.**

Three facts made it unenforceable rather than merely under-enforced:

1. The step designer collected `capability_code` and the amount band — the two fields the engine ignored
   — and had **no input** for `role_id` or `scope_id`, the ones it used. Every step built in the product
   was therefore assigned to nobody (`assigned_role_id` null) and notified nobody
   (`notify-approvals` opens with `if (!roleId) return 0`).
2. Every approvable document kept a direct approve route, **exposed as a button**
   (`features/procurement/pages.tsx` called `transitionPO(id, "APPROVED_LOCKED")` directly).
3. `user_scope` was read in one place (`identity-cache.js:127`) and **written nowhere in the codebase** —
   no endpoint, no UI, no script. So `req.scope_ids` was always null, every user was implicitly
   unrestricted, and the tree an admin could draw had no attachment point.

### The engine

- **`executor.act` now checks the actor**: the step's role must be held, the step's scope must fall inside
  the actor's closure, the capability must be held if the step names one, and the verb must match
  `step_kind`. Null on any of them = unrestricted, which is every step built before the pickers existed,
  so no existing tenant locks out.
- **Maker-checker, enforced for everyone including the CEO.** `notify-approvals` already resolved the
  requester — to decide whether to send a notification. The same comparison now decides whether the action
  is allowed. Deliberate departure from the CEO's RBAC bypass: SoD exists precisely so no single person
  completes a transaction alone. The product already enforces two-person integrity on *undeleting a row*
  (`CHECK (restored_by <> deleted_by)`) and did not on approving a payroll run.
- **Scope resolves as a closure** — `identity-cache.getUserScopeClosure`, a recursive walk down
  `parent_scope_id`, so authority flows downward. Raw `user_scope` rows would have made assigning a
  regional manager to HQ hide every branch from them, which is why the tree existed and never did anything.
  `middleware/rbac.js` uses the closure too, so record-level scope and approval eligibility agree.
- **`approval_task.module_key` (`0488`)** — approving anything required `approve` on **MOD-67, the IAM
  module**, which the default seed grants to CEO only. Now gated per task on the owning module
  (`modules/workflow/approval-permission.js`). Stored on the task rather than derived from the entity_ref
  prefix, so it cannot drift from `on-approved.js`'s handler map. Null falls back to MOD-67 — a task
  nobody can action is worse than one gated slightly too broadly.
- **`services/workflow/pending-guard.js`** — the seven direct transition routes 422 `APPROVAL_PENDING`
  while a task is live. Narrow on purpose: they refuse only while a chain is *pending*, so a document type
  with no bound workflow keeps a working path.
- **`W8` resolved by the guard, not by auto-finalising.** I implemented auto-finalise first and reverted
  it: for supplier invoices it posted to the general ledger because nobody had configured a workflow.
  Inferring authorisation from missing configuration is wrong. The reasoning is written into
  `purchase_order.service.js` where it will be found.
- **`0492`** (renumbered from 0487 in the merge) repairs the default workflows `0469` seeded and then
  swallowed with `EXCEPTION WHEN OTHERS THEN NULL`; it raises warnings and routes each event to the role
  that owns it. **`0491`** brings purchase requests into the engine — the only document with
  APPROVED/REJECTED states and an "Approved" KPI that never called `executor.start`.
- **Unknown amount now means most scrutiny.** `stepApplies` coerced null to 0, so a document with no total
  matched no min-bounded step and `start()` returned `autoApproved` — skipping approval entirely. Four
  callers legitimately pass null.

### The organigramme

- `user_scope` endpoints + assignment UI (`scope.members.js`), an **Organigramme** tab on Security →
  Scopes (`components/organigramme.tsx`) that flags nodes with nobody in them, and role/scope pickers on
  the step designer. `scope.validator` was `passthrough`; now shaped, with `assertNoCycle` — which matters
  because the tree is walked now.
- **Departments became scopes (`0490`).** "Department" had no table: free text in `employee`, `vacancy`
  and `purchase_request`, and `employees.repo` matched it with `=`, so "Operations"/"operations" were two
  departments each returning half the staff. `scope_id` added with the text kept as a display snapshot
  (the `0477` line-item pattern), one shared resolver (`shared/rbac/department-scope.js`), one shared
  picker, and the vacancy→employee hire path carries the reference instead of copying a typed string.
- **No FK on any of these scope references**, same reason as `0489`: `scope` is identity data pinned to
  LIVE while these tables are env data, so a declared FK resolves in the writing schema and rejects valid
  ids under TEST. Validated in code instead.

### Merge with the parallel session 19

Both streams enforced `depends_on` independently. **Theirs won.** Mine had two bugs my unit tests could
not see because they used synthetic data: `depends_on` is `citext[]`, which node-postgres returns as a raw
string (mine called `.find()` on it and would have thrown on every projection), and I set
`source: "dependency"`, which the `feature_state.source` CHECK forbids. Kept from mine: the log line
naming which features were forced off and by what — an unexplained "off" is one an operator will try to
toggle, fail to change, and report as a bug.

Their `requireCapability` call sites are audit finding **W7** solved from their side, and complementary to
the per-target-state permission map. Combined through `requireTransitionCapability`, so APPROVER is
demanded for decisions and **not** for submissions — which would have been the same bug one layer up.

### Four permission bugs, all found by testing as a non-CEO user

The CEO bypasses `requirePermission` entirely, so every route passes for whoever wrote it. One afternoon
as a Sales user found: the department picker gated on IAM; **every document View gated on MOD-70
Settings** (the viewer renders through the template Studio router, and session 16 put that button on ~20
screens); purchase-request **Submit** requiring `approve`, which under maker-checker means only an
approver can submit and is then forbidden from approving it; and the scope tree gated on IAM. Fixed, with
the class swept — seven more transition routes had the submit-as-approve shape
(`shared/http/transition-permission.js`).

Also: **the permission matrix was silently wiping grants.** `GET /permissions` paginates at 50; the matrix
loaded every role and module but only the first page of grants, so a cell below the cut rendered empty and
clicking one permission PUT an all-false row over whatever was stored. New `/permissions/matrix` returns
the set unpaginated.

### Other

- **`A5` — DELETE was a no-op across 32 modules.** `makeService` gained `deleteMode`; the five RBAC config
  tables really delete now (still writing `soft_delete`, so restore and maker-checker survive), and
  sessions return **405** pointing at `/sessions/:id/kill` rather than reporting a success that did nothing.
- **Screen registry 59 → 96.** It is the AI's map of the product and was missing all of Operations, Sales,
  Commercial, Costing, Procurement, Vault and AI Control.
- **20 silent frontend handlers now report.** `try {} finally {}` with no `catch` is how the
  milestone-advance 422 hid for weeks and how a 403 on Submit presented as "submit not working". A shared
  reporter plus a banner in the app shell made each retrofit one line; `lib/use-action.ts` is the better
  pattern for new code.
- **An audit finding was withdrawn.** C1 claimed `MOD-71` was uncatalogued and named the commit that
  "broke" it. False: `9120_hr_discipline_module.sql` adds it, committed alongside the modules. Four greps
  reported the file did not exist — the sandbox mount was hiding it. The correction and the
  re-verification of every other absence claim are in the audit document.

### B1 — the reporting line (`0493`)

`0490` answered *where* someone sits (branch / department, which is what approval routing needs). It did
not answer *who reports to whom*, and three things wanted that: `role.is_line_manager` is seeded as
"approves for own team" and nothing could resolve a team; escalation (W13) had nowhere to escalate to; and
an org chart of PEOPLE cannot be drawn from a reporting line that isn't recorded.

`employee.reports_to` with a **real** foreign key — unlike the scope references in 0489/0490 this points at
the same table in the same schema, so it is satisfiable under LIVE and TEST alike. `ON DELETE SET NULL`, so
deleting a manager orphans their reports rather than deleting them. Self-management is a DB CHECK (the
mistake a picker makes easiest); deeper loops are caught by a walk in the service, with a message that
names the person, because "cycle detected" tells an HR clerk nothing.

`directReports`, `teamOf` (recursive, depth-capped) and `managerChain` (nearest-first — the escalation
path). All masked like every other employee read, so a team list can't become a way around salary field
visibility.

**Not** added: a position/job catalogue. `job_title` remains free text with exactly the weakness
`department` had before 0490 — but that is master data with its own lifecycle and a separate decision.

### Auth — one live complaint, two defects

Full model and the traps: `doc/AUTH_SESSIONS.md`.

**The app never recovered from a failed refresh.** `api()` attempted one refresh on a 401 and, when that
failed, fell through and threw the 401 — no token clear, no state change, no redirect. The client went on
believing it was authenticated while holding a dead refresh token, so every subsequent action reproduced
the same error and the user sat on a "token expired" banner indefinitely. Only a manual sign-out cleared
it, which is precisely what was reported. The boot path in `auth-context` had always handled this
correctly; mid-session simply never got the same treatment. `endSession()` now clears tokens and dispatches
`SESSION_ENDED_EVENT`, which auth-context turns into `status: "anon"` — idempotent, so a page firing six
failing requests produces one transition rather than six.

The reported symptom ("logging out and back in fixes it") is the signature: a plain reload would have fixed
a merely-expired session, because the boot path recovers. Needing an explicit sign-out means the client
state was never reset.

**"Keep me signed in" didn't (`0494`).** The checkbox persisted the refresh token for 30 days; the server
killed any session idle for 30 minutes regardless. The promise and the enforcement disagreed and users got
the shorter one. Now recorded on `user_session.keep_signed_in` and honoured in `refresh()`. Rotation, reuse
detection, remote kill and the refresh TTL all still apply — a longer leash, not an exemption from
revocation. Sessions predating the column default to `false` rather than being silently upgraded.

Threading it exposed a trap worth remembering for any new auth field: **`zValidate` replaces `req.body`
with the parsed object and `z.object()` strips unknown keys**, so a field not declared in the schema is
dropped before the controller reads it. `keep_signed_in` had to be added to the login, 2FA-verify and
PIN-login schemas or the feature would have looked implemented and done nothing. Carried through the 2FA
step too, or ticking the box then completing TOTP would lose the choice.

**Knowingly left alone:** `last_seen_at` is written in exactly one place — `touchSession()` inside
`refresh()`. Ordinary authenticated requests never touch it, so the "inactivity" clock measures
time-since-last-refresh under a name that says otherwise. It is correct today only because
`JWT_ACCESS_TTL` (15m) is below `SESSION_INACTIVITY_MIN` (30), which forces a refresh well before the
window closes. **Raise the access TTL past the idle window and every non-keep-signed-in user is logged out
mid-work.** The proper fix touches every request in the system and wanted doing deliberately rather than at
the end of a long session; a startup assertion that refuses to boot on an inverted ratio is the cheap
interim guard.

### Tooling

`scripts/tenant/permission-report.js` — compares a tenant's grants against the seeded baseline, parsed out
of the seed files themselves so it cannot drift from what a fresh tenant gets, and reports MISSING or
REDUCED grants. Written because the matrix-pagination bug may have silently revoked grants and a
70-column grid is not something anyone audits by eye. Read-only.

**Migrations:** tenant `0488`–`0494`; seeds `9022` (grant gaps: MOD-00A, MOD-63, MOD-71, MOD-72) and
`9130` (MOD-72 mail catalogue entry).

**Owed:** `npm run build --prefix client` and `npm test` on Windows (~25 FE files changed after the last
green build; `tsc` does not complete on the sandbox mount), and a non-CEO click-through.

**Not done:** B2–B4 (no position table; `job_title` still free text), W13 (delegation, escalation,
deadlines — the DATA now exists via `managerChain`, the behaviour does not), C7 (`portal.*` gates the staff
preview but not the external surface), and the `last_seen_at` coupling described above.

---

## 2026-08-02 — Session 18: TEST-mode writes fully fixed (sandbox user mirroring moved to user create, not just wipe)

**Closes the one item session 17 left open — and a second hole nobody had spotted.**

**Recap of the collision** (full reasoning in `WORK_TO_BE_DONE.md`): identity is pinned to the LIVE schema
(`req.identityDb`, session 3) so the LIVE/TEST toggle stops logging people out, but business data writes
through `req.tenantDb` → the **sandbox** schema under TEST, and **60+ tenant columns are typed
`REFERENCES app_user(user_id)`**. A valid live user id stored beside sandbox business data raises **23503**,
usually AFTER the business row has committed — the user sees a record that exists and an error saying it
doesn't, then a duplicate-key error if they retry.

Session 17 fixed it by copying `live.app_user` into the rebuilt sandbox at the end of `wipeSandbox`. That is
correct but insufficient, because it mirrors at **one moment**:

1. **Fresh tenants** (known, flagged). Provisioning creates both schemas *before* `create-admin.js` makes any
   user, so the mirror has nothing to copy and the sandbox starts empty. The tenant's first TEST-mode write
   fails, and the remedy — wipe the sandbox — is deeply unintuitive for something that reads like a
   permissions error.
2. **Drift on established tenants** (NOT previously identified). The wipe mirror is a point-in-time snapshot,
   so **every user created afterwards was equally missing**: a hire onboarded months after the last wipe hits
   the identical 23503 on a system that has worked fine for everyone else. This was not hypothetical — the
   backfill found **2 such users on smartls**, i.e. the deployment was already in the broken state by a route
   the docs didn't describe.

**Fix — mirror at the source, on user create/update, not only on wipe.**

- **`src/shared/db/sandbox-user-mirror.js`** (new). `mirrorUsersIntoSandbox(client, {userId})` — one user or
  all — and `mirrorUserBestEffort(client, userId)` for the request path. Three decisions worth keeping:
  - **Schemas named explicitly** (`live.app_user` → `sandbox.app_user`) rather than relying on `search_path`,
    because callers arrive with it set to whatever they were already working in (live for the identity client,
    sandbox mid-wipe).
  - **`ON CONFLICT DO NOTHING` with no target**, deliberately: it must absorb a `user_id` clash (already
    mirrored) *and* an `email` clash (a stale sandbox row under a different id). The single-user path then
    verifies presence and **warns** — an email collision is the one case where "nothing inserted" still leaves
    the FK unsatisfied, and silent success there would be the worst outcome.
  - **`to_regclass` guard** so the mirror is a no-op mid-wipe or on an unmigrated database instead of erroring
    inside somebody's user-create request.
  - Carries the same column set as before: **no `employee_id`** (references `sandbox.employee`, which a wipe
    empties — would trade one 23503 for another), no `totp_secret_enc`, no `godmode_pin_hash`. Not a security
    widening: auth/sessions/RBAC all resolve against `req.identityDb`, so these rows are FK targets, not
    credentials.
- **Call sites:** `provisioning.wipeSandbox` (unchanged behaviour, now delegating), `provisioning.createAdmin`
  and `scripts/tenant/create-admin.js` (**this is what closes the fresh-tenant hole** — provisioning itself
  cannot, since no user exists yet), and `app_user.service` — `createUser` after COMMIT and best-effort (a
  sandbox problem must never roll back or fail a live user create), `updateUser` as a **self-heal** for
  pre-fix users, explicitly not a sync (the untargeted conflict means a renamed user keeps the old display
  name in sandbox; cosmetic, nothing reads it as authoritative).
- **`scripts/tenant/mirror-users.js`** (new) — `--slug=<x> | --all [--dry-run]` backfill for tenants
  provisioned before this existed. Idempotent, read-only against LIVE, counts what is missing before and after
  and names anything it could not mirror rather than reporting success.
- **Wired into the deploy path.** `migrateTenant()` now mirrors after `projectFeatures()`, so
  `scripts/deploy.sh`'s migrate service (platform + all tenants, every deploy) self-heals drift on **every
  environment** rather than depending on someone remembering the script. Idempotent — inserts nothing on a
  healthy tenant. **Best-effort:** a deploy must not fail over sandbox convenience data, so a failure logs at
  error level and the script re-runs it on demand.
- **`tests/unit/sandbox-user-mirror.test.js`** — nine cases, guarding the three decisions above plus "the
  best-effort wrapper never throws".

**Verified 2026-08-02 (user-run on Windows — the sandbox VM again failed to start, so nothing ran in-session):**
`npm run lint` + `npm test` clean; `mirror-users.js --all` reported `smartls: mirrored 2 of 2 missing user(s)`
with no collisions; and a TEST-mode write with a real actor confirmed working in the UI — **the first time
TEST mode has been writable since session 3.**

**Docs:** the "⚠️ STILL OPEN" banners in `WORK_TO_BE_DONE.md` and `SESSION_HANDOFF.md` are now closed, with the
drift hole written up since it was never recorded.

### Also session 18 — AI conversation memory no longer forgets, and /media is safe under S3

**1. Rolling conversation summary (`0481_ai_conversation_summary.sql`).** Session 17's memory capped replay at
`HISTORY_TURNS = 20` to keep per-call cost flat against a hard-capped AI budget. The flagged consequence:
turn 21 didn't fade, it **vanished** — worse than no memory, because the assistant had already taught the
user to expect recall. Now everything that scrolls out of the window is folded into one rolling summary on
`ai_conversation` (`summary`, `summary_through`, `summary_at`):

- **Replaced, never appended** — an appended summary grows without bound and recreates the cost problem the
  window exists to solve. Capped at ~200 words, regenerated from the previous summary plus the new batch.
- **Batched at 10** (`SUMMARY_BATCH`). Regenerating every turn would mean a second model call per question,
  roughly doubling the cost of a long thread. The price is a bounded **gap**: up to nine messages can sit
  outside both the window and the summary until the next batch absorbs them. Written down rather than
  discovered.
- **Runs before the model call**, so the current answer benefits from the summary just written.
- `summary_through` advances only after a successful write, so a failed batch retries cleanly and cannot skip
  or double-count. Redacted on the way in like every other egress path. Recorded against the tenant's AI
  budget with `call_type = 'summary'` — it is real spend, and hiding it would make the cap lie.
- Rides as a **system** message ("EARLIER IN THIS CONVERSATION…"), not a fake assistant turn, so the model
  doesn't quote it back as its own words.

**2. `/media` under S3 — a hole that would have opened on switch-over day.** The 08-01 guard was local-driver
only. Two findings on inspection:

- The gated download route was **already correct** for s3 — `document_vault.service:71` streams via
  `storage.get`, so permission is checked server-side either way. The exposure was elsewhere.
- **`storage.publicUrl` minted a direct path-style bucket URL for ANY key**, including vault artefacts —
  `pdf.service.renderAndStore` passes every rendered PDF through it. Persisting that value is exactly how a
  confidential document acquires a shareable link that bypasses `requirePermission`. Same hole as the flat
  mount, one layer along.

Fixed in code rather than by bucket policy: `publicUrl` now returns `/media/<key>` for everything (CDN only
for public keys), so no direct object URL is ever minted or stored; `/media` is mounted under **both** drivers
with the same allow-list, answering a permitted key under s3 with a **302 to a 5-minute presigned URL**
instead of a file. Net effect: **the bucket needs no public-read at all**, the rule lives in code instead of
in a policy someone must re-apply per environment, and a stored URL survives a local→s3 migration (a bucket
URL in the database would not). New `isPublicStorageKey()` shares one implementation with the URL form, so a
key and its `/media` path can never disagree about whether something is public.

**Tests:** `tests/unit/ai-conversation-summary.test.js` (batch boundaries, resume watermark, replace-not-append)
and new cases in `media-guard.test.js` (key/path agreement, and a regression guard that `publicUrl` never
returns an absolute URL for a private key). **`0481` applied and Windows validators green (user-run).**

### Also session 18 — the external CLIENT PORTAL, first external user who can actually sign in

**The gap.** `portal_access` (0340) grants by **email**; `portal_user` (0460) holds the credentials; and
nothing ever connected them. `POST /portal/users` existed with **no caller**, so every grant ever issued
pointed at somebody with no password — access granted, nobody able to use it. Third instance of this exact
shape after service types (session 17) and milestone templates: a complete backend with no route in.

**`0482_portal_invite.sql`** — one-time tokens for external users, mirroring `password_reset` (0471):
SHA-256 hash only (a database read cannot mint a working link), single-use via `used_at`, one live token per
user. `purpose` splits INVITE from RESET because they need **different lifetimes** — an invite goes to someone
who has never heard of the system and may open it days later (7 days), a reset is requested by someone at the
screen (30 minutes). A 30-minute invite would expire on most recipients and land as support load on the tenant.

**Backend** (`portal_auth`): `inviteUser` (create-or-find + email the link), `requestReset` (public, always
200 — no account enumeration), `acceptInvite` (consumes the token and **signs them straight in**: they have
just proved control of the mailbox, so bouncing them to a login form is friction for no security gain).
New routes `POST /portal/auth/forgot`, `POST /portal/auth/accept`, `POST /portal/users/invite`. A new login
gets a **random unusable password** — `password_hash` is NOT NULL and nobody, staff included, should know a
value that lets them sign in as an external party. Invite emails carry the **tenant's** name, resolved from
branding: an external contact has no idea what "Praxis LS" is, and an unattributed mail reads as phishing.

**Frontend** — `features/portal/portal-app.tsx` + `lib/portal-api.ts`:
- Mounted at **`/client-portal`, NOT `/portal`** — the staff grant screen already owns `/portal/access`.
  React Router would likely rank the static path above a splat and keep them apart, but an authentication
  boundary should not depend on route-scoring subtleties; one nested route added later and an external user
  is looking at a staff screen.
- Outside `RequireAuth` and `AppShell`. Its **own** token store and fetch client, deliberately not a flag on
  `api-client.ts`: sharing would mean sharing the staff refresh-on-401 path, and the first bug in that seam is
  a portal token reaching a staff endpoint or a staff session being clobbered by a client contact on the same
  browser. **sessionStorage, no "remember me"** — these sessions are opened on borrowed machines and the data
  behind them is somebody's commercial position.
- Screens: sign in, forgot-password, set-password (invite + reset both land here), and a home showing
  shipments and invoices from `GET /portal/client`. A login with no usable grant gets an explicit "no active
  access" rather than empty tables, which would read as "you have no shipments".

**Staff side** — the grant modal now creates the login too (on by default, with the reason stated in the UI),
sent as a **separate non-fatal step** so an SMTP outage can't roll back the grant; a partial failure holds the
modal open and says so. Grant rows show **"no sign-in"** or **"invited"** badges, last-sign-in date, and a
Create-sign-in / Resend action. Logins are matched to grants **client-side**: `portal_access` is
per-environment business data while `portal_user` is identity (live) data, and a cross-schema join is exactly
the trap that broke TEST-mode writes for fourteen sessions.

**Investor terminal — built the same session (PRD §5.2).** `investorView` was two reports; the catalogue
already held the rest, so it now returns **income statement + bilan + cash position + TAFIRE cash-flow** plus
a KPI block (revenue, net result, cash on hand, balance-sheet total). Three decisions worth keeping:

- **A default period was mandatory, not a nicety.** The statement producers take optional `from`/`to` and,
  given neither, sum the ENTIRE validated ledger — inception-to-date. That is a defensible trial balance and a
  meaningless income statement, where "revenue" is every franc ever billed, growing forever, comparable to
  nothing. Defaults to the current calendar year; explicit `?from`/`?to` still wins.
- **KPIs are derived from the statements already fetched** — no extra query and, more importantly, no second
  definition of "revenue" that could drift from the Compte de résultat sitting beside it on the same screen.
- **No operational detail** (no dossiers, no clients, no per-shipment margin) — that boundary is the point of
  the tier, so it is enforced by what the service fetches rather than by what the UI renders. Payload carries
  `basis: "OHADA"` because PRD open question 4 (true IFRS view vs KPIs) is still unanswered, and nothing
  downstream should assume otherwise.

FE: a KPI strip plus Compte de résultat / Bilan / Cash position panels. An **unbalanced bilan is shown, not
hidden** — it means the books need attention, and rendering it as final would be the worse failure. A login
holding both grants gets a Shipments/Financials switch rather than a guess.

**Still not built: the auditor room.** `auditorView` returns procurement spend plus a literal note that it
"reuses vault + audit ledger + reporting". The pieces exist (`security/audit_ledger` over the immutable
ledger, vault download + verification, time-boxing via `portal_access.expires_at`), but the blocker is a
**policy** decision, not code: the ledger carries staff names, HR events and every permission change, and
composing that for an external party needs someone to define scope first. A portal login holding only an
auditor grant is told the room isn't open rather than shown one report dressed up as a portal.

**Verified in-sandbox** (the VM came back mid-session): all touched backend files `node --check` clean,
`eslint` **0 errors** (two pre-existing warnings untouched), client `tsc -b --force` **clean**. `jest` still
would not run in-sandbox. **`0482` applied and Windows validators green (user-run).**

**Owed before this is usable by a real external party** — none of it is code:
1. **SMTP must be configured for the tenant**, or invites fail silently from the recipient's point of view.
   The UI reports it ("Login ready … but the email could not be sent") and Resend exists, but nobody sees that
   message unless staff read it.
2. **A click-through**: grant access to a real address → invite arrives → set a password → confirm the portal
   shows that client's dossiers **and nobody else's**. The scoping is `portal_access.client_id`, enforced
   server-side in `portalAuth("CLIENT")`, and it is the one thing worth proving by hand.
3. The three `portal.*` feature flags gate the data views (`portal.client` / `portal.investor` /
   `portal.audit`) on the STAFF preview path. Confirm they are on for the tenant, or previews 403 while the
   external view works — a confusing split to debug later.

---

## 2026-08-01 — Session 17: Control Tower map made real (geo_place + Geoapify forward geocoding), `/media` bypass closed, milestone auto-seeding, AI conversation memory, doc-truth audit

**Repo audit first — several backlog statuses had rotted.** Verified against source, not against the docs.
Found **already built** and marked `[ ]`/"deferred": payroll compute + auto-posted journal
(`hr/payroll/payroll.service.js`, posts 661/664 ⇄ 431/447/422), asset acquisition→depreciation→disposal
(`finance/asset/`, full 7-file module), `approval_task` auto-creation (`shared/events/emit.js:79` →
`services/workflow/executor.start()`), `notification.list()` self-scoping, the auth-gated vault download,
the AI spend dashboard, the Help centre, HR onboarding/succession, the LIVE/TEST toggle, the platform
console. All flipped in `WORK_TO_BE_DONE.md` with file-level evidence. **Confirmed still open:**
`scopeColumn` has no adopters (no business table has a scope column), `requireCapability` has zero call
sites, `depends_on` is never consulted by `projectFeatures()`, the Live self-grant block, xlsx/csv report
export (validator accepts them, only `pdf-render.js` exists), factory languages, external portal FE.

**Control Tower — the live-shipments panel was showing less than the backend already sent.** `toLiveShipment`
read `s.route ?? s.lane`; the payload has always carried `origin`/`destination` (`dossier.pol`/`pod`), so
`from`/`to` were empty on every row and the list rendered a bare "→". ETA went in raw
(`2026-07-16T23:00:00.000Z`) — now `dateFmt`. `prog` fell through `|| 45` to a literal 45 for every row
because no progress field was ever sent — the repo now derives it from `milestone_instance` using the SAME
correlated subqueries as `operations_file.repo.js:32-34`, so the bar and the Operations list can't disagree,
and sends **null** (bar hides) when a dossier has no chain: "not tracked" ≠ "not started". Status pill
`enumLabel`'d. Mode now comes from `service_type.key`, not text sniffing — `HINTERLAND_TRANSIT` has no
vessel and two ordinary city names, so the road corridor was drawing as a shipping lane.

**The map is real.** It was hand-drawn artwork: a stylised Cameroon+Chad landmass, three hardcoded lanes,
edge tags reading "ANTWERP"/"PARIS CDG" pointing at nothing. Nothing in the schema mapped a place name to a
coordinate — the only lat/long columns were the HR geofence ones (`0465`), which hold the tenant's own
offices, not ports. New **`0478_geo_place.sql`**: `query_key` (normalised: case/accents/apostrophes folded,
so `N'Djamena`/`Ndjamena`/`NDJAMENA` collapse to one row) + name/country/kind/lat/long/`source`, seeded with
24 places. New `operations/geo_place/` module (repo+service+controller+routes+validator+events, rides
**MOD-29** — a module_key absent from the catalogue has no grants, so a new key would deny every non-CEO).
`geoapify.service` gained **`forwardGeocode`** (`/v1/geocode/search`) mirroring the existing reverse call —
the integration was reverse-only and consumed solely by HR clock-in. Resolution is cache-first, writes misses
back, sequential (a burst trips the 3,000/day free tier). FE rebuilt onto **Natural Earth 110m**
(`world-atlas` + `topojson-client`, new client deps) projected equirectangular in the PARENT and handed to
the iframe as SVG path strings — the iframe can't import modules, and doing the fit once means land /
graticule / lanes / nodes can't drift onto different projections. Auto-fits the viewport, fans clustered
lanes to alternate sides, nudges colliding labels with leader lines. **`0479_dossier_place_refs.sql`** adds
`pol_place_id`/`pod_place_id`; the form's two bare `<Input>`s became `SearchSelect` pickers (free-text
fallback kept), and ports now resolve **at dossier save** — previously resolution only ran when the map
rendered, so a port on a dossier nobody viewed was never catalogued, and the dossier was never linked to the
row its own text had just created.

**`/media` bypass closed.** `express.static` was mounted over the whole storage root — which also holds
`tenant_<slug>/vault/…`, so the gated `GET /documents/:id/download` could be walked around by anyone who
knew a key. New `shared/http/media-guard.js`: deny-by-default allow-list (`branding`/`login`/`entity`/
`avatars` stay public — the logo and login background must load pre-auth), traversal rejected explicitly
(`tenant_x/branding/../vault/doc.pdf` never leaves the root, so a second-segment check alone would pass it),
404 not 403 so a probe can't distinguish protected from absent. `tests/unit/media-guard.test.js`.

**Branding stopped being per-environment.** It read through the env-scoped `req.tenantDb`, so appearance was
stored twice and `DROP SCHEMA sandbox CASCADE` destroyed the TEST copy on every wipe — while a LIVE copy was
invisible in TEST. Now **live is the base, sandbox may override**: reads take live and overlay only values
sandbox explicitly sets; writes go to the current env. Keeps palette experiments possible, makes the wipe
discard only a deliberate experiment. Also: the appearance editor rendered every unset token as `#000000`,
and Save posts what the inputs hold — one click would have written black as the brand palette. Fallbacks are
now the real `index.css` values.

**Milestones.** Instantiation was manual and, in practice, never done — the sandbox seed did it for one
dossier in five and no screen ever called `POST /milestones/instantiate`. Now auto-seeded on dossier create,
after the transaction commits (`milestone.instantiate` opens its own `BEGIN/COMMIT`; nesting would close
ours) and best-effort, so no template never blocks a create. `instantiateMilestones()` added as the escape
hatch for dossiers predating their template. Seed extended: templates for the **air** and **hinterland
transit** service types (only sea had one, so those dossiers couldn't be instantiated at all) and chains on
all five dossiers at 40/100/20/60/0% — 0% deliberately proves a real zero renders a bar where a missing
chain renders none. **Found:** `advanceMilestone` never sent the required `to`, so every advance from the UI
had been returning 422.

**AI conversation memory.** `ai_conversation`/`ai_message` have existed since `0400_ai.sql` and nothing ever
wrote to them — `orchestrator.ask` built `[system, user]` every call, so each question was the model's first.
Now: one rolling thread per user (resolved server-side), last 20 messages replayed, everything stored
indefinitely. History is redacted on replay like live input, saved *after* the model call (no orphan question
with no answer), and best-effort throughout. `GET /ai/history` + `POST /ai/history/clear` (clear starts a new
thread rather than deleting — `ai_action_run` references `conversation_id`). Executed actions now append a
factual assistant note, so the assistant knows what it *did*, not only what it proposed. Also fixed: action
runs recorded `conversation_id` from a request field the copilot never sent, so every one was orphaned.

**CI.** `npm audit --audit-level=high`, a secret scan, a **duplicate-migration-number guard**
(`scripts/db/check-migration-numbers.js` — `0470` and `0475` collide today; both are grandfathered because
renaming an APPLIED migration makes the filename-keyed migrator re-run it, and 23 tenant files use a bare
`CREATE TRIGGER` that fails `42710` on a second run), and a **frontend job** building `client` +
`platform-console`, neither of which CI had ever built.

**Second half — the fresh-tenant walkthrough.** Ran the full sequence against a deliberately **wiped**
sandbox to test whether a new tenant can configure itself through the app. It could not, and the attempt
produced most of what follows.

**TEST-mode writes had been broken since session 3 — the session's biggest finding.** Identity is pinned to
the LIVE schema (`req.identityDb`); business data writes through `req.tenantDb`, which under TEST is the
sandbox schema. **60+ tenant columns are typed `REFERENCES app_user(user_id)`** — `issued_by`, `approved_by`,
`requested_by`, `counted_by`, `moved_by`, `completed_by`, `actor_user_id`, `deleted_by`… so a valid live user
id stored beside sandbox business data raises **23503**, usually AFTER the business row committed (most
services have no surrounding transaction). The user sees a record that exists and an error saying it doesn't.
Invisible for fourteen sessions because `sandbox.app_user` still held rows from original provisioning — the
first `DROP SCHEMA sandbox CASCADE` exposed it. Fixed by mirroring `live.app_user` into the rebuilt sandbox in
`wipeSandbox`: one change, all 60+ columns, and attribution stays real rather than silently NULL so
maker-checker still means something. Per-site guards were tried first and abandoned — the tail is dozens long
and every new module reintroduces it. Kept anyway, because they're right on their own terms: `emitEvent` /
`audit` / `soft_delete.deleted_by` write the actor through a guarded sub-select, plus a new exported
`resolveActorId()`. **Still open:** provisioning creates schemas before `create-admin.js` makes any user, so a
brand-new tenant's sandbox is empty and its first TEST write fails the same way.

**Onboarding gap closed.** `service_type` was referenced by ten modules and **had no module of its own** — no
routes, no UI, created only by `seed-sandbox.sql`, contradicting `0310_operations.sql:7` ("Services as DATA,
not code… User-creatable"). And `POST /milestones/templates` existed with nothing calling it. So a fresh
tenant could define neither its services nor its milestone chains, and onboarding needed an engineer with
database access. Built the module (shared CRUD kit, MOD-29, immutable `key`, DELETE archives because
`dossier.service_type_id` is a plain FK), the Service types screen **with the template editor on it** (a
service type without an active template silently yields dossiers with no chain, so the list warns and the fix
is one click away), and **the service-type field on the dossier form** — without which none of it reached a
dossier, since every UI-created dossier had `service_type_id = null`.

**Also fixed in the walkthrough.** `corporate_entity.doc_prefix` was stored and never read, so refs came out
`DOC-29-2026-0001`; `schemeFor` now takes the entity and a `MODULE_TOKENS` map gives `SLAS-OPS-2026-0001`
(the token is load-bearing — `doc_sequence` restarts per module, so without it a dossier and an invoice would
collide). **`0480_party_address`** — `client_master`/`supplier_master` had **no address column at all**,
leaving the bill-to side of every OHADA invoice with only a name and a NIU. Country was free text against a
`char(2)` column ("Cameroun" → "Ca"); now a shared `CountrySelect`, OHADA states first. And **milestone
advance had never worked**: `to` was never sent (422), the first fix defaulted to an illegal `PENDING → DONE`
transition, and the page's `try/finally` with no `catch` hid both.

**CI — first run of the new pipeline, 4 of 5 jobs red, all fixed.** Three were caught by gates that had never
executed before, which is the argument for having added them. `frontend (client)` + `docker-build`: `TS6133`,
a dead `React` import in the new `country-select.tsx` (no hooks, automatic JSX runtime, `noUnusedLocals`).
`build-test`: `eqeqeq` ×2 — `!= null` in `dashboard.repo.js`, where the loose form bought nothing since a LEFT
JOIN miss is SQL NULL not undefined. `security`: 7 pre-existing vulnerabilities (3 high), transitive `uuid`
via **exceljs** and **node-cron** — set to `continue-on-error` so it reports without blocking, since clearing
them needs an exceljs major bump that deserves doing deliberately (it's also the writer we'd want for the
still-open xlsx report export). With lint green, **`npm test` ran for the first time all session** and caught
two more: `ai-readiness.test.js` rejected the new `service_type.ai.js`, which had been written from memory as
`{ module, reads:[{action_key, title, handler}] }` instead of the real contract
`{ entity, module_key, reads:[{key, service}] }` — with a correct exemplar in the same directory; and
`numbering.test.js` asserted the old raw-number `code`. That test was updated rather than the code, on the
grounds that its own `formatNumber` cases already used `INV`/`JE` as codes — readable tokens were always the
intended shape, and the change only makes them the default rather than per-tenant configuration. Four missing
cases added alongside: unmapped-module fallback, entity prefix, tenant override precedence, and the
entity-lookup-throws path.

**Migrations:** tenant **`0478_geo_place`** + **`0479_dossier_place_refs`** + **`0480_party_address`**.
**Owed:** `npm install --prefix client` for the two new map deps. Session 17 was written almost entirely
without a working sandbox VM, so nothing was compiled until the CI run above — treat the green pipeline, not
the code review, as the first real verification.

---

## 2026-07-29 — Session 16: document-UI overhaul finished + master emails + doc line items + logo fix + contract signed-copy + AI vendors → platform

**Documents.** Native `DocumentPage` detail (route `/documents/:docType/:id`) + drop-in `<DocButton>` wired
across every doc surface; real `loadRecord` loaders for the full set (invoice family, quotation, receipt with
`payment_allocation` lines, proforma from the `advance` table, PO, supplier invoice, PR, cash request, régie,
work order, contract, payslip, delivery/transit/GRN/cycle-count/trip-sheet). Native renderer gained
parts/cost, contract party+articles, proposal narratives+lines, cycle-count item-name resolution, trip-sheet
odometer, and a `fromParty()` mapper (the **"From" was blank** because preview returns `{legal_name,niu,rccm}`
but `PartyCol` read `name`). Operations 360° Documents tab now lists invoices with View.

**Logo.** `resolveLogo()` inlines the logo as a **base64 data URI** (renders in preview + Puppeteer PDF +
email) with a **branding-logo fallback** — fixes the double-wrapped `/media//media` URL and the per-entity-only
lookup that left the logo blank on every document.

**Contract signed-copy.** Send-on-create (email the drafted contract), Upload/Replace signed PDF (vaulted →
`hr_contract.pdf_vault_id`), Download prefers the signed copy; on Contracts + employee-360.

**Send.** `email.service` now supports `attachments`; the document `send` attaches the rendered PDF and
resolves the recipient from party-master emails. **`0475_master_email.sql`** adds `email` to
client/supplier/employee (+ validators + forms).

**Line items — `0476_document_lines.sql`.** purchase_request_line / delivery_note_line / transit_order_line /
grn_line + backend inserts, template loaders, and create-form line editors.

**DSF.** Bespoke SYSCOHADA structured build (identification / income statement / balance sheet / IS 33%).

**AI vendors → platform (shared keys).** **`platform/0060_ai_vendor.sql`** + `services/platform/
ai-vendor.service.js` + `/api/platform/ai-vendors` routes; the AI runtime (llm/embeddings/transcribe/vision)
reads the ONE shared set (env fallback kept); tenant **Vendors tab + `/ai/governance/vendors` removed**;
managed in the console under **Integrations → AI providers**; console nav slimmed to 5 primary + **More**.

**Other UI.** AI Control menu hidden for AI-off tenants (`useVisibleNav` + route guard); clock-in moved inside
the floating cluster; favicon applied from branding (`paint()`); vendor-card status control fixed.

**Docs.** New `doc/PLATFORM_CONSOLE_DEPLOY.md`; `doc/DOC_UI_OVERHAUL_STEP1.md` + `doc/SESSION_HANDOFF.md`
updated.

**Numbering + line-item integrity (late in session).** Fixed lists showing UUIDs instead of doc numbers —
aliased the number column `AS ref` in the PR/PO/supplier-invoice/transit/delivery list queries (they read
`r.ref`, which was never populated). Converted the free-text line inputs to catalogue selects
(`components/catalogue-select.tsx`): PO + PR → financial dictionary, GRN + delivery note + transit order →
inventory; **`0477_line_item_refs.sql`** adds the `dictionary_item_id`/`inventory_item_id` FKs (label kept as a
snapshot). Selects are empty until the dictionary/inventory masters have rows.

**Migrations owed:** platform `0060`, tenant `0475` + `0476` + `0477`. **Verification owed:** full `tsc` /
`vite build` / `jest` on a real machine (in-sandbox: backend ESLint + per-file TS syntax checks clean); set the
shared AI keys in the console; verify a live AI call on a tenant; seed the financial-dictionary + inventory
masters so the line selects have options.

---

## 2026-07-27 — Session 15: Lovable kit fidelity + AI gate/clickable actions + workflow blocks + SOPs/Talent build-out + fixes

**Context.** FE-fidelity + depth pass over the HR/Fleet/WMS rebuild, plus the loose ends the two plan docs
(`LOVABLE_FIDELITY_PLAN.md`, `UI_DEPTH_OVERHAUL_PLAN.md`) still tracked. Full detail: `SESSION_HANDOFF.md`
session-15 log. Headlines:

- **Lovable kit restyle finished** (shared kit only, tokens via `color-mix` off `--primary`): `index.css`
  (motion tokens, `fadeUp`/`modalRise`, global reduced-motion, `.chip*`/`.sec*`, `.btn-primary`/`.btn-surface`,
  serif `font-semibold` stripped app-wide), `button.tsx`, `table.tsx`+`data-list.tsx` (tablecard + orange row
  hover + micro header + **mobile card fallback**), `kpi-tile.tsx` (icon square + serif value + delta),
  `modal.tsx`+`input.tsx`, `Chips`/`Segmented` + every hand-rolled filter/nav pill row.
- **Per-screen AI gate restored** on all 21 HR/Fleet/WMS screens (`screen-specs.ts` `ai` specs + `<ScreenAi/>`
  per screen) and the **AI-action cards made clickable** (`ai-actions.tsx` dispatches `praxis:open-copilot`
  with a prompt; `praxis-copilot.tsx` auto-asks; writes stay AWAITING_CONFIRM).
- **Shared workflow blocks** `components/ui/workflow.tsx` (StepBar / StatusActionBar / TransitionButtons /
  LineTable) adopted in 9 screens.
- **SOPs → onboarding checklist, Talent → succession board** built out with two NEW auto-mounted backend
  modules: `src/modules/hr/succession/` (MOD-19, `/succession`) and `src/modules/hr/onboarding/` (MOD-16,
  `/onboarding`) — tables pre-existed in `0360_hr_breadth.sql`, so no migration; **API restart mounts them**.
- **Fixes:** platform-console `citext = uuid` 500 (`plans.planIdOf` + `roles.roleIdOf`, compare on text) —
  this, not a missing seed, was why the console Features/Roles tables rendered empty; vacancy→employee **role
  carry-over** on hire (`vacancy.service` copies vacancy title/department); **employee 360 Edit** modal
  (`PATCH /employees/:id`); mobile table/kanban overflow (card fallback + `min-w-0`); deleted dead
  `crud-resource.tsx`; added `client/` + `platform-console/` **ESLint flat configs** (were unlinted under
  ESLint 9).
- **Operational (not code):** Appraisals 500 = `0466_employee_earning` unapplied → `db:migrate:tenants`.

**Validated in-sandbox:** client `tsc -b`, Tailwind compile, root + backend ESLint all clean. **Owed on
Windows:** `npm install` (client + platform-console, for the new ESLint deps) + `npm run lint`/`build`, root
`npm test`, `db:migrate:tenants`, API restart, flip `ai.assistant.backend` per tenant.

## 2026-07-23 — Session 13: Platform Console (Praxis admin UI) built + Support & Feedback end-to-end

**Context.** The `/api/platform/*` backend (provision/suspend/resume/go-live/migrate/capacity/sandbox/
feature-toggles/plans/catalogue) had shipped long ago with **no frontend** — the standing "platform console
UI (proposal pending)" gap. Also closed out **Support & Feedback** (PRD §11.2), which had been *held until
the console existed* because its triage half lives there.

**Platform Console — new standalone app `platform-console/`.** A *separate* React 18 + Vite 5 + TS app
(own toolchain, `npm install` not `ci`), deliberately not folded into the tenant `client/` (own platform
auth; must never touch tenant data). Plain CSS, distinct dark "ops" theme; HashRouter; typed `/api/platform`
client with Bearer + `localStorage` token store. Screens: **Overview** (tenant counts by status/plan +
recent activity), **Tenants** + provision modal, **Tenant detail** (go-live/suspend/resume/migrate/
sandbox-wipe, capacity + sandbox-interval setters, DB/subdomains, feature toggles w/ plan/override/default
source + clear-override, per-tenant audit), **Plans**, **Catalogue**, **Audit**, **Support**. Verified
`tsc -b` + `vite build` clean (~203 kB, 64 kB gz).

**Host-gated serving.** `src/server.js` serves `platform-console/dist` **only** when
`req.hostname === PLATFORM_CONSOLE_HOST` (new env, e.g. `admin.praxisls.com`), at that host's root, and does
**not** serve the tenant SPA there; tenant hosts never serve the console and **there is no `/console` path**
(so `tenant.example.com/console` can't reach it). New Docker `consolebuild` stage bakes the dist into the
image. `.env.example` + `DEPLOYMENT.md §5b` document it — the existing `*.domain` nginx wildcard already
routes `admin.*` to the api with Host passthrough, so no new nginx block is needed; just set the env.

**New BE `GET /api/platform/audit`** (read-only): recent `platform_audit` rows with actor + tenant names,
optional `?tenant=<slug>` + `?limit` (1–500). Powers the Audit page + per-tenant activity card.

**Support & Feedback — both halves + the loop.** The central `platform.support_ticket` table already
existed (in `0030_platform_ops.sql`), so tickets live platform-side and the console aggregates with **no
cross-tenant fan-out** and **no migration**.
- Tenant BE: new `src/modules/dashboard/support/` (auto-mounts `/api/tenant/support`, **ungated**, authed) —
  create/list/detail + CSAT (only on resolved tickets), scoped to `req.tenant.tenant_id`, stamped with
  `req.user.email`, writing the platform DB via `services/platform/db`.
- Platform BE: new `services/platform/support.service.js` + `GET /api/platform/support/tickets` (aggregate +
  `?status/kind/tenant`), `GET /tickets/:id`, `PATCH /tickets/:id` status transition (audited
  `support.status_changed`).
- Console FE: **Support** = live triage board (status lanes, filters, per-ticket detail + transitions).
- Tenant FE: `client/src/features/support/support-page.tsx` (route `/support`, nav under Overview) — raise a
  ticket, track status, rate resolved tickets. Full client `tsc -b --force` clean.

**Not run against a live API** — Windows `npm run lint`/`test`/`build --prefix client`, `npm install` in
`platform-console/`, set `PLATFORM_CONSOLE_HOST`, create a Root Admin, and a click-through are owed.

## 2026-07-19 — Session 9: Security CRUD + Security/Vault hubs, Control Tower drill-downs, Governance, reconciliation, merge fields

**Context.** The FS colleague reported that "modules under fleet, security, warehouse, vault, vehicle and
hr aren't built — collapse them into one screen as tabs like the finance screen", and split the work:
this stream takes **security + vault**, he takes **fleet / warehouse / vehicle / hr**.

**Audit first, and it changed the job.** His read was right for four areas and for security, **wrong for
vault**: all five vault pages shipped in session 8. Security was the opposite — `features/security/
pages.tsx` was 104 lines of read-only `ResourceList` stubs, as its own file header admitted ("skeletal
(read-only lists) by intent"). So vault needed only a hub; security needed building from scratch. The
root cause of the confusion was `FE_IA_BUILD_MAP.md` §4 conflating *a screen exists at that route* with
*the screen works* — corrected in that file this session.

**Security — full CRUD** (104 → 872 lines). Users (create/edit, role assignment as toggle chips, status
through the separate audited `POST /users/:id/status`, password through `/users/:id/password`; the edit
modal re-fetches `GET /users/:id` because the list endpoint's `SAFE_COLS` omits `role_ids`), Roles (code
locked on edit, delete disabled for `is_system`), Capabilities (code constrained to the DB CHECK's four
values), Scopes (entity picker, parent select excluding self), Field visibility (**gated `approve`, not
`edit`** — the router says so), Sessions (mine + all, per-row revoke, revoke-all). Dropped the dead
`PermissionsPage` export — `app.tsx` always used `permission-matrix-page.tsx`.

**Two hubs.** `features/security/hub.tsx` + `features/vault/hub.tsx`, FinanceHub-shaped: overview landing,
tab bar, section map at `/<area>/:section`. **Deliberately not the shared `TabbedHub`** — it publishes its
tab bar via context and expects each page to render `<HubTabs/>`; none of these eleven pages do, so
adopting it meant editing all of them or double-rendering headers via `inlineTabs`. Routes collapsed 13 →
4, and **every old path still resolves as a hub section**, so nav, bookmarks, ⌘K and `screen-registry.json`
are untouched.

**Governance — the two stubs built.** Audit ledger became four segments, because `/audit` exposes four
genuinely different things the single-list stub had flattened: Ledger (`immutable_ledger`, row → before/
after JSON diff — the whole point of the table, previously unreachable), Security events, Access reviews
(create → decide each entry approved/revoked/flagged → complete, with Complete disabled until every entry
is decided), Restore queue (request-restore + restore, maker-checker rule stated up front since the DB
enforces `restored_by <> deleted_by` and a same-person attempt would otherwise read as a random failure).
Notifications = inbox + a preferences matrix; the table stores **explicit opt-outs only** (absence of a row
= enabled) so the grid defaults on, and `category` is free text server-side so the six categories are a UI
convention with any already-stored category merged in. **No Governance hub** — those four screens sit at
unrelated top-level paths, so hubbing would move every URL for cosmetics.

**Control Tower drill-downs — now real.** Clicking a KPI card opened the mock's hardcoded `kpiData`
(Bolloré, Sonara, truck LT-4471) even though the card *values* had been live since session 8. All four now
build from endpoints the user already reads — revenue → `/final-invoices` grouped by client, SLA →
`/operations` scored `ata ≤ eta`, overdue → the new endpoint below, fleet → `/vehicles` — with **no new
drill-down BE**. Each fetch catches independently, so a gated module yields that card's empty state rather
than breaking the tower. The mock's `openKpi` is **replaced outright** (its script is top-level with no
IIFE, so its functions are window properties and the inline `onclick=` handlers pick up the override);
that also removes its simulated ~18% random load failure, which was reasonable in a demo and wrong for real
data. The CTA now leaves the iframe entirely: it posts `{type:'praxis-kpi-nav', id}` and the **parent owns
the id→route map**, so the iframe can't navigate to an arbitrary path. Drill `meta` strings carry
deliberate `<b>` markup and are injected as HTML, so interpolated DB values are escaped — the iframe runs
`allow-same-origin`, which is not a boundary worth trusting. **Bug fixed en route:** `rgb(var(--info))` was
invalid — `--info` is a raw hex that `lib/theme.ts` sets with the comment "no consumer yet", not an
`"R G B"` triplet, and isn't defined in `index.css` at all; switched to `--ink-3`.

**BE — past-due reconciliation.** New `GET /receivables/overdue` (MOD-52, gated `accounting.core`),
registered before `/:id`. **No new SQL:** it reuses the same `repo.openInvoices` rows `ageing` already
reads, so `overdue.total === d1_30 + d31_60 + d61_90 + d90_plus` for the same `as_of` **by construction**.
Verified on fixtures — total 1100 = ageing past-due 1100, with the not-yet-due invoice (250) correctly left
in `current`. The Control Tower card and its drill-down now read this one payload; previously the card came
from the ageing report (net of receipts) and the list from raw invoices (not net), so they could disagree
on screen. Amounts are `outstanding`, so a partly-paid invoice shows what's actually owed, and the card no
longer depends on the `reporting` feature flag.

**BE — campaign per-recipient merge.** `sendCampaign` renders subject and body per subscriber:
`{{name}}`, `{{email}}`, `{{campaign}}`, `{{year}}`. Three deliberate choices. **Body values are
HTML-escaped, subjects are not** — `name` arrives via the public subscribe endpoint, so one subscriber
signing up as `<script>…` would otherwise inject markup into every other recipient's email; subjects aren't
HTML, but CR/LF is stripped because a newline there is header injection. **Unknown tokens render
literally**, so `{{firstname}}` is visible in a test send instead of silently blanking. **`name` falls back
to the email's local part, then "there"**, so "Hi {{name}}," never renders as "Hi ,". FE: `TemplateForm`
lists the fields under the body.

**Docs.** `CAMPAIGN_TEMPLATES_BE_HANDOFF.md` rewritten as a **record, not a request** — the endpoints it
proposed shipped in session 8 and were at real risk of being built twice; its remaining gaps (no SPF/DKIM
behind `verified_at`, no scheduling) are now written down. `FE_IA_BUILD_MAP.md` §4 corrected as above.
Postman gained `GET /receivables/overdue` with tests asserting rows sum to total and every row is genuinely
overdue.

**Verification.** In-sandbox `tsc --noEmit -p client` clean throughout; changed BE files `node --check` +
`eslint` clean (0 errors). **`npm test` could not run in the sandbox this session** (jest hangs with no
output), so the five new merge-field cases in `tests/unit/campaign-send.test.js` are **unexecuted** — the
logic beneath them was verified directly via `node -e`. Windows `npm run lint` / `npm test` / `npm run
build --prefix client` remain authoritative.

**Dead code found, not deleted** (the sandbox mount blocks unlink; needs `git rm` on Windows):
`client/src/features/master/pages.tsx` (748 lines) has **zero importers** — this stream's session-5
master-data trio, superseded at the PR #11 merge by his `masterdata/master-data-page.tsx`; removing it
empties `features/master/`. Also `ReceivablesPage` + `ChartOfAccountsPage` in `features/finance/pages.tsx`
are stubs nothing imports (`FinanceHub` takes both from the dedicated `receivables.tsx` /
`chart-of-accounts.tsx`). **Do not delete `features/dashboard-mock/`** — restored in session 7 and actively
rendered; the session-6 "safe to delete" note is stale.

---

## 2026-07-18 — Post-merge: idiom convergence, last screens, entity gaps

**Context.** After PR #11 merged and both streams' work was reconciled (see `SESSION_HANDOFF.md`
"Post-merge reconciliation"), this pass converged the duplicated UI idioms and closed the last
buildable FE items. **Client `tsc` clean; changed BE files `node --check` + `eslint` clean.**

**Idiom convergence.** Of the three apparent conflicts, only one was real:
- **AI** — no work: his `ScreenAi`/`PraxisCopilot` already import this stream's `AiActions`/`useAiEnabled`,
  so they compose on the global gate rather than competing with it.
- **Lists** — kept both (`ResourceList` self-fetches; `DataList` is presentational, and is now the default
  for new wired screens). Real duplication was `cell()` existing twice and **diverging** on boolean casing
  → single implementation in `lib/format.ts`, re-exported from `components/data-list.tsx` and
  `features/sales/ui.tsx` so no import path changed.
- **Tabs** — kept both (`TabbedHub` = route-driven shell, `Segmented` = in-page state). Master data was
  hand-rolling an identical bar → now uses `TabbedHub`, via a new optional `inlineTabs` prop (default off)
  because that hub's pages don't render `<HubTabs/>` and would otherwise lose their tabs.

**Screens.**
- **Module catalogue** built — `features/settings/catalogue-page.tsx` over `GET /catalogue/modules`
  (MOD-67 view, read-only): group chips, search, counts, link to the permission matrix.
- **Business setup retired** — it duplicated the Corporate entities editor; the route now redirects to
  `/master/corporate-entities` and the Settings-hub card was repointed.

**Corporate entity gaps (BE + FE).** `address`/`bank_block` were API-writable with no UI; the logo columns
were unwritable (validator dropped them). Added both logo fields to the validator and a new
**`POST /entities/:id/logo`** — 512 KB cap, allowed image types, stored per tenant+entity, audited, and
**gated MOD-01 edit** (not the MOD-70 `/branding/logo`, which would force settings-admin rights). FE: the
editor now covers Address, a Bank details block (→ invoice payment block) and the letterhead logo.

**Control Tower.** 4th KPI card (receivables overdue) now derived FE-side from the `receivables_ageing`
report producer — no new BE; hides when `reporting` is off. All four cards live.

**Bundle.** `manualChunks` added to `vite.config.ts` for the >500 kB warning. **Unverified in-sandbox**
(`vite build` needs the Linux rollup binary the Windows lockfile omits) — revert that file if the Windows
build errors. Improves caching, not first-load bytes; route-level `React.lazy` deliberately deferred.

## 2026-07-18 — Session 8: FE follow-ons + every pending BE job (build BE then FE)

**Context.** Cleared this stream's FE follow-on backlog, then built out **all pending BE jobs** end to
end (BE first, then the FE wiring). Sandbox-validated as far as it can: **`node --check` + `eslint`
clean on all BE files; `tsc --noEmit -p client` clean.** `npm run lint`/`test`/`build` + **applying the
two new migrations** remain the authoritative Windows checks (sandbox can't run the DB tests).

**Part A — FE follow-ons (all `tsc`-clean):**
- **Reference pickers → `SearchSelect`** across sales/commercial/finance/settings/portal (meeting,
  opportunity, proposal entity/client, quotation entity, pricing-variance, credit-note entity/client/
  reversed-invoice, bank-account, portal client-scope, opportunity win-form). Added an optional
  `filter` prop to `SearchSelect` (keeps the credit-note reversed-invoice picker scoped to FINAL).
- **Settings store tiles** — new `features/settings/store-pages.tsx`: Document templates, Custom fields,
  Email signatures, Business policies on the generic `/settings/:section/:key` store (MOD-70), routed.
- **Vault trio built** — `DocumentsPage` (upload/download/archive over `/documents`, authed binary
  download), `SignaturesPage` (per-`entity_ref` list + sign, feature-gated), `VerificationPage` (hash
  lookup → tamper verdict) in `features/vault/pages.tsx`, routed (replaced `<Planned/>`).
- **PWA** `manifest.background_color` now follows the tenant theme (`src/routes/pwa.js`).
- **Smart Comms** — new `features/comms/pages.tsx` (`/comms`, feature `comms`): two-pane channel list
  (search + New-channel modal with kind/topic/member picker, unread badges) | thread + composer, over
  `/smartcomm`; marks read on open. Routed.
- **My Workspace** — new `features/workspace/pages.tsx` (`/workspace`): greeting + metric tiles +
  Awaiting-your-approval (`/approvals?status=PENDING`) + Recent notifications (`/notifications`) + quick
  links. Composes existing read endpoints. Routed.
- **Build-map correction** — the Master data hub (incl. Expense rates + Financial dictionary) was already
  built; `FE_IA_BUILD_MAP.md` corrected (no rebuild).

**Part B — pending BE jobs (BE + FE):**
- **Dashboard KPI aggregates.** `dashboard.repo.js kpis()` gained guarded `revenue_final_ttc`
  (Σ locked FINAL invoice TTC), `revenue_currency`, `fleet_active`/`fleet_total`, `sla_on_time_pct`
  (dossier `ata ≤ eta`; NULL-preserving `num()` helper). `features/dashboard.tsx` feeds the Control
  Tower's revenue/SLA/fleet cards from these and hides any null card (the 4th "overdue" card has no
  aggregate → stays mock).
- **Refresh-token rotation + reuse-detection.** `app_user.service.refresh()` mints a fresh refresh
  token (sliding exp), returns it, and stores its jti on the session (`user_session.refresh_jti`,
  migration `0453`). On refresh the jti must match the session's current one; a mismatch revokes the
  session (replay/theft signal). Legacy NULL-jti sessions grandfathered. `issueSessionTokens` stamps
  the jti on login/2FA/PIN.
- **Campaign templates + senders + send (MOD-22).** Migration `0452` (`campaign_sender` +
  `campaign_template`). Extended `sales/marketing_campaign` with `/campaigns/senders` (+ `/:id/verify`),
  `/campaigns/templates` CRUD, and `POST /campaigns/:id/send` (fan-out: one durable "email" queue job
  per active subscriber, template's sender as the `from` override), all registered before `/:id`. FE:
  `TemplateForm` moved off the `/settings/campaign_template` stopgap to the new endpoints + a sender
  picker with inline `SenderForm`; a **Send…** button on each campaign card opens `SendCampaignModal`.

**Tests (new).** `tests/unit/auth-refresh-rotation.test.js` (reuse-detection predicate `refreshTokenReused`
— extracted as a pure exported seam) and `tests/unit/campaign-send.test.js` (`sendCampaign` orchestration
with repo/emit/queue mocked). `node --check`-clean and house-style; **jest couldn't boot in-sandbox
(no Redis/Postgres) — run on CI/Windows.**

**Postman.** Added folder **13 · Marketing / Campaigns** (subscribers → sender → verify → template →
send → cleanup, capturing ids) and made **`POST /auth/refresh`** capture the rotated `refresh_token`
(so a stale token now 401s — reuse-detection is testable in-collection).

**Migrations to apply:** `0452_campaign_templates.sql`, `0453_session_refresh_jti.sql` (renumbered from
0450/0451 post-merge — those numbers were taken by the other dev's comms/mail migrations).

## 2026-07-17 — Session 6: whole Sales/CRM + Commercial + Vault/Portal FE lane + live Control Tower

**Context.** Continuation of the FE reskin, this stream's lane (master data / sales-CRM / vault /
portal / settings; the FS colleague owns finance + operations). Agreed a funnel model with the user
— **marketing → leads + opportunities → sales** — and built the whole lane against the already-merged
BE modules. Design pulled from the user's Pixie "Hub" CRM screen recording (`Recording 2026-07-17`):
its *layout* (tabbed CRM, filter chips, avatar list-rows, segmented controls, metric strips) reused
but driven by the app's `--primary` tokens, not the mock's crimson — so every screen re-tints per
tenant. All wired to live endpoints; **in-sandbox `tsc --noEmit` clean throughout; `npm run lint` +
`npm run build --prefix client` pass on Windows (user-confirmed).**

**BE confirmation first.** Read `src/shared/http/module-loader.js` — modules auto-discover/mount from
`src/modules/<group>/<mod>/<mod>.routes.js`, so verified all target modules are merged with full
7-file structure + real routes before building. Gates to remember: Reports needs `reporting`;
Quotations needs `commercial.quotation`; portal external views need `portal.client|investor|audit`.

**Sales & CRM funnel — `client/src/features/sales/pages.tsx` (all six):**
- **Leads & intake** (`/sales/leads`, MOD-20) — two-tab (Leads + Inbound intake). Leads = Pixie
  Clients-tab layout (search + status chips + avatar rows) → capture/edit, advance
  (`/transition` → CONTACTED/QUALIFIED/LOST), **Convert** (`/convert`, QUALIFIED→client_master).
  Intake (nested segment) = Enquiries (**Triage** `/inbound/enquiries/:id/triage {to_lead,close}`) +
  Partnership requests (**Review** `/:id/review {status}`). **Inbound intake folded in as a tab, not
  a standalone screen** (user decision); `/sales/inbound-intake` now redirects to `?tab=intake`; nav
  relabelled "Leads & intake" + a deep-link.
- **Meetings** (`/sales/meetings`, MOD-21) — list + Schedule (subject + lead/client picker +
  `scheduled_at`); row → detail modal (`GET /:id` notes) with Add note (`/:id/notes {body,is_minutes}`).
- **Opportunities** (`/sales/opportunities`, MOD-24) — Board + List (segmented). Board = one column
  per `/opportunities/stages`; cards = OPEN opps grouped client-side by stage; per-column value from
  `/opportunities/board`; a forecast strip (open value / weighted Σ value×prob / open deals / win
  rate). **Drag-to-move** → `/:id/move` (won/lost stage auto-settles server-side); per-card Win
  (modal, opt. `create_dossier`+entity → `/:id/win`), Lose (`/:id/lose`), Edit. Note: BE `/board`
  is aggregates-only, so the board composes `/stages` + `/` (list) rather than rendering `/board`.
- **Proposals** (`/sales/proposals`, MOD-23) — list + chips; detail modal (narrative sections +
  priced line table + total); create/edit draft with narrative + line editors (PATCH replaces
  children, DRAFT-only); lifecycle via inline panels: Submit → Send (entity-numbered) → Reject /
  Accept (`/:id/accept`, opt. spin a quotation).
- **Marketing campaigns** (`/sales/campaigns`, MOD-22) — Pixie Sales-campaigns layout: metric strip
  (Active/Draft/Ended/Subscribers) + campaign cards with lifecycle buttons (`/:id/transition`,
  DRAFT→ACTIVE→PAUSED↔ACTIVE→ENDED); Subscribers tab (add `/subscribers`, unsubscribe).
- **Success stories** (`/sales/success-stories`, MOD-26) — filter chips + case-study cards;
  create/edit draft; Sign off (`/:id/sign-off`) → Publish (BE requires sign-off) → Unpublish.

**Shared UI extracted — `client/src/features/sales/ui.tsx`.** `Row`, `errMsg`, `cell`, `when`,
`fmtMoney`, `useList`, `Badge` (+ colour map), `Segmented`, `Chips`, `Avatar`, `MetricTile` — imported
by every sales/commercial/vault/portal/dashboard screen (was inline in `sales/pages.tsx`).

**Commercial group — `client/src/features/commercial/pages.tsx` (FS colleague verifying finance
correctness):**
- **Quotations** (`/commercial/quotations`, MOD-27) — **gated `commercial.quotation`** ("enable it"
  empty state when off). List + chips; detail (line table + HT/TTC from BE); create/edit draft with
  a line editor incl. a **débours** (untaxed pass-through) flag; lifecycle DRAFT→SENT (entity →
  numbers doc; sends directly if the quote already has an entity)→ACCEPTED (inline convert→final-
  invoice draft)/REJECTED/EXPIRED. **No tax-code picker yet** → FE doesn't VAT-flag lines, so
  total_ttc==total_ht until a `tax_code_id` is set (follow-on).
- **Margin simulation** (MOD-27) + **Extra-charge/demurrage simulation** (MOD-28) — saved-sim cards +
  a modal with a line/tier editor, **Preview** (`/preview`, no persist) then **Save** (`POST /`).
  Extra-charge tier editor overrides tenant settings `commercial.demurrage_tariff`.
- **Pricing variance** (MOD-27) — Sales R/Y/G list (flag + quote only; raw cost never leaves the
  finance boundary) + flag chips; Compute modal (dossier picker from `/operations`, quotation picker,
  optional quoted-price/actual-cost) → `/compute`.

**Vault hubs — `client/src/features/vault/pages.tsx`:**
- **Reports** (`/vault/reports`, MOD-63) — **gated `reporting`**. Catalogue (10 producers) → Run
  modal (optional from/to/as_of/period_code/dossier_id → generic table/JSON result → Save); Saved
  tab (run via `/saved/:id/run`, delete). Scheduling stays in Settings; tile picker deferred.
- **Compliance flags** (`/vault/compliance-flags`, MOD-65) — Flags tab: **Run checks** (`/run`) +
  severity chips + include-resolved toggle + Resolve (`/:id/resolve`); Rules tab = rule catalogue.

**Portal — `client/src/features/portal/pages.tsx`:**
- **Portal access** (`/portal/access`, MOD-67) — grant list + Grant (client/investor/auditor; CLIENT
  needs a client scope) + Revoke (`/access/:id/revoke`); Preview buttons GET the external views
  (`/portals/client|investor|auditor`), each gated `portal.*` → graceful "enable it" state.

**Control Tower — now LIVE (`client/src/features/dashboard.tsx`).** Replaced the static Lovable
`<iframe srcDoc>` mock with real React tiles: `GET /dashboard/kpis` (guarded flat counts) +
`GET /dashboard/control-tower` (op-file counts, approvals awaiting, live-shipments list = open/
in-progress dossiers with ref/status/route/vessel/ETA). MOD-00A, permission-gated, no feature flag.
Hero strip + live-shipments table + op-file breakdown + registry counts + Refresh + gated AI panel.
**Not** wired to `/reports/tiles` (that's a per-user tile-layout store) — the dashboard aggregate is
the right source.

**Cleanup.** Deleted the now-unused `client/src/features/dashboard-mock/{body.html,script.js,
style.css}.txt` and `client/src/features/placeholder/coming-soon.tsx` (+ their folders); nothing
imported them (verified). Routes wired in `client/src/app/app.tsx`; nav in `app-shell.tsx`.

**Every AI affordance drops in via `<AiActions>` (globally gated, session 5) — no AI UI appears when
the tenant flag is off.** Follow-ons (not built): tax-code picker for Quotations; Reports
dashboard-tile picker; platform/godmode console UI. Docs: `FE_IA_BUILD_MAP.md` + `SESSION_HANDOFF.md`
updated screen-by-screen.

## 2026-07-12 — Phase 1 finance FE (round 2): wire the actions that already had a BE

**Context.** Follow-on to the write-forms round below. Gap audit found three actions
whose **backend already exists** but had no UI; wired those. (Two other gaps — tax
declaration *filing* and credit-note *creation* — are left because they have **no BE
endpoint** either, so they're not just-wire-a-button; noted in the backlog.)

**Wired (`client/src/features/finance/pages.tsx` + `client/src/lib/finance-api.ts`).**
- **Journal reverse** (`POST /journal-entries/:id/reverse`, MOD-55 approve):
  `JournalsPage` converted from a generic `ResourceList` to a real table; validated
  entries (and not themselves reversals — `corrects_entry_id` shown as a "reversal"
  chip) get a per-row **Reverse** button → modal (reversal date + reason) that posts
  the linked contra entry. BE rejects reversing a draft (`NOT_REVERSIBLE`), surfaced.
- **Invoice draft edit** (`PATCH /final-invoices/:id`, MOD-51 edit): **Edit** action on
  DRAFT rows opens a modal that loads `GET /final-invoices/:id` (returns `.lines`),
  prefills client + lines (amount from `line_ht`, `is_disbursement`, dictionary item), and
  saves the patch. Sits next to the existing Submit action.
- **Guided monthly close** (`GET /statements/periods` + `POST /statements/periods/close`,
  MOD-59 edit): new **"Periods / close"** tab in `StatementsPage`. Lists periods with a
  status pill (OPEN/FROZEN/CLOSED); OPEN → Freeze/Close, FROZEN → Close, CLOSED → locked.
  A confirm modal calls the endpoint with `to: 'FROZEN'|'CLOSED'`; the BE's
  `CLOSE_BLOCKED` (unbalanced TB) / `ALREADY_CLOSED` errors surface inline.

**Plumbing.** `finance-api.ts` gained `getInvoice`/`updateInvoiceDraft`/
`reverseJournalEntry`/`listPeriods`/`closePeriod` (+ `InvoiceDetail`/`Period` types).
`ReportTabs` refactored to allow a **custom-render tab** (`render?: () => ReactNode`,
`path` now optional) so the Periods panel lives beside the report tabs without faking a
report fetch; the fetch effect early-returns for custom tabs.

**Also fixed (same day).** The Statements period filter was sending `period_code`, which
the statement endpoints ignore — they key on `period_id` (tax reports use `period_code`).
`ReportTabs` now takes a `periodMode` prop: Statements renders a **`period_id` dropdown**
loaded from `/statements/periods` and filtered by the selected entity; Tax keeps the
`period_code` text input. `Params`/`toQuery` carry both and send whichever is set, so the
Statements filter now actually binds.

**Verify status — blocked by the sandbox mount, not by the code.** In-sandbox `tsc`
could not validate this round: the network mount served **stale/truncated** copies of
the just-written files (e.g. `finance-api.ts` frozen at 3422 bytes / cut mid-type on
line 104; `pages.tsx` cut mid-statement on line 933), producing phantom
`TS1005 ')' expected` / `TS1110 Type expected`. Confirmed artifacts by reading the real
files through the file API — both lines are complete and valid on Windows. The prior
round typechecked clean once NUL-padding was stripped; **run `npm run build --prefix
client` on Windows as the authoritative gate for this round.**

## 2026-07-12 — Phase 1 finance FE: write forms on the read-only surfaces

**Context.** Handoff's next depth layer: the Phase 1 finance screens were read-only
lists + computed reports. Added the write/action forms that post to the ledger,
keeping the existing client plumbing (`tenant()` api-client, refresh-on-401, design
tokens). All new UI typechecks clean (`tsc --noEmit` = 0 once the sandbox NUL-padding
artifact is stripped — see the sandbox gotcha; validate on Windows with
`npm run build --prefix client`).

**New shared UI + plumbing.**
- `client/src/components/ui/modal.tsx` — portal-based `Modal` (backdrop + Escape +
  body-scroll-lock), a `Field` label/hint/error wrapper, and a native `Select`
  styled to match `Input`. First reusable dialog in the client.
- `client/src/lib/finance-api.ts` — typed write wrappers (`postJournalEntry`,
  `payAdvance`, `createInvoiceDraft`, `submitInvoice`) + option loaders
  (`loadEntities`/`loadClients`/`loadDictionaryItems`/`loadPostableAccounts`) feeding
  the form dropdowns from real master-data endpoints (`/entities`, `/clients`,
  `/financial-dictionary`, `/chart-of-accounts` filtered to `is_postable`). `today()`
  helper for date defaults.
- `client/src/components/resource-list.tsx` — added an optional `action(reload)`
  header-toolbar render prop + internal reload nonce, so a list can host a "New…"
  button and re-fetch after a successful write. Backwards-compatible.

**Forms wired (`client/src/features/finance/pages.tsx`).**
- **Post journal entry** (`POST /journal-entries`, MOD-55): multi-line editor with
  per-line account (postable-only) + debit/credit (mutually exclusive inputs), live
  balance indicator (blocks submit until Dr=Cr and >0), entity/journal-code (datalist
  VT/AC/BQ/PAIE/OD)/date/**mandatory source_doc_ref**, and a "Validate immediately
  (locks entry)" checkbox vs save-as-draft.
- **Record customer advance** (`POST /proformas/pay`, MOD-50): entity/client/amount/
  treasury-account/date/source-ref → posts to 4191, not revenue.
- **Final invoice lifecycle** (MOD-51): rebuilt `InvoicesPage` as a custom table
  (was a generic `ResourceList`) with a **New draft** modal (`POST /final-invoices`,
  optional dictionary-item lines with `is_disbursement`) and a per-row **Submit** action
  (`POST /final-invoices/:id/submit`, `entry_date` + `source_doc_ref`) shown only on
  DRAFT rows. Columns matched to the real `invoice` table (`doc_number`, `type`,
  `status`, `total_ttc`, `created_at`; PK `invoice_id`).
- **Statement + Tax period filters** (listed gap): `ReportTabs` now has an
  apply-on-demand filter bar (entity dropdown, `period_code` YYYY/YYYY-MM, `from`/`to`
  dates) that appends the query string the `financial_statement`/`tax_declaration`
  validators already accept (`entity_id`/`from`/`to`/`period_code`). Draft-vs-applied
  split so typing doesn't refetch on every keystroke.

**Also fixed while here.** `client/src/components/splash-screen.tsx` imported
`* as React` but never referenced it — a real `noUnusedLocals` error that would have
failed `tsc`/`npm run build`; removed the dead import (react-jsx needs no React
import).

**Verify caveat (sandbox gotcha, again).** In-sandbox `tsc` on freshly-written files
reports phantom `TS1127 Invalid character` errors — the network-mount pads the cached
copy with trailing NUL bytes past EOF. Confirmed benign: copying `src` to a local
tmpfs and `tr -d '\000'` before `tsc --noEmit` → **0 errors**. The Windows files are
correct; the authoritative gate is still `npm run build --prefix client`.

## 2026-07-12 — Doc reconciliation after colleague merge + FE pivot to Lovable look

**Context.** Pulled the colleague's merged work (`889f77d`): the codebase now spans
Phases 0–4. Reconciled `WORK_TO_BE_DONE.md` against the actual modules by presence +
`*.service.js` depth and the passing unit suites (not a line-by-line invariant
re-audit — noted as such inline).

**What the audit found landed (previously all-unchecked in the backlog):**
- **Phase 1 (accounting spine) — substantially done:** COA + financial dictionary +
  determination/posting-rules, journal engine + invariants (`journal_entry.rules.js`
  + ledger triggers), reversal-not-edit, régie aging, tax jurisdiction (versioned
  tax_code), statements (Bilan/CR/TAFIRE), tax center, PDF worker + vault + QR,
  per-tenant SMTP. Backed by `journal-*`, `final-invoice-lifecycle`, `invoicing`,
  `statements`, `tax-center`, `determination`, `numbering` suites.
- **Phase 2 (commercial cycle) — substantially done:** master data
  (entity/employee/client/supplier), currency+FX, dossier + service types, milestone
  engine (versioned templates), transit/delivery, costing + cost-tracking + régie
  disbursal, margin/extra-charge simulators, proforma (4191), final invoice, smart
  receivables, procurement (PR→PO→GRN + supplier invoice). Only the Ops-File 360°
  **modal** is left to the FE.
- **Phase 4 — partial:** AI service layer (DB-first vendor resolution + env fallback,
  transcribe/vision jobs, batch actions), Zod action gate + confirmation flow, AI
  governance, pricing variance index. Portals/smart-comms/reporting are backend
  scaffolds; settings hub is partial.

Ticked those boxes in the backlog with a dated audit banner per phase. No code changed
in this pass — documentation only.

**FE decision (this session).** Halting BE; the frontend gets reskinned to the Lovable
**Control Tower** mock (`doc/reference/reference-mock-lovable`) while keeping the
current `client/`'s working plumbing (auth, api-client with refresh-on-401, branding,
theme, screen-registry). The mock's UI is a static HTML/CSS/JS dashboard (3 views:
home/ops/finance) + a shadcn/ui component set; we adopt its **look**, not its
TanStack-Start stack. Next: port the design tokens + shadcn components into `client/`,
reskin the shell, then wire Phase 0 + Phase 1 screens to the live endpoints.

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
