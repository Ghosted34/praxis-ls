/** Transit-order repository (MOD-30). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertTO = (client, data) => insertOne(client, "transit_order", data);
const getTO = (client, id) => getById(client, "transit_order", "transit_order_id", id);
const insertLine = (client, data) => insertOne(client, "transit_order_line", data);
const listLines = async (client, id) =>
  (await client.query("SELECT * FROM transit_order_line WHERE transit_order_id = $1 ORDER BY transit_order_line_id", [id])).rows;

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getTO(client, id);
  return updateOne(client, "transit_order", "transit_order_id", id, fields, "*", null);
}
async function listTO(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query("SELECT *, ot_number AS ref FROM transit_order WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertTO, getTO, update, listTO, insertLine, listLines };
