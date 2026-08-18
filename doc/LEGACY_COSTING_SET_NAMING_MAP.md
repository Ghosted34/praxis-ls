# Legacy → Praxis LS naming map: the costing set

**Scope.** The four modules under `src/modules/costing/`: `costing`, `cost_tracking`,
`cash_request`, `regie`. Same exercise as the pricing set — find what each is called in
`doc/reference/legacy_codebase/`, so the port has a source of truth instead of a guess.

**Method.** Names were matched by following the SQL. A view's inline queries and an API's
`INSERT`/`FROM` clauses name the legacy tables outright; those were compared against the
`CREATE TABLE` statements in `migrations/tenant/`. Nothing here is inferred from a filename
alone. Every column named below was read from the migration SQL or from the legacy source,
not assumed.

**Date.** 2026-08-18. Legacy tree is read-only reference (`doc/reference/README.md`).

---

## 1. The map, in one table

| New module (`src/modules/costing/`) | MOD    | Legacy screen (`administration/view/<role>/`) | Legacy API (`administration/api/`)                             | Legacy tables                                                        | New tables                                                  |
| ----------------------------------- | ------ | --------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `costing`                           | MOD-46 | `costing-module.php` (~118 KB)                | `costing/` (12 PHP files)                                      | `costing_master`, `costing_line`                                     | `costing`, `costing_line`                                   |
| `cost_tracking`                     | MOD-47 | `cost-tracking.php` (~40 KB)                  | `cost-tracking/cost-tracking-api.php` (15 KB, single endpoint) | `cost_tracking_ledger`, `cost_entries`, + 3 DB **views**             | `cost_entry`                                                |
| `cash_request`                      | MOD-49 | `cash-request.php` (~133 KB)                  | **none** — SQL is inline in the view                           | `cash_request_master`, `cash_request_lines`, `cash_request_payments` | `cash_request`, `cash_request_line`, `cash_request_payment` |
| `regie`                             | MOD-49 | **none — no legacy source exists**            | **none**                                                       | —                                                                    | `regie_advance`                                             |

Three of the four are ports. **`regie` is not.**

---

## 2. `regie` has no legacy ancestor — it is new OHADA work

This is the headline finding, and it is a negative result that took the most checking:

- `grep -ril "regie\|régie"` across the entire legacy tree → **zero hits**.
- `grep -ril "avance"` restricted to `*.php`/`*.js`/`*.html` → three hits, all unrelated
  (`final-invoice/printfi.php` and two public `portfolio-case.php` marketing pages).
- `grep -rn "581\|imprest"` across all legacy source, excluding `uploads/` → **zero hits**.

The concept comes from `doc/OHADA_KB.md` §6.8 ("Operational cash advances (régie d'avance)
and the justification workflow — MOD-49"), which specifies the account (581), the state
machine (`ISSUED → PARTIALLY_JUSTIFIED → JUSTIFIED`, plus `AGED_UNJUSTIFIED` and `QUERIED`)
and the postings. `regie.service.js` implements exactly that: issue posts `Dr 581 / Cr 521`,
aging reclassifies `Dr 4211 / Cr 581`.

**Consequence for the port: there is nothing to port.** `regie` needs no legacy behaviour
audit, no field reconciliation and no parity tests. It should be reviewed against the KB,
not against PHP. Any plan that budgets `regie` as a fourth port item is budgeting work that
does not exist.

**Why it shares MOD-49 with `cash_request`** — they are two halves of one workflow, wired
by a real FK. `migrations/tenant/0342_finance_gaps.sql:65` heads the block
"MOD-49 Cash request / disbursal document (régie is the ledger side)" and gives
`cash_request` a `regie_advance_id uuid REFERENCES regie_advance(regie_advance_id)`.
The legacy system had the request half and no ledger half; the ledger half is the new work.

---

## 3. Column-level correspondence

### 3.1 `costing_master` → `costing`

Legacy `INSERT` (`api/costing/save.php`) and the new DDL (`0320_costing_procurement.sql:6`):

| Legacy column                                       | New column             | Note                                         |
| --------------------------------------------------- | ---------------------- | -------------------------------------------- |
| `costing_id`                                        | `costing_id`           | legacy int/text → uuid                       |
| `costing_ref`                                       | `doc_number`           | renamed; same role                           |
| `operations_file_reference`                         | `dossier_id`           | text ref → uuid FK to `dossier`              |
| `client_id`, `client_name_cached`, `client_bill_to` | —                      | **dropped**; reached through `dossier`       |
| `service_type`, `service_territory`                 | —                      | **dropped**; on the dossier                  |
| `costing_date`                                      | —                      | **dropped**; `created_at` only               |
| `currency`                                          | `currency`             | `char(3)`, default `'XAF'`                   |
| `exchange_rate_to_xaf`                              | `exchange_rate_to_xaf` | name survived verbatim                       |
| `total_ht`, `total_vat`, `total_ttc`                | —                      | **not stored**; derived from lines           |
| `status`                                            | `status`               | see §4.1                                     |
| `created_by_user_id`                                | —                      | **dropped** from the table                   |
| `validator_employee_id`                             | `validator_id`         | FK → `app_user`                              |
| `validator_assigned_at`                             | —                      | **dropped**                                  |
| —                                                   | `margin_percent`       | new                                          |
| —                                                   | `approver_id`          | new — legacy had no separate approver column |

### 3.2 `costing_line` → `costing_line`

| Legacy                               | New                     | Note                                                                      |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| `line_no`                            | —                       | dropped (ordering not persisted)                                          |
| `item_code`                          | `dictionary_item_id`    | free text → FK `dictionary_item`                                          |
| `item_description`                   | `label`                 |                                                                           |
| `qty`, `unit_cost`                   | `qty`, `unit_cost`      | verbatim                                                                  |
| `vat_applicable`, `vat_rate`         | `tax_code_id`           | two columns → FK `tax_code`                                               |
| `total_ht`, `total_vat`, `total_ttc` | —                       | derived, not stored                                                       |
| —                                    | `is_debours`            | new — margin exclusion (KB §6.7). **Renamed `is_disbursement` by `0640`** |
| —                                    | `container_type_ref_id` | added by `0663`                                                           |

### 3.3 `cash_request_master` → `cash_request`

Legacy `INSERT` has 20 columns; the new table has 11. The disbursement-detail block is the
difference:

| Legacy                                                                                     | New                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `pr_id`                                                                                    | `cash_request_id`                                                           |
| `category`                                                                                 | —                                                                           |
| `disburse_method` (`CASH`/`BANK`/`CHEQUE`/`MOMO`)                                          | — → normalised into `cash_request_payment.treasury_account_id`              |
| `bank_name`, `account_number`, `account_name`, `momo_number`, `momo_name`, `cheque_number` | — → same normalisation (6 columns collapse to one FK)                       |
| `ops_file_ref`                                                                             | `dossier_id`                                                                |
| `client_id`, `sea_bl`                                                                      | — (via dossier)                                                             |
| `cost_center`, `overhead_justification`                                                    | —                                                                           |
| `beneficiary`, `remarks`                                                                   | —                                                                           |
| `amount_total`                                                                             | `amount`                                                                    |
| `status`                                                                                   | `status` — see §4.2                                                         |
| `created_by`                                                                               | `requested_by`                                                              |
| `created_at`                                                                               | `created_at`                                                                |
| —                                                                                          | `costing_id`, `regie_advance_id`, `approver_id`, `doc_number`, `updated_at` |

`cash_request_lines` → `cash_request_line`: `line_code`/`line_desc` → `dictionary_item_id`/
`label`; `qty`+`unit_cost`+`vat_rate`+`line_total` → `budget_amount`; new `spent_amount`,
`is_debours` (**renamed `is_disbursement` by `0640`**, same as `costing_line`),
`proof_vault_id`. Legacy `is_imported` and `justification_required` have no new equivalent.

`cash_request_payments` → `cash_request_payment`: `paid_amount`→`amount`, `paid_at`→`paid_on`,
`paid_by`/`note` dropped, new `treasury_account_id` + `entry_id` (the ledger link legacy lacked).

### 3.4 `cost_tracking_ledger` → `cost_entry`

The one structural inversion. Legacy read from three **database views** —
`view_cost_tracking_master`, `view_cost_tracking_kpis`, `view_cost_item_details` — plus
tables `cost_tracking_ledger` and `cost_entries`. The new module has a single table
(`cost_entry`, `0320:33`) and computes the aggregates in `cost_tracking.service.js`
(`reconcileDossier`) instead of in SQL.

`cost_entry` columns (read from the migration): `cost_entry_id`, `dossier_id`,
`dictionary_item_id`, `category`, `amount`, `entry_id`, `proof_vault_id`, `created_at`.
`0463_cost_entry_source_ref.sql` adds a source ref.

**Porting implication:** the three legacy views are the specification for what the KPI
surface must produce. They cannot be diffed against a new view because none exists — the
comparison has to be legacy-view-SQL against `reconcileDossier`.

---

## 4. Two behavioural gaps found while mapping

Both are places where the legacy system does something the new one currently does not.
Neither is a naming question, but both were found by this exercise and both affect the port.

### 4.1 Costing: the unlock workflow is absent

`api/costing/transition.php` defines seven actions with role lists:

```
SUBMIT → ADMIN, SALES, OPERATIONS, MANAGEMENT      VALIDATE → ADMIN, MANAGEMENT, FINANCE, LEAD
APPROVE → ADMIN, MANAGEMENT                        REJECT   → ADMIN, FINANCE, MANAGEMENT, LEAD
REQUEST_UNLOCK → ADMIN, SALES, OPERATIONS, MANAGEMENT
UNLOCK → ADMIN, MANAGEMENT                         DENY_UNLOCK → ADMIN, MANAGEMENT
```

The new module implements the first four. `TRANSITION_ACTION` in `costing.routes.js` is
`{SUBMIT_VALIDATION, SUBMIT_APPROVAL, APPROVE, REJECT}` — there is no unlock path, and
`grep -rln -i unlock src/modules/` matches only `app_user.service.js` (account lockout,
unrelated).

The status vocabulary itself ported **exactly** — legacy `DRAFT`, `SUBMITTED_FOR_VALIDATION`,
`SUBMITTED_FOR_APPROVAL`, `APPROVED_LOCKED`, `REJECTED` are the same five values in the
`CHECK` constraint at `0320:13`. So `APPROVED_LOCKED` is a terminal state in the new system:
there is a lock, and no documented way out of it. Legacy had one, gated to ADMIN/MANAGEMENT.

Worth deciding deliberately rather than by omission — an approved costing that turns out to
be wrong currently has no route back.

### 4.2 Cash request: two legacy states have no new equivalent

Legacy `cash-request.php` queries `status` against `SUBMITTED`, `VALIDATED`,
`APPROVED_LOCKED`, `PARTIALLY_DISBURSED`, `DISBURSED`, `REJECTED`, `DRAFT`.

New `CHECK` (`0342:73`) and `cash_request.rules.js` allow
`DRAFT → SUBMITTED → APPROVED → DISBURSED → JUSTIFIED`, plus `REJECTED`.

- **`VALIDATED`** — legacy had the same two-step validate-then-approve that costing has
  (and that costing kept in the new system). Cash request collapsed it to a single
  `APPROVED`. Deliberate simplification or oversight? Costing keeping both steps while its
  sibling dropped them is at least inconsistent.
- **`PARTIALLY_DISBURSED`** — legacy tracks it because `cash_request_payments` is a
  one-to-many: a request can be paid in instalments. The new schema kept the one-to-many
  (`cash_request_payment`), so the situation the state describes is still representable —
  but there is no state for it. A half-paid request currently reads as `APPROVED`.

`JUSTIFIED` is new and comes from the régie work (KB §6.8), not from legacy.

---

## 5. Copies of each legacy screen

Unlike `extra-charges-simulator.php` in the pricing set (five byte-identical copies), these
screens **diverge per role** — the copies are not interchangeable and the largest is not
automatically the newest.

Counts are of view copies only (excluding the API files and `uploads/`):

| Screen               | View copies | Distinct hashes | Largest                                     |
| -------------------- | ----------- | --------------- | ------------------------------------------- |
| `costing-module.php` | 10          | 9               | `view/admin/` 118 063 B                     |
| `cost-tracking.php`  | 10          | 9               | `view/admin/` 40 041 B                      |
| `cash-request.php`   | 16          | 14              | `view/finance/` 132 914 B (admin 132 648 B) |

Where copies collapse: `finance/archive` and `management/archive` share `costing-module.php`
(`17221be9`) and `cost-tracking.php` (`68cf5ac9`); and `archive/managemen/`'s
`cash-request.php`, `cash-request copy.php` and `cash-request copy 2.php` are all three the
same bytes (`48a315bd`) — so the two "copy" files carry nothing the original does not.

`view/admin/` is the largest for two of the three and within 0.2 % of the largest for the
third, so it is the reasonable primary source — but for `cash-request.php` the finance copy
is the biggest and a diff against the admin copy is required before either is treated as
canonical. `public_html/smart-logistics/...` copies are markedly smaller (67 KB vs 133 KB)
and look like an older snapshot.

`api/financial-dictionary/cash-request.php` is **0 bytes** — an empty stub, not an API.

---

## 6. What this means for the port

1. **Drop `regie` from the port backlog.** Review it against `OHADA_KB.md` §6.8 instead.
   It is new work that is already done, not a port that is pending.
2. **`costing` is the cleanest port** — status vocabulary is identical, table shape is
   nearly one-to-one. The gap is the unlock workflow (§4.1).
3. **`cash_request` is the largest and least faithful.** 20 legacy columns → 11, with six
   payment-detail columns correctly normalised into `cash_request_payment`, but two states
   dropped (§4.2). The legacy screen is also the biggest single file in the set (133 KB) and
   carries its SQL inline with no API layer, so behaviour has to be read out of the view.
4. **`cost_tracking` needs the view SQL extracted first.** Three legacy DB views are the
   de-facto spec; the new code computes the same things in JS. Compare
   `view_cost_tracking_*` against `reconcileDossier` before changing either.

## 7. Verification

Every table and column above was read from source: legacy from the `INSERT`/`FROM` clauses
of the files named, new from `migrations/tenant/0230_treasury_invoicing.sql:22`,
`0320_costing_procurement.sql:6,21,33`, `0342_finance_gaps.sql:65,79,89`,
`0463_cost_entry_source_ref.sql` and `0470_regie_doc_number.sql`. The `is_debours` →
`is_disbursement` rename in `0640` and the `container_type_ref_id` addition in `0663` were
carried over from the pricing-set analysis and re-checked against `costing_line`.

No code changed in this commit. Analysis only.
