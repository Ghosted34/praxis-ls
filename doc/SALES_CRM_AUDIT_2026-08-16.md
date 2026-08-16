# Sales & CRM (F1–F14) — build audit

**Date:** 16 August 2026 · **Audited at:** `85aadfa` (main) · **Baseline:** `9852d4c5` (the commit `doc/SALES_CRM_FEATURES.md` was written against)
**Range:** 99 commits, 247 files, +26,141 / −1,914

Audits every feature in `doc/SALES_CRM_FEATURES.md` against its own *Done when*
clause, against Block A's ground rules, and against the two rules that override
everything. Includes a regression pass over the modules the spec told the
builder to preserve.

---

## How this was checked

Not by reading alone. A throwaway Postgres 16 was stood up, the platform was
migrated, two tenants were provisioned from scratch, and the API was driven over
real HTTP with a real session:

| Check | Result |
| --- | --- |
| `node scripts/db/migrate-platform.js` | 23 files applied |
| `node scripts/db/provision-tenant.js` (fresh tenant, live + sandbox) | clean |
| `node scripts/db/migrate-tenants.js` re-run | `applied 0 new file(s)` — migrations apply twice cleanly |
| `node scripts/db/check-migration-idempotency.js` | OK, 71 new files checked |
| `npx jest` (full suite) | 3,026 passed, 0 failed, 8 suites skipped |
| `npm run lint` | 0 errors, 29 warnings (under the 136 ceiling) |
| `check-response-contract` / `check-silent-catch` / `jest-mock-hoisting` / `check-fonts` | all clean |
| `generate-api-docs --check` | in sync |
| Live HTTP probes | every public route, plus F1–F14 through an authenticated CEO session |

**Four of the five defects below are invisible to the test suite and the static
gates.** They only appear when the code runs against a database it did not mock.
That is the single most useful thing in this report: the suite is green, the
gates are green, and the feature is broken anyway — three times because the test
asserts the branch while the schema forbids its result, and once because the
test reads the source as *text* instead of calling it.

---

## Verdict

Thirteen of fourteen features are substantially built and behave as specified.
The architecture the spec cared most about is right: the intake/pipeline status
split is real, and no cost or margin column reaches a model on any of the three
paths that talk to one.

Five defects were found and fixed. Six more are recorded and left alone.

| # | Severity | Feature | Defect | Status |
| --- | --- | --- | --- | --- |
| 1 | **High** | F5 | Share-token minting throws on every call — no proposal can be shared, in any environment | **Fixed** |
| 2 | **High** | F7 | Stage probabilities and ordering never land on a newly provisioned tenant — the board's forecast column reads 0 | **Fixed** |
| 3 | **High** | F13 | Public quote intake is unsatisfiable on a multi-entity tenant | **Fixed** |
| 4 | **Medium** | F10 | A vendor's second application can never be approved | **Fixed** |
| 5 | **Medium** | F5/F12/F13/F14 | An anonymous caller chooses the environment — website submissions can be written into the sandbox schema | **Fixed** |
| 6 | Medium | F2/F4/F5/F11–F14 | ~20 new source files shipped minified onto one line | Open |
| 7 | Medium | F14 | Per-stage `location` is hard-coded `null` — the spec bullet was not built | Open |
| 8 | Medium | F11 | Sign-off survives an edit, so sign-off → edit → publish bypasses review | Open |
| 9 | Low | F14 | The raw internal `dossier.status` is published on the anonymous endpoint | Open |
| 10 | Low | F12 | `/public/portfolio/media/:id` answers 400 on a malformed uuid instead of the uniform 404 | Open |
| 11 | Low | F6/F8/F9/F10 | List endpoints use a bare `{rows,total,kpi}` envelope, not the house `{data}` + `X-Total-Count` | Open |
| 12 | Low | F6 | `quote_request.converted_opportunity_id` has no foreign key though it is declared the source of truth | Open |

---

## The two overriding rules

**Rule 1 — no cost or margin field may reach an external model, excluded in the
SQL, not afterwards. HOLDS on all three paths.**

- `company_profile.repo.derived()` selects fleet counts, warehouse capacity,
  lanes, vertical mix, clearance hours, client count and a turnover *band*. The
  band is computed from `journal_line.credit` on `7%` revenue accounts — revenue,
  which the spec permits. No cost or margin column is named anywhere in the
  query. Executed against a live schema: it runs and returns.
- `proposal.generator.facts()` builds a closed, numbered fact set from that
  sheet and additionally strips any key matching
  `/(cost|margin|profit|purchase|unit_price)/i` before the prompt — belt and
  braces, with the SQL as the belt.
- `success_story.repo.eligible()` names its columns explicitly. This is the
  single most important line in F11 — the legacy interpolated `margin` into a
  prompt for a *public marketing page* — and it is correctly fixed at source,
  not downstream.

**Rule 2 — no status value valid as both an intake state and a pipeline stage.
HOLDS.**

`quote_request.status` carries intake (`RECEIVED`, `UNDER_REVIEW`,
`CLARIFICATION_REQUIRED`, `QUOTED`, `CONVERTED_TO_OPPORTUNITY`,
`CLOSED_NO_ACTION`), `opportunity.pipeline_stage_id` carries the stage, and the
two vocabularies are disjoint. `quote_request.rules.assertPartitions` proves the
KPI fold rather than asserting it in a comment, and there is an `OTHER` bucket so
an unmapped status cannot vanish. This is the correction the spec called the
defining constraint of F6, and it was made properly.

One deviation worth knowing about: the spec said *"intake lifecycle belongs on
the lead"*; the build put it on `quote_request` and left `lead.status` as a
commercial funnel (`NEW → CONTACTED → QUALIFIED → CONVERTED/LOST`). That means
`lead.status` shares the literal strings `NEW`, `QUALIFIED` and `LOST` with the
pipeline stage codes. Different tables, different state machines, no overloaded
column — the rule is not broken. But it is a third vocabulary using the legacy's
most confusing words, and worth a comment on the enum.

---

## Findings

### 1 · F5 — proposal sharing cannot mint a single link · HIGH · fixed

`src/modules/sales/proposal/proposal.service.js`, `signedToken()`

```js
crypto.createHmac("sha256", config.JWT_SECRET)
```

`JWT_SECRET` is not a key `src/config/env.js` defines. The schema declares
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` and nothing else, so this resolves
to `undefined` and `createHmac` throws:

```
TypeError: The "key" argument must be of type string or an instance of
ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey.
Received undefined
```

`POST /proposals/:id/share` therefore answers **500 in every environment**. The
whole feature — the link, the WhatsApp share, the client-facing page, the vaulted
PDF, `viewed_at` — is unreachable, because nothing can produce a token to reach
it with.

`src/middleware/auth.js:15` carries a note about this exact mistake being found
and fixed there. This is its second occurrence.

**Why the suite is green.** `tests/unit/proposal-f5-sharing.test.js` covers
`resolve()`, `get()` and `download()` — everything you do with a token that
already exists — and then asserts minting like this:

```js
expect(proposal).toContain("randomBytes(32)");
expect(proposal).toContain("createHmac");
```

It reads the service as a *string* and checks it contains those substrings. Both
substrings are in the line that throws.

**Fix.** `config.JWT_ACCESS_SECRET`, plus
`tests/unit/proposal-share-minting.test.js`, which calls the function and
asserts on the value: 32 bytes of entropy, a signature that recomputes, 200
tokens with no collision, and `share()` persisting only the sha256 while
returning the token. Reverting the one-word fix turns 3 of those 5 tests red.

**Verified end to end after the fix:** share → 200 with a token; public open →
200; PDF → 23,283 bytes from the vault; `viewed_at` and `downloaded_at` both
stamped; revoke → the same 404 as an unknown token.

### 2 · F7 — the pipeline forecast is zero on every new tenant · HIGH · fixed

`migrations/tenant/0686_sales_crm_f7_pipeline.sql`

`provisioning.service.migrateTenantDb` applies `files.tenantSchema()`
(`migrations/tenant/*`) and **only then** `files.tenantSeeds()`
(`migrations/seeds/90*`). On a fresh database 0686 therefore runs against an
empty `pipeline_stage`:

- `UPDATE pipeline_stage SET sort_order = sort_order + 1 WHERE sort_order >= 2`
  (line 71) matches no rows — no gap is opened;
- the insert puts `PRICING_IN_PROGRESS` at `sort_order` 2;
- all seven `UPDATE … SET default_probability = n WHERE code = '…'` match no rows;
- seed 9030 then inserts the six defaults on top.

What a tenant provisioned this morning actually has:

```
 code                | sort_order | default_probability
---------------------+------------+--------------------
 NEW                 |          0 |
 QUALIFIED           |          1 |
 PROPOSAL            |          2 |
 PRICING_IN_PROGRESS |          2 |               50.00
 NEGOTIATION         |          3 |
 WON                 |          4 |
 LOST                |          5 |
```

Two stages at `sort_order` 2, and six of seven with no probability. That is not
cosmetic: `opportunity.probability` is derived from
`pipeline_stage.default_probability` (`opportunity.rules.deriveProbability`), so
every deal on a fresh tenant carries a NULL probability. Measured over HTTP — a
10,000,000 XAF opportunity in NEW:

```json
{"pipeline_value":10000000,"weighted_value":0,"win_rate_all_deals":0}
```

The forecast column is dead. F7's *"win rate matches a hand calculation on
seeded data"* cannot hold.

The migration's own header says it lands there so it "reaches existing tenants
and new ones alike". It reaches existing ones. Deployed tenants — where
`pipeline_stage` was already populated when 0686 ran — are correct, which is
why nobody saw this.

**Why the suite is green.** `opportunity.rules.DEFAULT_STAGES` is a hand-written
constant with the *intended* ladder, and the unit tests assert against it. No
test reads the table.

**Fix.** `migrations/seeds/9031_seed_pipeline_stage_probabilities.sql` — a seed,
so it runs *after* 9030 on a fresh database and still reaches existing tenants
through `migrate-tenants`. It inserts the stage if missing, backfills
probabilities only where NULL (a tenant that tuned one keeps it), and opens the
gap only while a duplicate `sort_order` actually exists. 0686 is deliberately not
edited — its hash is in the idempotency baseline and it did the right thing where
it has already run.

Plus `tests/integration/pipeline-stage-ladder.test.js`, which asserts against the
table rather than the constant: seven stages, distinct sort orders, pricing
between qualified and proposal, no NULL probability, and the database agreeing
with `DEFAULT_STAGES`.

**Verified:** a tenant provisioned from scratch after the fix has the correct
0–6 ladder with all seven probabilities; the existing tenant was repaired by
`migrate-tenants`; the same 10M deal now reports `weighted_value: 1000000`;
migrations still apply twice cleanly and the idempotency gate still passes.

### 3 · F13 — the website cannot submit a quote request on a multi-entity tenant · HIGH · fixed

`src/modules/sales/public_intake/public_intake.validator.js` ·
`quote_request.service.resolveEntityId`

`resolveEntityId` falls back to the tenant's only active corporate entity and,
when there is more than one, refuses:

```json
{"code":"ENTITY_REQUIRED",
 "message":"This tenant has more than one corporate entity — say which one the request belongs to",
 "fields":{"entity_id":["required when the tenant has several corporate entities"]}}
```

That refusal is right — picking one silently files the request under the wrong
company. But the public schema is `.strict()` and has no `entity_id` in it, so
the one field the error asks for is the one field the endpoint rejects. Measured:

| Tenant shape | `POST /public/intake/quote-requests` |
| --- | --- |
| one entity | `201` |
| one entity, `entity_id` supplied | `422 VALIDATION_ERROR` (unknown key) |
| two entities | `422 ENTITY_REQUIRED` — unsatisfiable |

A multi-entity tenant cannot receive website quote requests at all, and no
payload can fix it. F13's *"all four accept a submission with no session"* fails
for the endpoint that matters most.

Also worth noting: on a tenant with **zero** entities the same error fires and
says "more than one".

**Fix.** `entity_id: z.string().uuid().optional()` on the public quote schema.
The uuid is scoped to the host-resolved tenant, so a caller can only name one of
that tenant's own entities — the tradeoff is that a hostile caller could file a
request under the wrong entity of the right tenant, which is mis-filing, not a
leak. Covered by `tests/unit/public-surface-hardening.test.js`.
**Verified:** two entities + `entity_id` → `201`, reference `SQ-2026-0005`.

### 4 · F10 — a vendor that applies twice can never be approved · MEDIUM · fixed

`migrations/tenant/0688_sales_crm_f10_partnership.sql:175` ·
`partnership_request.service.draftSupplierFor`

The service documents and implements supplier reuse:

> "an existing supplier with the same normalised name is REUSED rather than
> duplicated"

0688 then adds `ux_partnership_request_supplier`, **UNIQUE** on
`partnership_request(supplier_id) WHERE supplier_id IS NOT NULL`, described as
what "makes the check true under concurrency". It does not: the check it was
meant to defend is *this application must not be approved twice*, but the index
enforces *no supplier may be referenced by more than one application*. The reuse
branch runs, finds the supplier, and the write violates the index. Measured:

```
approve duplicate company -> 409 {"code":"CONFLICT","message":"A record with these values already exists"}
```

A vendor re-applying is routine, and it is the exact case the service comment
calls out. The second application becomes permanently un-approvable behind an
opaque 409. F10's *"an approval where the company already exists as a supplier
does not create a duplicate"* is satisfied only in the sense that it creates
nothing.

**Why the suite is green.** `tests/unit/partnership-f10.test.js` mocks the repo,
so the reuse branch is proven and the constraint forbidding its result is not in
the test's world.

**Fix.** `migrations/tenant/0699_partnership_request_supplier_reuse.sql` replaces
the unique index with a plain one, and `approve()` takes the per-row guarantee
where it belongs — a `SELECT … FOR UPDATE` inside its own transaction (the
existing `before.supplier_id` read happens before `BEGIN`, so on its own it was
never race-safe).

**Verified:** first application → DRAFT supplier `SLS-SUP-2026-0001`;
re-application → `200`, `supplier_reused: true`, same `supplier_id`, no second
supplier; double-approving one application → `422 ALREADY_APPROVED` as before.

### 5 · F5/F12/F13/F14 — the internet picks the environment · MEDIUM · fixed

All four public route files used `req.tenantDb(…)`, which resolves live vs
sandbox from the `X-Praxis-Env` header. On a signed-in request that header is the
user's LIVE/TEST toggle. On an unauthenticated route the "user" is the internet.
Measured:

```
POST /api/tenant/public/intake/contact-enquiries   X-Praxis-Env: sandbox  -> 201
select count(*) from sandbox.contact_enquiry;  -> 1
```

A stranger put a row in the tenant's sandbox schema. Reads are the same shape:
sandbox portfolio stories and sandbox proposal tokens are publicly resolvable to
anyone who sets the header.

`src/middleware/tenant-context.js` already anticipated this — `req.tenantDbIn`
exists precisely so the careers module can pin an environment rather than take
the caller's word, and its comment says "the environment a request runs in is the
header's decision, not a handler's". The four new modules did not follow it.

The same hole is in `careers.routes.js:49`, the module the spec holds up as the
reference implementation. Its own comment two lines below says "the shop window
is live-only" — but `req.tenantDb` cannot deliver that, so the index route does
not do what its comment claims.

**Fix.** All ten call sites across the four modules, plus the careers index, now
use `req.tenantDbIn("live", …)`, with the reasoning in each file header. Covered
by `tests/unit/public-surface-hardening.test.js`.
**Verified:** the same request with `X-Praxis-Env: sandbox` now lands in `live`;
the sandbox count stayed put.

### 6 · Roughly twenty new files are minified · MEDIUM · open

`proposal.generator.js` is 8,455 bytes on 16 lines, with a single line of 3,551
characters. `public_intake.routes.js`, `public_intake.service.js`,
`public_intake.validator.js`, `tracking_public.service.js`,
`tracking_public.routes.js`, `portfolio_public.routes.js`,
`proposal_public.routes.js`, `company_profile.routes.js`,
`company_profile.ai.js`, `success_story.validator.js`, both
`company-profile-refresh` job handlers and several client `.tsx` files are one
line each. `success_story.service.js` and `proposal.service.js` are partly
minified — readable functions interleaved with 700–1,700-character lines.

The split is clean along session boundaries: F1, F6, F7, F8, F9 and F10 are
normally formatted and well commented; F2, F4, F5, F11, F12, F13 and F14 are not.

This is not a style quibble in this repo. `.prettierignore` excludes `src/` with
the note "Praxis backend sources are hand-formatted", so `npm run format` will
never fix it and no gate will ever flag it — and the surrounding code carries
long explanatory comments that are the primary documentation of *why* things are
the way they are (`db.js`, `error-store.js`, `opportunity.rules.js`). Block A's
"FOLLOW THE HOUSE PATTERN" covers this. Three of the five defects above are in
minified files, and reading them required piping the source through Prettier
first.

Recommended: run Prettier over the affected files once, as a formatting-only
commit, and add a maximum-line-length check to the lint config so it cannot
recur.

### 7 · F14 — per-stage location was not built · MEDIUM · open

`tracking_public.service.js` returns `location: null`, hard-coded, for every
milestone. F14 asks for "the client-visible milestone subset only, **with
location**, stage reference and progress notes per stage", and the legacy
captures a location per stage.

There is nowhere to put one: `milestone_instance` has no location column, and
no table in the tenant schema carries a per-milestone location. Under the
vertical-slice rule the feature owned that migration. `stage_reference` is also
just `code` repeated.

Not fixed here — it needs a column, a write path and UI, which is a feature, not
a repair.

### 8 · F11 — sign-off does not survive an edit · MEDIUM · open

`success_story.service.update()` refuses to touch a *published* story, but a
signed-off unpublished one is freely editable and `signed_off_by` is not
cleared. So: sign off a bland draft → rewrite the headline, summary, KPIs and
client link → publish. The gate F11 was proud of ("a sign-off-before-publish gate
the legacy lacks — keep it") is bypassable by anyone with edit rights.

The one-line fix is to null `signed_off_by` whenever a content field changes,
but "which fields invalidate a sign-off" is a business decision — the KPI values
obviously do; a typo in the slug probably should not — so it is left as a
finding.

### 9 · F14 — internal dossier status on a public endpoint · LOW · open

The tracking response returns both `computed_status` (derived, client-facing)
and `status`, the raw `dossier.status` — internal vocabulary such as
`FINANCIALLY_PENDING`. A client tracking a shipment should not learn that their
file is sitting in finance. Drop `status` and keep `computed_status`.

### 10 · F12 — malformed uuid answers 400, not the uniform 404 · LOW · open

`/public/portfolio/media/:id` passes the path segment to Postgres, which raises
`22P02` on a non-uuid; the error handler maps that to `400 INVALID_VALUE`. The
careers pattern the spec points at returns the same 404 for every refusal. The
modules set `idParam: "text"`, which switches off the loader's id guard
(`module-loader.js`, API F-16) — correct for the slug and token routes, wrong for
this one. No existence is leaked, so it is cosmetic, but it is a deviation from
the pattern the block named.

### 11 · List endpoints deviate from the paged envelope · LOW · open

`quote_request`, `inbound_intake`, `partnership_request` and
`marketing_campaign` list handlers do `res.json(await …service.list(…))`,
returning a bare `{rows, total, kpi, limit, offset}`. The house helper is
`src/shared/http/paged.js` → `{data: rows}` plus an `X-Total-Count` header, with
a comment explaining that the body stays `{data}` "so every existing consumer
keeps working". It works today only because `api-client.ts` falls back to the
whole body when there is no `data` key. The KPI block genuinely does not fit
`sendPaged` — but then it is worth extending the helper rather than four
one-offs.

### 12 · F6 — the source of truth has no foreign key · LOW · open

`0683:100` — `converted_opportunity_id uuid`, commented "the SINGLE source of
truth for 'is converted'", with no `REFERENCES opportunity(opportunity_id)`.
Every other id column in that migration has one. A trigger keeps `status` in
sync with this column, so a dangling value would make a row permanently and
wrongly `CONVERTED_TO_OPPORTUNITY`.

---

## Regression pass — nothing was trampled

Checked every module the spec told the builder to preserve:

- **Campaign sending.** `campaign_sender`, `campaign_template`,
  `newsletter_subscriber` and the send endpoint are intact; the F8 work added
  platform/budget/targets around them. The PATCH-while-pending guard is real and
  correctly implemented as a state-dependent permission at the route
  (`PENDING_APPROVAL` and `ENDED` require `approve`), not as a status check in
  the service.
- **Supplier master.** Untouched, and F10's draft supplier goes through its repo
  rather than its service specifically so the write joins the caller's
  transaction. The other half — `assertSupplierUsable` in
  `purchase_order.service` — is implemented, refuses `DRAFT` and
  `PENDING_REVIEW`, and deliberately passes `NULL` so suppliers predating the
  party-lifecycle columns keep working. That is the right call.
- **Careers.** Still the reference public module. Its token routes were changed
  to resolve the environment from the token rather than the header, which is an
  improvement; the index route was left on `req.tenantDb` and is covered by
  finding 5.
- **Proposal lifecycle.** `DRAFT → IN_REVIEW → SENT → ACCEPTED/REJECTED` with
  per-transition permissions survives. Verified over HTTP: `DRAFT → SENT`
  directly is refused with `422 BAD_STATE`, and `SENT` allocates a real
  `doc_number` from the numbering service (`SLS-23-2026-0001`), not the legacy's
  colliding `rand(100,999)`.
- **Inbound triage.** `triage-to-lead` kept; `RESPONDED` added so the four KPI
  tiles can be computed.
- **`tenant-context.js`** was changed, and it is a genuine bug fix with a test:
  nested `tenantDb`/`identityDb` calls used to leave `search_path` pointing at
  the wrong schema, which had sandbox POSTs inserting into `live`.
- **AI tool catalogue.** All 14 features registered their operations —
  `get_company_profile`, `share_proposal`, `generate_proposal`,
  `convert_quote_request`, `approve_partnership_request`,
  `save_meeting_discovery_section` and the rest are in the 376-action catalogue.
  Block A asked for this and it was not skipped.

---

## Pre-existing, not caused by this work

`npx jest` exits **1** with all 3,026 tests passing. The cause is
`src/shared/observability/error-store.js`: its flush timer fires after Jest has
torn the environment down and lazily `require`s `services/platform/db`, which
raises "You are trying to `import` a file after the Jest environment has been
torn down" and leaves a non-zero exit code.

Confirmed identical at baseline `9852d4c5`, so it is **not** a regression from
the CRM work — but CI's `build-test` job runs `npx jest --coverage` and will be
red on it regardless of the code. Worth fixing separately: unref or clear the
flush interval in global teardown, or have `db()` return a no-op once the module
registry is gone. Coverage itself is fine (functions 26.94% against a 13% floor).

---

## Changes made by this audit

| File | Change |
| --- | --- |
| `src/modules/sales/proposal/proposal.service.js` | `JWT_SECRET` → `JWT_ACCESS_SECRET` (finding 1) |
| `migrations/seeds/9031_seed_pipeline_stage_probabilities.sql` | new — stage ladder and probabilities after 9030 (finding 2) |
| `src/modules/sales/public_intake/public_intake.validator.js` | optional `entity_id` on the public quote schema (finding 3) |
| `migrations/tenant/0699_partnership_request_supplier_reuse.sql` | new — drops the unique index blocking supplier reuse (finding 4) |
| `src/modules/sales/partnership_request/partnership_request.service.js` | `SELECT … FOR UPDATE` guard inside `approve()` (finding 4) |
| `portfolio_public.routes.js`, `proposal_public.routes.js`, `public_intake.routes.js`, `tracking_public.routes.js`, `careers.routes.js` | `req.tenantDb` → `req.tenantDbIn("live", …)` (finding 5) |
| `tests/unit/proposal-share-minting.test.js` | new — 5 tests; 3 fail against the unfixed code |
| `tests/unit/public-surface-hardening.test.js` | new — 8 tests |
| `tests/integration/pipeline-stage-ladder.test.js` | new — 5 tests against a real ladder |
| `doc/ERROR_CODES.md` | regenerated (the new `ALREADY_APPROVED` throw) |

After the changes: **3,039 tests passing, 0 failing**, lint 0 errors, migrations
apply twice cleanly, idempotency gate passes, all four static gates clean, API
docs in sync.

## Recommended next

1. Format the minified files and add a line-length rule (finding 6) — it makes
   everything else in this list cheaper to fix.
2. Decide what invalidates a success-story sign-off (finding 8).
3. Give F14 a per-milestone location, or amend the spec to say it has none
   (finding 7).
4. Fix the Jest teardown exit code so CI can be trusted to be red for real
   reasons.
5. When a test asserts a *branch* against a mocked repo — F10's reuse, F5's
   minting — pair it with one integration test that runs the same path against a
   schema. All four high/medium defects here lived in exactly that gap.

---

## Appendix · error-console triage (same day)

The tenant error monitor was reviewed alongside this audit. Duplicates of the
same code+route collapsed into one row each. Every entry is listed with what it
turned out to be, because "an error in the console" and "a defect in the code"
were not the same set — three of the seven were the system correctly refusing
something.

| Console entry | Verdict | Where it went |
| --- | --- | --- |
| `TypeError: n.map is not a function` — FATAL, `/hr/trainings` | Real, and it blanked the screen | `DataList` now reports an unexpected payload shape instead of crashing (`data-list-shape.test.tsx`, 8 tests) |
| `500` on the partnership-request list | Real — the two count partitions were built from different WHERE clauses | Both partitions now share one predicate (`partnership_request.repo.js`) |
| Opportunities kanban renders nothing though the endpoints return data | Real, and worse than blank — deals whose stage was not one of the board's columns were dropped silently | A dashed "No stage" column, with the existing Move control (`opportunities-board.test.tsx`) |
| `FIELD_NOT_WRITABLE: data_type, facet_role, group_code, key, label_en, label_fr, seq` — NOTICE | Real, and total: adding a field to a draft field set had never worked on any tenant | `INSERT_WRITABLE` derived from `FIELD_WRITABLE` (`service-type-field-insert.test.js`) |
| `PLAN_LOCKED: fields` — NOTICE | **Not a defect.** Refusing a plan edit on an ACTIVE campaign is F8 working. The *reporting* was wrong: `{ fields: [names] }` instead of the per-field map every other 422 emits, so `<Form>` marked nothing and the console printed the wrapper key | `assertEditable` now emits `{ field: [reason] }`; the old test asserted the wrong shape and was updated |
| `VALIDATION_ERROR: email, password` on login — NOTICE | **Not a defect.** `validate.js` rejecting a malformed submit; the shape is already canonical | Nothing to do |
| `INVALID_VALUE` ×1 on `/sales/company-profile` | **Closed, not reproduced** — see below | Nothing to do |

### On the `/sales/company-profile` `INVALID_VALUE`

Closed after every request that page makes was exercised — `GET
/company-profile`, `PUT /company-profile`, `POST /company-profile/refresh`,
`POST /company-profile/extract`, and the vault upload behind `ScanAttachment` —
without reproducing it.

What the investigation did establish, and the reason this closure is safe to
act on rather than a shrug: **`INVALID_VALUE` is not thrown by any application
code.** Nothing in `src/` raises it. It exists in exactly one place —
`src/middleware/error-handler.js`, which maps two raw Postgres SQLSTATEs onto
it:

* `22P02` — invalid text representation. A malformed uuid, or an empty string
  or non-numeric text reaching an integer/numeric/date parameter.
* `23514` — check-constraint violation.

Both are *data-shaped*, not code-shaped, which is exactly why a clean seeded
database will not produce them: it takes a particular value, not a particular
click. That also rules out the write path here — the profile validator is
`z.string().uuid()` on `source_document_id` and typed on everything else, so a
malformed value cannot arrive through it. `entity_ref` is a free-text column,
not a parsed id, so the `company_profile:tenant` fallback in the page is not it
either.

If it recurs, one console entry is enough to finish this: the `request_id` on
the row leads to the server log line carrying the failing statement and its
parameters, and the SQLSTATE says immediately which of the two it was. Chasing
it further without that is guesswork.
