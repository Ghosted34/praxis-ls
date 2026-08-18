# MySQL → PostgreSQL Migration Design (G12)

**Closes:** G12 of `doc/GAP_REVIEW_2026-08-14.md` — *"MySQL → PostgreSQL migration
tooling: zero lines. Correctly deferred (PRD §16 makes migration client-owned,
post-build) — but 'with our tooling/support' is a commitment, and the
staging-schema reconciliation approach should be designed before Phase 5
opens, not during it."*

This document is the **design**, written now so the work in Phase 5 is
execution, not discovery. The PRD keeps the migration client-owned and
post-build; our commitment is tooling + support, and the tooling starts here.

---

## 1. Why not a naive dump-and-load

The legacy is a hand-grown PHP/MySQL schema (~90 tables recovered from SQL
statements in `doc/reference/legacy_codebase/`). The rebuild is a migrated
PostgreSQL schema (233 tenant tables) with invariants the legacy never had:

- the immutable ledger, gap-free `entry_no`, balanced journals (triggers);
- OHADA posting rules, `doc_sequences` numbering, tenant schema isolation;
- UUID keys everywhere (the legacy used `AUTO_INCREMENT` ints);
- enum-ish `CHECK` constraints and NOT NULL guarantees the legacy lacks.

A `mysqldump | psql` pipe produces a database that fails every one of those
invariants. The migration is a **reconciliation**, not a transfer.

## 2. The staging-schema approach

The same pattern the tenant migrations already use — migrate into a schema,
verify, then promote — applied to the legacy data:

```
legacy MySQL                     rebuild Postgres
┌──────────────┐   extract   ┌──────────────────────┐
│ ~90 tables   │ ──────────▶ │ staging.<table>      │  raw, faithful copy
│ (AUTO_INC,   │   (SQL)     │ (INT ids preserved)  │  (id-mapping kept)
│  legacy enum)│            └──────────────────────┘
                                   │ transform (per-table mappers)
                                   ▼
                              ┌──────────────────────┐
                              │ live.<table>         │  UUIDs, FKs, invariants
                              │ (the real schema)    │  verified by the same
                              └──────────────────────┘  gates CI applies
```

Three stages, each independently verifiable:

### Stage 1 — Extract (read-only)
- `scripts/mysql-dump.mjs` connects to the legacy MySQL (read-only replica or
  a dump file) and writes the raw rows into `staging.<table>` **1:1**, keeping
  the legacy integer ids in a parallel `id_map` table.
- The staging schema is created by `CREATE SCHEMA staging` — it is never the
  live schema, so a bad extraction cannot corrupt anything.
- Idempotent: re-runs truncate staging and start over.

### Stage 2 — Transform (the real work, per table)
Each table gets a mapper module, because the mappings are idiosyncratic:

| Legacy concept | Rebuild mapping |
|---|---|
| `AUTO_INCREMENT` id | UUID — allocated via `id_map` so FKs re-point correctly |
| `TINYINT` flags | `boolean` (mapping table in the mapper, e.g. `1 → true`) |
| status strings | new vocabulary (`NEW/READ/RESPONDED/CLOSED` → rebuild statuses) |
| money as `DECIMAL` / floats | `numeric(18,2)`; XAF where the legacy used a code column |
| dates as strings | proper `timestamptz` |
| ledger-adjacent rows | **not transformed — rejected with a report**: the rebuild's ledger invariants mean legacy journal rows must be re-entered through the app (or explicitly mapped by the client accountant) |
| soft-deleted rows | map to `soft_delete` where the rebuild has that table |

- Every mapper outputs `{ rows, rejected }`; rejected rows go to a per-table
  report with the reason, so nothing is silently dropped.
- The transform runs **inside the tenant's `live` schema as one transaction
  per table batch**, and only after the invariant gates below pass.

### Stage 3 — Verify (the gates CI already owns)
The same scripts that gate migrations run against the loaded data before the
client signs off:

- `check-migration-idempotency.js` style re-run safety,
- schema drift + FK integrity (`check-schema-drift.js`),
- ledger invariants (balanced, gap-free `entry_no`) on any migrated
  accounting rows,
- a **count reconciliation report**: `staging.<t>` vs `live.<t>` vs the
  legacy's own `SELECT COUNT(*)`, per table, so "we lost 200 invoices" is
  caught by the tool, not by the client.

## 3. Sequencing (when Phase 5 opens)

1. **Dry run against a copy.** Dump the legacy to a staging DB; run extract +
   transform; produce the full report. No tenant DB touched.
2. **Client sign-off on the report** — the mapping decisions (statuses,
   which legacy rows are re-entered, how historical ledger rows are handled)
   are business decisions, not code decisions.
3. **Production run** — extract from the live legacy replica, transform into
   the tenant's `live` schema, re-run the count reconciliation, promote.
4. **Post-cutover support window** — the tool keeps the `id_map` and the
   reports so the client can ask "what happened to record X" and get a
   row-level answer.

## 4. Out of scope (by PRD §16)

- The legacy is **client-owned**; we do not migrate it unilaterally.
- No write-back to MySQL. One-way only.
- Password hashes, secrets, and the legacy's hard-coded credentials are
  **never** migrated — accounts are re-created through `create-admin` /
  invitations, exactly as today.

## 5. What ships before Phase 5 (this design is the first commit)

- [ ] `scripts/mysql-dump.mjs` — extract skeleton (mysql2 + pg drivers).
- [ ] `id_map` schema + the first three mappers (clients, suppliers,
      employees) as the reference implementation.
- [ ] The count-reconciliation report (staging vs live vs legacy).
- [ ] A fixture legacy dump (from `doc/reference/legacy_codebase/`) so the
      toolchain is testable without the client's real data.
