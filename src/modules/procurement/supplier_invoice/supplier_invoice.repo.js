/** Supplier-invoice repository (MOD-61). All SI / SI-line SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertSI = (client, data) => insertOne(client, "supplier_invoice", data);
const getSI = (client, id) => getById(client, "supplier_invoice", "supplier_invoice_id", id);
const insertLine = (client, data) => insertOne(client, "supplier_invoice_line", data);

async function deleteLines(client, id) { await client.query("DELETE FROM supplier_invoice_line WHERE supplier_invoice_id = $1", [id]); }
async function listLines(client, id) {
  const { rows } = await client.query("SELECT * FROM supplier_invoice_line WHERE supplier_invoice_id = $1 ORDER BY supplier_invoice_line_id", [id]);
  return rows;
}
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getSI(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE supplier_invoice SET " + set + ", updated_at = now() WHERE supplier_invoice_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function poTotal(client, poId) {
  const { rows } = await client.query("SELECT total_ttc FROM purchase_order WHERE po_id = $1", [poId]);
  return rows[0] ? Number(rows[0].total_ttc) : null;
}
async function grnCountForPO(client, poId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM goods_received_note WHERE po_id = $1", [poId]);
  return rows[0].n;
}
async function listSI(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.supplier_id) { params.push(q.supplier_id); wh.push("supplier_id = $" + params.length); }
  const { rows } = await client.query("SELECT *, doc_number AS ref FROM supplier_invoice WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertSI, getSI, insertLine, deleteLines, listLines, update, poTotal, grnCountForPO, listSI };
