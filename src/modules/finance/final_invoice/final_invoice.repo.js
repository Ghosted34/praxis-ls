/**
 * Final-invoice repository (MOD-51). All invoice / invoice_line / advance SQL for
 * this module lives here (CONVENTIONS: the repo is the only place with SQL).
 */
"use strict";
const { insertOne, getById, page, TOTAL_COL, splitTotal, updateOne } = require("../../../shared/db/query-helpers");

const insertInvoice = (client, data) => insertOne(client, "invoice", data);
const getInvoice = (client, id) => getById(client, "invoice", "invoice_id", id);

async function updateInvoice(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getInvoice(client, id);
  return updateOne(client, "invoice", "invoice_id", id, fields, "*", null, { touch: "updated_at" });
}

async function deleteLines(client, invoiceId) {
  await client.query("DELETE FROM invoice_line WHERE invoice_id = $1", [invoiceId]);
}
function insertLine(client, data) { return insertOne(client, "invoice_line", data); }
// The container type is joined so the printed invoice can say which box a
// charge was for, and `extra` rides along so a document totals its own TEU
// without a second round-trip. LEFT JOIN: most lines have no equipment, and a
// since-deactivated type must still render on a posted invoice.
const LINE_SELECT =
  "SELECT il.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra " +
  "FROM invoice_line il LEFT JOIN dictionary_ref dr ON dr.ref_id = il.container_type_ref_id ";
async function listLines(client, invoiceId) {
  const { rows } = await client.query(LINE_SELECT + "WHERE il.invoice_id = $1 ORDER BY il.line_no", [invoiceId]);
  return rows;
}

/**
 * One page of final invoices, plus how many match the filter in total.
 *
 * `q` searches doc_number, CLIENT NAME and DOSSIER REF — the same three fields
 * the Finance hub's search box targets. It used to match doc_number only, so
 * the hub did the other two client-side over whatever `page()` had already
 * truncated to 50 rows: searching a client name returned nothing unless that
 * client happened to appear in the 50 most recent invoices. The joins are
 * LEFT so an invoice with no client or no dossier is still returned.
 *
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
async function listInvoices(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["i.type = 'FINAL'"];
  if (q.status) { params.push(q.status); wh.push("i.status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("i.client_id = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    const p = "$" + params.length;
    wh.push(`(i.doc_number ILIKE ${p} OR c.name ILIKE ${p} OR d.ref ILIKE ${p})`);
  }
  const { rows } = await client.query(
    `SELECT i.*, ${TOTAL_COL} FROM invoice i ` +
      "LEFT JOIN client_master c ON c.client_id = i.client_id " +
      "LEFT JOIN dossier d ON d.dossier_id = i.dossier_id " +
      "WHERE " + wh.join(" AND ") +
      " ORDER BY i.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return splitTotal(rows);
}

async function openAdvances(client, { clientId, dossierId }) {
  const { rows } = await client.query(
    "SELECT advance_id, amount, applied_amount FROM advance " +
      "WHERE amount > applied_amount AND ($1::uuid IS NULL OR client_id = $1) AND ($2::uuid IS NULL OR dossier_id = $2) " +
      "ORDER BY received_on ASC, created_at ASC",
    [clientId || null, dossierId || null],
  );
  return rows;
}
async function addAdvanceApplied(client, advanceId, amount) {
  await client.query("UPDATE advance SET applied_amount = applied_amount + $2 WHERE advance_id = $1", [advanceId, amount]);
}

module.exports = {
  insertInvoice, getInvoice, updateInvoice, deleteLines, insertLine, listLines,
  listInvoices, openAdvances, addAdvanceApplied,
};
