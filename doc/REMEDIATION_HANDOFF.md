# Remediation handoff — read this first

Continuation notes for the Phase-0 audit remediation. Written 2026-08-05, and
updated later the same day after the test-coverage batch.

**Source of truth is `doc/AUDIT_REGISTER_2026-08-04.xlsx`**, not this file. Every
finding has a Status, a Verification column, and an evidence note explaining what
was done and how it was proven. This file is orientation and the things a
spreadsheet cannot hold.

---

## 1. Where it stands

**162 of 215 fixed.** Criticals 45/46, Highs 71/80, Mediums 36/66, Lows 10/18.

The most recent batch took the API-contract and data-integrity/perf clusters —
twenty findings closed, one (API-F23) attempted and deliberately left open; see
§10.

The register grew from 205 to 215 rows: findings NEW-01…NEW-10 were discovered
during remediation, not by the original audits. NEW-08 is the largest of them
and is worth reading before anything else — see §12. (There were two rows
numbered `NEW-06`; the Security one is now `NEW-07`.)

NEW-09 and NEW-10 are the same lesson as NEW-08 in two smaller places, and §13
covers them together with a regression this remediation introduced into
`PERF-S14` and then fixed.

The latest batch closed the test-coverage cluster — TC-C7, C8, C9, C10, C12 and
Q2 — plus API-F3, which that work turned up. **The six remaining Highs that were
blocked on §3 are no longer blocked**, because §3 is fixed; see below.

One thing to know about the register itself: the Summary sheet's `COUNTIF`
ranges were still pinned to row 206 while the Register sheet had grown to 213,
so every roll-up on that sheet had been quietly undercounting the seven newest
rows. Widened to row 500. If you trusted a Summary number taken between the
register growing and now, re-read it.

Nothing in this work has been committed. It is all in the working tree.

---

## 2. Do these before writing any more code

In this order. The first three gate a deploy.

```bash
npm install                                  # @socket.io/redis-adapter is new; CI now uses `npm ci`
npx jest tests/unit                          # first real Jest run of the new files — see §4
node scripts/db/probe-doc-numbers.js         # GATE: 0498's unique indexes have no NOT VALID escape
node scripts/db/reconcile-depreciation.js    # the books are wrong until this runs (DATA 5.5)
node scripts/check-api-contract.js --update  # then COMMIT doc/api-contract.json — CI fails without it
```

**Run Jest FIRST, before anything else in this list.** That line used to say the
new files "should need nothing" because they had been verified under the
substitute runner. They needed a great deal: the first real `npm test` produced
14 failing suites, 11 of them from a Jest rule the substitute runner does not
enforce and 6 of those written in earlier sessions. All fixed, and now guarded
in CI — but the general point stands and §11 spells it out. A green run under
`minijest` is not a verified run.

Owner-only, cannot be done from the repository:

- **Branch protection on `main`** — `doc/BRANCH_PROTECTION.md`. The only reason
  TC-CI1 is not closed. The code half is done: `deploy.yaml` refuses to deploy a
  commit that arrived without a pull request.
- **Fill in the on-call table** — `doc/INCIDENT_RUNBOOK.md` §2, four rows left
  `TBD` deliberately rather than inventing names.

---

## 3. The thing that was "broken and undiagnosed" — solved, and it was not a hang

`tests/unit/orchestration-outbox.test.js` now passes all ten assertions in 8.5s.
It used to die around test seven or eight with no failure and no summary, which
this document previously described as an undiagnosed exit hang and guessed was a
leaked timer or connection.

**It was neither. It was cost.** `dispatcher.js` requires `./handlers` at load,
which pulls a 171-module require graph. `jest.resetModules()` in `beforeEach`
made all ten tests rebuild all of it: measured at ~8.3s cold and ~6s warm on a
mounted filesystem, so the file needed about sixty seconds and every available
timeout is shorter than that. Seven tests × 6s ≈ 42s is exactly where it stopped.

The evidence that it is not a leaked handle: require the dispatcher in a bare
node process and it leaves **zero** active handles beyond stdout/stderr, and the
process exits 0 on its own.

The fix is to require the dispatcher once at file load and keep only
`handlers = []` in `beforeEach`. The reset was never needed — the dispatcher has
no module-level mutable state (a sweep's state lives on the `client` the caller
passes) and it resolves handlers through `registry.getHandlers()` at dispatch
time, so the mock picks up each test's handler list with nothing reloaded.

Two things worth carrying forward:

1. **This is the §6 rule biting the previous session's own note.** "A timer that
   is not unref'd" was a plausible story that explained the symptom, and it was
   wrong. Before hunting for the mechanism a story predicts, check that the
   story is true — one `process._getActiveHandles()` call would have ruled it
   out in a minute.
2. **A silent runner turns a slow test into a mystery.** The runner in §4 now
   streams each result as it happens and applies a per-test timeout, so the next
   time something stalls it says which test and for how long.

The `jest.setup.js` fix for `ALERT_WEBHOOK_URL` / `ALERT_EMAIL` from the earlier
session was a genuine and separate flake source. It stands.

---

## 4. About the tests, and a tool you will not find in the repo

**Jest cannot run in the Cowork sandbox.** Module resolution over the mounted
filesystem costs roughly 1.2 s per file, so even a single test file exceeds every
available timeout. This is an environment limit, not a project problem — Jest
runs fine on your machine and in CI.

The new test files were therefore written as **real Jest files** and exercised
under a small Jest-compatible runner living outside the repo at
`<scratch>/minijest.js`. **"Exercised", not "verified" — see §11.** It does not
run babel, so it enforces none of babel's rules, and eleven suites passed here
while failing under Jest. It implements only the subset they use: `describe`,
`it`, `beforeEach`, `expect` with the common matchers, and `jest.fn` /
`jest.mock` / `jest.resetModules`.

Two consequences worth knowing:

1. **The test files are written to that subset on purpose.** `jest.mock` is
   always called before the module under test is required, and the module is
   required lazily inside `beforeEach` where it matters. That pattern is valid
   under real Jest and is what makes the files portable. Keep it.
2. **The runner is not a deliverable and is not committed.** If you need it
   again, rebuild it — or better, just run Jest, which is the point.

**Rebuild it with these four properties**, each of which cost time to learn:

- **Key mocks on the RESOLVED path, not the request string.** A mock registered
  as `"../../src/orchestration/registry"` must match the dispatcher's own
  `"./registry"`. Getting this wrong makes mocks silently inactive, and twelve
  tests then fail for reasons unrelated to the code.
- **Stream each result as it happens, and time out per test.** Buffering until
  the file finishes means a stall prints nothing at all — see §3.
- **Do not `unref()` the timeout timer.** An unref'd timer lets node exit the
  moment a hung test leaves the loop empty, so the process dies mid-file with no
  summary: the exact failure the timeout exists to remove.
- **Set `process.exitCode`; do not call `process.exit()`.** `exit()` truncates
  buffered stdout when piped, which eats the summary line.
- Make `resolves` / `rejects` proxy *every* matcher rather than a hand-picked
  few, and implement `jest.doMock`. Missing either produces
  "`toMatchObject` is not a function", which reads exactly like a product
  failure and is not one.

It earned its keep four times now: its own mock resolution was wrong; a fake
pool that never recycled clients made a `search_path` re-bind test pass for the
wrong reason; a fake's rollback truncated the movement journal to a high-water
mark and so rolled back a *concurrent* transaction's committed work; and a
non-re-entrant row lock in the same fake self-deadlocked nested moves. **Three of
those four were fixture defects that looked like product bugs.** Suspect the
fixture first.

**Assertion counts in this section were measured under the substitute runner
and are NOT a Jest result — see §11 before trusting them.** 372 assertions
across seventeen files pass under  — the twelve that
already did (`tenant-registry`, `auth-middleware`, `rbac-enforcement`,
`identity-cache`, `api-contract`, `money-path`, `auth-refresh-rotation`,
`orchestration-outbox`, `capability-assignment`, `async-safe`,
`health-and-error-contract`, `logout-revokes-session`) plus the five below.

`health-and-error-contract` builds the whole app and needs
`MINIJEST_TIMEOUT=40000` in this sandbox; it is not slow anywhere else.

### The files this batch added

| File | Finding | Assertions |
|---|---|---|
| `auth-refresh-flow.test.js` | TC-Q2 | 22 |
| `portal-auth.test.js` | TC-C10 | 45 |
| `tenant-provisioning.test.js` | TC-C9 | 52 |
| `wms-inventory.test.js` | TC-C7 | 35 |
| `middleware-chain.test.js` | TC-C12, API-F3 | 42 |

**Every one was mutation-tested**, because §6's second pattern says a passing
test proves nothing on its own. In each case the pre-fix behaviour was
reintroduced and the file re-run:

- disabling the `refreshTokenReused` call site fails 3 of the new refresh tests
  and **0 of the 5 pre-existing predicate tests** — which is precisely the
  complaint TC-Q2 made, demonstrated rather than asserted;
- removing the portal `typ` check, the SEC H6 policy call, the grant re-check
  and the ACTIVE-status check fails 10 of 45;
- five simultaneous provisioning mutations fail 11 of 52;
- restoring the pre-DATA-5.1 read-modify-write `move()` fails 9 of 35, including
  both concurrency races.

Do this for anything you add. It is twenty minutes and it is the difference
between a test suite and a decorative one.

---

## 5. What the first deploy will do

Migrations **0499–0503** apply: 71 CHECK constraints, 290 FK indexes, the ledger
hash chain, `request_id` on the audit tables, the currency FKs, and the
depreciation invariant.

Everything that could fail on historical data is `NOT VALID`, so the migration
will not block — **but those constraints are not enforced on existing rows until
they are `VALIDATE`d separately.** Each migration file names its own. Do the
probes in §2 first, then validate.

CI is now much slower and will surface things that were previously invisible: it
spins up Postgres, provisions a tenant from nothing, applies migrations twice to
prove idempotency, boots the built image, and runs the integration suites that
have been dark since they were written.

One client-visible change from the last batch (API-F3): the six middleware-level
error responses that used to answer `res.status(...).json(...)` directly now go
through the error handler, so their bodies gain a `request_id` field. Status
codes and error codes are unchanged and asserted as unchanged — this is an
addition to the envelope, not a reshaping of it. The affected responses are
`TENANT_NOT_FOUND`, `TENANT_SUSPENDED`, `TENANT_NOT_READY`, `NO_TENANT_CONTEXT`
(twice) and `FEATURE_DISABLED`. Side effect worth expecting: the 500s among them
are now logged and reported, so a misordered middleware chain becomes loud
rather than silent.

---

## 6. How to think about this codebase

One pattern accounts for most of the findings, and recognising it is worth more
than any individual fix:

> **A control is documented as working and is not.**

Verified instances: a health check that could not fail; `pino-http` declared as a
dependency and mounted nowhere; a secret scanner pointed away from the secrets;
`cached_receivables` read on every credit check and written by nothing;
`before_hash`/`after_hash` described in the architecture doc and populated never;
`required_permission` selected into the AI tool list and compared against
nothing; RLS apparatus maintained for policies that do not exist; `initDatabase()`
never called, so every cron job's advisory lock silently failed; four integration
suites that self-skip because an env var was never set.

The practical rule that follows: **when a comment explains why something is the
way it is, check the premise.** Two of the fixes here exist because the stated
reason was false — `npm install` was justified by a lockfile concern that
lockfileVersion 3 makes obsolete, and the "deliberately not cached" note on the
scope closure was right about the risk and wrong about how often the code runs.

Second pattern, this one self-inflicted: **isolation testing proves a piece
works, not that it is right.** Several fixes in this work were corrected by
contact with the real system or by writing the test. Prove old-vs-new behaviour
with a targeted harness before claiming a fix.

A third, learned from the test batch: **a test that cannot fail is worse than no
test, because it is counted.** Two concrete shapes to watch for, both of which
were written and then caught in this work:

- **An assertion on a counter nobody incremented.** `expect(fetchCalls).toBe(0)`
  reads like a network guard and asserts nothing at all when `beforeEach` just
  reset it to 0. Measure *across* the call — capture before, compare after.
- **A fake that returns `{rows: []}` for unrecognised SQL.** It cannot tell a
  dropped `WHERE` clause from a query that was never issued. Throw instead. The
  two files here that do it found real mismatches immediately.

And the general form: after writing a test for a fix, **break the fix and check
the test fails.** Every file in the last batch was put through that, and every
one of them caught it. A test that passes against the broken code was measuring
something else.

---

## 7. What is left

**Remaining Critical (1)** — TC-CI1, owner action only.

**Remaining High (12)** — the test-coverage cluster is closed.

| Cluster | Findings | Note |
|---|---|---|
| Deploy & environment | OBS-I3, OBS-I4, TC-CI2, TC-D5, TC-D6, TC-E1 | Mostly process + `deploy.sh`. The obvious next batch: six findings, all verifiable in-repo, none needing a database |
| API contract | API-F21, API-F25 | F21 is a real inconsistency; F25 is now partly moot — `check-api-contract.js` derives the surface from code, which is what a spec was wanted for |
| Data | DI-2.4, DI-3.5 | DI-3.5 is Partially fixed: new migrations must declare a down block, the existing 99 are grandfathered |
| Perf / infra | OBS-I6, PERF-S8 | S8 is a Vite config change; needs a real build to verify |

**Mediums and Lows (93)** — largely API-contract consistency (F10–F12, F17, F22,
F23, F28, F29) and the long tail. Several Mediums are one-liners that were
skipped only because Criticals and Highs came first.

Two of the remaining ones now have a test waiting for them, which is worth
knowing before you start:

- **DI-5.6** (sandbox wipe not transactional) — `tenant-provisioning.test.js`
  asserts the *current* non-transactional behaviour deliberately, so it will
  fail when you fix it. That is the intent: update the test in the same pass.
- **TC-Q3** (regex SQL fakes absorb query changes) — `wms-inventory.test.js`
  shows the alternative. Its fake throws on unrecognised SQL instead of
  returning `{rows: []}`, which caught two genuine mismatches while it was being
  written. Worth copying when you get to `final-invoice-lifecycle.test.js`.

---

## 8. Working agreements from the session

Carried forward because they shaped everything above:

- **Full fixes only.** No partial fixes, no trailing caveats. If something cannot
  be finished, say so plainly and mark it Partially fixed in the register with
  the reason — do not describe it as done.
- **Ten findings per batch**, then update the register in the same pass.
- **The register is not optional.** Every batch updates Status, Verification and
  the evidence note.
- **Mask credential values** in all output. Rotation is the fix; there is no
  git-history purge and that was a deliberate decision.
- The owner commits. Work is left staged or in the working tree.

---

## 11. The substitute runner was weaker than Jest, and hid real failures

**Read this before trusting any "verified" claim in this document.**

The first real `npm test` run after two sessions of work produced **14 failing
suites**. None of them was a fluke, and the pattern behind most of them matters
more than any individual fix:

> `minijest` does not run babel. Jest does. Everything babel enforces, the
> substitute runner silently permitted.

Concretely, **eleven suites violated Jest's mock-hoisting rule** — a
`jest.mock()` factory may not reference an out-of-scope variable unless its name
matches `/^mock/i`, because the transform hoists the call above the imports.
**Six of those eleven were written in earlier sessions** and had been recorded
as passing. They were not passing; they had never been run by Jest.

That is the same failure this whole remediation keeps finding — a control
described as working that is not — except the control was our own verification.

What is now in place:

- All twelve violations fixed (the twelfth, `identity-cache`'s `CTX`, the Jest
  run had not even reached).
- **The checker itself had this same defect once.** Its first version masked
  string literals across the whole file, and these test files contain REGEX
  LITERALS holding quote characters — `/WHERE "?inventory_item_id"? = \$1/`.
  Those quotes paired with unrelated ones and the mask swallowed whole regions
  of real code, so it reported `wms-inventory` CLEAN while Jest rejected it.
  Masking is now per-line, which bounds an unbalanced quote to one line. Both
  the checker and the earlier rename script were wrong in the same way, which is
  worth remembering: **a mask that spans lines is a liability in a file that
  contains regexes.**
- **`scripts/check-jest-mock-hoisting.js`**, wired into CI. Static, cheap, and
  it deliberately does NOT flag `jest.doMock` — that form is un-hoisted and the
  rule genuinely does not apply, which cost one false positive to learn.
- The rule is NOT enforced inside `minijest`: a runtime check there cannot see
  the test module's scope, only its own, and produced false positives on arrow
  parameters. The repo is the right home for it anyway.

**Also fixed:** `scripts/check-api-contract.js` had a top-level `return`. Node
tolerates it (CommonJS wraps modules in a function); babel does not, so the
moment `api-contract.test.js` required it for `diffSurface`, the whole suite
failed to parse. The script worked perfectly from the CLI, which is exactly why
nothing noticed.

**A REAL BUG came out of this, and it is the best argument for running Jest.**

`notify-events` looked like a stale test: PERF S5 replaced the per-recipient
`notify` loop with one batched `notifyMany`, and the test still asserted
`notify`. Three of its four cases were exactly that. The fourth was not — it was
the only test still asserting the real contract, and it was right:

```js
try {
  ...
  return service.notifyMany(...);   // BUG
} catch (err) { return 0; }
```

**In an async function, `try { return p; }` does not catch `p`'s rejection.**
The return adopts the promise and the rejection escapes the handler entirely.
This function is documented and relied upon as BEST-EFFORT — an event fan-out
must never fail the business operation that produced the event — and it was
not. A notification failure propagated straight out to the caller.

Fixed with `return await`. I swept `src/` for the same shape: the other five
candidates all return synchronous values, so this was the only instance.

**All of them are now fixed, and every one was a STALE TEST, not a product
bug — except the `notify-events` one above.** The pattern is worth naming
because it recurred four times in four files:

> An earlier session tightened the product and left the test asserting the old
> contract. Nothing caught it, because Jest was never run.

| Suite | What had drifted |
|---|---|
| `notify-events` | PERF S5 replaced `notify` with batched `notifyMany`. 3 of 4 cases were stale; the 4th found the real `return await` bug. |
| `ai-batch` | SEC H1 made `action-authz` FAIL CLOSED — an action whose catalogue row declares no `required_permission` is denied. The fake supplies no catalogue row, so every action was denied and the batch halted on the first. The subject of that file is halt-on-failure sequencing, so the gate is now satisfied explicitly with a CEO rather than the permission matrix being re-encoded into a sequencing test. |
| `error-reporting` | TWO layered defects. (1) `errorHandler` was required at describe-time while `freshReporter()` calls `jest.resetModules()`, so the handler reported into a DEAD module instance and `received` stayed empty — the product was reporting correctly the whole time. The same identity trap made `err instanceof ZodError` false against a class from a different module instance, sending every validation error down the 500 branch. (2) With that fixed, the ZodError case returned **422** — because API F-2 standardised validation on 422 to match the 90 module validators, and this assertion predates it. The first defect had been *masking* the second. |

**The generalisable lesson: `jest.resetModules()` invalidates every reference
you captured before it.** Require inside the factory/helper that runs after the
reset, not at describe-time. Two of the four failures here were that single
mistake, and it produces symptoms that look exactly like product bugs —
"the error was not reported", "the wrong status was returned".

**The lesson for the next session, stated plainly:** a substitute runner that is
MORE permissive than the real one does not merely miss failures — it
manufactures confidence, which is worse than not running the tests at all. If
you use `minijest` again, treat a green run as "probably not broken", never as
"verified", and get a real `npm test` in front of anything before you write it
into the register.

---

## 10. The API-contract + data/perf batch — what to know

**Behaviour changes a client can see.** All deliberate, all owner-approved:

- **A permission tightening (F-17/F-21).** Lifecycle transitions now gate per
  target state, and `PATCH /:id { status }` meets the same gate as
  `POST /:id/status`. A caller with the right permission is unaffected; one
  taking the old cheaper path gets a 403. That 403 IS the fix — the transition
  gate used to be optional because PATCH bypassed it. One deliberate LOOSENING
  in the same change: `proposal` was flat `approve` for every target, so only
  approvers could *submit*; DRAFT/IN_REVIEW/SENT relax to `edit`.
- **Smart Comms writes moved from `view` to `edit` (F-22)** — archive, add and
  remove member, edit and delete another's message. Own-preference writes (pin,
  mute, read, draft, star, react) deliberately keep `view`.
- **`400 WRONG_HOST` instead of `500` (F-4)** on a tenant-API request arriving
  on a platform host.
- **`422` instead of silence for a bad filter or sort (F-28/F-29)** on the 16
  repos that declare a `filterable` set. Those keys were being *ignored*, so
  anything relying on them was already getting the wrong answer.

**Two CI gates were added** — `check-actor-fk-guard.js` (DATA 2.4) and
`generate-api-docs.js --check` (F-5/F-25). Both fail the build; both were
verified to bite before being wired in.

**Migrations: 0496 and 0499–0506 are now ALL self-guarding, and that was not
optional.** Running the fleet migrate exposed three separate failures in a row,
each of which rolled back an entire file and wedged the tenant behind it:

1. `0496` — `column "created_at" does not exist`. The 130-index list was derived
   by PARSING THE MIGRATION DDL, and **the files and the live schema have already
   drifted** (DATA 3.3). One missing column killed all 130.
2. `0499` — `EXCLUDE constraints cannot be marked NOT VALID`. `NOT VALID` exists
   only for FOREIGN KEY and CHECK. The other 84 constraints in that file are one
   of those two, which is why nothing else tripped.
3. `0499` again — a PL/pgSQL syntax error in my own repair.

So every index and constraint in `0496`, `0499`, `0500`, `0502`, `0504` and
`0505` now checks that its table and column actually exist, creates only what is
missing (re-runnable), and **reports what it skipped by name**. The exception
handlers catch `undefined_table` / `undefined_column` ONLY — a named, expected
condition that is reported, which is the whole difference between this and the
`EXCEPTION WHEN OTHERS THEN NULL` anti-pattern in DATA 3.6.

Editing applied migrations in place is normally forbidden here. It is safe in
exactly this case and no other: **`applyTracked` writes the ledger row only
AFTER the file succeeds**, so a file that FAILED has no ledger row anywhere.
Tenants where it already succeeded will never re-run it.

Two things this cost that are worth internalising:

- **Parse-checking is not enough.** I verified all of these against the real
  Postgres grammar via `libpg-query` (WASM) and it passed the `NOT VALID`
  version happily — that rule is *semantic*, enforced only at execution. And
  `libpg-query` does not validate PL/pgSQL inside a `DO` block at all, which is
  where the third failure lived. **This is TC-CI6 exactly: the first execution
  of a migration is production.** Nothing short of running them against a real
  Postgres will catch this class.
- **Keep PL/pgSQL boring.** The third failure was my own multi-line `RAISE`
  relying on implicit string-literal concatenation, plus an over-clever
  aggregate probe. Both are now single-line and simple. Cleverness inside a `DO`
  block on a live tenant costs a failed migration and a round trip to find out.

A skipped constraint is NOT a safe constraint — it means that invariant is
unenforced on that tenant, and the WARNING names it. Fix the drift, re-run.

**API-F23 is the one I did not close, on purpose.** The plan was to publish the
self-scoped access tier in the generated API reference. `doc/api-contract.json`
records `auth`/`rbac` from the middleware names on each route's own stack, but
nearly every router applies auth once via `router.use(authMiddleware)`, which
never appears on the route — so the flags read `auth: false` for hundreds of
routes that are authenticated. Classifying off them produced *"713 public, 9
self-scoped"* against the audit's 10 and 61. **A security tier table that lies is
worse than none**, so the section states why it is absent and points at
`API_CONTRACT_AUDIT.md` §F-23/F-24 meanwhile. Closing it means resolving
router-level middleware inside `check-api-contract.js`, so that CI and the doc
share one answer — contained, but it belongs to that script.

**A note on PERF-S15.** Half of it was already done and the register did not say
so: `use-resource.ts` had already been migrated to TanStack Query. Only the
badge poller in `app-shell.tsx` was still outside the cache. Worth remembering
that the register can lag the code in the *optimistic* direction too.

**The tripwire fired, as designed.** The DI-5.6 assertion left in
`tenant-provisioning.test.js` — which asserted the *old* non-transactional
behaviour — failed the moment the fix landed and was rewritten deliberately.
That is the mechanism working; leave more of them.

**Three fixture defects surfaced, all of them mine or the suite's, none product
bugs**: eight pre-existing test files mocked `shared/events/emit` without
`resolveActorId`; `final-invoice-lifecycle.test.js`'s regex fake matched the
unquoted `WHERE invoice_id` only (which is TC-Q3 seen from the inside — worth
reading before you take that finding); and the runner needed five gaps closed
(auto-mock, callable auto-mock, `getMockImplementation`,
`toHaveBeenNthCalledWith`, asymmetric `toEqual`). One of those was a **false
PASS**: `deepEqual` compared an array to `{}` as equal on key count. Fixed.

---

## 12. NEW-08 — the integration suites found a flow that had never worked

This is the first thing the real-Postgres integration job did, and it is the
best argument in this document for keeping it.

**`dossier` has no `title` column.** 0310 created the table without one; the only
`ALTER TABLE dossier` in the tree before 0508 is 0479, adding
`pol_place_id`/`pod_place_id`. Two services write one anyway:

```
src/orchestration/handlers/opportunity-won-open-dossier.js:48
src/modules/sales/opportunity/opportunity.service.js:62    win({ createDossier })
```

Both reach `insertOne(client, "dossier", data)`, which builds its column list
from `Object.keys(data)`. Its identifier check asks whether a key is a *legal
identifier* — `title` is — not whether the table has it. So the key went to
Postgres and came back `42703`.

**Two failure modes, and the quiet one is worse.**

- The **event** route fails inside the outbox. `dossierSvc.create` rolls back and
  rethrows, the dispatcher marks the row FAILED, retries, and lands it in DEAD.
  The user who clicked *Won* gets a **200**. The opportunity is marked won, no
  dossier exists, nothing links them. Sales believes it handed the job to
  Operations; Operations never sees it. Nothing surfaces but a dead-letter row.
- The **synchronous** route — `POST /opportunities/:id/win` with
  `createDossier: true` — is not swallowed. It 500s. **That flag has never once
  succeeded.**

The costing failures in the same run (`dossier_id violates not-null`) are this
defect one step later: the dossier that should exist does not.

**Why the column, rather than deleting the argument.** Both call sites are
carrying `opportunity.name` — the human label for the deal — across the
sales/operations boundary, and `dossier` had nowhere to put it: its only
name-like column is `ref`, a machine-allocated number (`SLAS-2026-0001`). The
authors were not inventing a column at random; they were writing to the field
the model was missing. Dropping `title:` would also make the flow work, and
would lose the deal name at exactly the handoff where Operations most needs to
know what the job is. Migration **0508** adds it (nullable, plus a backfill from
`opportunity.name` for hand-linked dossiers).

**Why nothing caught it for months, which is the transferable part.** Three
layers each had a reason not to:

1. the zod validator strips unknown keys — but **both broken call sites reach
   `service.create` in-process**, with no HTTP request anywhere near them;
2. `insertOne` validates identifiers, which stops injection and knows nothing
   about the schema;
3. the unit suites fake the client, and **a fake accepts any column name you
   hand it**.

Only a real database ever said no. That is TC-Q3's argument — *the fix is not a
better fake, it is a real database* — arriving as a concrete production bug
rather than a finding.

**What was added so the next one fails cheaply.** `operations_file.repo.js` now
declares a `writable` allow-list (the layer that would have caught it, because
it sits next to the SQL and applies to every caller, HTTP or not), and
`tests/unit/dossier-columns.test.js` reconciles that list *and* both call-site
payloads against the columns the migrations declare. No database needed — it
fails in the fast suite, at the moment the mismatch is written.

That reader had the defect this remediation keeps finding, caught while writing
it: it read `DROP COLUMN` out of a **comment**. Every migration here documents
its rollback in comments, so it reported `title` phantom on the migration that
adds it. It strips comments now, and the first assertion in the file checks the
reader found a plausible table at all — a scanner that silently matches nothing
passes every other assertion vacuously.

**Not yet executed.** 0508 has not been applied and has not been parsed — the
session that wrote it had neither Postgres nor `libpg-query`. Run
`npm run db:migrate:tenants`, then the orchestration integration suite. Given
0499 took four attempts to apply, assume this one may need a second look.

---

## 13. The three things the first green-ish CI run cost, and what they teach

All three were found by running the pipeline properly for the first time. Two of
them are mine.

### PERF-S14 — I introduced a stale-closure bug in the auth path

S14 wrapped six `AuthProvider` handlers in `useCallback`. I gave **all six** an
empty dep array. Two read render state:

- `verify2fa` reads `pendingToken` → would have sent `pending_token: null`, so
  **2FA could never complete**
- `registerPin` reads `user` → `if (user)` never true, so the server registers a
  PIN device the browser never records and the next PIN login fails
  `NO_PIN_DEVICE` **against a device that exists**

`eslint react-hooks/exhaustive-deps` caught both. The other four are genuinely
stable and keep `[]`. `acceptTokens` is deliberately *not* a dependency: it
closes over nothing from render scope, and listing it would make three handlers
unstable every render and undo S14 for nothing.

The part worth carrying: **the comment in the file asserted all six were
stable**, and stayed there while the code stopped matching it. That is the
failure this whole remediation is about, committed by the remediation.

### NEW-10 — a spy type that erased the contract, hiding nine bad fixtures

Pinning the client to vitest 3 broke `tsc -b` on two test files.
`ReturnType<typeof vi.spyOn>` names the generic *without instantiating it*, so it
resolves to the uninstantiated default and the real spy will not assign to it. It
compiled under vitest 4 by accident.

Typing from the spied function instead (`MockInstance<typeof apiClient.tenantPaged>`)
fixed it — and immediately failed nine more times, because every fixture passed
`{ data, total }` while `Paged<T>` also requires `limit`, `offset` and `hasMore`.
The fake had been handing the hook `undefined` for all three and **nothing could
complain**, because the erased type let `mockResolvedValue` accept anything.

TC-Q3 again, from a new angle: *a fake that cannot disagree with the contract it
replaces*.

**Decision recorded:** stay on **vite 5 + vitest 3**. Forward (vite 7 + vitest 4)
leaves those two files untouched but is a build-tool major nobody can verify
without a real build — and PERF-S8, a Vite config change needing exactly that, is
already open. Do them together or not at all.

### NEW-09 — the fixture never satisfied the contract the suites document

Both integration suites state their requirements in their own headers. The
workflow fixture was written from what they obviously needed instead:

- **no `accounting_period`** — journal-posting failed `No accounting period
  covers <today>`; ledger-hardening's `beforeAll` left `period` undefined and all
  six tests died on `period.period_id`, six identical errors naming the reader
  and not the cause
- **account `521`** is the non-postable parent; `5211` is the leaf. The service
  was right to refuse it
- and the one that matters most: `rejects an unbalanced entry` asserted only
  `.rejects.toThrow()`, so it **passed on the not-postable error and never once
  reached the balance check it is named after**

A negative test that cannot say *why* it failed will pass for the wrong reason
indefinitely. It now asserts `/Out of balance/`, the fixture seeds an OPEN
calendar-month period computed in SQL and *asserts* one covers today before
running anything, and `beforeAll` throws a message naming the missing fixture.

**Not executed here** — no Postgres in the session that wrote it. `ci.yaml` is
YAML-validated and both suites parse-check; the job is the verification.

---

## 9. Starting a new session

Point it at this repository and say:

> Read `doc/REMEDIATION_HANDOFF.md` and `doc/AUDIT_REGISTER_2026-08-04.xlsx`,
> then continue the remediation.

Give it the working agreements in §8 up front — they are the difference between
useful batches and a lot of half-finished work.
