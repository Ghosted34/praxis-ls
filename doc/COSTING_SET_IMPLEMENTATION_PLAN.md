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

### 1.2 Service work — `regie.service.js`

Add, each posting through `journalEntry.buildAndInsert` exactly as `issue`/`ageOne` do:

- **`retire(client, {advanceId, kind, dossierId, amount, proofVaultId, ...})`** — inserts the
  `regie_retirement` row, posts per the table above, then **recomputes** the advance from its
  children rather than incrementing a counter:
  `justified_amount = Σ RECEIPT`, `returned_amount = Σ (CASH_RETURN + WRITE_OFF)`.
  Recompute-from-children is the point: an increment would drift the moment a retirement is
  corrected, and these two columns are what `openBalance` depends on.
- **`recomputeState(advance)`** in `regie.rules.js` (pure, testable without a DB):
  `open === 0 → JUSTIFIED` (set `closed_on`); `0 < justified+returned < amount →
PARTIALLY_JUSTIFIED`; unchanged otherwise. Never downgrades out of `QUERIED` or
  `AGED_UNJUSTIFIED` without an explicit call.
- **`query(client, {advanceId, reason})`** → `QUERIED`, no posting (KB: "hold as a query").
- **`writeOff(client, {advanceId, amount, ...})`** → a `WRITE_OFF` retirement, `Dr 658`,
  only permitted from `QUERIED`. Requires `approve`.
- **`unage(...)`** — reverse an `AGED_UNJUSTIFIED` reclassification when the holder finally
  produces receipts, using `aged_entry_id`. Without this, aging is a one-way door: the
  balance sits in 4211 and a later receipt cannot be posted against 581 because 581 is
  already flat. This is the régie equivalent of the costing-unlock gap in §3.1 and should
  not be repeated.

Transitions belong in `regie.rules.js` as a `NEXT` map, the shape `cash_request.rules.js`
already uses — currently régie has no transition table at all, and `ageOne` writes
`state: "AGED_UNJUSTIFIED"` with no guard.

### 1.3 The `cash_request` ↔ `regie` seam

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

### 1.4 Nothing hardcoded

Every account code in the set is currently a JS default parameter:

```
regie.service.js:22   treasuryCoa = "521", regieCoa = "581"
regie.service.js:60   holderReceivableCoa = "4211", regieCoa = "581"
regie.service.js:31   journalCode "BQ"        :67  journalCode "OD"
cash_request.service.js:128  treasuryCoa = "521"
cost_tracking.service.js:19  "4731", "521"     :33  "OD"
```

`9050_seed_settings.sql:19` seeds `('finance','regie','{"policy_window_days":7}')` and
nothing else, so `policy_window_days` is the _only_ régie value a tenant can change.

Replace with one settings read, seeded in `9094_seed_regie_accounts.sql`:

```json
("finance", "regie", {
  "policy_window_days": 7,
  "accounts": { "regie": "581", "treasury": "521", "cash": "571",
                "holder_receivable": "4211", "dossier_mandant": "4731", "write_off": "658" },
  "journals": { "issue": "BQ", "retire": "OD", "age": "OD" },
  "require_proof_for_receipt": true,
  "allow_partial_justification": true
})
```

Read via `getRule(client, "finance", "regie", "accounts", …)` — the function already exists
and `issue()` already uses it for `policy_window_days`, so this is applying the established
convention, not inventing one. Keep the JS literals as the final fallback so an un-seeded
tenant still posts correctly.

**Precedent check:** `posting_rule` (`0200_coa_dictionary.sql:63`) already models
per-dictionary-item debit/credit accounts for `sale`/`purchase`/`disbursement`, with a
trigger asserting every item has one. Régie postings are workflow-level rather than
item-level, so settings is the right home — but if a tenant ever needs per-dossier-type
régie accounts, `posting_rule` is the pattern to extend rather than a second settings blob.

### 1.5 Tests

`tests/unit/` — no DB, following `extra-charge-five-families-g16.test.js`:

- `regie.rules.js` pure: `openBalance` with partial receipts; `recomputeState` at each
  boundary (0, partial, exact, over-retirement must throw); `isAged` unchanged.
- Retirement postings balance (Σ Dr = Σ Cr) for all three `kind`s.
- `recomputeState` never downgrades out of `QUERIED`.
- The §1.3 seam: justify → advance `JUSTIFIED`, `open === 0`.
- A receipt with no `proof_vault_id` is refused when `require_proof_for_receipt` is true.

---

## 2. Landing B — régie UI (the "enrich the flow" half)

Current surface: `RegiePage` lists advances and `RegieForm` issues one
(`client/src/features/costing/pages.tsx:863,961`). `costing-api.ts` exports exactly
`listRegie` and `issueRegie`. **There is no way to retire, return cash, query or write off
from the UI** — consistent with the backend, and equally incomplete.

Build a **régie detail view**, because an advance is a running balance with a history, and a
row in a list cannot show that:

- **Balance header** — issued / justified / returned / **open**, open being the number that
  matters, with the state pill and days-to-window (or days overdue) beside it. Derived from
  the same `openBalance` the backend uses, never recomputed in the client with its own
  arithmetic.
- **Retirement ledger** — the `regie_retirement` rows in date order, each with kind,
  dossier, amount, proof link and its journal entry. This is the audit trail KB §6.8 implies
  and nothing currently renders.
- **Actions gated by state, from the API not the client** — Retire (receipt), Return cash,
  Raise query, Write off, Un-age. Which are available follows the `NEXT` map in
  `regie.rules.js`; the client must not carry a second copy of the state machine.
- **Aging watchlist** on the list page — advances inside N days of their window and those
  past it. The window is per-advance (`policy_window_days` is a column, defaulted from
  settings at issue), so this must read the row, not a global constant.

Per the standing UI rules (`doc/FRONTEND_GUIDE.md`): desktop layout at `lg`/`xl`/`2xl` only;
dense; `PageContainer width="wide"`; the balance header and retirement ledger side by side at
`xl` rather than stacked. The `useIsDesktop` hook and `Dialog size="wide"` added in `810da6f`
are available for the detail-in-modal-vs-page decision.

---

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

### 3.2 Cash request — two missing states

Legacy has `VALIDATED` and `PARTIALLY_DISBURSED`; the new CHECK (`0342:74`) has neither.

- **`PARTIALLY_DISBURSED`** — the schema already supports the situation
  (`cash_request_payment` is one-to-many), so a half-paid request currently reads as
  `APPROVED`. Adding the state is a CHECK change plus a `NEXT` entry.
- **`VALIDATED`** — costing kept the two-step validate-then-approve; its sibling collapsed
  it. **This one needs a decision before code**, and it should be an explicit product call:
  either restore the step for consistency with costing, or record why cash requests are
  deliberately one-step. Do not add it just because legacy had it.

Both are CHECK-constraint changes, so they need a migration (`10718`) and the existing
`check-migration-*` gates apply.

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
comparison is analysis, not code. `cost_entry` also already carries `source_ref` with a
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

## 6. Open questions

1. **§1.3 remainder** — require `CASH_RETURN` before `JUSTIFIED` (recommended), or allow a
   partially-justified close?
2. **§3.2 `VALIDATED`** — restore the two-step for consistency with costing, or record the
   one-step as deliberate?
3. **Un-age (§1.2)** — confirm reversing an aging reclassification is wanted. It is the right
   accounting answer, but it is not in KB §6.8 explicitly.
4. **Write-off account** — KB §6.8 step 5 says "write off to 658 **or** recover from the
   holder". Recovery is `4211`, i.e. the aging posting. Confirm write-off and recover are two
   distinct user actions rather than one.

Unless answered, these take the recommended option and it is recorded in the commit, matching
how the pricing set handled its §9.

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
