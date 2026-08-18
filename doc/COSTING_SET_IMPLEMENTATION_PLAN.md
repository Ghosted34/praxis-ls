# Costing set — implementation plan

**Companion to** `doc/LEGACY_COSTING_SET_NAMING_MAP.md`, which established what each module is
called in the legacy tree and found that `regie` has no legacy ancestor.

**Scope.** `src/modules/costing/{costing,cost_tracking,cash_request,regie}` plus their client
surfaces. Four landings, ordered by whether the books are currently wrong.

**Standing constraints** (carried from the pricing set, still binding): read `migrations/`
properly; do not assume; do not guess column names; every column named below was read from
migration SQL. Additionally, per this task: **nothing hardcoded that a tenant might
reasonably want to change** — the test for each new value is whether it goes through
`shared/config/settings.getRule` or a table, never a JS literal.

**Date.** 2026-08-18. Next free tenant migration: `10717`. Next tenant seed: `9094`
(`/^90/` = tenant, `/^91/` = platform — see `migrator.js`; getting this wrong sends a tenant
seed to the platform DB).

---

## 0. The finding that reorders everything

Régie is not "new but complete". **It is a two-step stub of a five-step workflow, and the
gap silently corrupts account 581.**

`regie_advance` (DDL at `0230_treasury_invoicing.sql:22`) has:

```
amount, justified_amount, returned_amount, policy_window_days,
state CHECK IN ('ISSUED','PARTIALLY_JUSTIFIED','JUSTIFIED','AGED_UNJUSTIFIED','QUERIED')
```

`regie.rules.js:14` computes `openBalance = amount − justified_amount − returned_amount`.

But **`justified_amount` and `returned_amount` are never written by any code in the repo**:

```
$ grep -rn "justified_amount\|returned_amount" src/
src/modules/costing/regie/regie.rules.js:14      <- the only hit, and it READS them
```

Consequences, in order of severity:

1. **`openBalance` always equals `amount`.** It is a subtraction of two columns that are
   permanently zero.
2. **Three of the five states are unreachable.** Nothing can ever set
   `PARTIALLY_JUSTIFIED`, `JUSTIFIED` or `QUERIED`. `listAgeable` selects
   `state IN ('ISSUED','PARTIALLY_JUSTIFIED')`, so in practice it only ever sees `ISSUED`.
3. **581 never clears.** KB §6.8 steps 2–5 (retirement against receipts, unspent cash
   returned, full justification, unsupported spend held as a query) have **no
   implementation at all**. Only step 1 (issue) and the aging rule exist.
4. **`cash_request.justify` closes the wrong half of the workflow.**
   `cash_request.service.js:149` sets the request to `JUSTIFIED` and records `spent_amount`
   on the lines — but never touches the linked `regie_advance`. So the request reads
   "justified" while its advance still sits open in 581 and will subsequently be **aged into
   `4211` as a receivable from a holder who already accounted for the money.** That is a
   wrong ledger entry produced by a workflow completing normally, which is the worst class
   of the four.

This is why §1 below is the first landing and why it is not optional.

### 0.0 STATUS — Landing A is implemented

Shipped: `migrations/tenant/10717_regie_retirement.sql`,
`migrations/seeds/9094_seed_regie_policy.sql`, the régie module (8 files),
the `cash_request.justify` seam, and `tests/unit/regie-retirement.test.js` (50 tests, all
passing, no regressions against baseline).

**Three defects were found DURING implementation that this plan did not know about.** All
three would have made Landing A fail at runtime, and none was visible from the JS:

1. **`658` does not exist.** KB §6.8 step 5 names it and `grep -rn "658" migrations/`
   returns exactly one hit — a longitude in the geo catalogue (`0675:75`). Neither `658` nor
   its heading `65` is seeded. `journal_line.account_code` is
   `REFERENCES chart_of_accounts(code)` (`0220:56`) **and** `assert_line_valid()`
   (`0640:150`) raises unless `is_postable` — so every write-off would have failed twice
   over. 9094 seeds `65` + `658`.
2. **`521` is not postable — so régie issuance is broken TODAY.** `9000:77` seeds
   `('521','52','Banques locales',…,is_postable=false)`: it is a 3-digit grouping whose
   postable leaf is `5211` (`9000:126`). `9001:38` re-lists it but is `ON CONFLICT DO
NOTHING` and runs second, so 9000's row wins. Every service in the set defaults
   `treasuryCoa = "521"` and `regie.controller.js` never overrides it, so
   `assert_line_valid` raises _"account 521 is not postable (KB §23.3)"_ on any régie issue.
   This is independent of the retirement gap and predates it. The seeded default is now
   `5211`.
3. **`4731` is `requires_analytic`** (`9001:113`), so the ledger trigger rejects a receipt
   posting with a NULL `dossier_id`. This makes the per-kind dossier rule a hard
   requirement rather than a nicety, and it is why `justify` now refuses a régie-backed
   request that has no dossier.

Defects 1 and 2 are the answer to "did you read the migrations properly" — neither is
findable without reading the CoA seeds and the ledger trigger together.

### 0.1 What "enrich the process and flow" means concretely

Régie is being written fresh, so the target is not parity with anything — it is the workflow
done properly. Eight concrete gaps, each with its section:

| #   | Gap today                                                          | Becomes                                          | §      |
| --- | ------------------------------------------------------------------ | ------------------------------------------------ | ------ |
| 1   | No way to record a receipt                                         | `regie_retirement` child table, 3 kinds          | 1.1    |
| 2   | 3 of 5 states unreachable, no transition table                     | Full `NEXT` map incl. back-edges                 | 1.2    |
| 3   | Aging is a one-way door                                            | `unage` via `aged_entry_id`                      | 1.3    |
| 4   | `justify` closes the request, not the advance                      | Both, one transaction                            | 1.4    |
| 5   | Accounts/journals frozen in JS                                     | `setting`, validated against `chart_of_accounts` | 1.5 L1 |
| 6   | **Flat permission — a 50 K and a 50 M advance take the same path** | Workflow engine + amount thresholds              | 1.5 L2 |
| 7   | No currency on a money table                                       | `currency` + `exchange_rate_to_xaf`              | 1.5    |
| 8   | Holder is never asked for receipts                                 | "My advances" + pre-window notification          | 2.2    |

Number 6 is the one that most deserves the word "dynamic", and it is not a settings value —
see §1.5 Layer 2.

---

## 1. Landing A — close the régie loop (correctness)

**Goal:** every KB §6.8 step exists, `581` can reach zero, and no state is unreachable.

### 1.1 Migration `10717_regie_retirement.sql`

Régie retirement is currently unrepresentable because there is nowhere to record a receipt.
Add the child table, mirroring how `cash_request_payment` already records the other side:

```sql
CREATE TABLE regie_retirement (
  regie_retirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regie_advance_id uuid NOT NULL REFERENCES regie_advance(regie_advance_id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('RECEIPT','CASH_RETURN','WRITE_OFF')),
  dossier_id       uuid REFERENCES dossier(dossier_id),   -- required for RECEIPT (per-dossier 4731 tag)
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  proof_vault_id   uuid REFERENCES document_vault(doc_id),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  retired_on       date NOT NULL DEFAULT CURRENT_DATE,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

Three `kind`s because KB §6.8 has three distinct postings, and collapsing them would force
the posting account to be inferred:

| `kind`        | KB step | Posting                                                                 |
| ------------- | ------- | ----------------------------------------------------------------------- |
| `RECEIPT`     | 2       | `Dr 4731 Mandants (dossier) / Cr 581`                                   |
| `CASH_RETURN` | 3       | `Dr 571 Caisse / Cr 581`                                                |
| `WRITE_OFF`   | 5       | `Dr 658 / Cr 581` — only from `QUERIED`, only with an explicit decision |

`dossier_id` is nullable in DDL but **required for `RECEIPT`** — enforced in the validator,
not a CHECK, because the requirement is per-kind and a partial CHECK across two columns is
harder to read than one line of zod. (Flagging this as a deliberate choice, not an
oversight.)

`proof_vault_id` FK → `document_vault(doc_id)` matches `cash_request_line.proof_vault_id`
(`0342:87`). KB §6.8 step 5 is explicit: **never invent a 4731 line without a document** —
so a `RECEIPT` with no proof must be refused or forced down the `QUERIED` path.

Also in `10717`, additive and idempotent:

```sql
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES corporate_entity(entity_id);
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS closed_on date;
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS aged_entry_id uuid REFERENCES journal_entry(entry_id);
```

`entity_id` because `issue()` takes an `entityId` for the posting but never stores it, so
nothing can later re-post (aging, retirement) without the caller supplying it again —
`ageDue` currently demands `entity_id` in its request body for exactly this reason, which is
the schema leaking into the API. `aged_entry_id` so the aging reclassification is
reversible; `ageOne` posts it and keeps no reference. Both mirror the existing
`issue_entry_id` column.

### 1.2 The enriched lifecycle

KB §6.8 gives five steps and five states but no transition table. Régie currently has neither
— `ageOne` writes `state: "AGED_UNJUSTIFIED"` directly with no guard, which is how three
states ended up unreachable. The full machine, to live as a `NEXT` map in `regie.rules.js`
(the shape `cash_request.rules.js:7` already uses):

```
                    ┌──────────────┐
   retire(RECEIPT | │              │ retire(...) leaving open > 0
   CASH_RETURN)     ▼              │
  ┌────────► PARTIALLY_JUSTIFIED ──┘
  │                 │
ISSUED              │ retire(...) closing to open = 0
  │  │              ▼
  │  └────────► JUSTIFIED  (terminal, sets closed_on)
  │                 ▲
  │                 │ writeOff (Dr 658)
  │                 │
  ├─ query ──► QUERIED ──► retire(RECEIPT) ──► (back to PARTIALLY_JUSTIFIED / JUSTIFIED)
  │
  └─ age (past window, open > 0) ──► AGED_UNJUSTIFIED
                                          │
                          unage, or a late retire(RECEIPT)
                                          │
                                          └──► ISSUED / PARTIALLY_JUSTIFIED
```

`NEXT` as data, so the routes, the AI manifest and the client all read one source:

```js
const NEXT = {
  ISSUED: ["PARTIALLY_JUSTIFIED", "JUSTIFIED", "AGED_UNJUSTIFIED", "QUERIED"],
  PARTIALLY_JUSTIFIED: ["JUSTIFIED", "AGED_UNJUSTIFIED", "QUERIED"],
  AGED_UNJUSTIFIED: ["PARTIALLY_JUSTIFIED", "JUSTIFIED", "QUERIED"], // unage / late receipts
  QUERIED: ["PARTIALLY_JUSTIFIED", "JUSTIFIED"], // resolved or written off
  JUSTIFIED: [], // terminal
};
```

Two things this makes explicit that the KB leaves implicit, and both are deliberate:

- **`AGED_UNJUSTIFIED` is not terminal.** A holder who produces receipts a week late must be
  able to retire the advance. Without the back-edge, aging is a one-way door: the balance
  sits in 4211 and a later receipt cannot post against 581 because 581 is already flat. This
  is exactly the costing-unlock defect (§3.1) — a lock with no key — and repeating it in a
  module we are writing fresh would be inexcusable.
- **`QUERIED` can resolve either way.** Write-off is not the only exit; the KB says "write
  off to 658 **or** recover from the holder".

### 1.3 Service work — `regie.service.js`

Each posting goes through `journalEntry.buildAndInsert`, exactly as `issue`/`ageOne` already do:

- **`retire(client, {advanceId, kind, dossierId, amount, proofVaultId, ...})`** — inserts the
  `regie_retirement` row, posts per the §1.1 table, then **recomputes** the advance from its
  children rather than incrementing a counter:
  `justified_amount = Σ RECEIPT`, `returned_amount = Σ (CASH_RETURN + WRITE_OFF)`.
  Recompute-from-children is the point: an increment drifts the moment a retirement is
  corrected, and these two columns are what `openBalance` depends on. Reject over-retirement
  before the UPDATE — `0497:137` already constrains `justified + returned <= amount`, and a
  clean 422 beats a constraint violation surfacing from inside a transaction.
- **`recomputeState(advance)`** in `regie.rules.js` (pure, no DB, per the `NEXT` map above).
- **`query(client, {advanceId, reason})`** → `QUERIED`, no posting (KB: "hold as a query").
- **`writeOff(client, {advanceId, amount, ...})`** → a `WRITE_OFF` retirement, `Dr 658`,
  only from `QUERIED`, routed through the approval chain (§1.5 Layer 2).
- **`unage(client, {advanceId, ...})`** — reverses the aging reclassification using
  `aged_entry_id`, restoring the balance to 581 so late receipts can post.

**Concurrency.** `retire` must `SELECT ... FOR UPDATE` the advance row before recomputing.
Two receipts filed simultaneously would otherwise both read the same `justified_amount`, and
the recompute-from-children design only holds if the read and the write are serialised.
Worth stating because the existing `issue`/`ageOne` never needed it — they touch one row once.

### 1.4 The `cash_request` ↔ `regie` seam

`cash_request.justify` must retire the linked advance in the **same transaction**, not leave
it open. The cash request's lines already carry `spent_amount`, `is_disbursement` (renamed by
`0640`) and `proof_vault_id` — which is exactly a receipt list. So justification maps each
line to a `RECEIPT` retirement tagged with the request's `dossier_id`.

Decision to make explicitly (do not let it default): a cash request whose `spent_amount` sum
is **less** than the advance leaves a remainder. Options are (a) require a `CASH_RETURN`
retirement for the difference before allowing `JUSTIFIED`, or (b) allow partial and leave the
advance `PARTIALLY_JUSTIFIED`. **Recommend (a)** — KB step 4 says a fully justified advance
nets 581 to zero, and (b) lets a "justified" request sit against an open advance, which is
the bug this landing exists to remove.

### 1.5 Dynamic, not hardcoded — the four layers

"Not hardcoded" is not one change; there are four distinct things currently frozen in JS,
and they want four different mechanisms. Putting them all in one settings blob would be as
wrong as leaving them in code.

#### Layer 1 — account codes and journals → `setting` (tenant-editable values)

Every account code in the set is a JS default parameter:

```
regie.service.js:22   treasuryCoa = "521", regieCoa = "581"
regie.service.js:60   holderReceivableCoa = "4211", regieCoa = "581"
regie.service.js:31   journalCode "BQ"        :67  journalCode "OD"
cash_request.service.js:128  treasuryCoa = "521"
cost_tracking.service.js:19  "4731", "521"     :33  "OD"
```

`9050_seed_settings.sql:19` seeds `('finance','regie','{"policy_window_days":7}')` and
nothing else, so `policy_window_days` is the **only** régie value a tenant can change today.

Extend that same key in `9094_seed_regie_policy.sql`:

```json
("finance", "regie", {
  "policy_window_days": 7,
  "accounts": { "regie": "581", "treasury": "521", "cash": "571",
                "holder_receivable": "4211", "dossier_mandant": "4731", "write_off": "658" },
  "journals": { "issue": "BQ", "retire": "OD", "age": "OD" }
})
```

Read through the existing `getRule` — `issue()` already uses it for the window, so this
applies the convention rather than inventing one. Keep the JS literals as last-resort
fallbacks so an un-seeded tenant still posts correctly.

**Validate the codes on write, not on post.** A typo'd account in `setting` currently fails
at posting time, deep inside a transaction, as a foreign-key error against
`chart_of_accounts(code)`. The Settings write path should reject an account code that is not
in `chart_of_accounts` — the difference between "you cannot save that" and "the month-end
close crashed".

#### Layer 2 — who may approve what → the **workflow engine**, which régie is not wired to

This is the substantive "more dynamic" gap, and it is not a settings value.

`workflow_step` (`0120_events_workflow.sql:31`) already models exactly what régie needs:

```
step_seq, step_kind CHECK IN ('VALIDATE','APPROVE'),
role_id, capability_code CHECK IN ('VALIDATOR','APPROVER'), scope_id,
min_amount_xaf, max_amount_xaf          -- amount-threshold routing
```

`cash_request` is already wired to it: `disburse` runs through `executor.start` bound to
`disbursal.requested`, with `assertNoPendingChain` guarding double-approval, and
`0469_default_workflows.sql` seeds a default single-step chain. So a tenant can already say
"disbursals over 5 M XAF need a second approver" **without a code change**.

Régie has none of this. `regie.routes.js` gates `POST /issue` on a flat
`requirePermission("MOD-49","create")` and `POST /age-due` on `approve`. There is no chain,
no amount threshold, no VALIDATE step — a 50 000 XAF advance and a 50 000 000 XAF advance
take exactly the same path.

Worse, **`regie.issued` is not a seeded `event_type` at all.** `9020_seed_rbac_events.sql`
seeds `disbursal.requested` (approvable) and `advance.aged_unjustified` (not approvable);
`grep -rn "'regie.issued'" migrations/` returns nothing. `regie.events.js:2` acknowledges
this — the key is emitted into `event_log` as free-form citext. An event type that does not
exist cannot have a workflow bound to it, so régie is structurally unroutable today.

The work: seed `regie.issued` (and the new `regie.retired` / `regie.write_off`) as event
types with `is_approvable` set appropriately, then call `executor.start` from `issue`,
`writeOff` and `unage`, passing `amountXaf` so the threshold columns actually do something.
Write-off especially — "hold as a query, then write off to 658" (KB §6.8 step 5) is precisely
the decision a tenant will want routed by value.

**This is the difference between configurable and hardcoded that matters most**, because it
is about authority rather than about a number.

#### Layer 3 — per-item posting accounts → `posting_rule`, if ever needed

`posting_rule` (`0200_coa_dictionary.sql:63`) models per-dictionary-item debit/credit
accounts for `sale`/`purchase`/`disbursement`, with a deferrable trigger asserting every item
has one (KB §23.14). Régie postings are workflow-level, not item-level, so Layer 1 is the
right home **for now** — but retirement receipts are tagged per dossier and could plausibly
need per-service-type accounts later. If that day comes, extend `posting_rule` rather than
growing a second settings blob. Recorded so the next person does not re-litigate it.

#### Layer 4 — policy switches → `setting`, but each one must earn its place

```json
{
  "require_proof_for_receipt": true, // KB §6.8 step 5: never a 4731 line without a document
  "allow_partial_justification": true, // see the §1.4 remainder question
  "auto_age": true, // whether the worker ages automatically
  "warn_before_window_days": 2
} // watchlist lead time (Landing B)
```

`require_proof_for_receipt` defaults **true** because the KB states it as a rule, not a
preference. A tenant may relax it; the default must not.

**Deliberately NOT configurable:** the _shape_ of the postings. Which accounts get debited
and credited is a setting; that a `RECEIPT` is `Dr <mandant> / Cr <regie>` and balances is
not. Making the posting shape data would let a tenant configure an unbalanced entry, and
Σ Dr = Σ Cr is the one thing that must never be a tenant's decision.

#### What "richer" adds to the schema

Two columns in `10717` that the current design cannot express:

```sql
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS currency char(3) REFERENCES currency(code);
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS exchange_rate_to_xaf numeric(18,8);
```

`regie_advance` stores a bare `numeric(18,2)` with **no currency** — the only money table in
the set that does not carry one (`costing` has `currency` + `exchange_rate_to_xaf`,
`0320:10-11`). An advance drawn in EUR for a European carrier is currently unrepresentable,
and the amount-threshold routing in Layer 2 is meaningless without a rate to convert to XAF.
Default `'XAF'` / `1` so existing rows and the common case are unaffected.

Note the existing constraint this must respect: `0497_money_constraints.sql:137` already
enforces `justified_amount + returned_amount <= amount` (NOT VALID). The recompute in §1.3
therefore has to reject over-retirement _before_ the UPDATE, or it will surface as a
constraint violation rather than a clean 422.

### 1.6 Tests

`tests/unit/` — no DB, following `extra-charge-five-families-g16.test.js`:

- `regie.rules.js` pure: `openBalance` with partial receipts; `recomputeState` at each
  boundary (0, partial, exact, over-retirement must throw); `isAged` unchanged.
- Retirement postings balance (Σ Dr = Σ Cr) for all three `kind`s.
- `recomputeState` never downgrades out of `QUERIED`.
- The §1.4 seam: justify → advance `JUSTIFIED`, `open === 0`.
- A receipt with no `proof_vault_id` is refused when `require_proof_for_receipt` is true.

---

## 2. Landing B — régie UI and the operational surfaces

Current surface: `RegiePage` lists advances, `RegieForm` issues one
(`client/src/features/costing/pages.tsx:961,863`). `client/src/lib/costing-api.ts:138-140`
exports exactly `listRegie` and `issueRegie`. **There is no way to retire, return cash, query, write off or
un-age from the UI** — consistent with the backend, and equally incomplete.

### 2.1 The advance detail view

An advance is a running balance with a history; a list row cannot show that.

- **Balance header** — issued / justified / returned / **open**, open being the number that
  matters, with the state pill and days-to-window (or days overdue). Derived from the same
  `openBalance` the backend uses; the client must not re-implement the arithmetic.
- **Retirement ledger** — the `regie_retirement` rows in date order: kind, dossier, amount,
  proof link, journal entry. This is the audit trail KB §6.8 implies and nothing renders today.
- **Actions gated by the API's `NEXT` map**, not by client-side conditionals. The client
  renders what the server says is available; a second copy of the state machine in TSX is
  how the two drift.
- **Aging watchlist** on the list page — inside `warn_before_window_days` of the window, and
  past it. The window is **per-advance** (`policy_window_days` is a column, defaulted from
  settings at issue), so this reads the row, never a global constant.

Per `doc/FRONTEND_GUIDE.md`: desktop layout at `lg`/`xl`/`2xl` only, dense,
`PageContainer width="wide"`, balance header and retirement ledger side by side at `xl`
rather than stacked. `useIsDesktop` and `Dialog size="wide"` (added in `810da6f`) cover the
detail-in-modal-vs-page decision.

### 2.2 The holder's view — the flow's missing half

Every surface in this module today is finance-facing. But the person who **owes** the
justification is the holder, and nothing tells them so. The workflow's whole premise is that
a holder takes cash to the port and comes back with receipts; if the system never asks them
for those receipts, aging is guaranteed and the 4211 reclassification becomes routine rather
than exceptional.

So: **"My advances"** — the holder's own open advances, what each is for, what is still
unjustified, and a file-a-receipt action. `regie_advance.holder_user_id` already exists and
is already populated (`cash_request.disburse` passes `holderUserId || cr.requested_by`), so
this is a filtered read, not new schema.

Pair it with a **notification at `warn_before_window_days`** rather than only a compliance
flag after the fact. The notification module is self-scoped ("read your own"), which fits
exactly. Chasing a receipt two days before the window is worth more than flagging a breach
after it.

### 2.3 Wire the compliance flag that is already specified

`compliance_flag.rule_key` is documented in the DDL comment as
`'dossier.missing_bl' | 'advance.aged_unjustified'` (`0340_vault_comms.sql:29`), and
`advance.aged_unjustified` is a seeded event type (`9020_seed_rbac_events.sql:69`). KB §6.8
closes with "**MOD-49** owns issuance and retirement; **MOD-65** raises the aging flag."

`ageOne` emits the event but **never raises the flag**, so the MOD-65 half of that sentence
is unimplemented. One insert in `ageOne`, severity from settings (`WARN` default, `RED` past
a configurable multiple of the window). The plumbing all exists.

### 2.4 The AI manifest must grow with the workflow

`regie.ai.js` declares two reads and two writes (`issue_regie_advance`, `age_regie_advances`).
Every new service in §1.3 needs an entry, or the assistant can issue an advance and then be
unable to retire it — which is worse than not exposing régie at all, because it can start
something it cannot finish.

Per `87d8e03`, each entry needs a `permission` whose module matches the routes
(`MOD-49`) and whose verb resolves through `action-authz`. `retire` is `edit`; `write_off`
and `unage` are `approve` and must set `confirm: true` — they move money between accounts on
a human's say-so.

## 3. Landing C — the two legacy gaps

Both were found in the naming-map exercise and are behaviour the legacy system has and the
new one does not.

### 3.1 Costing unlock (`APPROVED_LOCKED` is terminal)

Legacy `api/costing/transition.php` gates seven actions; the new
`costing.routes.js` `TRANSITION_ACTION` map has four. There is no way out of
`APPROVED_LOCKED`, and `grep -rln -i unlock src/modules/` matches only
`app_user.service.js` (account lockout, unrelated).

Add `REQUEST_UNLOCK` / `UNLOCK` / `DENY_UNLOCK`. The legacy role lists
(`REQUEST_UNLOCK`: ADMIN/SALES/OPERATIONS/MANAGEMENT; `UNLOCK` and `DENY_UNLOCK`:
ADMIN/MANAGEMENT) map onto the existing pattern: `edit` for the request, `approve` +
`APPROVER` capability for the decision — the same split `costing.routes.js` already documents
for SUBMIT vs APPROVE. The status vocabulary needs no migration: `0320:13` already allows all
five values and unlock returns the row to an existing state.

**Do not port the role names.** Legacy hardcodes `['ADMIN','MANAGEMENT']`; the new system has
module grants plus the SoD capability overlay, which is strictly more expressive.

**CORRECTION — this section said "the status vocabulary needs no migration".** It does.
Reading `transition.php` properly shows the request and the decision are two acts by two
people, so legacy parks the interval in a **sixth** status, `UNLOCK_REQUESTED`
(`transition.php:181`). Without it, "someone has asked to reopen this" is unrepresentable.
Migration `10718` widens the CHECK and adds the attribution columns
(`unlock_requested_by/at`, `unlock_reason`, `unlocked_by/at`).

**A second thing this section did not account for**, found while implementing: approving a
costing calls `finalInvoice.ensureDraftForCosting` (`costing.service.js:99`), so approval
**opens a FINAL invoice** for the dossier, and that invoice can reach `ISSUED_LOCKED` /
`POSTED_LOCKED` with a posted `entry_id` (`0230:66`). Reopening the costing underneath a
posted receivable would let the priced basis move while booked revenue stayed put. `UNLOCK`
therefore refuses while a non-DRAFT final invoice exists, naming it in the 422 so the user
knows what to reverse. `REQUEST_UNLOCK` is **not** blocked — asking is harmless, and the
invoice may be reversed between the ask and the decision.

### 3.2 Cash request — two missing states — **NOT IMPLEMENTED, and why**

Legacy has `VALIDATED` and `PARTIALLY_DISBURSED`; the new CHECK (`0342:74`) has neither.
**Both were investigated and both were deliberately left out.** The paragraph below is the
correction: the premise this section was written on turned out to be wrong.

#### `PARTIALLY_DISBURSED` — the premise was wrong

This section claimed "the schema already supports the situation (`cash_request_payment` is
one-to-many), so a half-paid request currently reads as `APPROVED`". The table does exist and
is one-to-many. **Nothing writes to it.**

```
$ grep -rn "insertPayment" src/
src/modules/costing/cash_request/cash_request.repo.js:8    (the definition)
src/modules/costing/cash_request/cash_request.repo.js:62   (the export)
```

Two call sites, both in the repo that defines it. `insertPayment` is dead code, and the only
reader — `listPayments`, in `get` (`cash_request.service.js:249`) — returns an always-empty
array. Following the disbursal path confirms it:

- `disburse` (`cash_request.service.js:129`) takes **no amount**. Its validator
  (`cash_request.validator.js:14`) accepts `entity_id`, `entry_date`, `source_doc_ref`,
  `treasury_coa`, `holder_user_id` — and nothing else.
- It issues a régie advance for `Number(cr.amount)`, the **whole** request, then sets
  `status: "DISBURSED"` in the same statement.
- `cash_request.regie_advance_id` (`0342:71`) is a single nullable uuid, not a child table.
  One request draws on **one** advance.

So a partial disbursement cannot be expressed today at any layer: no amount to partially
disburse, no payment row to record it against, no second advance to hold the remainder.
Adding `PARTIALLY_DISBURSED` to the CHECK would create **a state nothing can write** —
which is precisely defect (1) of Landing A, where `justified_amount` and `returned_amount`
were read by `openBalance` and written by nothing, leaving three of five states unreachable.
Repeating that pattern in the same session that fixed it would be indefensible.

**If partial disbursement is genuinely wanted**, the work is not a CHECK change. It is:
`disburse` taking an `amount`; writing a `cash_request_payment` row per payment; deriving the
status from `Σ payments` vs `cash_request.amount` rather than setting it directly; and
deciding whether the second payment issues a second régie advance (needing a join table) or
tops up the first (needing an `amount` that can change after issue, which `regie_advance`
does not currently allow). That is a landing of its own, and it needs the product question
answered first: _does a cash request ever get paid in instalments in this business?_

#### `VALIDATED` — no evidence it is wanted

The two-step exists in costing because a costing is a **priced commitment to a client** that
someone other than the author should check before it is approved. A cash request is an
internal ask for a float, already gated by `approve` + the APPROVER capability, and — since
Landing A — closed out by a justification that must retire its advance to the cent.

Adding a state to a lifecycle is cheap; removing one after rows have used it is not. Nothing
in the legacy `view/finance/cash-request.php` flow, nor in the KB, argues the extra step
earns its cost here. **Recorded as deliberate: `cash_request` is one-step.** If a tenant
wants a second signature, `executor.start` on `cash_request.submitted` already provides one
without a schema change — which is the configurable answer this codebase prefers over a
hardcoded state.

#### What §3 shipped instead

Migration `10718` is spent on §3.1 (costing unlock), which had a real, evidenced defect: a
state with no exit. §3.2 needs no migration.

---

## 4. Landing D — cost tracking

Legacy computed its KPI surface in three **database views**
(`view_cost_tracking_master`, `view_cost_tracking_kpis`, `view_cost_item_details`); the new
module computes equivalents in JS (`cost_tracking.service.js` `reconcileDossier`). There is
no new view to diff against, so:

1. Extract the three view definitions from the legacy SQL and record them alongside
   `reconcileDossier` in a comparison doc.
2. Reconcile field by field. Only then decide whether anything is genuinely missing.

Deliberately last: it is the only one of the four with no known correctness defect, and the
comparison is analysis, not code.

**DONE — `doc/COST_TRACKING_LEGACY_COMPARISON.md`.** Headline findings:

- **The view DDL does not exist in the reference tree.** Only the consumer
  (`cost-tracking-api.php`) survives; no schema dump was ever committed. The _projected
  columns_ of all three views were recovered from the PHP `SELECT` lists and array keys,
  which is what the field-by-field comparison actually needs. Reconstructing the view
  bodies would have been fabrication.
- **One real gap:** advances are never joined to the cost-tracking read, so
  `total_advance` / `total_balance` / `coverage_percentage` have no equivalent. But the new
  system models advances _better_ — `advance` (`0230:38`) is per-dossier with its own
  `entry_id` and `applied_amount`, versus legacy's per-cost-line column. The fix is a repo
  query plus three derived fields on `reconcileDossier`; **no migration**. Left as its own
  scoped change rather than folded into an analysis commit.
- **One thing not to copy:** `calculated_status` / `manual_status`. It is implemented twice
  (SQL view _and_ PHP) and disagrees with itself; `COMPLETED` means "the client has paid",
  not "the work is done"; and `dossier.status` (`0310:26`) already owns that vocabulary with
  a different meaning. Surfacing coverage as a percentage says what it means.
- **One thing we have that legacy could not express:** variance against an _approved_
  budget. The three views have no budget column — they can say what was spent and what was
  collected, never whether the spend was authorised. That is the point of MOD-47. `cost_entry` also already carries `source_ref` with a
  partial unique index (`0463`) for idempotent analytical attribution, so the dedupe problem
  that usually bites this module is already handled.

---

## 5. Order, and why

| #   | Landing               | Why here                                                                                                                                                     |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Régie loop + settings | The books are currently wrong: 581 never clears and aging fabricates a 4211 receivable against a holder who already accounted. Everything else is a feature. |
| B   | Régie UI              | Landing A is unusable without it — retirement would exist only over HTTP.                                                                                    |
| C   | Legacy gaps           | Real, bounded, and `VALIDATED` needs a product decision first.                                                                                               |
| D   | Cost tracking         | Analysis; no known defect.                                                                                                                                   |

## 6. Decisions taken (Landing A shipped on the recommended option)

All six were implemented on the recommended default. Each is reversible by a settings edit
or a one-line change, and each is recorded here so the choice is visible rather than
inferred from code.

| #   | Question                     | Decision                                                                                                                                                                     |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Remainder before `JUSTIFIED` | **Required.** `allow_partial_justification: false`. A "justified" request over an open advance is the defect Landing A exists to remove. Tenant-overridable.                 |
| 3   | Un-age                       | **Implemented.** `unage()` reverses via `aged_entry_id`; `ux_one_reversal_per_entry` (`0464:59`) prevents double-unaging.                                                    |
| 4   | Write-off vs recover         | **Two distinct actions.** Write-off = `WRITE_OFF` retirement (Dr 658). Recover = the existing aging posting (Dr 4211). Write-off is only reachable from `QUERIED`.           |
| 5   | Multi-currency               | **Added.** `currency` + `exchange_rate_to_xaf`, defaulted `'XAF'` / `1`, with `chk_regie_advance_fx_positive`.                                                               |
| 6   | Default approval chain       | **Not seeded.** Event types are seeded as approvable so a chain _can_ bind; none is bound by default. `executor.start` logs `no_workflow`, so auto-approval is visible.      |
| —   | Compliance flag              | **Implemented.** `ageOne` now inserts the `advance.aged_unjustified` flag the `0340:29` DDL comment already names. Best-effort: a flag failure never rolls back the posting. |

Still open, because it belongs to Landing C rather than A:

2. **§3.2 `VALIDATED`** — restore the two-step for consistency with costing, or record the
   one-step as deliberate? Unchanged; `cash_request` is untouched by Landing A apart from
   the justify seam.

### 6.1 Consequences worth knowing before Landing B

- **`5211`, not `521`.** The seeded treasury default is the postable leaf. `cash_request`
  and `cost_tracking` still carry `treasuryCoa = "521"` in JS and are therefore still broken
  on that path — deliberately out of scope here, but they should be fixed next; the same
  `assert_line_valid` raise applies to both.
- **A régie-backed cash request now requires a dossier.** `4731` is `requires_analytic`, so
  justify refuses rather than letting the trigger raise. Existing requests with no dossier
  will surface this at justify time.
- **Advances aged before 10717 cannot be un-aged automatically** — they have no
  `aged_entry_id`. `unage` says so explicitly instead of posting a second unlinked entry.

## 7. Verification plan

Environment limits are unchanged and will not be worked around: `npm ci` fails
(`ECONNRESET`), there is no `node_modules`, so **`tsc`, `vite build`, client `eslint` and
`vitest` cannot run.** Regressions are judged by diffing `^(PASS|FAIL)` from `npx jest`
against the recorded baseline (85 PASS / 159 FAIL / 10 skipped).

Per landing: new `tests/unit/` suites (DB-free, pure-rule where possible); the four DB gates
(`check-migration-numbers`, `check-destructive-migrations`, `check-migration-reversibility`,
`check-migration-idempotency`); `npx prettier --check`; and for client work the Babel parse +
import-resolution check plus `check-palette` / `check-contrast` / `check-motion` /
`check-docs`. Ledger correctness is asserted as **Σ Dr = Σ Cr per posting** in unit tests,
which is checkable without a database.
