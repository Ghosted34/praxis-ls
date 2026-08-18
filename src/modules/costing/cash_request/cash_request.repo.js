/** Cash-request repository (MOD-49). Header, lines, payments. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertCR = (client, data) => insertOne(client, "cash_request", data);
const getCR = (client, id) => getById(client, "cash_request", "cash_request_id", id);

/**
 * The request row, locked for the duration of the transaction.
 *
 * `disburse` recomputes `disbursed_amount` from the payment children and writes
 * a status derived from it. Without the lock two concurrent instalments both
 * read the same total, both compute PARTIALLY_DISBURSED, and the request ends
 * up with two advances and a cache that understates the cash actually issued.
 * Same rule as regie.repo.getForUpdate (10717).
 */
async function getCRForUpdate(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM cash_request WHERE cash_request_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

/** Σ of the payment children — the source of truth for disbursed_amount. */
async function paymentsTotal(client, id) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM cash_request_payment WHERE cash_request_id = $1",
    [id],
  );
  return Number(rows[0].total);
}
const insertLine = (client, data) => insertOne(client, "cash_request_line", data);
const insertPayment = (client, data) => insertOne(client, "cash_request_payment", data);

async function deleteLines(client, id) { await client.query("DELETE FROM cash_request_line WHERE cash_request_id = $1", [id]); }
async function listLines(client, id) {
  const { rows } = await client.query("SELECT * FROM cash_request_line WHERE cash_request_id = $1 ORDER BY cash_request_line_id", [id]);
  return rows;
}
async function listPayments(client, id) {
  const { rows } = await client.query("SELECT * FROM cash_request_payment WHERE cash_request_id = $1 ORDER BY paid_on", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getCR(client, id);
  return updateOne(client, "cash_request", "cash_request_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE cr." + wh.join(" AND cr.") : "";
  /*
   * `total_budget` — the sum of this request's lines.
   *
   * The list screen has rendered a "Budget" column bound to `total_budget`
   * since it was written (features/costing/pages.tsx), but nothing ever sent
   * the field: the budget lives on `cash_request_line.budget_amount` and this
   * query was a bare `SELECT *` off the head table. So the column has been
   * blank on every row, for every tenant, and no test noticed — an optional
   * field that is always `undefined` type-checks perfectly. That is the exact
   * failure `scripts/check-response-contract.js` exists to catch, and this is
   * it catching one.
   *
   * A correlated subquery rather than a JOIN + GROUP BY: the head columns are
   * `SELECT *`, so grouping would mean naming every one of them and re-naming
   * them again whenever the table grows. COALESCE so a request with no lines
   * yet reports 0 rather than null — "no lines" is a budget of nothing, and the
   * column is money.
   */
  const { rows } = await client.query(
    `SELECT cr.*,
            COALESCE((SELECT SUM(l.budget_amount)
                        FROM cash_request_line l
                       WHERE l.cash_request_id = cr.cash_request_id), 0) AS total_budget
       FROM cash_request cr ${where}
      ORDER BY cr.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}
/**
 * The linked costing, only when it can feed a request: its status/ref plus the
 * line facts (label, qty, unit_cost, is_disbursement, dictionary item). Used by
 * `importCostingLines` — the legacy `costing_lines_get` gate lives in the
 * service (APPROVED_LOCKED only), this is just the read.
 */
async function costingForImport(client, costingId) {
  if (!costingId) return null;
  const { rows } = await client.query(
    "SELECT costing_id, status, doc_number FROM costing WHERE costing_id = $1 LIMIT 1",
    [costingId],
  );
  const head = rows[0];
  if (!head) return null;
  const lr = await client.query(
    "SELECT dictionary_item_id, label, qty, unit_cost, is_disbursement FROM costing_line WHERE costing_id = $1 ORDER BY costing_line_id",
    [costingId],
  );
  return { ...head, lines: lr.rows };
}

module.exports = { insertCR, getCR, getCRForUpdate, paymentsTotal, insertLine, insertPayment, deleteLines, listLines, listPayments, update, list, costingForImport };
