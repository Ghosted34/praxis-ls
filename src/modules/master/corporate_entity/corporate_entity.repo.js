/** Corporate-entity repository (MOD-01). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "corporate_entity", data);
const get = (client, id) => getById(client, "corporate_entity", "entity_id", id);

async function getByCode(client, code) {
  const { rows } = await client.query("SELECT * FROM corporate_entity WHERE code = $1", [code]);
  return rows[0] || null;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "corporate_entity", "entity_id", id, fields, "*", null, { touch: "updated_at" });
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
