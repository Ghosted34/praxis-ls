/**
 * Final-invoice repository (MOD-51). All invoice / invoice_line / advance SQL for
 * this module lives here (CONVENTIONS: the repo is the only place with SQL).
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertInvoice = (client, data) => insertOne(client, "invoice", data);
const getInvoice = (client, id) => getById(client, "invoice", "invoice_id", id);

async function updateInvoice(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getInvoice(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE invoice SET " + set + ", updated_at = now() WHERE invoice_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function deleteLines(client, invoiceId) {
  await client.query("DELETE FROM invoice_line WHERE invoice_id = $1", [invoiceId]);
}
function insertLine(client, data) { return insertOne(client, "invoice_line", data); }
async function listLines(client, invoiceId) {
  const { rows } = await client.query("SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY line_no", [invoiceId]);
  return rows;
}

async function listInvoices(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["type = 'FINAL'"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("doc_number ILIKE $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM invoice WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
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
