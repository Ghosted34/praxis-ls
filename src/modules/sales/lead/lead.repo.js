/** Lead repository (MOD-20). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "lead", data);
const get = (client, id) => getById(client, "lead", "lead_id", id);
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "lead", "lead_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push("owner_user_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(company_name ILIKE $" + params.length + " OR contact_name ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM lead " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, update, list };
