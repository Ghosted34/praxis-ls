/** Purchase-order repository (MOD-60). All PO / PO-item SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertPO = (client, data) => insertOne(client, "purchase_order", data);
const getPO = (client, id) => getById(client, "purchase_order", "po_id", id);
const insertItem = (client, data) => insertOne(client, "purchase_order_item", data);

async function deleteItems(client, poId) { await client.query("DELETE FROM purchase_order_item WHERE po_id = $1", [poId]); }
async function listItems(client, poId) {
  const { rows } = await client.query("SELECT * FROM purchase_order_item WHERE po_id = $1 ORDER BY po_item_id", [poId]);
  return rows;
}
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getPO(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE purchase_order SET " + set + " WHERE po_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function listPO(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.supplier_id) { params.push(q.supplier_id); wh.push("supplier_id = $" + params.length); }
  const { rows } = await client.query("SELECT *, doc_number AS ref FROM purchase_order WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertPO, getPO, insertItem, deleteItems, listItems, update, listPO };
