"use strict";

/**
 * Shared SQL for reading `cost_entry` NET of reconciliation reversals.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Budget Reconciliation settlement (MOD-76) posts a downward correction as a
 * REVERSING entry whose `cost_entry` row still carries a POSITIVE `amount` —
 * chk_cost_entry_amount_nonneg (0497) forbids a negative — under category
 * `reconciliation_reversal`. The journal lines move the money the other way, so
 * the row is an economic CREDIT wearing a positive amount.
 *
 * Every read that means "net actual spend" therefore has to SUBTRACT those rows.
 * An unsigned `SUM(amount)` reads a correction DOWN as spend UP: a file whose
 * actual was corrected from 100k to 80k would report 120k. That is one rule, and
 * it lives here once rather than being re-typed into every `SUM(cost_entry.amount)`
 * in the tree (a file 360's actual_cost, a margin report, the master-ledger
 * matrix, a dictionary-item trend). A second copy is a copy that drifts.
 *
 * `REVERSAL_CATEGORY` is the SINGLE source of truth for the category string; the
 * writer (`dossier_reconciliation.service.settle()`) must stamp exactly this.
 *
 * Usage — interpolated into a query, never with user input (there is none here):
 *
 *   const { netAmountSql } = require("../../../shared/finance/cost-entry-sql");
 *   `SELECT COALESCE(${netAmountSql("ce")}, 0) AS actual FROM cost_entry ce ...`
 *   `SELECT COALESCE(${netAmountSql()}, 0)   AS total  FROM cost_entry ...`   // no alias
 */

const REVERSAL_CATEGORY = "reconciliation_reversal";

/**
 * `SUM(...)` over `cost_entry.amount` with `reconciliation_reversal` rows
 * subtracted. `alias` is the table alias in the query (`"ce"`); pass `""` (or
 * omit) when the table is unaliased. The output is a constant SQL fragment —
 * `alias` is a code-supplied identifier, not user input.
 */
function netAmountSql(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `SUM(CASE WHEN ${p}category = '${REVERSAL_CATEGORY}' THEN -${p}amount ELSE ${p}amount END)`;
}

module.exports = { netAmountSql, REVERSAL_CATEGORY };
