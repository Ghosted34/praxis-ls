/**
 * Smart-receivables repository (MOD-52). Receipts, allocations, and the
 * outstanding/ageing reads. All SQL for this module lives here.
 */
"use strict";
const { insertOne, getById, page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

const insertReceipt = (client, data) => insertOne(client, "payment_receipt", data);
const getReceipt = (client, id) => getById(client, "payment_receipt", "receipt_id", id);
const insertAllocation = (client, data) => insertOne(client, "payment_allocation", data);

const updateReceipt = (client, id, fields) => {
  const keys = Object.keys(fields);
  if (!keys.length) return getReceipt(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return client.query("UPDATE payment_receipt SET " + set + " WHERE receipt_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]).then((r) => r.rows[0] || null);
};

/** Treasury account -> its GL cash account (521/571/538x). */
async function treasuryCoa(client, treasuryAccountId) {
  const { rows } = await client.query("SELECT coa_code FROM treasury_account WHERE treasury_account_id = $1", [treasuryAccountId]);
  return rows[0] ? rows[0].coa_code : null;
}

/** Open FINAL invoices (issued/posted) with outstanding = total_ttc - allocated. */
async function openInvoices(client, { clientId = null }) {
  const { rows } = await client.query(
    "SELECT i.invoice_id, i.doc_number, i.client_id, i.total_ttc, i.payment_due_on, " +
      "  COALESCE(a.allocated, 0) AS allocated, " +
      "  (i.total_ttc - COALESCE(a.allocated, 0)) AS outstanding " +
      "FROM invoice i " +
      "LEFT JOIN (SELECT invoice_id, SUM(amount) AS allocated FROM payment_allocation GROUP BY invoice_id) a " +
      "  ON a.invoice_id = i.invoice_id " +
      "WHERE i.type = 'FINAL' AND i.status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED') " +
      "  AND (i.total_ttc - COALESCE(a.allocated, 0)) > 0 " +
      "  AND ($1::uuid IS NULL OR i.client_id = $1) " +
      "ORDER BY i.payment_due_on ASC NULLS LAST, i.created_at ASC",
    [clientId],
  );
  return rows;
}

/**
 * One page of receipts, plus how many match the filter in total.
 *
 * `q` searches CLIENT NAME, the field the Finance hub's Receipts tab filters
 * on — previously done in the browser over a truncated set.
 *
 * limit/offset now go through `page()` rather than being taken raw: the caller
 * passed `q.limit` straight from the query string, so a non-numeric or
 * unbounded value reached the SQL unclamped.
 *
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
async function listReceipts(client, { clientId = null, limit, offset, q: text = null } = {}) {
  const { limit: lim, offset: off } = page({ limit, offset });
  const params = [lim, off];
  const wh = ["1=1"];
  if (clientId) { params.push(clientId); wh.push("r.client_id = $" + params.length); }
  if (text) { params.push("%" + text + "%"); wh.push("c.name ILIKE $" + params.length); }
  const { rows } = await client.query(
    `SELECT r.*, ${TOTAL_COL} FROM payment_receipt r ` +
      "LEFT JOIN client_master c ON c.client_id = r.client_id " +
      "WHERE " + wh.join(" AND ") +
      " ORDER BY r.received_on DESC, r.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return splitTotal(rows);
}

async function allocationsForReceipt(client, receiptId) {
  const { rows } = await client.query("SELECT * FROM payment_allocation WHERE receipt_id = $1", [receiptId]);
  return rows;
}

module.exports = { insertReceipt, getReceipt, updateReceipt, insertAllocation, treasuryCoa, openInvoices, listReceipts, allocationsForReceipt };
