# Remediation handoff — read this first

Continuation notes for the Phase-0 audit remediation. Written 2026-08-05, and
updated later the same day after the test-coverage batch.

**Source of truth is `doc/AUDIT_REGISTER_2026-08-04.xlsx`**, not this file. Every
finding has a Status, a Verification column, and an evidence note explaining what
was done and how it was proven. This file is orientation and the things a
spreadsheet cannot hold.

---

## 1. Where it stands

**188 of 217 fixed.** Criticals 45/46, Highs 74/80, Mediums 51/67, Lows 14/19.

**Every remaining item is a decision, a settings change, or a project** — none
is a fix waiting to be written. See §18.
One finding (NEW-07) is **Withdrawn** — see §16.

The most recent batch took the API-contract and data-integrity/perf clusters —
twenty findings closed, one (API-F23) attempted and deliberately left open; see
§10.

The register grew from 205 to 217 rows: findings NEW-01…NEW-12 were discovered
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

## 14. The client suite's failures were all about the environment

Two rounds: 726/3 failed, then 735/6 after a new suite landed. **Not one of the
failures was about the code under test** — which is itself the finding. Full
detail is NEW-12; the transferable parts:

- **A test that could only ever run on Linux.** `execFileSync("mkdir", ["-p", …])`
  — there is no `mkdir` binary on Windows, it is a cmd.exe builtin, and
  `execFileSync` uses no shell. Green on the CI runner nobody reads, red on the
  machines everybody uses. The same file shelled to `npx` twice, which fails the
  same way; `shell: true` would have fixed the launch and broken the arguments,
  re-splitting `--name "Widget orders"` on the space. Both now call `node`
  against the local bin scripts.

- **A comment that was measurably false, again.** `config/shared-alias.ts` said
  *"Vitest externalises node_modules and loads them through Node, whose exports
  map hands BOTH sides ./index.cjs — already one instance."* Node does no such
  thing: `require("zod")` gets `./index.cjs`, `import "zod"` gets `./index.js`,
  and `instanceof` between them is false. It held only because vitest 4 put both
  sides through CJS interop, and broke when the client was pinned to vitest 3
  (c58b10f). **That is the third thing that pin has cost.** The alias now names
  `./index.cjs` explicitly, which is one instance by construction whatever the
  runner does.

- **A shell rendered without the app's providers.** `top-shell.test.tsx` mounted
  `AppShell` in a bare `MemoryRouter`; `useUnreadCounts` calls
  `useQueryClient()`, which throws *during render*, so all six tests died before
  asserting anything about the strip. It uses `renderScreen()` now. Worth
  noticing that the harness's own comment predicted it — it gained
  `ToastProvider` after the journal-entry form lost four assertions the same
  way, and says so: *"the only path that exercised the harness was the only path
  that could not see what it was missing."* **Anything that renders a shell
  should go through the harness**, rather than assembling a subset of the root
  providers and discovering which one is missing one hook at a time.

- **An assertion that depended on where the developer sits.** An ETA rendering
  `04 Jul 2026` is true at UTC and false in Douala. There is no timestamp that
  fixes it — for a date to survive UTC-12…UTC+14 the UTC hour must be both `>= 12`
  and `<= 9`. `vitest.config.ts` pins `TZ=UTC`.

**The bug underneath that last one is real and is NOT fixed** — see **NEW-11**.
A Postgres `date` leaves a WAT API as `…T23:00:00Z` and is formatted in the
viewer's zone, so client and API only agree while they share a timezone. It
needs a decision (serialise `date` as `YYYY-MM-DD` at the API? format with an
explicit zone — the viewer's, the tenant's, or the *port's*?), not a patch.

**On the vitest pin.** It has now caused two `tsc` errors, a Zod instance split,
and — via the precise typing that fixed the first — exposed nine incomplete
fixtures. The last of those was a net win. It is still the right call to stay on
vite 5 + vitest 3 rather than take a build-tool major nobody can verify, but if
PERF-S8 is ever done, do the vitest 4 move in the same change.

---

## 15c. Security sweep — SEC-M9, M8, M3, L2 and PERF-S18

**Two of these were already half-done and saying so matters more than redoing
them.** SEC-L2's keyspace namespacing and its `KEYS`-sweep problem were closed
by PERF-S9; only Redis authentication remained. And **SEC-M8's justification had
evaporated**: `unsafe-inline` was relaxed application-wide for the Control
Tower's `<iframe srcDoc>` mock, and **Phase 3 / AUDIT F1 deleted that iframe.**
The primary XSS defence had been switched off across every page including login,
for months, protecting a feature that no longer existed — with the refresh token
in web storage, a single XSS bought thirty days of account access.

That is a pattern worth naming: **a documented, deliberate exception outlived
its reason silently, because nothing ties an exception to the thing that
justified it.** TC-CI4's dated `npm audit` expiry is the shape of the answer.

Before removing it I verified the alternative was real, since this fails closed
and visibly: one external `<script>` per `index.html`, `injectRegister: false`
so the PWA emits no inline registration, and the two surviving `srcDoc` iframes
use `sandbox=""` / `sandbox="allow-same-origin"` — neither grants
`allow-scripts`, so scripts cannot run in them at all.

**SEC-M3** now resolves authority from the **record**, not the screen. The vault
holds payslips, contracts and ID documents; MOD-64 `view` alone let an
operations clerk download HR files about colleagues. The existing
`moduleKeyForDocType` pattern keys off the URL, so it could not be reused
directly — here the doc type is a column, so the record loads first and the
grant is checked against what it turns out to be. **MOD-64 still passes on
purpose:** revoking the vault administrator's own grant in the same change would
be a silent lockout dressed as a security fix.

**PERF-S18** keys the new global limiter by **tenant**, not IP — an office
behind one NAT looks like a single abuser, a distributed integration looks like
a thousand innocents, and the tenant is the unit the capacity is shared between.
Set high (600/min) because it is a circuit breaker, not a quota: a ceiling that
trips on real use gets raised in a panic mid-incident and stops being a control.

**SEC-M9** adds Dependabot and CodeQL. Weekly and grouped — a bot that opens
fifteen PRs a week gets muted, and a muted bot still looks like coverage.
`vite`/`vitest` majors are ignored because they are pinned as a pair (§14).

**The TC-E1 gate caught my own omission** while doing this: `REDIS_PASSWORD` was
added to `.env.example` and not to the schema, and CI told me so.

---

## 15b. API-F23 / SEC-L5 — the walk is DONE; the table is not published

**Fixed:** the effective-middleware walk in `check-api-contract.js`. It now
carries `router.use(...)` down to the routes it protects, accumulating in order.
**19 public / 94 self-scoped / 624 gated**, against the old flags' nonsense
"713 public". `doc/api-contract.json` records a tier per route.

**Three live blind spots found by doing it** — all the same shape, an
authorisation gate invisible because its function had no useful name:

| Where | Was | Effect |
|---|---|---|
| `portal_auth.middleware.js` | anonymous function | the **entire external portal product** (`/portal/me`, `/client`, `/investor`, `/auditor`) read as PUBLIC |
| `platform-auth.js` `requirePlatformRole` | `check` | platform admin routes unrecognisable |
| `platform-auth.js` `requireCap` | `check` | same |

Now `portalAuthCheck`, `platformRoleCheck`, `platformCapCheck`. These were real
gaps in any inventory of *"what is reachable without credentials"*, not tooling
noise.

**Deliberately NOT published, and this is the finding repeating itself.** About
23 `/api/platform/*` routes still classify self-scoped, including
`DELETE /platform/tenants/...`. Their capability gates are applied somewhere the
walk does not yet see — **or they genuinely lack one**, which would be a finding
of its own worth checking before anything is written down. Emitting a tier table
now would repeat exactly what kept F23 open: a security document that lies.

**To finish:** resolve the platform classification (start at
`src/modules/platform/platform.routes.js` — see whether caps are applied
per-sub-router), then uncomment the tier section in `generate-api-docs.js` and
add the CI gate that fails on any public/self-scoped route absent from an
explicit allow-list. That gate is what turns the convention into a control.

---

## 15. QUEUED — how to actually close API-F23

Left Open deliberately (see §10 and the note above `renderApi` in
`scripts/generate-api-docs.js`). The plan, so the next session does not have to
rediscover why the obvious approach fails:

**The problem.** `doc/api-contract.json` records `auth`/`rbac` per route from the
middleware on *that route's own stack*. Almost every router does
`router.use(authMiddleware)` once at the top, which appears on no individual
route — so hundreds of authenticated routes read `auth: false`. A first
generator classified off those flags and produced **"713 public, 9 self-scoped"**
against an audit count of 10 and 61. Publishing that would have been a security
tier table that lied.

**The fix — runtime introspection, not static analysis.**
`check-api-contract.js` already mounts the real routers, so the answer is in
`router.stack`:

1. Walk the stack carrying context down. A `router.use(fn)` is a layer with no
   `.route`; a route is a layer with `.route.stack`. Accumulate router-level
   handlers as you descend and prepend them to each route's own stack — that is
   the EFFECTIVE middleware, which is what is missing today.
2. Classify from that: no `authMiddleware` → public; auth without
   `requirePermission` → self-scoped; both → gated. Write the tier into
   `api-contract.json`.
3. **Sanity-check before trusting it.** The result should land near 10 / 61 /
   rest. If it does not, the walk is wrong — this step is what stops a repeat of
   "713 public".
4. **Then make it a control, which is the real prize.** Fail CI if any route is
   public or self-scoped and not named in an explicit allow-list file. Adding an
   ungated route then costs a line that says "yes, deliberately" — and
   `POST /sessions/:id/kill` (NEW-07) would have failed that build.
5. The doc falls out free: `generate-api-docs.js` already has the tier section
   written and suppressed; it only needs the field to exist.

Steps 1–3 are the work. Step 4 is small once 1–3 are right. Step 5 is
uncommenting.

---

## 16. Group 1 (Security) — 4 of 11 done, 7 to go

**Done:** SEC-M1, SEC-M4, SEC-L1, and NEW-07 **withdrawn**.

**NEW-07 was my error, and the shape of it is the point.** I filed
*"`POST /sessions/:id/kill` has auth but no `requirePermission`"* after reading
`session.routes.js`. `session.service.js` `kill()` enforces exactly the right
rule — self always allowed, `is_ceo` allowed, otherwise MOD-68 `can_update`,
else 403 — and the route is ungated deliberately, with a comment one line above
saying so, because a `requirePermission` there would stop a user ending their
own session. I judged a control by where I expected it to live rather than by
what it does, which is the mistake this remediation keeps documenting in other
people's code. Left in the register as Withdrawn rather than deleted: a
withdrawn finding is evidence about the review. It also *strengthens* API-F23 —
this is exactly a self-scoped route whose authorisation is real, enforced one
layer down, and invisible at the route.

**Two of the three fixes had a trap in them, both the same shape:** the obvious
fix would have closed the hole and broken something real.

- **SEC-M1** — rejecting on "not in Redis" would sign out every user of every
  tenant the first time Redis restarted, because Redis is a cache and
  `killed_at` is the record. Hence a three-valued check where *absent* means
  *ask Postgres* and only *unreachable* means *assume nothing*, and a deliberate
  fail-open when neither layer can answer.
- **SEC-M4** — deleting the client-supplied `auth.host` would have broken every
  developer's local socket, because it is a documented dev affordance for the
  Vite proxy. Gated on `NODE_ENV` instead, matching the origin check beside it.
- **SEC-L1** — `USER node` alone would have produced a green deploy that failed
  on its first write, because bind mounts keep host ownership. `deploy.sh` does
  the chown.

**Remaining 7, with the honest reason each is still open:**

| ID | Why it is not done |
|---|---|
| SEC-M9 | Dependabot + CodeQL are file additions and safe; the `npm audit` fixes are not, on a tree that has already had lockfile trouble. Do the config here, the bumps on a machine that can run `npm ci`. |
| SEC-L5 | Per-route anonymous-surface assertion. **Do this with API-F23 (§15) — it is the same router walk**, and doing them separately means writing it twice and risking two answers. |
| SEC-L2 | Redis password + per-tenant key prefix + `KEYS`→`SCAN`. Touches the hot identity-cache path; needs care, not scale. |
| SEC-M3 | Vault record-level authz. The pattern exists (`moduleKeyForDocType` in `template.routes.js`); it is a real design port, not a patch. |
| SEC-M8 | CSP `unsafe-inline`. Needs the Control Tower mock moved to a per-route CSP, and I cannot exercise that iframe here. |
| SEC-M6 | Platform session store, revocation, 2FA. New table + migration + service work — a batch of its own. |
| SEC-L3 | httpOnly refresh cookie. Explicitly gated on M8 and C2, and breaking for every client. |

---

## 17. Groups 2 and 3 — 6 done, 15 to go

**Done:** TC-D8, TC-E1, TC-CI3, TC-Q1, TC-F2, TC-Q6.
**TC-E2 attempted and reverted** — the reasoning is in `env.js` and in the
register, and it is the most useful thing in this batch.

### TC-E2: the obvious fix fires everywhere except production

The guard keys on `NODE_ENV === "production"`; the natural fix is corroborating
signals. Both are wrong here, and I wrote one before checking:

- **`APP_BASE_DOMAIN` defaults to `praxisls.com`.** The default is already
  production-shaped, so "domain is not localhost" throws on **every developer
  machine, every unit test and every CI job**. I had this in the file before
  asking what the default actually was.
- **`DB_HOST` is `postgres` in compose — and production uses compose.** So
  "host is not local" never fires where it matters, and *does* fire for a
  developer pointed at a remote database. Exactly backwards.

The audit's scenario is also narrower than it reads: the Dockerfile sets
`ENV NODE_ENV=production` on runtime and worker, so `docker compose run --rm api
node …` already inherits it. The genuine residual is a process started outside
Docker with `NODE_ENV` unset. **The real fix is to stop having exploitable
defaults** — per-install generated secrets, or make the three required with no
default — which is a behaviour change needing sign-off, not a cleverer sniff.

### What the other five bought

- **TC-E1** moves environment validation from *after* migrations to *before*
  them. Previously a change adding a required variable passed CI, passed the
  build, **migrated every tenant database**, and only then failed to boot.
- **TC-Q1/CI3** — coverage is measured in CI and the threshold is on
  **functions**, because 99 `*.routes.js` files report 100% statements with 0%
  functions. A line gate would be satisfied by importing files. No `branches`
  floor: nobody has measured it, and a guessed number either breaks on arrival
  or means nothing.
- **TC-Q6** — the auth guard matched middleware **by function name**, so
  wrapping it in `asyncHandler` would have left it green while detecting
  nothing. Now matched by reference, floor raised from 50 to 95 against a
  verified 101 modules.

### Second pass — the other 12

**Fixed:** TC-D7, TC-R3, OBS-I3, OBS-I4, TC-R1, TC-R4, TC-CI4, TC-Q3, TC-Q5,
TC-F3. **Partially fixed:** TC-D5, TC-CI10 — both because the remainder is not
code.

Three decisions in there worth keeping:

- **OBS-I4's auto-rollback is OPT-IN (`AUTO_ROLLBACK=1`), and that is the fix
  rather than a hedge.** Migrations have already run by the time the readiness
  gate fails, and there are no down-migrations before 0500. Reverting the *code*
  under a schema that has moved forward is safe for an additive migration and
  **not** safe for anything else — an automatic revert could turn a broken
  deploy into a corrupted one. The operator makes that judgement once, in the
  environment, instead of the script guessing every time.
- **Two ratchets, not two zeroes.** Lint blocks at `--max-warnings 136` and
  `npm audit` blocks with an expiry of 2026-10-31. A gate set to an
  unachievable value fails on arrival and is reverted by whoever it blocks
  first, which is how a gate becomes a comment. The number going down is the
  record that work happened.
- **OBS-I3 requires a marker, not abstinence.** `-- DESTRUCTIVE: <what is lost
  and why>` on the statement. Banning destructive migrations outright gets
  worked around; requiring the sentence puts it in the diff for a reviewer and
  in the file for whoever is restoring a backup at 02:00.

### Remaining 3 — none of them code I can write

| ID | What is actually left |
|---|---|
| **TC-CI2** | `main` red 15% of runs. Follows from TC-CI1: switch on branch protection (`doc/BRANCH_PROTECTION.md`). The deploy-side guard already refuses to ship a commit that reached `main` without a PR. |
| **TC-D5** (partial) | `environment: production` is declared in `deploy.yaml` and is inert until you create it. Then: an unprivileged `deploy` user, docker group + only the sudo entries `deploy.sh` needs, a restricted `authorized_keys` entry, a rotation date. **Until the user is unprivileged, a compromised Action is still a host compromise.** |
| **TC-E2** | Needs sign-off, not cleverness — see above. Generate per-install secrets, or make the three required with no default. |
| **TC-C11** (partial) | Frontend coverage of money, permissions and the Live/Test toggle. A body of test-writing, not a config change. |
| **TC-CI10** (partial) | A backend type layer. The PRD promises one; the pipeline has never had one. The PRD is the thing that should move. |

---

## 18. What is left, and why none of it is a fix waiting to be written

**29 open. Sorted by what unblocks them, not by severity** — severity does not
tell you who has to act.

### A. Settings and infrastructure — only the owner can do these (5)

`TC-CI1` (branch protection, the last Critical) · `TC-CI2` (follows from CI1) ·
`TC-D5` (the `production` Environment exists in `deploy.yaml` and is inert until
created; then an unprivileged deploy user) · `OBS-I6` (single-host topology) ·
`TC-D6` (already a costed decision — **amend the PRD**, which still contradicts
it)

### B. One decision each (4)

- **`NEW-11`** — where dates are rendered. Serialise `date` as `YYYY-MM-DD` at
  the API, or format with an explicit zone: the viewer's, the tenant's, or the
  **port's**? For a freight ETA the third answer is defensible.
- **`TC-E2`** — stop having exploitable defaults. Per-install generated secrets,
  or make the three required with no default. Both are behaviour changes.
- **`SEC-L3`** — needs the **cookie-scope story across tenant subdomains**
  (`<slug>.<domain>`): apex-scoped is shared by every tenant in the browser,
  host-scoped breaks cross-subdomain flows. Note its premise has weakened —
  SEC-M8 and C2, the two findings its severity was coupled to, are now closed.
- **`DI-3.4`** — already correctly diagnosed and correctly left alone.

### C. One project each (3)

`SEC-M5` + `SEC-M7` + `TC-E3` are **one piece of work, not three**: one JWT
secret across three tiers, one encryption key across all tenants, and no
rotation path for anything. Individually they read as Mediums; together they are
the answer to *"what happens after a credential compromise"*, which today is
**everything, everywhere**. `ENCRYPTION_KEY` in particular cannot be rotated
without a re-encryption migration nobody has written.

Also: `TC-C11` (frontend money/permission coverage) and `TC-CI10`'s remainder (a
backend type layer — the PRD promises one and never had one).

### D. The API-contract cluster — ONE sitting, then one batch (9)

`API-F7…F14` are all breaking URL/verb changes: `/portal` vs `/portals`,
pluralisation at 63/37, `DELETE` meaning two different things, reads that are
POSTs. Fix the conventions and pick a versioning approach in a single session,
then it is mechanical. **Piecemeal is worse than not at all** — half-converted
conventions are harder to reason about than consistent-but-wrong ones.

`API-F23` is the exception and is nearly done — see §15b. What remains is
verifying the platform-tier classification, then the doc table and the CI gate.

### E. Genuinely deferred, with a reason (5)

`SEC-M6`'s 2FA step-up (a feature, and the same undecided design as the tenant
side) · `PERF-S8` (needs a real build — pair it with the vitest 4 move) ·
`PERF-S13` (Chromium pool) · `PERF-S17` (keyset pagination, breaking) ·
`TC-CI4`'s `exceljs` major (dated to 2026-10-31 in CI)

---

## 9. Starting a new session

Point it at this repository and say:

> Read `doc/REMEDIATION_HANDOFF.md` and `doc/AUDIT_REGISTER_2026-08-04.xlsx`,
> then continue the remediation.

Give it the working agreements in §8 up front — they are the difference between
useful batches and a lot of half-finished work.
