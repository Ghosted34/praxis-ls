/** Costing repository (MOD-46). costing + costing_line SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "costing", data);
const get = (client, id) => getById(client, "costing", "costing_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "costing", "costing_id", id, fields, "*", null, { touch: "updated_at" });
}
async function deleteLines(client, costingId) { await client.query("DELETE FROM costing_line WHERE costing_id = $1", [costingId]); }
function insertLine(client, data) { return insertOne(client, "costing_line", data); }
async function listLines(client, costingId) {
  const { rows } = await client.query("SELECT * FROM costing_line WHERE costing_id = $1 ORDER BY costing_line_id", [costingId]);
  return rows;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM costing " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, update, deleteLines, insertLine, listLines, list };
