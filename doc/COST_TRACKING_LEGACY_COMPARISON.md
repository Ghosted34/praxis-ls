# Cost tracking — legacy views vs `reconcileDossier`

Landing D of `doc/COSTING_SET_IMPLEMENTATION_PLAN.md`. Deliberately last: it is the
only one of the four landings with **no known correctness defect**, so the deliverable is
analysis, not code.

The plan asked for two things: extract the three legacy view definitions and record them
next to `reconcileDossier`, then reconcile field by field and only then decide whether
anything is genuinely missing. This does both, and the answer at the bottom is **one real
gap, one deliberate difference, and one thing legacy did that should not be copied**.

---

## 0. A negative finding first: the view DDL is not in the reference tree

The plan says "extract the three view definitions from the legacy SQL". They are not there.

```
$ grep -rln "view_cost_tracking_master\|view_cost_tracking_kpis\|view_cost_item_details" \
    doc/reference/legacy_codebase/
doc/reference/legacy_codebase/administration/api/cost-tracking/cost-tracking-api.php
```

One file, and it is the **consumer**. `doc/reference/legacy_codebase/` contains PHP and
front-end assets; no `.sql` dump of the schema was ever committed, so the `CREATE VIEW`
bodies do not exist in anything we hold. Evidencing that is more useful than guessing at
them — a reconstructed view body would be a fabrication with a table in front of it.

**What can be recovered, exactly and without inference,** is each view's _projected
columns_, because the PHP names them in `SELECT` lists and array keys. That is sufficient
for a field-by-field comparison, which is what the plan actually needs. Everything below is
sourced to a line in `cost-tracking-api.php`.

---

## 1. `view_cost_tracking_master` — one row per operations file

Columns, from the CSV export (`:394-405`, which names them explicitly) plus
`getFileDetails` (`:212`, `SELECT *`):

| Legacy column         | Meaning                                         | New equivalent                                  | Status                          |
| --------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| `file_ref_no`         | Operations file reference                       | `dossier.ref` (`0310:22`, `UNIQUE NOT NULL`)    | ✅ present                      |
| `client_name`         | Client display name                             | `dossier.client_id` → `client_master`           | ✅ present (joined, not flat)   |
| `bl_number`           | Bill of lading                                  | `dossier.bl_mawb` (`0310:28`)                   | ✅ present                      |
| `arrival_date`        | Vessel arrival                                  | `dossier.ata` (`0310:34`), with `eta` beside it | ✅ better — legacy has one date |
| `destination`         | Where it is going                               | `dossier.pod` (`0310:31`), with `pol` beside it | ✅ better — legacy has one end  |
| `service_type`        | Service performed                               | `dossier.service_type_id` → `service_type`      | ✅ present (FK, not free text)  |
| `total_cost`          | Σ actual cost across items                      | `repo.actualTotal` → `Σ cost_entry.amount`      | ✅ present                      |
| `total_advance`       | Σ advances received against the file            | **see §4 — the one real gap**                   | ⚠️ different model              |
| `total_balance`       | `total_cost - total_advance`                    | derivable once the above is settled             | ⚠️ follows from it              |
| `calculated_status`   | NOT STARTED / IN PROGRESS / COMPLETED / ON HOLD | **see §5 — do not copy**                        | ⛔ deliberately absent          |
| `coverage_percentage` | `advance / cost × 100`                          | see §4                                          | ⚠️ follows from it              |

## 2. `view_cost_item_details` — one row per cost line

From the explicit `SELECT` at `:228-236`:

| Legacy column      | New equivalent                                            | Status                             |
| ------------------ | --------------------------------------------------------- | ---------------------------------- |
| `item_name`        | `cost_entry.dictionary_item_id` → `dictionary_item`       | ✅ better — a FK, not a text label |
| `actual_cost`      | `cost_entry.amount` (`0320:38`)                           | ✅ present                         |
| `advance_received` | none on `cost_entry`                                      | ⚠️ §4                              |
| `notes`            | none on `cost_entry`; `category` is the nearest column    | ⚠️ minor, §6                       |
| `updated_at`       | `cost_entry.created_at` only — the row is **append-only** | ✅ by design, §6                   |

## 3. `view_cost_tracking_kpis` — one row, whole-table aggregate

From the zero-fill fallback at `:370-378`, which enumerates every key the view returns:

| Legacy KPI                  | New equivalent                                 | Status                     |
| --------------------------- | ---------------------------------------------- | -------------------------- |
| `total_files_tracked`       | `COUNT(DISTINCT dossier_id)` over `cost_entry` | ✅ trivially derivable     |
| `files_auto_status`         | count not manually held — §5                   | ⛔ tied to `manual_status` |
| `files_on_hold`             | count of `ON_HOLD` — §5                        | ⛔ tied to `manual_status` |
| `total_costs_incurred`      | `Σ cost_entry.amount`                          | ✅ present                 |
| `total_advances_received`   | §4                                             | ⚠️                         |
| `total_balance_outstanding` | follows from §4                                | ⚠️                         |
| `avg_cost_per_item`         | `AVG(cost_entry.amount)`                       | ✅ trivially derivable     |
| `avg_advance_per_item`      | §4                                             | ⚠️                         |
| `overall_coverage_pct`      | §4                                             | ⚠️                         |

**Note what the new system has that no legacy KPI does: `variance` against an approved
budget.** `reconcileDossier` returns `{ budget, actual, variance, variance_percent,
over_budget }` (`costing.rules.js:33`), where `budget` is `Σ qty × unit_cost` over lines of
an `APPROVED_LOCKED` costing (`cost_tracking.repo.js:21`). The legacy KPI surface has no
budget column at all — it can say what was spent and what was collected, never whether the
spend was _authorised_. Reconciliation against the approved costing is the point of MOD-47,
and it is the thing the three views could not express.

---

## 4. THE ONE REAL GAP — advances are per-file, not per-cost-item

Legacy carries `advance_received` **on every cost line** and totals it per file.
`cost_entry` has no such column:

```
cost_entry_id, dossier_id, dictionary_item_id, category, amount,
entry_id, proof_vault_id, created_at          (0320:33)
source_ref                                    (0463:11)
```

**But the new system does model advances — better, and elsewhere.** `advance`
(`0230_treasury_invoicing.sql:38`) is `advance_id, client_id, dossier_id, amount,
received_on, applied_amount, entry_id, created_at`: a real row, per dossier, carrying its
own ledger entry and the amount already applied. Money received from a client is a
**liability** (Dr treasury / Cr 4191), which `proforma.service` posts and
`final_invoice.service:143` later draws down — an accounting fact the legacy column was
never connected to.

So this is not "legacy has a feature we lack". It is: **the two systems attach the same
figure at different grains**, and the new grain is the correct one. A client does not
advance money "against Demurrage"; they advance it against the file, and it is applied to
whatever the file ends up owing. Splitting one payment across fifteen cost lines is a
presentation choice masquerading as data.

**What is genuinely missing is the read.** Nothing joins `advance` to the cost-tracking
surface, so `reconcileDossier` cannot answer "how much has this client already paid toward
this dossier's costs" — which is the question `total_advance`, `total_balance` and
`coverage_percentage` all exist to answer.

**Recommended, if this is wanted:** extend `reconcileDossier` with
`Σ advance.amount` and `Σ advance.applied_amount` for the dossier, and derive
`balance` / `coverage_percent` from them. It is a repo query and three derived fields — no
migration, no new column, no change to how advances are recorded. **Not done here**,
because Landing D was scoped as analysis and this is a behaviour change to a service that
currently has no defect; it should be its own small landing with its own tests.

---

## 5. DO NOT COPY — `calculated_status` and `manual_status`

Legacy derives a per-file status in PHP (`calculateStatus`, `:470-487`):

```php
if ($manualStatus === 'ON HOLD') return 'ON HOLD';
$balance = array_sum($costs) - array_sum($advances);
if ($totalCost == 0)   return 'NOT STARTED';
elseif ($balance <= 0) return 'COMPLETED';
else                   return 'IN PROGRESS';
```

Three reasons this should not be ported:

1. **It is computed in two places that disagree.** The same status is also a column in
   `view_cost_tracking_master` (`calculated_status`, exported at `:404`) _and_ recomputed in
   PHP for the tracker grid (`:190-194`). Two implementations of one rule, one in SQL and
   one in PHP, is the drift Landing B's client work was written to avoid.

2. **`COMPLETED` means "the client has paid us", not "the work is done".** `balance <= 0`
   fires when advances cover costs. A dossier with no costs recorded yet also has
   `balance <= 0`, and is only saved from reading COMPLETED by the `totalCost == 0` branch
   above it — the ordering is load-bearing and undocumented.

3. **The new system already has a dossier lifecycle.** `dossier.status` is
   `OPEN | IN_PROGRESS | COMPLETED | CANCELLED` (`0310:26`), driven by operations. A second,
   money-derived "status" on the same file, with three of the same four words and a
   different meaning, would be actively misleading — someone will read COMPLETED on a
   dossier that operations still has open.

If "the client has covered this file" is worth surfacing, it is a **coverage percentage**
(§4), not a status. It is a number, it says what it means, and it cannot be confused with
the operational lifecycle.

---

## 6. Two small, deliberate differences

- **`notes` per cost line.** `cost_entry` has `category` (free text) and no notes column.
  Nothing is blocked by this; if per-line commentary is wanted, `category` is the wrong
  place for it and a `memo text` column would be a one-line additive migration. Recorded,
  not actioned.

- **`updated_at` per cost line.** `cost_entry` has `created_at` only, because it is
  **append-only**: a cost entry carries `entry_id`, a posted journal entry. Editing the row
  would silently desynchronise it from the ledger, and the correction path is a reversing
  entry, not an UPDATE. The legacy view's `updated_at` reflects a table that could be edited
  in place; that is not a capability worth acquiring. This is a difference in favour of the
  new design and should stay.

- **`cost_entry.source_ref`** (`0463`) has a partial unique index for idempotent analytical
  attribution — so the double-attribution problem that usually bites this module is already
  handled. The legacy has no equivalent.

---

## 7. Conclusion

| Question                                        | Answer                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Are the three view definitions recoverable?     | **No** — only the consumer PHP survives. Projected columns recovered instead. |
| Is `reconcileDossier` missing anything real?    | **One thing**: advances are not joined to the cost-tracking read (§4).        |
| Does it need a migration?                       | **No.** `advance` already has the data at the right grain.                    |
| Anything legacy has that we should NOT build?   | **Yes** — `calculated_status` / `manual_status` (§5).                         |
| Anything we have that legacy could not express? | **Yes** — variance against an approved budget, which is the point of MOD-47.  |

**No code changed in this landing.** The single actionable item (§4) is written up with its
recommended shape so it can be picked up as a scoped change with its own tests, rather than
folded into an analysis commit.
