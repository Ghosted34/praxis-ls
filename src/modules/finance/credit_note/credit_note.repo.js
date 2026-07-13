/**
 * Credit-note repository (MOD-51). Credit notes are invoice rows with
 * type='CREDIT_NOTE'; all SQL for this module lives here.
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
    [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}

async function deleteLines(client, invoiceId) {
  await client.query("DELETE FROM invoice_line WHERE invoice_id = $1", [invoiceId]);
}
const insertLine = (client, data) => insertOne(client, "invoice_line", data);
async function listLines(client, invoiceId) {
  const { rows } = await client.query("SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY line_no", [invoiceId]);
  return rows;
}

async function listCreditNotes(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["type = 'CREDIT_NOTE'"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  if (q.reverses_invoice_id) { params.push(q.reverses_invoice_id); wh.push("reverses_invoice_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM invoice WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

module.exports = { insertInvoice, getInvoice, updateInvoice, deleteLines, insertLine, listLines, listCreditNotes };
