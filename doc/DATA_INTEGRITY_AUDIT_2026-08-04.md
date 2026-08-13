# Praxis LS — Data Integrity, Schema & Migrations Audit

**Date:** 2026-08-04
**Phase:** 0 — audit only. **No schema or code change was made.** Nothing here has been executed against any database.
**Scope:** tenant + platform schema design, migration mechanics and history, and the application layer's interaction with the database.
**Method:** the schema was reverse-engineered from the actual migration files (`migrations/platform/*`, `migrations/tenant/*`, `migrations/seeds/*`) and cross-checked against the services that write to it. FK/index/constraint coverage was extracted by parsing the DDL, not sampled. Every finding below cites the file and line it was verified against. Where a prior document (`doc/DB_ARCHITECTURE.md`, `doc/SCHEMA_AUDIT.md`) states a guarantee, that claim was tested against the DDL rather than accepted.

---

## 0. What the data layer actually is

Established from the code, not assumed:

| Aspect                   | Reality                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                   | PostgreSQL. Extensions: `pgcrypto`, `citext`, `vector` (`migrations/tenant/0001_extensions.sql`)                                                                                  |
| ORM                      | **None.** Raw `pg` with parameterised SQL and hand-rolled builders (`src/shared/db/query-helpers.js`)                                                                             |
| Tenancy                  | **Database per tenant** (`tenant_<slug>`), each with two schemas: `live` and `sandbox`. Registry in a separate `platform` database (`src/services/tenant/registry.service.js:95`) |
| Migration tool           | Bespoke. Ledger `public.schema_migration(scope, filename)`, keyed **by filename**, applied in alphabetical order (`src/services/platform/migrator.js:85-108`)                     |
| Tenant schema size       | 183 tables, 351 foreign keys, 72 explicit indexes, across 62 tenant migration files                                                                                               |
| Platform schema size     | 8 migration files, ~12 tables                                                                                                                                                     |
| Down/rollback migrations | **Zero.** No `down` concept exists in the tooling                                                                                                                                 |

The design intent is strong and, in the ledger core, well executed: journal entries and lines are guarded by real database triggers (balance, one-side-per-line, postable-leaf-only, débours rules, period lock, one-reversal-per-entry, immutability of validated entries). That core is the best part of this schema and most of what follows is about everything _around_ it.

---

## 1. Schema design issues

### 1.1 — Monetary and quantity columns are almost entirely unconstrained · **Critical** · needs migration plan

Of ~103 `numeric` money/quantity columns in the tenant schema, exactly **three** carry a `CHECK` constraint: `journal_line.debit`, `journal_line.credit` (`0220_ledger.sql:57-58`) and `employee_earning.amount`.

Everything else accepts negatives, including:

- `invoice.service_ht`, `disbursement_total`, `vat_total`, `total_ttc` (`0230_treasury_invoicing.sql`)
- `payment_receipt.amount`, `payment_allocation.amount` (same file)
- `supplier_invoice.amount_ht / vat_total / wht_total / amount_ttc` (`0342_finance_gaps.sql`)
- `asset.acquisition_cost`, `depreciation_schedule.amount`
- `payroll_run_item.gross`, `net_pay`
- `inventory_item.qty_on_hand`, `stock_movement.qty`, `outbound_line.qty`
- `regie_advance.amount / justified_amount / returned_amount`
- `advance.amount / applied_amount`

`fx_rate` is guarded on `journal_line` only (`0464_ledger_hardening.sql`, `chk_line_fx_rate_positive`); the identical column on `invoice`, `supplier_invoice` and `costing.exchange_rate_to_xaf` is not — a zero or negative rate there is accepted and will silently produce zero-value or sign-flipped conversions.

`asset.useful_life_months integer` has no `> 0` check; the divisor is validated only in Zod (`asset.validator.js:15`).

**Risk:** a negative invoice total, a negative stock quantity, or a zero FX rate written by any path that bypasses the Zod validator (a worker, an orchestration handler, an AI action, a support fix, a future endpoint) is accepted permanently and silently. The ledger triggers will not catch it because these are not ledger tables.

### 1.2 — Balance-sum invariants have no cross-row enforcement · **Critical** · needs migration plan

Several tables carry a total and its consumed portion with nothing tying them together:

| Table                | Columns                                         | Missing invariant                                                    |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `advance`            | `amount`, `applied_amount`                      | `applied_amount <= amount`                                           |
| `regie_advance`      | `amount`, `justified_amount`, `returned_amount` | `justified + returned <= amount`                                     |
| `cash_request_line`  | `budget_amount`, `spent_amount`                 | none enforced                                                        |
| `payment_allocation` | `amount` per (receipt, invoice)                 | `Σ amount <= receipt.amount` **and** `Σ amount <= invoice.total_ttc` |

`payment_allocation` additionally has no `UNIQUE (receipt_id, invoice_id)`, so the same receipt can be allocated to the same invoice more than once.

The over-allocation case is reachable in practice — see finding 5.3.

### 1.3 — Multi-currency ledger lines are stored but never reconciled · **High** · needs migration plan

`journal_line` carries `currency char(3)` and `fx_rate numeric(18,8)` (`0220_ledger.sql:64-65`) but:

- the DB balance trigger sums raw `debit`/`credit` with **no currency grouping and no FX conversion** (`assert_entry_balanced`, `0220_ledger.sql:112-125`);
- the app-layer pre-check does the same (`journal_entry.rules.js:36-61`) — `currency` is not read at all;
- there is **no base-currency column** (`debit_xaf` / `credit_xaf`) on the line.

**Consequence:** an entry with a `USD 1000.00` debit and an `XAF 1000.00` credit passes both layers as "balanced". And because no converted amount is stored, a multi-currency entry cannot be reported in XAF at all — the trial balance would add USD and XAF as if they were the same unit. The `currency` / `fx_rate_daily` tables exist (`0342_finance_gaps.sql`) but the ledger does not consume them.

### 1.4 — `currency` typing is inconsistent across tables · **Medium** · quick, safe fix

Eight `char(3)` currency columns reference `currency(code)`; nine identical columns do not:

- **With FK:** `supplier_invoice`, `debt_engagement`, `quotation`, `margin_simulation`, and others added in `0342`/`0345`/`0350`.
- **Without FK:** `journal_line`, `invoice`, `treasury_account`, `dictionary_item`, `expense_rate`, `tax_jurisdiction`, `costing`, plus two AI tables.

The same logical domain is modelled two ways in the same database. The unconstrained set includes the ledger itself.

### 1.5 — `chart_of_accounts` hierarchy has no cycle guard · **Medium** · quick, safe fix

`chart_of_accounts.parent_code` is a self-FK with no `ON UPDATE`/`ON DELETE` and no cycle prevention (`0200_coa_dictionary.sql:11`). A row can be made its own ancestor, which makes any recursive rollup (statement generation, account tree UI) loop forever or error. `scope.parent_scope_id` and `employee.reports_to` (`0493_employee_reports_to.sql`) have the same shape and the same gap.

### 1.6 — `doc_number` is not unique anywhere · **High** · needs migration plan

No table has a unique constraint or index on `doc_number` — verified across all 62 tenant migrations. `invoice`, `costing`, `cash_request`, `purchase_order`, `purchase_request`, `supplier_invoice`, `delivery_note`, `regie_advance` all carry a nullable `text doc_number` with nothing preventing duplicates.

The allocator itself is sound — `doc_sequence` upsert with `RETURNING` serialises correctly (`numbering.service.js:allocate`) — but nothing stops a duplicate arriving by any other route (a retried post, a manual correction, a data import). For a statutory document series this is the one uniqueness guarantee that must exist in the database.

### 1.7 — The `§23.14` dictionary invariant is one-directional · **Low** · quick, safe fix

`assert_dictionary_has_rule` fires `AFTER INSERT ON dictionary_item` only (`0200_coa_dictionary.sql:80-88`). Deleting the last `posting_rule` for an item leaves the item rule-less, which the documented invariant forbids. No trigger exists on `posting_rule` delete.

### 1.8 — `tax_code` effective windows can overlap · **High** · quick, safe fix (constraint), careful backfill

`tax_code` has `effective_from`/`effective_to` and a `CHECK (effective_to >= effective_from)` (`0210_tax.sql`), but **no exclusion constraint and no unique index** preventing two overlapping rows for the same `(jurisdiction_id, code)`. The migration's own comment concedes it: _"no overlapping windows is enforced in app; this index just makes 'current version' lookups fast."_

The app does not enforce it either. `addCode` (`tax_jurisdiction.service.js:55-72`) calls only `assertRate` and `assertEffectiveWindow`; `assertEffectiveWindow` compares the new row's own two dates and nothing else (`tax_jurisdiction.rules.js:26-31`). There is no query for a conflicting row.

**Consequence:** two overlapping VAT rows resolve silently — `determination.js:119` takes `ORDER BY effective_from DESC LIMIT 1`. The wrong rate is applied to every invoice from that date, with no error and no flag. `expense_rate` has the same shape with the additional gap of no `effective_to >= effective_from` check at all.

### 1.9 — Denormalised balances that are read but never written · **High** · quick, safe fix

`client_master.cached_receivables`, `client_master.cached_overdue` and `supplier_master.cached_payables` (`0300_masterdata.sql`) are declared `NOT NULL DEFAULT 0`. Grepping the entire `src/` tree, **no code ever writes to any of them.** They are permanently zero.

They are read: `creditStatus` computes credit availability as `limit - cached_receivables` (`client_master.rules.js:14-18`), surfaced through `client_master.service.js:46`. Every client therefore reports zero exposure and unlimited available credit regardless of actual outstanding invoices. The credit-limit control is inert.

The correct figure is already computable — `smart_receivables.repo.js:openInvoices` derives it properly from `invoice` minus `payment_allocation`.

---

## 2. Referential integrity gaps

### 2.1 — `ON DELETE CASCADE` on financial and inventory history · **Critical** · needs migration plan

74 foreign keys use `ON DELETE CASCADE`. On configuration and truly-owned child rows this is right. On the following it destroys records that must be preserved:

| Child (cascade-deleted) | Parent              | What is lost                                                                                                                                                                                                                           |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depreciation_schedule` | `asset`             | Posted depreciation rows **carrying `entry_id` references to real journal entries.** Deleting an asset silently erases its depreciation history while the GL entries remain — the asset register and the ledger diverge with no trace. |
| `payment_allocation`    | `payment_receipt`   | The receipt→invoice application record. Invoices silently revert to "unpaid".                                                                                                                                                          |
| `invoice_line`          | `invoice`           | The composition of a posted invoice.                                                                                                                                                                                                   |
| `supplier_invoice_line` | `supplier_invoice`  | Same, AP side.                                                                                                                                                                                                                         |
| `cash_request_payment`  | `cash_request`      | Disbursement records carrying `entry_id`.                                                                                                                                                                                              |
| `debt_repayment`        | `debt_engagement`   | Repayment history carrying `entry_id`.                                                                                                                                                                                                 |
| `stock_movement`        | `inventory_item`    | **The entire movement journal for that item.** The comment at `inventory.repo.js:6` calls it "its append-only movement journal" — it has no append-only trigger and is cascade-deleted.                                                |
| `close_checklist`       | `accounting_period` | Period-close evidence.                                                                                                                                                                                                                 |
| `payroll_run_item`      | `payroll_run`       | Per-employee pay detail.                                                                                                                                                                                                               |

`journal_line → journal_entry ON DELETE CASCADE` (`0220_ledger.sql:52`) is safe **only** because `protect_validated_entry` blocks deletion of a validated entry. Draft entries do cascade, which is correct. This is the pattern the others should follow: block the parent delete rather than cascade the child.

**Realistic path to loss:** the shared CRUD kit's `archive` runs a real `DELETE` when `deleteMode: "hard"` and the table has no active column (`resource.js:135-140`). `asset` has no active column. Any module wired with `deleteMode: "hard"` on a parent in the table above hard-deletes it and takes the financial children with it, with only the `soft_delete.payload_json` snapshot of the **parent row alone** as recovery — the children are not snapshotted.

### 2.2 — 295 of 351 foreign keys have no index on the referencing column · **High** · quick, safe fix (online)

Only 56 FK columns are covered by an index. The correctness consequence, distinct from speed: every `DELETE` or key `UPDATE` on a parent forces a sequential scan of each referencing child to enforce the constraint, while holding locks. On a large tenant this makes parent deletion slow enough to hit `statement_timeout` (`database.js` sets one) — the delete fails, and multi-step delete flows that are not transactional (see §5) abort part-way.

The heaviest concentrations are the columns most likely to be filtered or joined:

- `app_user` is referenced by ~60 columns (`issued_by`, `validated_by`, `approved_by`, `received_by`, `counted_by`, `acted_by`, `moved_by`, …) — almost none indexed.
- `dossier_id` appears on ~25 tables; only `journal_line` (partial) and `document_vault` are indexed.
- `entry_id → journal_entry` appears on 12 tables (`invoice`, `payment_receipt`, `cost_entry`, `fuel_log`, `work_order`, `payroll_run`, `goods_received_note`, `depreciation_schedule`, `cash_request_payment`, `debt_repayment`, `advance`, `regie_advance`) — **none indexed.** "Which document produced this journal entry?" is a full scan of twelve tables.
- `stock_movement.inventory_item_id` — unindexed, and it is the table the movement history is read from (`inventory.repo.js:19`).

### 2.3 — No `ON UPDATE` clause on any foreign key · **Medium** · assess before changing

Zero of 351 FKs declare `ON UPDATE`. For UUID surrogate keys this is harmless. It matters for the **natural text keys**:

- `chart_of_accounts.code` is the primary key and is referenced by `journal_line.account_code`, `treasury_account.coa_code`, `treasury_account.momo_fee_account`, `asset.coa_asset_code`, `asset.coa_depr_code`, `posting_rule.debit_account`, `posting_rule.credit_account`, `tax_code.posts_debit_account`, `tax_code.posts_credit_account`, `payroll_component.coa_code`, `debt_engagement.coa_code`, `supplier_invoice_line.expense_account`.
- `currency.code` similarly.

Default `NO ACTION` means renaming an account code is simply blocked once it has been posted to. That is arguably the _correct_ behaviour for a statutory chart — but it is undocumented, and the COA service exposes edit paths. This should be an explicit decision recorded in the schema, not a default.

### 2.4 — Sandbox actor FKs are structurally unsatisfiable, and the workaround is inconsistently applied · **High** · needs design decision

This is documented at length in `src/shared/db/sandbox-user-mirror.js` and is real: identity is pinned to the `live` schema, business writes go to `sandbox`, and ~60 columns are `REFERENCES app_user(user_id)` in whichever schema is being written to. A valid live user id therefore raises `23503` beside sandbox business data.

Three mitigations exist — a user mirror, and guarded sub-selects in `emit.js:audit()` and `emitEvent()` — but the guard is **not applied consistently.** `inventory.service.js:53` writes `moved_by: actor.user_id` raw. Because that write is not in a transaction (§5.1), the `qty_on_hand` update has **already committed** when the `stock_movement` insert raises `23503` — the balance moves and the movement record does not exist. Other raw-actor writes exist in the same shape.

The mirror itself is best-effort and can silently fail on an email collision (`sandbox-user-mirror.js`, logged as a warning only).

---

## 3. Migration history problems

### 3.1 — Migration application is not atomic with its ledger entry · **High** · fix in tooling, no schema change

`applyTracked` runs the file (`migrator.js:98`) and then, as a **separate statement**, records it (`migrator.js:99-102`).

A single `cli.query(sql)` of a multi-statement file is an implicit transaction, so the DDL itself is atomic. The ledger insert is not part of it. If the process is killed, the connection drops, or the pod is evicted between line 98 and line 102, the schema change is committed and unrecorded. The next run re-applies the file.

This matters because most tenant migrations are **not re-runnable**: 22 files use bare `CREATE TABLE` and 21 files use bare `CREATE TRIGGER` (a second run raises `42P07` / `42710`). The tenant is then wedged mid-upgrade and every subsequent migration for that tenant fails until someone hand-inserts the ledger row.

**Fix:** wrap the file execution and the ledger insert in one explicit `BEGIN`/`COMMIT`. This is a tooling change with no effect on existing data.

### 3.2 — A partial fleet upgrade leaves tenants on different schema versions · **High** · fix in tooling

`migrateAllTenants` iterates tenants, and `migrateTenantDb` applies `live` then `sandbox` sequentially (`provisioning.service.js:36-59`). Any failure stops the loop. There is no ordering guarantee, no resume marker, and no report of which tenants ended where beyond stdout. Tenant 7 of 20 failing leaves tenants 8-20 un-migrated while the application code has already been deployed expecting the new schema.

### 3.3 — Migration files and the live schema have already drifted · **High** · verify against production before fixing

`notification_preference` is defined **twice, with different columns**:

- `0440_settings_gaps.sql:13` — `CREATE TABLE IF NOT EXISTS notification_preference (...)` **without** `created_at`.
- `0472_notification_preference.sql:9` — `CREATE TABLE IF NOT EXISTS notification_preference (...)` **with** `created_at`, plus an index.

Because both use `IF NOT EXISTS` and 0440 sorts first, **0440 always wins**. `created_at` does not exist on any database, on any tenant, despite migration 0472 declaring it. Migration 0472's `CREATE INDEX IF NOT EXISTS` still runs, so the index is present — the file half-applied by design and reported success.

Nothing currently reads `created_at` from this table (`notification.repo.js:49` selects `updated_at`), so there is no live breakage. The finding is that **the migration files are no longer a faithful description of the schema**, and the tooling cannot detect it. Any future code trusting 0472 will fail at runtime.

### 3.4 — Duplicate migration numbers, correctly diagnosed and correctly left alone · **Medium** · prevention only

`tenant/0470` and `tenant/0475` each have two files. `scripts/db/check-migration-numbers.js` documents this accurately, explains why renaming an applied migration is a live-database hazard (the ledger keys on filename, so a rename re-runs a non-idempotent file), grandfathers the two known pairs, and fails CI on any new collision. It is wired into CI (`.github/workflows/ci.yaml:50`).

This is correct handling and should not be "fixed". The residual risk the script itself names is the real one: the next collision where two same-numbered files touch the _same_ object, where apply order becomes an alphabetical accident.

### 3.5 — No migration is reversible · **High** · policy gap

There are zero down/rollback scripts and no `down` concept in the tooling. Recovery from a bad migration today is restore-from-backup for the whole tenant database. For the additive migrations shipped so far this has been survivable. It will not be for anything in this remediation that touches constraints or existing rows — which is why every proposal in §8 carries an explicit rollback statement.

### 3.6 — `EXCEPTION WHEN OTHERS THEN NULL` in data-seeding migrations · **Medium** · partially fixed already

`0467_approvals_retrofit.sql` and `0468_leave_approval_backfill.sql` end their `DO` blocks with `EXCEPTION WHEN OTHERS THEN NULL`. A failure inside is invisible: the migration records success and the tenant is left without the workflow it was supposed to get.

This was diagnosed and corrected for one file — `0492_default_workflows_repair.sql` replaces silent swallowing with `RAISE WARNING` and explains precisely why (its header is the best piece of migration documentation in the repo). The same treatment has not been applied to 0467/0468, and per §3.1 those files cannot be edited in place.

### 3.7 — Data backfills are well built · **positive finding**

`0490_department_scope_refs.sql:63-112` is the pattern to standardise on: it fills only `NULL`s, matches on a normalised key, **leaves ambiguous rows unlinked rather than guessing**, counts what it did, and warns rather than failing the deploy. `0463_cost_entry_source_ref.sql` correctly introduces an idempotency key as a _partial_ unique index so existing NULL rows are unaffected. Both are additive and safe to re-run.

---

## 4. Data validation enforced only in the application

Where the DB does enforce, it enforces well — the ledger triggers in `0220`, `0221` and `0464` are genuine defence-in-depth and the integration test `tests/integration/ledger-hardening.test.js` proves they fire against real Postgres. Outside the ledger, almost nothing is enforced below the API.

| Rule                                                 | Enforced in                                    | Nothing at DB level | Severity     |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------- | ------------ |
| Tax-code windows must not overlap                    | nowhere (see §1.8)                             | ✔                   | **High**     |
| Sums (`applied <= amount`, `Σ allocations <= total`) | nowhere                                        | ✔                   | **Critical** |
| Amounts must be non-negative                         | Zod validators per module                      | ✔                   | **Critical** |
| `qty_on_hand` must not go negative                   | `inventory.service.js:43` (racy, see §5.1)     | ✔                   | **High**     |
| Inventory state transitions                          | `inventory.service.js:11-17`                   | ✔                   | Medium       |
| Invoice / costing / PO status transitions            | each service's guard clauses                   | ✔                   | Medium       |
| Outbound order transitions                           | `outbound.service.js:11-18`                    | ✔                   | Medium       |
| `report_key` must be in the catalogue                | `0440_settings_gaps.sql:24` says so explicitly | ✔                   | Low          |
| Entity-scoped row isolation                          | **nothing** (see §4.1)                         | ✔                   | Medium       |

Status columns are a good example of the split: `CHECK (status IN (...))` constrains the _set_ of values, so the DB knows the vocabulary, but the _transitions_ live only in JS. Any write that does not go through the owning service can move a `POSTED_LOCKED` invoice back to `DRAFT`.

### 4.1 — The RLS layer described in the code does not exist · **Medium** · dead code, remove or implement

`src/config/database.js` carries a full RLS apparatus: an `RLS_READ_ENFORCE` flag, `applySessionContext` setting `app.current_business` / `app.current_user_id`, a `queryWithContext` path that wraps single reads in a transaction so the GUC applies, and a boot-time warning about superuser bypass. Comments at `database.js:191` and `request-context.js:8` attribute the policies to _"migration 000200"_.

**There is no migration 000200, and no `ROW LEVEL SECURITY` or `CREATE POLICY` statement anywhere in `migrations/`.** Verified across all files.

Cross-tenant isolation is not at risk — it is achieved by the database boundary, as `doc/DB_ARCHITECTURE.md:§1` intends, and that boundary is real. What does not exist is the _entity-level_ filtering the GUC implies. `corporate_entity` scoping is enforced only by whatever `WHERE entity_id = $1` each query happens to carry.

The risk is the misleading affordance: turning on `RLS_READ_ENFORCE` today adds a transaction round-trip per read and filters nothing, while reading as though isolation were enabled.

### 4.2 — Legacy references to a schema that does not exist · **Medium** · dead code

32 references across 6 files point at a `shared.*` schema (`shared.audit_log`, `shared.notification_preferences`, `shared.document_numbering`, `shared.business_config`, `shared.push_subscription`, `shared.notifications`, `shared.permissions`). No migration creates a `shared` schema — only `live`, `sandbox` and `platform` exist.

`src/middleware/audit.js` is the worst of these: a complete audit-writing helper documented as writing to an append-only `shared.audit_log`, required by **nothing** (verified). Anyone reading it would reasonably believe an audit path exists that does not. `src/services/notifications.service.js` and `src/services/numbering.service.js` are in the same state; `numbering.service.js` has already been superseded by `services/documents/numbering.service.js`, which its own header acknowledges.

---

## 5. Transaction boundary issues

This is the most systemic category. `withTenantConnection` hands the callback a **raw pooled client with no transaction** — it sets `search_path` and calls the function (`registry.service.js:95-105`). Every service that needs atomicity must issue its own `BEGIN`. Many do; the shared kit does not.

The 78 explicit `BEGIN`s in `src/` are all correctly paired with `COMMIT` and `ROLLBACK` — that part is clean. The problem is the write paths with no `BEGIN` at all.

### 5.1 — Inventory movements are not transactional and not locked · **Critical** · code fix + constraint

`inventory.service.js:38-58` — the stock balance path:

```js
const before = await repo.findById(client, id);          // plain SELECT, no FOR UPDATE
const newQty  = Number(before.qty_on_hand) + delta;      // computed in JS
if (newQty < 0) throw ...                                // app-only guard
const row = await repo.update(client, id, patch);        // writes the ABSOLUTE value
await repo.insertMovement(client, {...});                // separate statement
await emitEvent(...); await audit(...);                  // two more
```

The controller calls it through `req.tenantDb(...)` with no wrapper (`inventory.controller.js:15-28`). **Every statement autocommits independently.** Three distinct failures:

1. **Lost update.** Two concurrent moves both read `qty = 10`; one writes `5`, the other writes `7`. Final quantity is `7` instead of `2`. Silent, no error, and undetectable afterwards because the two movement rows _are_ both written.
2. **The negative-stock guard is racy and has no DB backstop.** Two concurrent `-6` moves against `qty = 10` both pass the check. There is no `CHECK (qty_on_hand >= 0)`.
3. **Balance and journal diverge permanently.** If `insertMovement` fails — and per §2.4 it _will_ raise `23503` in sandbox on `moved_by` — the quantity change is already committed. The item's balance moved with no movement record. Since `qty_on_hand` is an absolute value rather than a derived sum, there is no way to detect or reconstruct it.

Read-modify-write on a stock balance, unlocked and uncommitted-as-a-unit, is the single highest-risk pattern in this codebase for inventory correctness.

### 5.2 — The shared CRUD kit writes business row, event, and audit as three separate commits · **Critical** · code fix

`resource.js:79-84` (`create`), `86-93` (`update`), `111-146` (`archive`). Each performs 3-6 statements — business write, `emitEvent` (which itself may insert into `event_log`, start an approval task via `executor.start`, and fan out `notification` rows), `audit` insert, and in `archive` a `soft_delete` insert plus a real `DELETE` — with **no `BEGIN` anywhere in the chain**, and no controller wraps them (verified: zero `transaction(` calls in any `*.controller.js`).

25 modules build their service on `makeService`; 34 build controllers on `makeController`.

**Consequences, in ascending severity:**

- A business row commits and its `immutable_ledger` entry does not → the audit trail has a hole and no error is raised anywhere.
- `archive` writes the `soft_delete` recovery row, then `DELETE`s. If the `DELETE` fails a foreign key, the `soft_delete` row remains, asserting a deletion that did not happen. The code comment at `resource.js:130-134` reasons carefully about the _ordering_ of these statements while leaving them non-atomic — ordering only matters because atomicity is absent.
- An approval task can be opened by `executor.start` for a record whose own write then fails.

This is also the root cause of the failure mode described at length in `emit.js`: _"the audit row lands in `sandbox.immutable_ledger` carrying a user id that `sandbox.app_user` has never heard of → 23503 … AFTER the business row had already committed — so the record existed but the request 409'd, and a retry then hit a duplicate-key error."_ The guarded sub-select fixes the FK; the reason a mid-sequence failure could strand a committed row is the missing transaction, and that remains.

### 5.3 — Receipt allocation reads unlocked and can over-allocate · **High** · code fix + constraint

`smart_receivables.service.js:44-77` opens a transaction (good), but `repo.openInvoices` (`smart_receivables.repo.js:26-41`) has no `FOR UPDATE`. Two concurrent receipts for the same client both see the same open invoices, both FIFO-allocate against them, and both commit. Combined with the missing `Σ allocations <= total_ttc` constraint (§1.2), an invoice can end up allocated beyond its value — which then makes `outstanding` negative and silently removes the invoice from the ageing and dunning reports (`openInvoices` filters `outstanding > 0`).

### 5.4 — Tax-code supersession splits across two transactions · **High** · code fix

`supersedeCode` (`tax_jurisdiction.service.js:75-88`):

```js
await client.query("BEGIN");
  ... expire the current row (set effective_to = day before) ...
await client.query("COMMIT");            // line 85
return addCode(client, {...});           // line 87 — opens its OWN BEGIN/COMMIT
```

The expiry is committed before the replacement is attempted. `addCode` runs `assertRate` **before** its `BEGIN` (line 58) and throws on a bad rate; it can also fail on insert. Either way the old rate is already expired and the new one does not exist.

**Result:** for that `(jurisdiction, code)` there is no row effective from that date. `pickEffective` throws `NO_EFFECTIVE_CODE` (`tax_jurisdiction.rules.js:43`) and `determination.js:119` returns nothing — **every invoice from that date forward fails to post**, until someone notices and inserts the row by hand. A tax-rate change is exactly the operation performed under time pressure at a Finance Law boundary.

### 5.5 — Asset depreciation posts nothing to the GL and records success · **Critical** · code fix

`asset.service.js:70-82`:

```js
lines: [
  { account: "6813", debit: round(row.amount), credit: 0, ... },   // line 74
  { account: asset.coa_depr_code || "2845", debit: 0, credit: ... } // line 75
],
...
} catch (err) { entryId = null; }   // line 80 — swallows everything
const updated = await repo.markPosted(client, row.depreciation_id, entryId);  // line 82
```

Two independent defects compound:

1. **The lines use `account:`, not `account_code:`.** `buildAndInsert` reads `ln.account_code` (`journal_entry.service.js:74`). It also requires `sourceDocRef` when `validate` is true (default), and `depreciate` passes none — so the call throws `SOURCE_DOC_REQUIRED` before it ever reaches the account. This is the _identical_ bug that was found and fixed in payroll, where the fix is documented in a comment: _"buildAndInsert expects `account_code` (not `account`) and requires a source_doc_ref to validate — both were missing, so this post silently threw and degraded to null (payroll never hit the GL). Fixed."_ (`payroll.service.js:149-151`). The same fix was never applied to `asset`.
2. **The catch swallows every error** and `markPosted` then sets `posted = true` with `entry_id = NULL`.

**Net effect: depreciation never reaches the general ledger, on any asset, ever — and is recorded as posted.** Because `accumulatedPosted` sums `depreciation_schedule WHERE posted = true` (`asset.repo.js:62-68`), the fixed-asset register reports accumulated depreciation and net book value that the trial balance does not contain. `dispose` then computes gain/loss from that same unposted figure (`asset.service.js:93-95`) and **posts nothing at all** — no journal entry is created on disposal despite the module header claiming it "recognises gain/loss".

There are no tests for the asset module (verified: no `asset` or `deprec` test file among 80 test files).

The `catch → entryId = null` pattern is worth calling out on its own: "record without posting" converts a hard ledger rejection — which might be a closed period, an unbalanced entry, or a non-postable account — into a silent divergence between a subledger and the GL. Note also that `journal.post` opens its own transaction, so `markPosted` runs _after_ that transaction has committed; if `markPosted` then fails, the GL carries a dotation the schedule still shows as unposted, and the next run posts it again.

### 5.6 — Tenant provisioning is not transactional · **Medium** · code fix

`provisionTenant` (`provisioning.service.js:74-116`) performs five platform writes — `tenant` upsert, `tenant_database` insert, `subdomain` insert, `status = 'LIVE'` update, audit — on a bare client with no `BEGIN`. A failure part-way leaves a tenant registered without a database row or subdomain, or stuck in `PROVISIONING` with its schema fully built. `wipeSandbox` (`:314-341`) similarly runs `DROP SCHEMA ... CASCADE` → `CREATE SCHEMA` → ledger `DELETE` → re-apply, unwrapped.

---

## 6. Audit trail

### 6.1 — What exists and works

The foundation is genuinely good and should be preserved as-is:

- `immutable_ledger` (`0130_platform_projection.sql:41-58`) — `bigint` identity PK, actor, action, module, `entity_ref`, `before_json`, `after_json`, `ip`, `created_at`, with `trg_ledger_ro` blocking `UPDATE`/`DELETE` per row. Three supporting indexes.
- `event_log` (`0120_events_workflow.sql:47-61`) — append-only, same protection.
- `platform.platform_audit` — same protection on the platform side.
- `soft_delete` (`0130:64-76`) — full payload snapshot for restore, with a maker-checker `CHECK (restored_by IS NULL OR restored_by <> deleted_by)`.
- Validated journal entries cannot be edited or deleted; corrections are a linked reversal, at most one per entry (`ux_one_reversal_per_entry`, `0464`).

### 6.2 — The tamper-evidence chain is declared but not implemented · **High** · quick, safe fix

`immutable_ledger.before_hash` and `after_hash` exist as columns. The only writer — `audit()` at `emit.js` — inserts `before_json` and `after_json` and **never populates either hash column** (verified: the INSERT lists 8 columns, neither hash among them).

`doc/DB_ARCHITECTURE.md:§4.4` describes the ledger as `{actor, role, action, module, entity_ref, before_hash, after_hash, payload_json, ip, created_at}`. Without the hashes there is no chaining and no tamper evidence — the row-level trigger prevents in-place edits, but nothing detects a restore-from-backup with rows removed, and `TRUNCATE` does not fire row triggers at all.

### 6.3 — Financial and inventory mutations are audited inconsistently · **High** · code fix

The kit audits `create`/`update`/`archive` with both `before` and `after` (`resource.js:83, 91, 144` — note `archive` passes `before` only, so the ledger cannot show what state the record ended in). Hand-written domain services are uneven:

- `final_invoice.postCore` audits with a summary object (`doc_number`, totals, advance applied) rather than the row — no `before`, so a posted invoice's prior state is not recoverable from the ledger.
- `smart_receivables.post` audits `{ entry_id, doc_number, plan }` — again no `before`.
- `asset.depreciate` audits the schedule row only.
- `outbound.setLineFlags` audits `before`/`after` correctly — the good example.

Because `audit()` is called per-service rather than by a database trigger, **any write that bypasses a service leaves no trace at all.** There is no `AFTER INSERT OR UPDATE OR DELETE` audit trigger on any financial table. For OHADA purposes the ledger's completeness currently depends on developer discipline in 183 tables' worth of write paths.

### 6.4 — Inventory has no audit trail at all in the accounting sense · **High** · needs migration plan

`stock_movement` is the de facto inventory audit trail. It:

- has **no** `forbid_mutation` trigger (unlike `event_log` and `immutable_ledger`) — rows can be updated or deleted freely;
- is **cascade-deleted** with its parent item (§2.1);
- can be **missing rows** whose balance change committed (§5.1);
- carries no `before`/`after` quantity, only a delta, so a missing row cannot be inferred from its neighbours.

`cycle_count.discrepancy` is a free-form `jsonb` with no schema and no link to the `inventory_item` rows it counted — a stock audit whose result cannot be tied to what it audited.

### 6.5 — Silent overwrite of financial figures · **Medium**

`invoice`, `costing`, `quotation` and `supplier_invoice` totals are updated in place. Correct for `DRAFT`; the immutability guarantee for locked documents rests entirely on service-level status checks (`final_invoice.service.js:88` for example), with **no database trigger** equivalent to `protect_validated_entry`. A direct `UPDATE` on a `POSTED_LOCKED` invoice succeeds.

`content_hash` exists on `invoice`, `payment_receipt`, `delivery_note` and `document_vault` for exactly this purpose (§8.4 "document DNA") but is not verified on read anywhere.

---

## 7. Indexing, from a correctness and design lens

Beyond §2.2's 295 unindexed FKs:

### 7.1 — Missing uniqueness that should exist · **High** · needs careful migration (duplicates may exist)

| Table                                                                                                        | Should be unique                                                                                  | Consequence today                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `invoice`, `costing`, `purchase_order`, `supplier_invoice`, `cash_request`, `delivery_note`, `regie_advance` | `doc_number` (per entity/year)                                                                    | duplicate statutory document numbers          |
| `payment_allocation`                                                                                         | `(receipt_id, invoice_id)`                                                                        | the same receipt applied twice to one invoice |
| `tax_code`                                                                                                   | non-overlapping `(jurisdiction_id, code, effective_from..to)`                                     | ambiguous rate resolution (§1.8)              |
| `expense_rate`                                                                                               | non-overlapping `(dictionary_item_id, shipping_line, variant, effective_from..to)`                | ambiguous cost rate                           |
| `journal`                                                                                                    | `(entity_id, code)` exists — but `entity_id` is nullable, so `NULL`-entity journals can duplicate | duplicate global journals                     |

`journal_entry` correctly has `UNIQUE (journal_id, period_id, entry_no)` (`0220_ledger.sql:50`).

### 7.2 — Missing indexes on columns that gate correctness-critical queries · **Medium** · quick, safe fix (online)

- `invoice(status, type)` — every receivables read filters on both (`smart_receivables.repo.js:34`); currently a full scan of `invoice`.
- `payment_allocation(invoice_id)` — the `GROUP BY` driving `outstanding` in the same query.
- `journal_line(account_code, entry_id)` — trial balance and statement generation aggregate on this; only single-column `ix_line_account` exists.
- `journal_entry(entity_id, period_id, status)` — period close and statement snapshots.
- `stock_movement(inventory_item_id, moved_at DESC)` — the movement history read.
- `depreciation_schedule(asset_id, posted)` — `accumulatedPosted` (`asset.repo.js:63`).
- `accounting_period(entity_id, starts_on, ends_on)` — `getPeriodForDate` runs on **every** ledger post (`journal_entry.repo.js:25-29`).

That last one is worth emphasising: the hottest lookup in the accounting engine — resolving which period a date falls in, on every single journal post — has no supporting index.

### 7.3 — Index coverage is uneven by module · **observation**

`0370_wms_fleet_depth.sql` creates 12 tables and **zero indexes**. `0360_hr_breadth.sql` and `0350_sales_crm.sql` are similar. The finance migrations (`0220`, `0230`, `0342`) index reasonably. The correctness reading: the modules added later were scaffolded for breadth (as `doc/SCHEMA_AUDIT.md` records) and never had their access patterns designed — which is also where the missing constraints cluster.

---

## Severity summary

| #   | Finding                                                         | Severity     | Fix class                   |
| --- | --------------------------------------------------------------- | ------------ | --------------------------- |
| 5.5 | Asset depreciation never posts to GL, recorded as posted        | **Critical** | code, quick                 |
| 5.1 | Inventory balance: no transaction, no lock, no DB floor         | **Critical** | code + constraint           |
| 5.2 | Shared CRUD kit: business/event/audit in separate commits       | **Critical** | code, mechanical            |
| 1.1 | ~100 money/qty columns with no `CHECK`                          | **Critical** | migration, needs data probe |
| 1.2 | No sum invariants (over-allocation, over-justification)         | **Critical** | migration, needs data probe |
| 2.1 | `ON DELETE CASCADE` on financial/inventory history              | **Critical** | migration, careful          |
| 1.3 | Multi-currency lines never reconciled to base                   | **High**     | migration + code            |
| 1.6 | `doc_number` not unique anywhere                                | **High**     | migration, needs dedupe     |
| 1.8 | `tax_code` windows can overlap → wrong VAT silently             | **High**     | migration + code            |
| 1.9 | `cached_receivables` read but never written; credit limit inert | **High**     | code, quick                 |
| 2.2 | 295/351 FKs unindexed                                           | **High**     | migration, online           |
| 2.4 | Sandbox actor-FK guard applied inconsistently                   | **High**     | code                        |
| 3.1 | Migration apply not atomic with ledger entry                    | **High**     | tooling                     |
| 3.2 | Partial fleet upgrade leaves version skew                       | **High**     | tooling                     |
| 3.3 | `notification_preference` drift — file ≠ live schema            | **High**     | verify + tooling            |
| 3.5 | No migration is reversible                                      | **High**     | policy                      |
| 5.3 | Receipt allocation unlocked → over-allocation                   | **High**     | code + constraint           |
| 5.4 | Tax supersession splits transactions → no effective rate        | **High**     | code, quick                 |
| 6.2 | `before_hash`/`after_hash` never populated                      | **High**     | code, quick                 |
| 6.3 | Audit coverage depends on service discipline                    | **High**     | code + triggers             |
| 6.4 | `stock_movement` mutable, cascade-deleted, can be incomplete    | **High**     | migration                   |
| 7.1 | Missing uniqueness on document numbers and allocations          | **High**     | migration, needs dedupe     |
| 1.4 | `currency` typing inconsistent                                  | Medium       | migration                   |
| 1.5 | No cycle guard on self-referencing hierarchies                  | Medium       | migration                   |
| 2.3 | No `ON UPDATE` on natural-key FKs                               | Medium       | decision                    |
| 3.4 | Duplicate migration numbers (handled correctly)                 | Medium       | prevention                  |
| 3.6 | `EXCEPTION WHEN OTHERS THEN NULL` in 0467/0468                  | Medium       | forward-fix                 |
| 4.1 | RLS apparatus references a migration that does not exist        | Medium       | remove or implement         |
| 4.2 | 32 references to a non-existent `shared.*` schema               | Medium       | remove                      |
| 5.6 | Provisioning / sandbox wipe not transactional                   | Medium       | code                        |
| 6.5 | Locked documents protected only in the service layer            | Medium       | migration                   |
| 7.2 | Missing indexes on correctness-critical filters                 | Medium       | migration, online           |
| 1.7 | `§23.14` invariant one-directional                              | Low          | migration                   |

---

## 8. Remediation roadmap — five phases

**Governing constraint:** no proposed change may risk loss or corruption of existing data. Every phase that touches existing rows carries a data probe, a reversible migration, and a rollback. Anything that cannot be made reversible is marked **IRREVERSIBLE** in bold.

**Two tooling changes are prerequisites for everything else and are therefore in Phase 1.**

### Migration conventions to adopt before Phase 1 begins

These apply to every migration proposed below:

1. **Every new migration file is idempotent** — `IF NOT EXISTS` on objects, `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...) $$` on constraints (`0464_ledger_hardening.sql` already demonstrates this), `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`.
2. **Every new migration file has a matching `migrations/tenant/down/<same-name>.sql`.** Down files are never auto-run; they are reviewed, tested on a restored snapshot, and applied by hand. This gives a rollback path without changing the forward tooling's semantics.
3. **Constraints are added `NOT VALID` first, then `VALIDATE CONSTRAINT` in a separate migration.** `ADD CONSTRAINT ... NOT VALID` takes a brief `SHARE UPDATE EXCLUSIVE` lock and does not scan the table; `VALIDATE` scans without blocking writes. This is what makes constraint addition safe on a live tenant.
4. **Indexes are created `CONCURRENTLY`.** This requires the statement to run outside a transaction block, which the current runner cannot do (§3.1's fix wraps files in a transaction) — so index migrations get an explicit opt-out marker the runner honours. Detail in Phase 2.
5. **Every migration that reads or writes existing rows is preceded by a read-only probe script** whose output is reviewed before the migration is scheduled.
6. **Nothing in this roadmap drops a column, drops a table, or changes a column type.** Not one phase requires it.

---

### Phase 1 — Stop the active bleeding

**Scope:** the defects that are corrupting or losing data _right now_, plus the tooling needed to deploy anything safely. Almost entirely application code; two small, fully-reversible migrations.

**Dependencies:** none. Start here.

**Deliverables**

_Tooling (blocking prerequisite)_

1. `migrator.applyTracked` wraps file execution and the ledger insert in one `BEGIN`/`COMMIT` (`migrator.js:96-103`). Add a `-- praxis:no-transaction` marker for files needing `CREATE INDEX CONCURRENTLY`, which the runner detects and runs unwrapped, recording the ledger row separately with a documented caveat.
2. `migrateAllTenants` records per-tenant start/finish in `platform.provisioning_job` (the table already exists, `0030_platform_ops.sql:20`), continues past a failed tenant, and returns a structured pass/fail report. Add `scripts/db/schema-drift-check.js`: connect to each tenant, dump `information_schema` columns/constraints/indexes, diff against a schema built from the migration files in a scratch database, and report divergence. Run it in CI and on demand.
3. Adopt the down-migration convention (above) and write down-files for the two Phase 1 migrations.

_Correctness fixes — code only, no schema change_

4. **`asset.depreciate`** (`asset.service.js:70-82`): `account:` → `account_code:`; pass a `sourceDocRef`; replace `catch { entryId = null }` with a real failure that leaves the schedule row unposted. Add `asset.dispose` GL posting (Dr accumulated depreciation, Dr/Cr gain-or-loss, Cr asset). Wrap `depreciate` in one transaction spanning the ledger post and `markPosted` — currently `journal.post` commits before `markPosted` runs, which is the double-post window. **Add unit + integration tests; the module currently has none.**
   _Data remediation:_ a read-only probe reports every `depreciation_schedule` row with `posted = true AND entry_id IS NULL` (expected: all of them). These rows are wrong but not corrupt — the amounts are right, the GL entries are simply absent. Remediation is a **separate, reviewed, opt-in backfill** in Phase 3 that posts the missing entries into open periods, or a documented prior-period adjustment for closed ones. Phase 1 stops new occurrences and quantifies the existing gap; it does not touch the rows.
5. **`inventory.move`** (`inventory.service.js:38-58`): wrap in a transaction; replace the read-modify-write with `UPDATE inventory_item SET qty_on_hand = qty_on_hand + $delta WHERE inventory_item_id = $1 RETURNING qty_on_hand` (atomic, no lost update); route `moved_by` through `resolveActorId` (`emit.js`). Same treatment for `setState`.
6. **Shared CRUD kit** (`resource.js:79-146`): wrap `create`, `update` and `archive` each in a single transaction. This is the highest-leverage change in the roadmap — one file, 25 modules fixed. Verify no caller already holds an open transaction (audit shows none do: zero `transaction(` calls in controllers).
7. **`supersedeCode`** (`tax_jurisdiction.service.js:75-88`): one transaction spanning expire-old and insert-new. Extract `addCore` from `addCode` the way `final_invoice` separates `createDraftCore` from `createDraft` — the pattern is already established in this codebase.
   _Data remediation:_ probe for `(jurisdiction_id, code)` groups with no row effective today. If any exist, a tax code is currently unresolvable and invoices are failing — treat as an incident, not a migration.
8. **`smart_receivables.post`**: add `FOR UPDATE` to `openInvoices` when called from the posting path (keep the unlocked read for reporting).
9. **`cached_receivables` / `cached_overdue` / `cached_payables`**: rather than start writing them, change `creditStatus` to take the derived figure from `openInvoices` and pass it in from the service. Leave the columns in place, untouched, marked deprecated in a comment. No data migration, no risk, and the credit limit starts working.
10. **`emit.js audit()`**: populate `before_hash` / `after_hash` as `sha256` of the canonicalised JSON. Additive; existing rows keep NULL hashes and the chain starts from the deploy date, which is honest and verifiable.

_Migrations — both trivially reversible_

11. `05xx_stock_movement_immutable.sql` — `CREATE TRIGGER trg_stock_movement_ro BEFORE UPDATE OR DELETE ON stock_movement ... forbid_mutation()`.
    **Safety:** affects future writes only; touches no existing row. **Rollback:** `DROP TRIGGER`. Fully reversible.
    **Verify first:** probe for any code path that updates or deletes `stock_movement` (audit found none) so the trigger cannot break a working flow.
12. `05xx_negative_stock_floor.sql` — `ALTER TABLE inventory_item ADD CONSTRAINT chk_qty_non_negative CHECK (qty_on_hand >= 0) NOT VALID`.
    **Safety:** `NOT VALID` guards new writes without scanning. **Probe first:** `SELECT count(*) FROM inventory_item WHERE qty_on_hand < 0` on every tenant. If zero, `VALIDATE` in the same phase; if not, the negative rows are investigated and corrected by the business before validation. **Rollback:** `DROP CONSTRAINT`. Fully reversible.

**Exit criteria:** drift check runs green on every tenant; the CRUD kit and the four named services are transactional; asset depreciation posts and is tested; the depreciation gap is quantified per tenant.

---

### Phase 2 — Referential integrity and indexing

**Scope:** stop preventable orphaning and destruction of financial history; index the foreign keys. All online, no maintenance window.

**Dependencies:** Phase 1's `CREATE INDEX CONCURRENTLY` runner support.

**Deliverables**

1. **Index every unindexed FK column** (295, §2.2), in batches by module, `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. Priority order: `entry_id → journal_entry` (12 tables), `dossier_id` (25 tables), `client_id`, `supplier_id`, `employee_id`, then `app_user` actor columns, then the rest.
   **Safety:** `CONCURRENTLY` never blocks reads or writes. A failed build leaves an `INVALID` index that is inert and droppable. **Rollback:** `DROP INDEX CONCURRENTLY`. Fully reversible. Cost is disk and write amplification — quantify total index size against each tenant's current footprint before scheduling, and drop any index that measurement shows is unused after a full quarter.
2. **Correctness-critical composite indexes** (§7.2), same mechanism: `accounting_period(entity_id, starts_on, ends_on)` first — it is on the hot path of every ledger post — then `invoice(status, type)`, `payment_allocation(invoice_id)`, `journal_line(account_code, entry_id)`, `journal_entry(entity_id, period_id, status)`, `stock_movement(inventory_item_id, moved_at DESC)`, `depreciation_schedule(asset_id, posted)`.
3. **Convert destructive cascades to `RESTRICT`** (§2.1) for the nine financial/inventory relationships.
   **This is the most delicate change in the roadmap.** Postgres has no `ALTER CONSTRAINT` for the delete action, so each is `DROP CONSTRAINT` + `ADD CONSTRAINT ... ON DELETE RESTRICT NOT VALID`, then `VALIDATE`. There is a window between the drop and the add during which no FK is enforced — it must be inside a single transaction, which Phase 1's runner change guarantees.
   **Probe first:** for each relationship, count child rows and confirm no current code path relies on the cascade. Specifically: identify every module wired with `deleteMode: "hard"` and confirm none targets a parent in the list.
   **Rollback:** the down-migration restores `ON DELETE CASCADE` verbatim. Fully reversible, and reverting restores exactly the prior behaviour.
   **Behaviour change to socialise:** deleting an asset with a depreciation schedule will start failing with a foreign-key error where it previously succeeded silently. That is the point, but it is a user-visible change and needs a friendly error message and a release note.
4. **Cycle guards** (§1.5) on `chart_of_accounts.parent_code`, `scope.parent_scope_id`, `employee.reports_to` — a `BEFORE INSERT OR UPDATE` trigger walking ancestors with a depth cap.
   **Probe first:** run the cycle detection as a read-only query on every tenant; if a cycle already exists, it must be resolved by the business before the trigger lands. **Rollback:** `DROP TRIGGER`. Fully reversible.
5. **Dead code removal** (§4.1, §4.2): delete `src/middleware/audit.js`, `src/services/notifications.service.js`, `src/services/numbering.service.js`; remove the RLS apparatus from `database.js` and `request-context.js`, or implement the policies — a decision to make explicitly, not by leaving it ambiguous. Given database-per-tenant isolation, removal is the recommendation, with entity-level filtering handled explicitly in queries. **No data risk; code deletion only.** Confirm zero runtime references first (audit found none).

**Exit criteria:** every FK indexed; parent deletion of a financial record fails loudly instead of cascading; no code references a non-existent schema.

---

### Phase 3 — Financial invariants at the database layer

**Scope:** make the database reject financially impossible data. Highest data-risk phase — every constraint must be probed before it is validated.

**Dependencies:** Phases 1-2. Phase 1's fixes must be in production long enough that new violations have stopped.

**Deliverables**

1. **Non-negativity `CHECK`s** (§1.1) on all ~100 money/quantity columns, grouped by module, all `NOT VALID` first.
   **Probe:** a generated read-only script counting violations per column per tenant. **This probe is the deliverable that gates the phase** — the count is unknown today and the decision to validate depends on it.
   - Zero violations → `VALIDATE` immediately.
   - Few → business reviews and corrects each, then `VALIDATE`.
   - Systematic (e.g. credit notes stored as negative invoices) → the constraint is **wrong for that column** and is dropped rather than forced. Note that `invoice.type = 'CREDIT_NOTE'` exists (`0230`) and `reverses_invoice_id` was added in `0442`, which suggests credit notes are modelled as their own document rather than as negatives — but this must be confirmed against real data, not inferred.
     **Rollback:** `DROP CONSTRAINT` per constraint. Fully reversible at every step. Leaving a constraint `NOT VALID` indefinitely is a legitimate outcome: it guards new writes while historic rows are worked through.
2. **Sum invariants** (§1.2) as `BEFORE INSERT OR UPDATE` triggers — `advance.applied_amount <= amount`; `regie_advance.justified + returned <= amount`; `Σ payment_allocation.amount <= receipt.amount` and `<= invoice.total_ttc`.
   Deferred constraint triggers where a multi-row assembly must be permitted mid-transaction, following the `trg_entry_balanced` pattern (`0220_ledger.sql:126-131`) which is already proven in this schema.
   **Probe:** identify existing violations. Over-allocations are likely given §5.3 — each is a real accounting discrepancy needing business resolution, not a silent fix. **Rollback:** `DROP TRIGGER`. Fully reversible.
3. **Uniqueness** (§7.1) — `CREATE UNIQUE INDEX CONCURRENTLY` on `payment_allocation(receipt_id, invoice_id)` and on `doc_number` per table (partial, `WHERE doc_number IS NOT NULL`, since existing rows are legitimately NULL).
   **Probe:** duplicates must be found and resolved first — `CREATE UNIQUE INDEX CONCURRENTLY` fails cleanly and leaves an `INVALID` index, so a failure is safe, but it is better to know. **Duplicate document numbers cannot be resolved by tooling** — renumbering a statutory document is a business and possibly regulatory decision. Flag, report, and wait. **Rollback:** `DROP INDEX`. Fully reversible.
4. **Non-overlapping effective windows** (§1.8) on `tax_code` and `expense_rate` via `EXCLUDE USING gist` with `btree_gist` and a `daterange`. Add the missing `CHECK (effective_to >= effective_from)` to `expense_rate`. Add the app-side conflict check to `addCode` so users get a clear 422 rather than a raw constraint error — mirroring the ledger's existing rules-plus-triggers approach.
   **Probe:** overlapping windows almost certainly exist given no enforcement has ever been present. Each is a business decision about which rate was actually correct — and it changes historic tax computations. **This may need a maintenance window** if resolution requires recomputing posted VAT. Flag prominently; do not resolve unilaterally. **Rollback:** `DROP CONSTRAINT`. Fully reversible.
5. **Locked-document immutability triggers** (§6.5) on `invoice`, `supplier_invoice`, `costing`, `quotation`, modelled directly on `protect_validated_entry` (`0220_ledger.sql:134-160`) — allow only the field sets that legitimately change post-lock.
   **Probe:** confirm no legitimate service path updates a locked document outside the allowed fields; the reversal and credit-note paths in particular must be checked against the trigger's allow-list. **Rollback:** `DROP TRIGGER`. Fully reversible.
6. **Currency FK consistency** (§1.4) — add `REFERENCES currency(code)` to the nine unconstrained columns, `NOT VALID` then `VALIDATE`.
   **Probe:** every distinct value in those columns must exist in `currency`; seed any that do not _before_ validating. **Rollback:** `DROP CONSTRAINT`. Fully reversible.
7. **Optional, gated on Phase 1's probe:** the depreciation backfill. Post the missing GL entries for `posted = true, entry_id IS NULL` schedule rows into open periods, one entry per asset per period, tagged `source = 'SYSTEM_RULE'` with a distinct `source_doc_ref` so they are identifiable and, if wrong, reversible through the existing linked-reversal mechanism.
   **This is a financial correction, not a technical migration.** It requires accounting sign-off per tenant. Rows in closed periods **cannot** be posted retroactively — the period lock trigger (`0464`) will correctly reject them, and forcing it would be wrong. Those become a documented prior-period adjustment. **Flag as requiring manual verification.**

**Exit criteria:** the database rejects negative money, over-allocation, duplicate document numbers and overlapping tax windows. Every constraint is either `VALIDATE`d or documented as `NOT VALID` with a known violation count and an owner.

---

### Phase 4 — Audit trail and multi-currency

**Scope:** make the audit trail complete and independent of service discipline; make multi-currency arithmetic correct.

**Dependencies:** Phase 3 (the immutability triggers establish the pattern and prove the trigger overhead is acceptable).

**Deliverables**

1. **Database-level audit triggers** on financial and inventory tables — `AFTER INSERT OR UPDATE OR DELETE`, writing `before_json`/`after_json` and the hashes into `immutable_ledger` from `row_to_json(OLD)` / `row_to_json(NEW)`, with the actor read from `current_setting('app.current_user_id', true)`.
   This is where the RLS apparatus removed in Phase 2 gets partly reinstated with a real purpose: `applySessionContext` already sets `app.current_user_id` correctly (`database.js`), and the trigger consumes it. Requires the tenant connection path to set it too — `withTenantConnection` currently does not.
   **Interaction to design carefully:** the existing service-level `audit()` calls would double-write. Either the service calls become no-ops for trigger-covered tables, or the trigger writes a distinct `action` prefix. Decide before implementing; do not ship both.
   **Cost:** every write to a covered table gains an insert. Measure on a copy at realistic volume before enabling per table.
   **Rollback:** `DROP TRIGGER` per table. Fully reversible; already-written ledger rows remain, which is correct.
2. **Fix `audit()` call sites** (§6.3) to pass `before` consistently, especially `resource.js:144` (`archive` omits `after`) and the finance services that audit summaries instead of rows.
3. **Multi-currency base amounts** (§1.3) — add `debit_xaf` / `credit_xaf` `numeric(18,2)` to `journal_line`, and equivalents on `invoice` and `supplier_invoice`.
   **Backfill:** every existing row has `currency = 'XAF'` and `fx_rate = 1` (the defaults) unless proven otherwise — **probe first**, per tenant, counting rows where `currency <> 'XAF' OR fx_rate <> 1`. If zero, backfill is `debit_xaf = debit` and is trivially safe. If non-zero, each non-XAF row needs the rate that was actually in force, which may not be recoverable — **flag as requiring manual verification.**
   Then extend the balance trigger to check base-currency balance, and `assertBalanced` to match.
   **Ordering:** add columns (nullable) → backfill → verify → add the `NOT NULL` and the trigger extension. Four separate migrations, each independently reversible. **Rollback:** the trigger extension and `NOT NULL` are droppable; the columns are left in place (dropping a column is **IRREVERSIBLE** and unnecessary — an unused nullable column is harmless).
4. **`cycle_count` structure** (§6.4): replace free-form `discrepancy jsonb` with a `cycle_count_line` child table referencing `inventory_item`, keeping the jsonb column populated in parallel during transition.
   **Migration:** additive only. New table, dual-write, backfill from jsonb where parseable, verify, then switch reads. The jsonb column is retained, not dropped. **Rollback:** stop writing the new table; reads fall back. Fully reversible.
5. **Retention:** the ledger's documented 10-year retention has no implementation. Add partitioning by `created_at` on `immutable_ledger` and `event_log` so retention becomes a partition detach rather than a `DELETE` — a `DELETE` would be blocked by `forbid_mutation` anyway, which is currently an unsolved operational problem nobody has hit yet.
   **Note:** converting an existing table to partitioned requires a table rewrite. Do this as create-new + copy + rename inside one transaction, with the original retained under a suffixed name until verified. **Flag as requiring a maintenance window.**

**Exit criteria:** every financial and inventory mutation produces a ledger row regardless of write path; hashes chain; multi-currency entries balance in base currency.

---

### Phase 5 — Normalisation, consistency and prevention

**Scope:** the design-level cleanups, and the guardrails that stop this list regenerating.

**Dependencies:** Phases 1-4.

**Deliverables**

1. **Enum consistency.** Status vocabularies are inconsistent across tables that model the same lifecycle — `invoice` uses `DRAFT/SUBMITTED_FOR_VALIDATION/SUBMITTED_FOR_APPROVAL/ISSUED_LOCKED/APPROVED_LOCKED/POSTED_LOCKED/CANCELLED/REVERSED`, `costing` uses a five-value subset, `purchase_order` a different six, `journal_entry` lowercase `draft|validated` while everything else is uppercase. Introduce a shared `document_status` domain and align, **additively**: widen each `CHECK` to accept both old and new values, migrate values, then narrow. Three reversible steps per table. Lowercase-to-uppercase on `journal_entry.status` is the riskiest — its value is read by the immutability trigger and by `WHEN (NEW.status = 'validated')` clauses on two constraint triggers, all of which must change in the same transaction.
   **Assess whether this is worth doing at all.** It is cosmetic relative to Phases 1-3, and it touches the ledger. A defensible outcome is to align the _new_ tables and leave `journal_entry` alone, documenting why.
2. **Over-normalisation review.** Two candidates: `client_type` is a table with three rows feeding one nullable FK, and `milestone_template` / `milestone_template_stage` / `milestone_instance` carries three levels of indirection where instances copy `code`/`label` from the template anyway (`0310_operations.sql`). Neither is causing harm; document the assessment and change nothing unless a concrete problem is identified. Denormalisation for its own sake is not an improvement.
3. **`ON UPDATE` policy** (§2.3): make the natural-key decision explicit. Recommendation: keep `NO ACTION` on `chart_of_accounts.code` (a posted statutory account code must not be renamed) and document it in the migration and in the COA service's error handling, so a user attempting the rename gets a clear explanation rather than a raw `23503`.
4. **Forward-fix the silent-failure migrations** (§3.6): a new migration that re-asserts what 0467/0468 were meant to do, with `RAISE WARNING` instead of `NULL`, following `0492`'s example. The originals stay untouched.
5. **Prevention — the deliverable that matters most in this phase:**
   - Extend `check-migration-numbers.js` into a full migration linter: reject bare `CREATE TABLE`/`CREATE TRIGGER` without `IF NOT EXISTS`/`DROP IF EXISTS`; reject `EXCEPTION WHEN OTHERS THEN NULL`; reject a new FK without an accompanying index; reject a new money column without a `CHECK`; require a matching down-file.
   - Wire `schema-drift-check.js` (Phase 1) into CI against an ephemeral tenant, and into a scheduled production check.
   - Add a lint rule or test asserting that no `*.controller.js` calls a service write method outside a transaction wrapper.
   - Extend `tests/integration/` — currently only the ledger has DB-backed trigger tests, and they skip without `DATABASE_URL`. Add the same for every trigger and constraint added in Phases 2-4, and make them run in CI against a real ephemeral Postgres rather than skipping.
6. **Documentation reconciliation.** `doc/DB_ARCHITECTURE.md` describes guarantees the schema does not provide: `before_hash`/`after_hash` population (§6.2), `user_entity_scope` and `allowance_type` tables that do not exist, a sandbox wipe by `TRUNCATE` where the code uses `DROP SCHEMA CASCADE`, and RLS removal that the code did not complete (§4.1). Update it to describe the schema as it is after Phase 4, and mark clearly which statements are design intent versus implemented fact. This document is the first thing a new engineer reads; it currently teaches things that are not true.

**Exit criteria:** the linter blocks the classes of defect this audit found; drift detection runs continuously; the architecture doc matches the database.

---

## 9. What must not be changed

Recording these explicitly so a later pass does not "tidy" them:

- **The ledger triggers** (`0220`, `0221`, `0464`). They are correct, well-reasoned, tested against real Postgres, and are the strongest part of this schema. Extend, never relax.
- **`entry_no` allocation.** `pg_advisory_xact_lock` + `MAX+1` inside the posting transaction (`journal_entry.repo.js:33-43`) is genuinely gap-free and rollback-safe. It looks like a naive `MAX+1` race and is not.
- **The grandfathered migration-number collisions.** `check-migration-numbers.js` explains precisely why renaming an applied migration is a live-database hazard. Its reasoning is correct.
- **`0490`'s backfill pattern** — fills only NULLs, leaves ambiguity unlinked, warns rather than fails. Copy it.
- **`0492`'s header.** The best migration documentation in the repo; it is the standard the others should meet.
- **Database-per-tenant isolation.** Not in question and not touched by anything above.

---

## 10. Standing recommendation

Phases 1 and 3 contain the findings that put financial data at risk today. Phase 1 is almost entirely application code and is deployable without a maintenance window; **finding 5.5 (asset depreciation never reaching the GL) should be treated as an incident rather than roadmap work**, because every tenant with fixed assets currently has a fixed-asset register that its own trial balance does not corroborate.

Nothing in this document has been executed. No migration should be written until the findings are reviewed and the phase order is confirmed.
