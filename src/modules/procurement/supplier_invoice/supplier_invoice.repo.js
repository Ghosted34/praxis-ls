/** Supplier-invoice repository (MOD-61). All SI / SI-line SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertSI = (client, data) => insertOne(client, "supplier_invoice", data);
const getSI = (client, id) => getById(client, "supplier_invoice", "supplier_invoice_id", id);
const insertLine = (client, data) => insertOne(client, "supplier_invoice_line", data);

async function deleteLines(client, id) { await client.query("DELETE FROM supplier_invoice_line WHERE supplier_invoice_id = $1", [id]); }
// The container type is joined so a carrier's invoice can be read line-by-line
// against the rate card it was priced from — the whole point of recording it.
// LEFT JOIN: most lines carry no equipment, and a type retired since the
// invoice was posted must still render its name.
const LINE_SELECT =
  "SELECT sl.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra " +
  "FROM supplier_invoice_line sl LEFT JOIN dictionary_ref dr ON dr.ref_id = sl.container_type_ref_id ";
async function listLines(client, id) {
  const { rows } = await client.query(LINE_SELECT + "WHERE sl.supplier_invoice_id = $1 ORDER BY sl.supplier_invoice_line_id", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getSI(client, id);
  return updateOne(client, "supplier_invoice", "supplier_invoice_id", id, fields, "*", null, { touch: "updated_at" });
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
