/** Quotation repository (MOD-27). Header + lines. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "quotation", data);
const get = (client, id) => getById(client, "quotation", "quotation_id", id);
const insertLine = (client, data) => insertOne(client, "quotation_line", data);

async function deleteLines(client, id) { await client.query("DELETE FROM quotation_line WHERE quotation_id = $1", [id]); }
async function listLines(client, id) {
  const { rows } = await client.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no NULLS LAST, quotation_line_id", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "quotation", "quotation_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM quotation " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, insertLine, deleteLines, listLines, update, list };
