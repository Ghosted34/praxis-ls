/** Corporate-entity repository (MOD-01). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "corporate_entity", data);
const get = (client, id) => getById(client, "corporate_entity", "entity_id", id);

async function getByCode(client, code) {
  const { rows } = await client.query("SELECT * FROM corporate_entity WHERE code = $1", [code]);
  return rows[0] || null;
}
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE corporate_entity SET " + set + ", updated_at = now() WHERE entity_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.is_active !== undefined) { params.push(q.is_active === "true" || q.is_active === true); wh.push("is_active = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(code ILIKE $" + params.length + " OR legal_name ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM corporate_entity " + where + " ORDER BY code ASC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, getByCode, update, list };
