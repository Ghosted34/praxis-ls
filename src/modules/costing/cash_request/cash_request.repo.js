/** Cash-request repository (MOD-49). Header, lines, payments. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertCR = (client, data) => insertOne(client, "cash_request", data);
const getCR = (client, id) => getById(client, "cash_request", "cash_request_id", id);
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
module.exports = { insertCR, getCR, insertLine, insertPayment, deleteLines, listLines, listPayments, update, list };
