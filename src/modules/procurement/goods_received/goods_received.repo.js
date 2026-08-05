/** Goods-received-note repository (MOD-61). All GRN SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertGRN = (client, data) => insertOne(client, "goods_received_note", data);
const getGRN = (client, id) => getById(client, "goods_received_note", "grn_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getGRN(client, id);
  return updateOne(client, "goods_received_note", "grn_id", id, fields, "*", null);
}
async function getForPO(client, poId) {
  const { rows } = await client.query("SELECT * FROM goods_received_note WHERE po_id = $1 ORDER BY created_at DESC", [poId]);
  return rows;
}
async function listGRN(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.po_id) { params.push(q.po_id); wh.push("po_id = $" + params.length); }
  const { rows } = await client.query("SELECT * FROM goods_received_note WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
// PO status peek (read-only; PO writes belong to the PO repo/service).
async function poStatus(client, poId) {
  const { rows } = await client.query("SELECT po_id, status, total_ttc FROM purchase_order WHERE po_id = $1", [poId]);
  return rows[0] || null;
}
module.exports = { insertGRN, getGRN, update, getForPO, listGRN, poStatus };
