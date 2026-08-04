# Test Coverage & CI/CD Reliability Audit — 2026-08-04

**Phase 0 — audit only. No code, tests, CI config, or deployment process were changed.**

The question this audit answers: *how much confidence does the team actually have that a
given change won't break production, and how fast and safely can they ship?*

Short answer: **shipping is fast and the pipeline is honest about what it checks — but what
it checks is the shallow half of the system.** Every pure-arithmetic rule in the accounting
engine is well tested. Not one line of the authentication middleware, the RBAC enforcement
path, the identity cache, or the multi-tenant connection registry is exercised by a single
test. Production is deployed automatically on every green push to an unprotected `main`,
and there is no rollback.

---

## 0. Method — what was actually measured

Nothing below is estimated. Sources:

| Evidence | How it was obtained |
|---|---|
| Coverage numbers | `npx jest --runInBand --coverage` on this tree (deps installed fresh) |
| Per-function coverage | `coverage/coverage-final.json` `fnMap`/`f` inspection |
| Flakiness | 90 GitHub Actions runs via the Actions API — `run_attempt` on every one |
| Merge behaviour | 60 most recent CI runs classified by `event` + `display_title` |
| Branch protection | GitHub branches API — `"name":"main","protected":false` |
| Releases / tags | GitHub releases API (`[]`), `git tag` (empty) |
| Determinism | Suite run in-band and in parallel, results compared |

Measured against `main` at `3e913c1`. `main` advanced 11 commits during the audit; the suite was
re-run on the rebased tree and the backend numbers are unchanged (the new commits touch the
frontend and docs). One finding — C11 — was materially affected and has been revised, with the
change recorded in place rather than silently rewritten.

---

## 1. Baseline

### Coverage (measured, this tree)

```
Statements   35.36%  ( 7256/20519)
Branches     16.02%  ( 1892/11808)
Functions    13.12%  (  565/4305 )
Lines        40.68%  ( 6827/16780)
```

**Read the function number, not the line number.** The 27-point gap between lines (40.68%)
and functions (13.12%) is not noise — it is the shape of the whole problem. Requiring a
module executes its top-level statements, so all 102 `*.routes.js` files report *100%
statement coverage* while never handling a request. Any target set on lines or statements
is gamed automatically by this repo's structure.

### Suite

| | |
|---|---|
| Test suites | 80 (76 unit, 4 integration) |
| Tests | 697 — **686 pass, 11 skipped** |
| Assertions | ~990 |
| Runtime | 22.5s (`--runInBand`) / 7.4s (parallel) |
| Source under test | 857 JS files, 42,497 LOC |
| Test code | 5,382 LOC (**12.7%** of source) |
| Services with *any* test reference | **37 of 135** (27%) — reference, not exercise |
| Frontend tests | **22** across 3 files / 235 LOC, all in `client`; `platform-console` has **0** |
| E2E tests | **0** |

### Coverage by module, sorted by function coverage

| Module | Files | Stmts | Stmt% | **Func%** | Br% |
|---|---:|---:|---:|---:|---:|
| modules/platform | 3 | 190 | 0.0 | **0.0** | 0.0 |
| src/orchestration | 14 | 346 | 0.0 | **0.0** | 0.0 |
| src/routes | 2 | 84 | 0.0 | **0.0** | 0.0 |
| modules/branding | 4 | 123 | 22.8 | **0.0** | 0.0 |
| modules/catalogue | 4 | 19 | 78.9 | **0.0** | 0.0 |
| modules/dashboard | 22 | 230 | 33.0 | **2.1** | 0.0 |
| modules/workflow | 8 | 232 | 23.7 | **3.0** | 0.0 |
| modules/documents | 4 | 386 | 13.5 | **3.0** | 0.0 |
| modules/portal_auth | 6 | 244 | 23.8 | **3.2** | 0.8 |
| src/jobs | 17 | 261 | 9.2 | **4.7** | 8.9 |
| modules/hr | 88 | 1535 | 38.4 | **4.8** | 0.0 |
| modules/fleet | 53 | 765 | 40.3 | **5.7** | 0.0 |
| modules/sales | 52 | 1143 | 33.8 | **6.3** | 8.1 |
| modules/operations | 43 | 749 | 35.6 | **7.0** | 2.2 |
| **modules/wms** | 44 | 610 | 43.4 | **7.3** | 0.0 |
| modules/master | 77 | 1604 | 35.0 | **8.6** | 13.0 |
| **modules/security** | 65 | 1450 | 41.2 | **9.0** | 16.8 |
| modules/procurement | 31 | 644 | 39.6 | **10.9** | 12.7 |
| **modules/costing** | 31 | 638 | 37.5 | **12.7** | 5.9 |
| src/config | 8 | 161 | 32.3 | **16.1** | 37.9 |
| modules/commercial | 32 | 593 | 45.7 | **17.9** | 22.5 |
| **modules/finance** | 68 | 1863 | 42.4 | **18.9** | 20.8 |
| src/services | 58 | 3022 | 28.0 | **20.4** | 22.9 |
| modules/vault | 38 | 772 | 48.4 | **23.7** | 27.1 |
| **src/middleware** | 10 | 218 | 20.6 | **25.0** | 11.8 |
| src/shared | 19 | 638 | 47.5 | **35.3** | 42.3 |

The four domains the brief names as highest-risk — money, inventory, auth, multi-tenant
isolation — occupy five of the seven lowest rows that contain real logic.

### Pipeline

| | |
|---|---|
| CI runs recorded | 93 |
| Median CI duration | **68s** (min 54, max 79) |
| Deploy runs | 44, median ~68s |
| Failures in last 60 runs | 9 (**15%**) |
| `run_attempt > 1` (re-runs) | **0 of 90** |
| Direct pushes to `main` (last 60) | **27** (45%) |
| PR merge commits | 14 · local merge-branch pushes 3 · PR checks 16 |
| `main` protected | **No** |
| Releases / tags / CHANGELOG | **None / none / none** — all three `package.json` at `0.1.0` |

---

## 2. Findings

Severity is rated by **production risk**, not by how wrong the code looks.
Effort is **Quick** (hours–1 day) or **Deeper** (a real work item or a process change).

---

### 2.1 Coverage gaps — critical business paths

#### C1 · Multi-tenant isolation has zero test coverage — **CRITICAL** · Deeper

`src/services/tenant/registry.service.js` — **all 10 functions uncovered**, verified against
`fnMap`: `platform()`, `resolveByHost()`, `invalidateHost()`, `poolFor()`,
`withTenantConnection()`, `listActiveTenants()`, `closeAll()`.

This file *is* the tenancy boundary. `resolveByHost()` (`registry.service.js:43`) maps a Host
header to a tenant row through a 60-second cache; `poolFor()` (`:68`) hands out a pool keyed
on `meta.db_name`; `withTenantConnection()` (`:95`) binds `search_path` to the live or sandbox
schema. A defect anywhere on that chain — a cache key collision, a pool reused across tenants,
a schema fallback firing — is cross-tenant data exposure in an ERP holding several companies'
general ledgers.

No test asserts that an unknown host is refused, that a `SUSPENDED` tenant gets 403, that
`is_live` blocks the sandbox switch, or that two tenants get two pools. `src/middleware/tenant-context.js`
(0% statements) contains the one-line env decision that the whole Live/Test separation rests on:

```js
const env = !req.tenant.is_live && requested === "sandbox" ? "sandbox" : "live";
```

Untested. Invert that boolean and every test in the repo still passes.

> Also noted, not a test finding: `withTenantConnection` interpolates the schema name
> directly into SQL (`SET search_path = ${schema}, public`). The value comes from
> `platform.tenant_database`, so it is trusted today — but it is an untested trust boundary.

#### C2 · Request-time authentication is untested — **CRITICAL** · Quick

`authMiddleware()` (`src/middleware/auth.js:32`) — **uncovered**.

The most consequential lines in the file are these, at `auth.js:52-54`:

```js
if (payload.typ && payload.typ !== "access") {
  throw new AppError("INVALID_TOKEN", "Not an access token", 401);
}
```

The file's own comment records why they exist: *"Was missing entirely: refresh tokens
(typ:"refresh") and, now, 2FA pending tokens (typ:"2fa_pending") are signed with this same
secret — without this check either could be replayed here as a real access token."* This is a
patched vulnerability with **no regression test**. Delete those three lines and CI stays green.

#### C3 · RBAC enforcement is untested — **CRITICAL** · Quick

Function-level coverage of `src/middleware/rbac.js`:

```
COVERED   requirePermission()   L61   ← the factory, called at import by 102 route files
UNCOVERED rbacCheck()           L70   ← the actual per-request enforcement
UNCOVERED (anonymous_2)         L91
UNCOVERED (anonymous_3)         L101
COVERED   requireCapability()   L139
COVERED   capabilityCheck()     L143
COVERED   requireCeo()          L175  ← the factory
UNCOVERED ceoCheck()            L176  ← the God-Mode guard
```

`requirePermission` shows "covered" purely because route modules invoke the factory at
require time. The returned `rbacCheck` — which resolves grants, denies with 403, applies the
CEO bypass, and attaches `req.scope_ids` from the scope closure — never runs in a test.
`ceoCheck()`, the guard on destructive surfaces such as the God Mode purge, likewise.

The contrast is instructive: `requireCapability` **is** properly covered by
`tests/unit/capability-assignment.test.js`, which drives the middleware with a fake `req`
and asserts the 403. That test is a ready-made template for the two gates beside it — this is
a gap of application, not of capability.

#### C4 · The identity cache is untested — **CRITICAL** · Deeper

`src/shared/cache/identity-cache.js` — **all 31 functions uncovered**, including
`getAuthUser`, `getGrants`, `getUserScopeIds`, `getUserScopeClosure`, `getUserCapabilities`,
`getMaskedFieldKeys`, `invalidateUser`, `invalidateGrants`.

Every authorization decision in the application reads through this 30-second Redis cache.
Untested invalidation means a deactivated user or a revoked role can keep working for a window
nobody has verified. `getUserScopeClosure` decides which branch/entity records a user can see —
its correctness is the record-level half of multi-tenant safety, and `rbac.js` documents it as a
deliberate behavioural choice (walk the organigramme down, not just the raw assignments) that
nothing checks.

#### C5 · Money is tested as arithmetic, never as persistence — **HIGH** · Deeper

The pure layer is genuinely good. `journal_entry.rules` 100% functions, `tax_declaration.rules`
100%/68% br, `smart_receivables.rules` 100%/81% br, `financial_statement.rules` 100%/80% br,
`debt.rules` 100%/80% br. `tests/unit/costing.test.js` and `tests/unit/invoicing.test.js`
assert real OHADA outcomes (débours excluded from margin, no VAT on débours, FIFO advance
allocation) with exact figures.

The layer that writes to the database is not tested at all. **0% function coverage** on:
`credit_note.service` · `debt.service` · `tax_declaration.service` · `smart_receivables.service` ·
`asset.service` · `cash_request.service` · `costing.service` · `regie.service` ·
`financial_statement.service` and `.repo` · `cost_tracking.service` · `proforma.service`.

Only two money services are meaningfully exercised: `journal_entry.service` (71% fn) and
`final_invoice.service` (62.5% fn) — and see Q4 for what that second one actually proves.

The arithmetic is right. Whether the right arithmetic reaches the right rows is unverified.

#### C6 · The tests that prove the ledger is correct never run — **HIGH** · Deeper

All four files in `tests/integration/` open with the same guard:

```js
const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_ENTITY_ID;
const d = hasDb ? describe : describe.skip;
```

CI sets neither variable. **11 tests, permanently skipped.** What is dark:

- `journal-posting.test.js` — a balanced entry posts and reads back; an unbalanced entry is
  rejected *by Postgres*.
- `ledger-hardening.test.js` — proves the `migrations/tenant/0464_ledger_hardening.sql`
  triggers actually fire, deliberately using **raw SQL to bypass the app-layer pre-checks** so
  the database is what rejects. This is the highest-value test asset in the repository.
- `orchestration-import-freight.test.js` — the won-opportunity → dossier → costing →
  draft-invoice lane, **including its idempotency**.
- `mail-imap.test.js` — real IMAP/SMTP transport.

Consequence, stated plainly: **nothing in CI verifies that an unbalanced journal entry is
rejected, or that a closed accounting period blocks a posting.** The team wrote the proof and
then never ran it. Each file's header already documents exactly what CI needs to provide —
this is the single highest-return item in the audit.

#### C7 · Inventory is the least-covered business domain — **HIGH** · Deeper

`modules/wms` — **7.3% function coverage**, 0% branches, across 44 files. Every service is at
0% functions: `inventory.service`, `outbound.service`, `inbound.service`, `cycle_count.service`,
`warehouse_location.service`, `equipment.service`.

Stock quantity is the data-integrity analogue of money: a double-decrement or a lost movement
is unrecoverable without a physical count. There is no equivalent of the `.rules.js` pure-math
layer here either — WMS has no rules files, so the domain has neither unit nor integration
coverage. It is the largest fully-dark critical domain.

#### C8 · Cross-module orchestration is 0% covered — **HIGH** · Deeper

`src/orchestration/` — 14 files, 346 statements, **0% statements, 0% functions**. This is the
event outbox that turns *costing approved* into a draft invoice, *opportunity won* into a
dossier, *fuel log created* into a dossier cost — eleven handlers spanning sales, costing,
finance, fleet and WMS.

`dispatcher.js` documents its own contract: *"Delivery is at-least-once — handlers MUST be
idempotent (A2)."* The only test of that idempotency is in the skipped integration suite (C6).
A non-idempotent handler produces duplicate invoices or duplicate cost entries on retry, and
nothing would catch it before a customer did.

#### C9 · The tenant-provisioning surface is 0% covered — **HIGH** · Deeper

`src/modules/platform/` (190 statements, 0%), `src/middleware/platform-auth.js` (0%), and
`src/services/platform/`: `tenants.service` (106 stmts, 0%), `plans.service` (0%),
`users.service` (0%), `roles.service` (0%), `auth.service` (0%), `support.service` (0%).

This is the Root-Admin console that creates, suspends and configures tenants — a surface where
a defect affects every customer at once, and where `platform-auth.js` is the only thing
standing between the public internet and that power.

#### C10 · Portal auth (external, customer-facing) — **HIGH** · Quick–Deeper

`modules/portal_auth` at **3.2% function coverage**; `portal_auth.service.js` (117 statements)
at 0% functions; `portal_auth.middleware.js` at 25%. This is authentication for external client
users — the least-trusted population that reaches the system.

#### C11 · Frontend testing has just started, and not on the risky surfaces — **MEDIUM** · Deeper

41,941 LOC of TypeScript (`client` 39,361 + `platform-console` 2,580).

**This finding was revised during the audit.** An earlier draft recorded zero frontend tests;
`main` advanced 11 commits mid-audit and `a686019` (*"Phase 1 PR2 — page containers, desktop
widths, a11y + test gates"*) introduced a frontend suite. Current measured state:

- `client` — Vitest 4.1.10 + React Testing Library 16.3.2, **22 tests across 3 files** (235 LOC):
  `data-list.test.tsx` (9), `page-container.test.tsx` (8), `lib/theme.test.ts` (5). Wired into
  CI as a `Test` step, plus a `check:contrast` step asserting WCAG AA on design tokens.
- `platform-console` — **still zero**: no `test` script, no runner. The CI step uses
  `npm run test --if-present`, so its absence passes silently rather than failing the matrix.

The direction is right and the CI wiring is correct. The gap is *what* is covered: all three
files test presentational and layout concerns. **Nothing tests money formatting or rounding on
display, permission-conditional rendering, or the Live/Test toggle** — the last being the
user-facing half of C1, on a frontend that drives journal entries, payroll runs and God-Mode
purges. Rated MEDIUM rather than HIGH because `build` runs `tsc -b` on both apps, so type errors
and broken imports still fail the pipeline.

#### C12 · No end-to-end or API-level tests — **HIGH** · Deeper

No Playwright, no Cypress. `supertest` is a `devDependency` and appears in exactly one test
(`tests/unit/async-safe.test.js`), used to check async error propagation — not to exercise an
endpoint. **No test ever boots the Express app and sends a request through the real middleware
chain.** That is precisely why C1–C3 can be simultaneously true and invisible: the chain
`hostTenantResolver → tenantContext → authMiddleware → requirePermission → controller` has
never executed under test, as a chain, once.

---

### 2.2 Test quality — tests that exist but verify less than they appear to

#### Q1 · Coverage inflation makes the headline number meaningless — **MEDIUM** · Quick

Lines 40.68% vs functions 13.12%. Files reporting **100% statements with 0% functions**
include every `*.routes.js` — `app_user.routes`, `session.routes`, `inventory.routes`,
`costing.routes`, `debt.routes`, `smart_receivables.routes`, and 96 more. Requiring them
registers routes; that is all the coverage measures.

Practical consequence: a coverage gate set on statements or lines would be satisfied by
importing files. **Any coverage target this team adopts must be expressed in functions and
branches.** Only 66 of 855 files are at literally 0% statements, which makes the codebase look
far better instrumented than it is.

#### Q2 · Security logic extracted into a testable predicate, while the caller stays dark — **HIGH** · Quick

`app_user.service.js:268-274` defines `refreshTokenReused(session, payload)`, whose own JSDoc
says *"Pure reuse-detection predicate (exported for tests)"*. `tests/unit/auth-refresh-rotation.test.js`
covers it thoroughly — five cases, including the legacy-grandfathering path. The test file is
candid about why: *"The refresh() flow is dependency-heavy (jwt/redis/repo), so the
security-critical decision is a small pure predicate exported for exactly this test."*

But `refresh()` (`app_user.service.js:276`) is **0% covered**. It performs the session lookup,
the revoked/killed check, the reuse-triggered session kill + Redis removal + cache invalidation
+ audit event, and the 30-minute inactivity enforcement (which the code comments describe as
*"the enforcement point that was missing"*). None of it is tested.

If a refactor stopped calling `refreshTokenReused` at line 297, **all five tests still pass**.
This is the textbook shape of testing an implementation detail instead of an outcome, and it is
sitting on the session-hijacking defence.

#### Q3 · Hand-rolled regex SQL fakes silently absorb query changes — **MEDIUM** · Deeper

`tests/unit/final-invoice-lifecycle.test.js` builds a `fakeClient` that matches SQL with
regexes and **returns `{ rows: [] }` for anything unmatched**. It cannot detect a wrong `WHERE`
clause, a dropped tenant/entity filter, a changed column list, or a query that was never issued.
Modify the invoice `UPDATE` to omit its guard and the fake happily returns the row anyway.

The fake is well-written for what it is — the problem is that a fake can only ever assert the
shape the test author already imagined. The fix is not a better fake; it is a real database (C6).

#### Q4 · The money-path test mocks away the accounting — **HIGH** · Deeper

Same file. Six `jest.mock` calls, two of which remove the thing under audit:

- `services/accounting/determination` — **decides which GL accounts money lands in** — mocked
  to return a fixed `4111` line.
- `journal_entry.service.buildAndInsert` — **posts the entry** — mocked to return `{entry_id:"je1"}`.

The test then asserts that `numbering.allocate` and `documents.capture` *were called* and that
status became `POSTED_LOCKED`. Those are orchestration assertions. It never asserts that the
resulting journal entry balances, or that a service invoice hits the correct OHADA accounts.

Combined with C6, the conclusion is unambiguous: **no test that runs in CI verifies that
posting an invoice produces a correct, balanced general-ledger entry.** For an accounting ERP
that is the central claim of the product.

#### Q5 · Registration-only tests read as behavioural coverage — **LOW–MEDIUM** · Classification

`tests/unit/approval-wiring.test.js` asserts `handlerFor("purchase_order:x")` returns a
function for six document types — it never calls one. A handler registered under the right key
that does entirely the wrong thing passes. `tests/unit/ai-writes.test.js` has the same shape
for *"every ai_enabled write has a real executor in the map"* (though it does then execute one
path properly).

These are legitimate and useful anti-regression guards — a module dropping its `onApproved`
registration is a real failure mode worth catching. The issue is bookkeeping: they should not
be counted as coverage of the approval or AI-write *paths*, because they aren't.

#### Q6 · The best structural guard has two soft spots — **MEDIUM** · Quick

`tests/unit/auth-coverage.test.js` discovers every tenant module router and asserts each
carries `authMiddleware` — a genuinely excellent guard against a new module shipping an
anonymous surface, and exactly the right instinct. Two weaknesses:

1. It identifies the middleware **by function name** (`l.name === "authMiddleware"`). Rename
   the function, or wrap it in `asyncHandler`, and the guard silently stops detecting anything
   while still passing.
2. The floor is `expect(modules.length).toBeGreaterThan(50)`. Discovery currently returns
   **100** modules. If module loading broke and found 51, the suite stays green and the other
   49 routers go unchecked.

And it proves *presence*, never *effect* — the middleware it guarantees is mounted has never
been shown to reject anything (C2).

#### Q7 · Assertion strength is fine — **no action**

26 weak assertions (`toBeDefined` / `toBeTruthy` / `not.toThrow` / `toBeGreaterThan(0)`) out of
~990 — about 2.6%. No snapshot tests anywhere. Where tests exist, they mostly assert real
values. This is a healthy signal and worth preserving.

---

### 2.3 Flaky or unreliable tests

#### F1 · No flakiness — and this is measured, not assumed — **positive finding**

- **`run_attempt` is 1 on all 90 recorded workflow runs.** Nobody has ever clicked "re-run
  failed jobs". In a flaky suite that number is never clean.
- The suite produces identical results in-band (22.5s) and fully parallel (7.4s): 686 passed,
  11 skipped, both times.
- Only four test files touch wall-clock time, all building relative dates from `Date.now()`
  with wide margins. No `Math.random`, no `randomUUID`, one `setTimeout` — inside the skipped
  IMAP integration test.
- `tests/jest.setup.js` pins `NODE_ENV`, silences logging, and blanks eight provider keys
  before any module can read them.

**No failure in this repository's history was ignored as a flake, because there were none to
ignore.** The caveat is honest: determinism here is largely a consequence of the suite not
touching I/O. It is a property to *protect* as Phases 3–4 add database tests, not a
property already earned.

#### F2 · `--runInBand` costs 3× runtime for no observed benefit — **LOW** · Quick

`package.json` (`"test": "jest --runInBand"`) and the CI `Test` step both pin it. Measured:
22.5s serial vs **7.4s parallel**, identical results.

Deliberately *not* filed as "just remove it": parallel workers surface latent shared-module
state, and the suite is about to grow database-touching tests where serialization may become
load-bearing. The right sequencing is to drop `--runInBand` **now**, while the suite is pure
and any breakage is obviously new, rather than after Phase 3 when the cause would be ambiguous.

#### F3 · Expected-error noise in the CI log — **LOW** · Quick

`tests/unit/env-guard.test.js` triggers a real `console.error` from `src/config/env.js:195`
("Refusing to boot in production with insecure/default secrets") on every run. The test is
correct and the guard is working — but printing a red error block on every green build trains
people to skim past red text in CI output.

---

### 2.4 CI pipeline gaps

`.github/workflows/ci.yaml` runs four parallel jobs — `build-test` (syntax → lint → jest →
migration-numbering), `security` (audit → secret scan), `frontend` (matrix: client,
platform-console — lint → design-token contrast → test → build), `docker-build`. The frontend
job's contrast and test steps arrived with `7267f3e`/`a686019` during this audit (see C11).
It is well organised and every non-obvious
decision carries a written justification. The gaps below are about what is missing, not about
what is there.

#### CI1 · `main` is unprotected and 45% of changes go straight to it — **CRITICAL** · Quick to enable, process change to adopt

Branches API: `{"name":"main","protected":false}`.

Of the 60 most recent CI runs: **27 direct pushes to `main`**, 14 PR merge commits, 3 local
merge-branch pushes, 16 PR checks. Nearly half of all changes reach `main` with **no pull
request, no review, and no required status check**.

Compounded by CI5/D-series: `deploy.yaml` fires on `workflow_run` completion of CI on `main`.
So a single `git push` from a laptop, if it goes green, **is a production deployment with no
human other than its author in the loop.**

#### CI2 · Broken code lands on `main` and stays there — **HIGH** · Quick (CI1 fixes it structurally)

Runs **#86 and #87** (2026-08-03, both `push` to `main`) failed at the **Test** step —
`build-test` red, all other jobs green. `main` was broken from 10:41 to 11:12 (~31 min).
Earlier: runs **#49, #50, #52** left `main` red on 2026-07-25 from 19:05 to 21:25 (~2h20m).
Nine failures in the last 60 runs — a **15% red rate**.

The deploy gate held correctly (deploy runs #40 and #41 show `skipped`), so production was
protected. But the repository has no branch that is reliably deployable, and "is `main` green
right now?" is a question the team currently has to look up.

#### CI3 · Coverage is never measured in CI — **MEDIUM** · Quick

The Test step is `npx jest --runInBand`. No `--coverage`, no threshold, no artifact, no report.
The numbers at the top of this document had to be generated locally for this audit. **Nobody
can currently see whether coverage went up or down in a given change** — which makes any
remediation programme unmeasurable from day one.

#### CI4 · `npm audit` reports but does not block — **LOW–MEDIUM** · Quick

`security` job, `continue-on-error: true`, with the clearest rationale in the file: 7 findings
(3 high), all transitive `uuid` reached via `exceljs` and `node-cron`; clearing them needs a
breaking `exceljs` major that the team wants to do deliberately rather than to turn a pipeline
green. The comment concludes *"A gate everyone learns to force past is worse than one that
reports honestly."*

**That reasoning is correct and I am not filing it as a defect.** The gap is that the
suppression has no expiry: no tracking issue, no target date, no mechanism that makes it
resurface. Non-blocking-with-a-deadline is a decision; non-blocking-forever becomes furniture.

#### CI5 · Security scanning is one regex and no history — **MEDIUM** · Quick

The `Secret scan` step greps the working tree for five patterns: `sk-…`, `AIza…`, `gsk_…`,
PEM private keys, `AKIA…`. Right instinct — the file records that *"the kickoff shared provider
keys in plaintext (Gemini/DeepSeek/Groq/exchangerate) and they had to be rotated"*. Two limits:

1. **Coverage.** It would not catch a leaked database password, a JWT signing secret, a
   `postgres://user:pass@host` URI, a base64'd Google service-account JSON, an SMTP password,
   or the `ENCRYPTION_KEY` — every one of which appears in `.env.example` as a named variable
   and would be plausible to paste.
2. **History.** `git grep` reads the working tree. A secret committed in June and deleted in
   July is invisible to it — and still in the clone anyone has.

There is also no SAST (CodeQL), no dependency-review on PRs, and GitHub's own secret scanning
with push protection does not appear to be relied on.

#### CI6 · Migrations are never executed in CI — **HIGH** · Deeper

`check-migration-numbers.js` validates **filenames**. Nothing ever *runs* the 8 platform + 69
tenant migrations against a real Postgres. A migration's first execution anywhere is on the
**production server**, during deploy.

Two facts from the repo make that expensive rather than merely awkward. From
`check-migration-numbers.js`: *"tenant migrations are not written to be idempotent (23 files
use a bare `CREATE TRIGGER`, which fails 42710 on a second run)"* and *"Renaming an applied
migration is therefore a live-database hazard, not a tidy-up."* And the tree already carries
two grandfathered number collisions (`tenant/0470`, `tenant/0475`) that cannot now be renamed.

The guard that exists is thoughtful and correctly scoped. It just cannot tell you whether the
SQL runs.

#### CI7 · The built image is never started — **HIGH** · Quick

`docker-build` runs `docker build --target runtime -t praxis-ls:ci .` and stops. No container
is launched, no health endpoint is hit. A boot-time failure — a bad `require`, a Zod env
validation throw, a missing runtime file — passes CI and first appears during the production
rollout. Adding `docker run` plus a health poll costs roughly 30 seconds on a 68-second
pipeline and closes the largest gap between "CI is green" and "the thing runs".

#### CI8 · CI does not test the dependency tree that gets deployed — **HIGH** · Deeper

`npm install` (never `npm ci`) in all three CI jobs and in the Dockerfile's `deps`,
`clientbuild`, and `consolebuild` stages. The documented reason is real: the lockfile is
Windows-generated, so `npm ci` on Linux omits platform binaries (`sharp`, `argon2`,
`@rollup/rollup-linux-x64-gnu`) and the build dies.

The consequence is under-appreciated. Every `npm install` re-resolves semver ranges
independently, so **the tree CI tested at 09:00 and the tree baked into the image at 09:05 are
not guaranteed to be the same tree.** A bad transitive patch release can pass CI and break the
deployment, and neither the CI log nor the image records what was actually installed. This also
means the `npm audit` finding count is not reproducible run to run.

The root cause is fixable rather than permanent: regenerate the lockfile on Linux (or inside
the container) and commit it, then move every install to `npm ci`.

#### CI9 · Pipeline speed is not a problem — **positive finding**

Median CI 68s, range 54–79s; deploy ~68s. Nothing is being skipped for slowness. **The bypass
documented in CI1 is cultural, not latency-driven** — worth stating so remediation doesn't
optimize the wrong thing. It also means the pipeline has real headroom: Phases 3–4 can add a
Postgres service and integration tests and still land well under five minutes.

#### CI10 · No type-check, and lint warnings never fail — **MEDIUM** · Deeper

The backend is plain CommonJS with no type layer. `eslint.config.js` sets `no-unused-vars` and
`no-shadow` to `"warn"`, and `npm run lint` is bare `eslint .` — **verified to exit 0 with
warnings present**. So between `node --check` (does it parse) and Jest (does this specific
function work) there is no semantic check at all: a typo in a property name on an untested path
reaches production.

`node --check` across `src` and `scripts` is a genuinely clever, near-free gate and should
stay. But `doc/SmartLS_PRD_Master_Functional_Spec_v2.md:216` commits to *"every merge runs lint
+ type-check + unit/integration tests"* — of those four, type-check does not exist for the
backend, integration tests never run (C6), and lint does not block. The team is being measured
against a standard the pipeline does not implement.

---

### 2.5 Deployment process risk

`deploy.yaml` → `appleboy/ssh-action` → `scripts/deploy.sh` on the VPS:
`git pull --ff-only` → `docker compose build` → `docker compose run --rm migrate` → sync AI
action catalogue → roll `api-standby` → roll `api` → roll `worker` → `docker image prune -f` →
`curl /api/health`. Triggered by `workflow_run` on CI success on `main`, or `workflow_dispatch`.

The **ordering is genuinely well designed** — build before migrate, migrate before rolling,
standby before primary so nginx's backup upstream absorbs the window, worker last because queue
downtime is invisible. The concurrency group prevents overlapping deploys. The risks below are
about what happens when a step goes wrong.

#### D1 · There is no rollback, and the deploy destroys the means of one — **CRITICAL** · Deeper

Images are built on the server, unversioned. The second-to-last line of `deploy.sh` is:

```bash
docker image prune -f
```

That removes the previous image layers. **"Redeploy the last known-good build" is not a command
that exists in this system.** Recovery from a bad deploy means `git revert`, push, wait for CI
(~70s), wait for the server rebuild — with the forward-only migration already applied (D2).
There is no `rollback.sh`, no image tag to roll back to, and no record of what the previous
build even was (R2).

For a system that deploys ~17 times in two days, the absence of a rollback path is the single
largest production risk in this audit.

#### D2 · Migrations run before the roll, with no backup and no down path — **CRITICAL** · Quick (backup) / process (conventions)

`docker compose run --rm migrate` executes at step 2. **Zero down/rollback migration files
exist** (`find migrations -name "*down*" -o -name "*rollback*"` → empty). No `pg_dump` runs
first. `doc/DEPLOYMENT.md:260-263` documents a manual backup command as *"minimum viable
backup"* — nothing in the automated path invokes it.

Forward-only, additive-by-convention migration is a defensible choice and is what makes the
zero-downtime roll safe (old code keeps working against the new schema mid-deploy). But it
compounds D1 exactly: **you cannot roll code back past a schema change**, and the last
pre-migration state of the database is whatever backup someone happened to take by hand.

#### D3 · Fleet migration is not atomic and has no error containment — **HIGH** · Deeper

`provisioning.service.js:307-312`:

```js
async function migrateAllTenants() {
  const slugs = await listTenantSlugs();
  const results = [];
  for (const slug of slugs) results.push(await migrateTenant(slug));
  return results;
}
```

A plain sequential loop with no `try`. A failure on tenant 3 of N leaves tenants 1–2 upgraded,
3–N not, and `set -e` aborts the deploy — leaving **the fleet in mixed schema state with no
report of which tenant is where**, no resume, and no per-tenant isolation. The abort happens
before the containers roll, so old code continues against a partially-new schema, which
additive conventions make survivable — but nobody is told, and the next deploy re-enters the
same loop from the top.

#### D4 · The deploy's health gate is a liveness probe wearing a readiness probe's hat — **HIGH** · Quick

`src/routes/index.js:18-20`:

```js
router.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
```

No database check. No Redis check. Both `docker compose up -d --wait` (whose healthcheck hits
this same endpoint) and `deploy.sh`'s closing `curl -fsS .../api/health` will report **success
on a container that cannot reach Postgres at all.**

The carefully sequenced zero-downtime roll is therefore gated on "the Node process is
listening", not "the application works" — so the standby can be declared healthy, the primary
rolled into the same broken state, and the deploy exit green while every request 500s.

#### D5 · CI holds a long-lived shell on the production host — **HIGH** · Quick–Deeper

`deploy.yaml` uses `appleboy/ssh-action@v1.2.0` with `DEPLOY_HOST` / `DEPLOY_USER` /
`DEPLOY_SSH_KEY`. The workflow's own documentation gives the example `DEPLOY_USER  ssh user
e.g. root`.

If that is literally `root`, **every CI run has unrestricted shell on the production server**,
authenticated by a single long-lived private key with no rotation policy, no GitHub Environment,
and no required approval. `workflow_dispatch` is open to anyone with write access. A compromised
Action, a malicious dependency in a workflow step, or a leaked repo secret is a full host
compromise rather than a bad deploy.

#### D6 · No pre-production environment for *builds* — **HIGH** · Process

This one needs care, because it is a **deliberate, costed decision, not an oversight**.
`doc/Praxis_LS_Kickoff_Meeting_Transcript.md:200-208` records decision **D6**: *"Test/Live
toggle; Live + Sandbox inside each tenant's Postgres; sandbox purged by cron every 14 days;
**no shared staging server**"* — chosen explicitly over a staging server on cost grounds and
restated in `README.md:47`. I am not relitigating it.

The honest consequence, which should be recorded rather than assumed away: **sandbox separates
data, not deployments.** It is a second schema inside the same database, served by the same
containers, from the same image, on the same host, after the same migrations. It provides no
opportunity to observe a new build before customers do. **A new build's first execution
anywhere is on the production host serving live tenants.**

Worth flagging separately: `doc/SmartLS_PRD_Master_Functional_Spec_v2.md:215-216` still
specifies *"Local (Docker Compose) → Staging → Production"* and *"deploys are promoted staging
→ prod"*. **The PRD and the kickoff decision directly contradict each other.** One should be
amended, so the team is not measured against a standard it consciously declined.

The cheapest mitigations are not a staging server: they are CI7 (boot the image in CI) and CI6
(run migrations in CI), which recover most of what staging would have caught, for minutes of
pipeline time.

#### D7 · The deployed tree is mutable and the deploy is not pinned — **MEDIUM** · Deeper

`git pull --ff-only` on the server means deployment identity is "whatever `main` points at when
the script runs", not a pinned artifact. Any hand-edit to a tracked file on the server (an
edited `docker-compose.yml`, say — `.env` is correctly gitignored) makes the next deploy fail
mid-script under `set -e`, at an arbitrary point, possibly after migrations.

Related: the `workflow_dispatch` path takes no ref input, so a manual deploy always deploys
current `main` — **you cannot deploy a specific commit**, which is exactly what you want during
an incident.

#### D8 · Deploy serialization is correct; CI's is missing — **MEDIUM** · Quick

`deploy.yaml` correctly sets `concurrency: { group: deploy-production, cancel-in-progress: false }`.
But **CI has no `concurrency` block**, so two rapid pushes to `main` produce two CI runs, two
`workflow_run` completion events, and two queued deploys ordered by *completion* time rather
than commit order. Since `deploy.sh` always pulls current `main`, the practical result is a
redundant deploy rather than a reversed one — but the trigger SHA and the deployed SHA are then
provably different, which is the traceability failure in R3. On 2026-08-03 there were eight
pushes to `main` between 09:33 and 16:16, several within fifteen minutes of each other.

---

### 2.6 Environment & secrets handling in CI

#### E1 · Production config is a hand-maintained file validated too late — **HIGH** · Quick

Every service in `docker-compose.yml` takes `env_file: .env`; `.env` is correctly gitignored.
`src/config/env.js` validates the whole environment with Zod at require-time and **refuses to
boot in production** on default `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `ENCRYPTION_KEY`,
on identical access and refresh secrets, or on an empty `DB_PASSWORD` (`env.js:178-198`). That
guard is well built and is the right control.

The problem is *when* it runs: at container start on the production host — deploy step 4-5,
**after migrations have already been applied**. A change that introduces a required env var
passes CI (nothing validates any `.env` in CI), passes the image build, applies its migrations,
and then fails to boot. Nothing anywhere compares `.env.example` against the Zod schema, so the
template silently drifts from what the app requires.

#### E2 · Publicly known dev defaults, guarded only by `NODE_ENV` — **MEDIUM** · Quick

`env.js` ships `JWT_ACCESS_SECRET: "__dev_access__"`, `JWT_REFRESH_SECRET: "__dev_refresh__"`,
and a fixed 64-hex `ENCRYPTION_KEY`, all repeated in the committed `.env.example`. These are, as
the file itself says, *"a full auth-bypass in production"*.

The production guard (E1) is exactly the right mitigation and it exists. The residual risk is
that it keys solely on `NODE_ENV === "production"`. Any production-adjacent invocation that
misses it — a one-off `docker compose run --rm api node …` outside the compose `environment:`
block, a worker started by hand — boots with a signing key that is published in this repository.
Broadening the trigger (e.g. also assert when `APP_BASE_DOMAIN` is not localhost, or invert to
an explicit dev allowlist) removes the sharp edge.

#### E3 · No rotation story for anything — **MEDIUM–HIGH** · Process

Three repo secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`) with no GitHub Environment,
no required reviewers, no expiry, no rotation record. Application secrets — DB password, both
JWT secrets, `ENCRYPTION_KEY`, four AI provider keys, SMTP credentials, VAPID keypair — exist
only in the server's `.env`.

`ENCRYPTION_KEY` deserves specific attention: it is the AES-256-GCM key for secrets at rest,
which per `.env.example:47-50` covers 2FA TOTP secrets and vendor API keys. **There is no
documented procedure for rotating it**, and rotating it naively invalidates every encrypted
value in every tenant database. That is a re-encryption migration nobody has written, which
means in practice the key can never be rotated — including after a suspected compromise.

#### E4 · The secret scan cannot see git history — **MEDIUM** · Quick to check, potentially expensive to fix

Covered mechanically in CI5. Called out separately because this repository has **documented
real exposure**: `ci.yaml` states the kickoff shared Gemini/DeepSeek/Groq/exchangerate keys in
plaintext and they had to be rotated. Whether those values still sit in reachable git history
is a question the current working-tree scan structurally cannot answer, and nobody appears to
have asked it. A single `gitleaks detect --log-opts=--all` answers it in minutes.

#### E5 · Test-environment isolation is done well — **positive finding**

`tests/jest.setup.js` pins `NODE_ENV` and `LOG_LEVEL`, then explicitly blanks eight provider
keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, SMTP trio,
`WHISPER_BASE_URL`) **before any module can require `env.js`** — with a comment explaining that
`dotenv` will not override an already-set var, so this is what keeps a developer's real `.env`
from leaking in and defeating the "provider not configured" branches.

That is careful, non-obvious test hygiene. It should be preserved and extended as Phases 3–4
introduce database configuration into the test environment.

---

### 2.7 Release practices

#### R1 · There are no releases — **MEDIUM** · Quick

GitHub releases API returns `[]`. `git tag` is empty. No `CHANGELOG` exists anywhere in the
repository. All three `package.json` files read `"version": "0.1.0"` and have never moved,
across 93 CI runs and 44 production deploys.

There is no unit of "a release" in this system — only a stream of commits, each of which is
silently a deployment.

#### R2 · A running build cannot identify itself — **HIGH** · Quick

Nothing stamps the git SHA into the image, the container, or any endpoint. `/api/health`
returns `{ ok, ts }` and nothing else. **To answer "what code is in production right now?" you
must SSH to the server and run `git rev-parse HEAD`** — and that answer is only true until the
next `git pull` overwrites it.

This is the finding that turns every incident into an investigation before it can become a
diagnosis, and it is among the cheapest to fix in the entire audit: a build arg, an env var,
three lines in the health route.

#### R3 · Deploys are not traceable to commits — **MEDIUM–HIGH** · Quick to record

The deploy job never checks out the repository and never records a SHA. It fires on CI
completion and runs a script that pulls whatever `main` is at *execution* time. Given D8 (no CI
concurrency group), that is not necessarily the SHA whose CI run triggered it. So for any past
deploy, the question "which commit did this deploy?" has no recorded answer — only an inference
from timestamps.

#### R4 · Commit messages are the changelog, and are inconsistent — **LOW–MEDIUM** · Quick

Most commits use conventional prefixes (`feat:`, `feat(module):`) — the raw material for
generated release notes is largely present. But the PR-merge titles that mark the actual
integration points include **"Lots of changes"** (PRs behind runs 94, 91, 71, 70), **"a lot"**
(run 61), and **"audit portan and opportunities board list"** (run 84). The merge commits — the
ones a changelog would be built from — carry the least information.

#### R5 · High deployment frequency is real, and is the good news — **positive finding, with a caveat**

44 deploys recorded, roughly 17 of them across 2026-08-02/03 alone, each ~68 seconds from green
CI to live. On the DORA "speed" axis this team is performing well, and the deploy script's
zero-downtime sequencing is thoughtfully built.

The caveat is the pairing: **deploying many times a day while unable to roll back (D1),
unable to identify what is deployed (R2), and unable to tie a deploy to a commit (R3).** The
frequency is not the risk — the frequency is an asset that the missing recovery primitives turn
into one.

---

## 3. Findings summary

| ID | Finding | Severity | Effort |
|---|---|---|---|
| C1 | Multi-tenant isolation (`registry.service.js`) — 0/10 functions covered | CRITICAL | Deeper |
| C2 | `authMiddleware()` uncovered; patched token-replay fix has no regression test | CRITICAL | Quick |
| C3 | `rbacCheck()` and `ceoCheck()` uncovered — enforcement paths never run | CRITICAL | Quick |
| C4 | `identity-cache.js` — 0/31 functions; grants, scope closure, invalidation | CRITICAL | Deeper |
| D1 | No rollback; `docker image prune -f` destroys the previous build | CRITICAL | Deeper |
| D2 | Migrations run pre-roll, no backup, zero down-migrations | CRITICAL | Quick/Process |
| CI1 | `main` unprotected; 45% direct pushes; each green push auto-deploys | CRITICAL | Quick/Process |
| C5 | Money services 0% functions; only rules layer tested | HIGH | Deeper |
| C6 | All 4 integration suites permanently skipped — 11 tests dark in CI | HIGH | Deeper |
| C7 | WMS/inventory 7.3% functions — no unit *or* integration coverage | HIGH | Deeper |
| C8 | Orchestration outbox 0% — at-least-once idempotency unverified | HIGH | Deeper |
| C9 | Platform/tenant-provisioning surface 0% | HIGH | Deeper |
| C10 | Portal auth (external-facing) 3.2% functions | HIGH | Quick–Deeper |
| C12 | No API-level or E2E test; middleware chain never runs as a chain | HIGH | Deeper |
| Q2 | `refresh()` untested; only its extracted predicate is | HIGH | Quick |
| Q4 | Invoice test mocks away determination + GL posting | HIGH | Deeper |
| CI6 | Migrations never executed in CI; first run is production | HIGH | Deeper |
| CI7 | Built image never started; boot failures reach deploy | HIGH | Quick |
| CI8 | `npm install` not `ci` — CI doesn't test the deployed tree | HIGH | Deeper |
| D3 | `migrateAllTenants` — no containment, mixed-fleet state on failure | HIGH | Deeper |
| D4 | `/api/health` is shallow; deploy gate can't see a dead database | HIGH | Quick |
| D5 | CI holds long-lived (likely root) SSH on production | HIGH | Quick–Deeper |
| D6 | No pre-production for builds (deliberate; PRD contradicts it) | HIGH | Process |
| E1 | Prod `.env` hand-maintained; validated only at boot, post-migration | HIGH | Quick |
| R2 | Deployed build cannot be identified from the running system | HIGH | Quick |
| CI2 | `main` red 15% of runs; no always-deployable branch | HIGH | Quick |
| C11 | Frontend suite is 22 presentational tests; money/permissions/Live-Test untested, `platform-console` at zero | MEDIUM | Deeper |
| Q1 | Line coverage inflated by import-time execution | MEDIUM | Quick |
| Q3 | Regex SQL fakes absorb query changes silently | MEDIUM | Deeper |
| Q6 | `auth-coverage` matches by function name; floor of 50 vs 100 modules | MEDIUM | Quick |
| CI3 | Coverage never measured in CI | MEDIUM | Quick |
| CI5 | Secret scan: 5 patterns, working tree only; no SAST | MEDIUM | Quick |
| CI10 | No backend type-check; lint warnings never fail | MEDIUM | Deeper |
| D7 | Server pulls `main`; no pinned artifact, can't deploy a chosen commit | MEDIUM | Deeper |
| D8 | CI has no concurrency group; trigger SHA ≠ deployed SHA | MEDIUM | Quick |
| E2 | Published dev secrets guarded only by `NODE_ENV` | MEDIUM | Quick |
| E3 | No rotation story; `ENCRYPTION_KEY` effectively unrotatable | MEDIUM–HIGH | Process |
| E4 | Secret scan blind to history; documented past exposure unverified | MEDIUM | Quick |
| R3 | Deploys not traceable to commits | MEDIUM–HIGH | Quick |
| R1 | No releases, tags, or changelog; version frozen at 0.1.0 | MEDIUM | Quick |
| Q5 | Registration-only tests counted as path coverage | LOW–MEDIUM | Classify |
| R4 | Merge commits carry the least information | LOW–MEDIUM | Quick |
| CI4 | `npm audit` non-blocking with no expiry (rationale sound) | LOW–MEDIUM | Quick |
| F2 | `--runInBand` costs 3× runtime for no observed benefit | LOW | Quick |
| F3 | Expected-error noise trains people to ignore red CI output | LOW | Quick |

**What is working and should be protected:** the pure-rules test layer (real OHADA assertions,
exact figures); `auth-coverage.test.js` as a structural anti-regression guard; the deterministic
suite (zero re-runs in 90 runs); `tests/jest.setup.js` environment isolation; the `node --check`
gate; the migration-numbering guard; the new `check:contrast` WCAG gate and the frontend test
step that landed mid-audit; the deploy script's ordering and the standby-first roll;
the production env guard in `env.js`; the deploy concurrency group; the honesty of the CI
comments — nearly every non-obvious decision in this pipeline is documented with its reasoning,
which is rarer than good coverage and made this audit possible.

---

## 4. Remediation roadmap — 5 phases

Sequencing rationale, stated up front because it drives everything below:

1. **Recoverability before coverage.** No quantity of tests helps if a bad deploy can't be
   undone. Phase 1 is entirely additive — no gates, no slower merges, nothing that changes how
   anyone works.
2. **Breach risk before correctness risk.** An RBAC hole is worse than a wrong subtotal, and
   the auth tests are also the cheapest (C2/C3 need no database).
3. **Infrastructure before the tests that need it.** Phase 3 builds the Postgres harness;
   Phase 4 spends it on money and inventory.
4. **Gates last.** Branch protection and coverage floors go in *after* the pipeline is worth
   waiting for. Imposing a required-checks regime on a 68-second pipeline that doesn't test
   auth teaches people to route around it — the exact failure mode `ci.yaml` already names in
   its `npm audit` comment.

Effort figures assume the current small team and are calendar estimates, not headcount.

---

### Phase 1 — Make production recoverable and identifiable
**~1 week · no dependencies · nothing blocks a merge**

Addresses D1, D2, D4, D8, R2, R3, CI7, F2, F3.

**Scope.** Deployment safety primitives only. Every item is additive; no process changes, no
new gates, no impact on merge speed.

**Deliverables**
1. **Versioned images + rollback.** Tag each build `praxis-ls:<short-sha>` and `:previous`;
   replace bare `docker image prune -f` with a prune that retains the last N. Add
   `scripts/rollback.sh <sha>` that re-tags and rolls standby-then-primary using the existing
   sequencing.
2. **Pre-migration backup.** `pg_dumpall` (the command already in `doc/DEPLOYMENT.md:260-263`)
   into a retained, timestamped file *before* `docker compose run --rm migrate`, with the
   deploy aborting if the dump fails.
3. **`/api/ready`.** A deep check — `SELECT 1` on the platform pool plus a Redis `PING`. Point
   the compose healthchecks and `deploy.sh`'s final curl at it. Keep `/api/health` shallow for
   liveness.
4. **Build identity.** `--build-arg GIT_SHA` → `ENV` → returned by `/api/health` alongside
   `ok`/`ts`. Log it once at boot.
5. **Deploy traceability.** Have the deploy job record the SHA it deployed in its summary; add
   `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` to `ci.yaml`.
6. **CI boot smoke (CI7).** After `docker build`, `docker run` the image with a throwaway
   Postgres and Redis and poll `/api/ready`. Budget ~30s.
7. **Housekeeping.** Drop `--runInBand` (F2) — deliberately now, while the suite is pure and
   any breakage is unambiguously new. Silence the expected `console.error` in `env-guard`
   (F3).

**Measurement**
- Rollback drill: deliberately deploy a known-bad build and restore. Target **< 5 minutes**,
  timed, with the result written down. This number is the phase's headline.
- 100% of deploys have a recorded SHA; `/api/health` reports the same SHA the deploy claims.
- Backup artifact present for 100% of deploys that ran migrations.
- At least one boot failure caught by CI7 before deploy within the first month (if zero, the
  smoke test is still cheap insurance — do not remove it on that basis).

---

### Phase 2 — Cover the paths where a bug is a breach
**~2 weeks · depends on Phase 1 only for the parallel-jest change · no database required**

Addresses C2, C3, C4, C10, Q2, Q6, C12 (harness), Q1/CI3 (measurement).

**Scope.** Authentication, authorization, tenant resolution, and the request-level API harness
that makes all three testable. Every test here **verifies existing behaviour** — where a test
and the code disagree, the code is right and the test is wrong, unless it exposes a genuine
security defect, which gets raised separately rather than silently "fixed" by a test.

**Deliverables**
1. **`tests/helpers/app.js`** — a supertest harness booting the real router with fake tenant
   resolution and a stubbed identity DB, so the chain
   `hostTenantResolver → tenantContext → authMiddleware → requirePermission → controller`
   executes end to end. This unblocks Phases 4–5 as much as it serves this one.
2. **`tests/unit/auth-middleware.test.js`** — missing header → 401; malformed token → 401;
   expired → `TOKEN_EXPIRED`; **`typ:"refresh"` rejected**; **`typ:"2fa_pending"` rejected**
   (the C2 regression tests); missing `req.identityDb` → 500; inactive user → 401; happy path
   populates `req.user` including `is_ceo` and `role_ids`.
3. **`tests/unit/rbac-permission.test.js`** — modelled on the existing
   `capability-assignment.test.js`: CEO bypass without a grant read; each action → column
   mapping (`view/read/create/edit/update/delete/approve/export/publish`); denial → 403
   `PERMISSION_DENIED`; `req.scope_ids` null when unscoped, populated from the closure when
   scoped; `requireCeo()` admits only CEO.
4. **`tests/unit/identity-cache.test.js`** — `getAuthUser`/`getGrants` hit and miss; TTL
   expiry; **`invalidateUser` and `invalidateGrants` actually clear** (the revocation-window
   question); `getUserScopeClosure` walks `parent_scope_id` down the organigramme;
   `getMaskedFieldKeys`; Redis-unavailable degradation via `safeRedis`.
5. **`tests/unit/tenant-resolution.test.js`** — unknown host → 404; `SUSPENDED` → 403;
   non-`LIVE` → 423; platform hosts set `isPlatform`; the dev `X-Praxis-Tenant` path is inert
   outside `NODE_ENV=development`; **`x-praxis-env: sandbox` is honoured only when
   `!is_live`**; `identityDb` always binds live even under sandbox.
6. **`refresh()` end to end (Q2)** — full flow with a fake client: revoked session, reuse
   detection *reached through `refresh()`*, session kill + cache invalidation + audit event,
   30-minute inactivity kill, and the "keep me signed in" opt-out.
7. **Portal auth (C10)** — login, token issue, and the `portal_auth.middleware` gate.
8. **Harden `auth-coverage.test.js` (Q6)** — assert the exact discovered module count
   (currently 100) rather than `> 50`, and detect the middleware by identity rather than by
   function name.
9. **Coverage visibility (CI3/Q1)** — add `--coverage` to the CI test step, publish
   `coverage-summary.json` as an artifact, and post function/branch deltas on PRs.
   **Report only — no threshold yet.**

**Measurement**
- Function coverage on `src/middleware` + `src/shared/cache` + `src/services/tenant`:
  **~8% → ≥ 80%**, reported per-directory.
- **Sabotage check** (the real acceptance test, run manually): comment out `auth.js:52-54`
  (the `typ` guard) — the suite **must** fail. Repeat for the `rbacCheck` denial branch and
  the `is_live` sandbox condition. A phase that raises coverage but survives these is not done.
- Coverage delta visible on every PR from the end of this phase onward.

---

### Phase 3 — Put a real database in CI
**~2–3 weeks · depends on Phase 1 (pipeline discipline); unblocks Phase 4**

Addresses C6, CI6, CI8, and the infrastructure half of C1.

**Scope.** The Postgres harness. This is the largest infrastructure lift in the roadmap and the
highest-leverage: it turns 11 already-written, currently-dark tests green, and it makes Phase 4
possible at all.

**Deliverables**
1. **Postgres service container** in `ci.yaml` (`pgvector/pgvector:pg16`, matching production),
   in a new `integration` job so `build-test` stays fast.
2. **Provision step** — `npm run db:migrate:platform` then `npm run db:provision --slug=citest`,
   then export `DATABASE_URL` and `TEST_ENTITY_ID`. **This alone un-skips all four integration
   suites** (C6); each file's header already documents exactly what it needs.
3. **Seed fixture** — a corporate entity with an OPEN accounting period, journal `BQ`, and
   postable accounts `521`/`4191`, as `ledger-hardening.test.js` requires.
4. **Migration execution gate (CI6)** — two paths: fresh provision (all 69 tenant migrations
   from empty) and upgrade-existing (provision at the previous release's migration set, then
   apply new files). The second catches the ordering bugs the numbering guard structurally
   cannot see.
5. **Lockfile repair (CI8)** — regenerate `package-lock.json` on Linux (or inside the
   container) for the root and both frontends, then move every install in `ci.yaml` and the
   `Dockerfile` to `npm ci`. Verify `sharp`, `argon2`, and the rollup linux binary resolve.
   This makes CI test the tree that ships and makes the `npm audit` count reproducible.
6. **Tenant isolation tests (C1, DB half)** — provision **two** tenants; assert that a request
   bound to tenant A cannot read tenant B's rows; assert `withTenantConnection` binds the
   correct `search_path` for live vs sandbox; assert pool separation by `db_name`.
7. **Time budget** — keep total CI under **5 minutes**. It runs at ~68s today; the integration
   job runs in parallel with the existing four.

**Measurement**
- **Skipped tests: 11 → 0.** The cleanest binary in this roadmap.
- Migration gate catches at least one bad migration before merge (baseline: production is
  currently the first executor).
- `npm ci` succeeds on Linux in CI and in all three Docker stages; two consecutive builds of
  the same SHA produce identical dependency trees.
- Total CI wall-clock stays under 5 minutes (report it; if exceeded, split rather than delete).

---

### Phase 4 — Behavioural coverage for money and data integrity
**~3–4 weeks · depends on Phase 3 (needs the DB harness) and Phase 2 (needs the API harness)**

Addresses C5, C7, C8, C9, Q3, Q4.

**Scope.** The correctness half. With a real database available, test the layers that write —
services, repos, and the orchestration outbox — asserting persisted outcomes rather than that
functions were called.

**Deliverables**
1. **A money-invariant suite.** One shared assertion applied to every posting path: for any
   operation that touches the general ledger, **sum(debits) === sum(credits)** and the affected
   accounts match the OHADA determination. Cover invoice posting, credit notes, debt drawdown
   and repayment, payroll, supplier invoices, cash requests, and asset depreciation.
2. **Rewrite `final-invoice-lifecycle.test.js` against the real DB (Q3, Q4)** — same scenarios,
   **`determination.resolve` and `journal_entry.service` unmocked**, asserting the actual
   journal rows. Retain the existing fake-client test as a fast unit check if it still earns its
   runtime; the DB test is the one that proves the claim.
3. **Finance services (C5)** — `credit_note`, `debt`, `tax_declaration`, `smart_receivables`,
   `asset`, `financial_statement`: create → submit → post lifecycles, period-close rejection,
   locked-document rejection, and each service's numbering allocation.
4. **WMS (C7)** — inbound receipt increments stock; outbound decrements; cycle-count adjustment
   reconciles; **stock cannot go negative**; a movement is never double-applied. This domain has
   no pure-rules layer, so these are its first tests of any kind.
5. **Orchestration (C8)** — dispatcher: pending events dispatch, handler throw → `FAILED` →
   `DEAD` after `MAX_ATTEMPTS`, one handler's failure doesn't block others, feature-gated
   handlers skip cleanly. Then **idempotency for each of the 11 handlers**: dispatch twice,
   assert exactly one downstream record. This is the contract `dispatcher.js` declares and
   nothing currently checks.
6. **Platform surface (C9)** — provisioning creates both schemas and applies all migrations;
   suspension actually blocks tenant requests; `platform-auth` rejects tenant tokens.
7. **Costing (C5)** — approval → draft-invoice orchestration, budget-vs-actual reconciliation
   against persisted rows, and the débours exclusion asserted end to end rather than on the
   rules function alone.

**Measurement**
- Function coverage: `modules/finance` **18.9% → ≥ 60%**; `modules/costing` **12.7% → ≥ 60%**;
  `modules/wms` **7.3% → ≥ 55%**; `src/orchestration` **0% → ≥ 70%**.
- Branch coverage on those four: **≥ 45%** (from 20.8 / 5.9 / 0.0 / 0.0).
- Every GL-touching path is covered by the money-invariant suite — tracked as a checklist of
  posting paths, not a percentage.
- Overall function coverage **13.12% → ≥ 40%**.

---

### Phase 5 — Gates, releases, and the frontend
**~4 weeks · depends on Phases 1–4 · this is the phase that changes how people work**

Addresses CI1, CI2, CI3 (enforce), CI4, CI5, CI10, C11, C12, D5, D6, D7, E1–E4, R1–R4.

**Scope.** Turn the now-meaningful pipeline into a gate, establish release identity, and put
first tests on the frontend. Deliberately last: **every item here trades speed for safety, and
that trade is only honest once the checks being waited on actually test something.**

**Deliverables**
1. **Branch protection on `main` (CI1, CI2)** — require a PR, require `build-test`, `security`,
   `frontend`, `docker-build`, and `integration` to pass, require the branch to be current.
   **The largest process change in this roadmap — see the tradeoff table.**
2. **Coverage floor (CI3)** — a **ratchet**, not a target: record current function/branch
   coverage and fail only on regression, raising the floor as it rises. Expressed in
   **functions and branches**, never lines or statements (Q1).
3. **Security scanning (CI5, E4)** — enable GitHub secret scanning with push protection; add
   CodeQL for JavaScript; add dependency-review on PRs; run `gitleaks detect --log-opts=--all`
   **once** to answer the open history question, and act on what it finds.
4. **`npm audit` expiry (CI4)** — keep it non-blocking, but attach a tracking issue and a date
   to the `exceljs` upgrade, so the suppression resurfaces instead of settling in.
5. **Backend semantic checking (CI10)** — `--max-warnings=0` on lint as the cheap step; then
   `checkJs` via a `jsconfig.json` with JSDoc types on the shared and middleware layers first.
   Full-repo typing is explicitly out of scope.
6. **Environment drift check (E1, E2)** — a CI step comparing `.env.example` against the Zod
   schema in `env.js` (fail on a required var missing from the template); a pre-flight env
   validation on the server **before** migrations; broaden the insecure-default guard beyond
   `NODE_ENV` alone.
7. **Deploy hardening (D5, D7)** — a dedicated non-root deploy user with a forced command; a
   GitHub Environment for production with required reviewers on `workflow_dispatch`; a `ref`
   input so a specific commit can be deployed during an incident.
8. **Release identity (R1, R3, R4)** — tag every deploy `v0.1.<n>+<sha>`; generate release notes
   from conventional commits; create a GitHub release per production deploy. Ask for
   descriptive PR titles — "Lots of changes" is the input a generated changelog gets.
9. **Frontend tests (C11)** — the runner now exists in `client` (Vitest + RTL, wired into CI),
   so this is **extension, not introduction**: point the existing suite at the highest-risk
   surfaces — money formatting and rounding, permission-conditional rendering, the Live/Test
   toggle — and stand up the same setup in `platform-console`, which still has none and whose
   `--if-present` step passes silently. **Not a coverage mandate** — a floor of meaningful tests
   plus the existing `tsc -b`.
10. **E2E smoke (C12)** — Playwright, **three journeys only**: login → dossier → costing →
    invoice; a tenant-isolation check (user A cannot see tenant B); and a permission-denial
    check. Run against the CI-booted container from Phase 1, not against production.
11. **PRD reconciliation (D6)** — amend `SmartLS_PRD_Master_Functional_Spec_v2.md:215-216` to
    match the kickoff's D6 decision, or reopen the staging question explicitly. Do not leave two
    contradictory standards in the documentation.
12. **`ENCRYPTION_KEY` rotation procedure (E3)** — document it, including the re-encryption
    migration for TOTP secrets and vendor keys. Writing this before it is needed is the whole
    point.

**Measurement**
- **Direct pushes to `main`: 45% → < 5%** (measure the same way this audit did — classify CI
  runs by `event`).
- **`main` red rate: 15% → < 5%**; time-to-green when red: **< 30 minutes** (worst observed
  today: 2h20m).
- Coverage ratchet never regresses; overall function coverage **≥ 50%**.
- 100% of production deploys have a tag, a release note, and a recoverable predecessor image.
- **Change-failure rate** and **time-to-restore** become measurable for the first time — Phase 1
  supplies the rollback primitive, Phase 5 supplies the release record that lets you count.
- Deployment frequency: **maintained**, not reduced. If branch protection halves it, the gate is
  mis-tuned — revisit rather than accept.

---

## 5. Tradeoffs — every recommended process change

Per the brief's constraint: **no process change is proposed without its cost stated.** Nothing
in this table has been applied.

| Change | Phase | Cost | Why it is still worth it |
|---|---|---|---|
| **Require PRs on `main`** | 5 | Slowest single item here. On a small team this can mean waiting for the only other reviewer, or self-approving — which is theatre. Direct-push velocity is genuinely lost. | Today one `git push` deploys to production unreviewed. The *required status checks* matter more than the human review — consider requiring checks while allowing self-merge, which recovers most safety at a fraction of the friction. |
| **Postgres in CI** | 3 | CI goes from ~68s to an estimated 2–4 min. A new infra dependency that can itself flake. | Un-skips 11 already-written tests, including the only proof the GL rejects unbalanced entries. Runs as a parallel job so the fast feedback loop survives. |
| **Coverage ratchet** | 5 | Can block an urgent fix on an unrelated coverage dip. Invites gaming. | Ratchet-not-target and function/branch-not-lines defuse both. Without it, Phase 4's gains erode within months. |
| **Drop `--runInBand`** | 1 | Parallel workers can expose latent shared-module state; a stable suite could become intermittently red. | 3× faster today. Doing it *now*, while the suite is pure, means any breakage is unambiguously attributable — after Phase 3 it would be ambiguous. Reversible in one line. |
| **`npm ci` + regenerated lockfile** | 3 | Real risk of a painful day: `npm ci` is stricter and platform binaries (`sharp`, `argon2`, rollup) are exactly what broke before. Needs a Linux regeneration and verification in all three Docker stages. | CI currently does not test the tree that gets deployed. Until this is fixed, "CI is green" says nothing about the artifact — and audit results aren't reproducible. |
| **Deep `/api/ready` health gate** | 1 | A slow database makes a deploy fail that would previously have "succeeded". Deploys will fail more often. | They will fail *correctly*. Today the gate cannot distinguish a working app from one that cannot reach Postgres — a green deploy is not currently evidence of anything. |
| **Retain N-1 images (no blanket prune)** | 1 | Disk on the VPS. A few GB per retained build. | It is the entire rollback capability. Cheapest insurance in this document. |
| **Backup before migrate** | 1 | Adds ~seconds-to-minutes to each deploy, scaling with database size. Needs retention management. | With forward-only migrations and no down path, the pre-migration dump is the only route back past a schema change. |
| **Non-root deploy user + Environment approvals** | 5 | Setup effort; `workflow_dispatch` needs a reviewer, so emergency manual deploys get slower. | Every CI run currently has (likely) root shell on production. An emergency deploy that needs one click is a fair price. |
| **`--max-warnings=0` / `checkJs`** | 5 | Will fail immediately on existing warnings — a cleanup sprint before it can be enabled. `checkJs` on 42k LOC of untyped JS surfaces a lot at once. | Nothing currently sits between "it parses" and "this one tested function works". Scope to `src/middleware` and `src/shared` first. |
| **Amending the PRD on staging** | 5 | Documentation work; may reopen a settled cost conversation. | Two contradictory standards are live in the docs. Whichever wins, the team should be measured against one. |
| **Tagging + changelog** | 5 | Small ongoing discipline; nudges people toward descriptive PR titles. | "What is in production and what changed?" currently has no answer that survives the next `git pull`. |

---

## 6. Constraint compliance

- **No code, test, CI, or deployment change was made.** The only file added by this work is this
  document. `git status` before this commit was clean.
- **Everything above is measured**, not inferred: coverage from a real run on this tree,
  per-function status from `coverage-final.json`, pipeline behaviour from 90 workflow runs via
  the Actions API, branch protection from the branches API.
- **All proposed tests verify existing behaviour.** Where a Phase 2–4 test and the current code
  disagree, the code is treated as correct and the test corrected — unless the disagreement is a
  genuine security defect, which gets raised as its own item rather than quietly encoded in a
  test.
- **No process change has been applied**, and each is listed above with its cost.
- Priority order throughout is money, data integrity, auth, multi-tenant isolation — with
  recoverability placed ahead of all of them, because a system that cannot roll back cannot use
  what its tests tell it.
