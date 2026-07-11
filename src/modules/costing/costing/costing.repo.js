/** Costing repository (MOD-46). costing + costing_line SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "costing", data);
const get = (client, id) => getById(client, "costing", "costing_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE costing SET " + set + ", updated_at = now() WHERE costing_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
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
