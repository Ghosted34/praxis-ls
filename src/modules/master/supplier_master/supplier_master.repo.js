/** Supplier master repository (MOD-04). All supplier_master SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "supplier_master", data);
const get = (client, id) => getById(client, "supplier_master", "supplier_id", id);
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE supplier_master SET " + set + ", updated_at = now() WHERE supplier_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("name ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM supplier_master " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, update, list };
