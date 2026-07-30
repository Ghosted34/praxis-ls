/** Delivery-note repository (MOD-32). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertDN = (client, data) => insertOne(client, "delivery_note", data);
const getDN = (client, id) => getById(client, "delivery_note", "delivery_note_id", id);
const insertLine = (client, data) => insertOne(client, "delivery_note_line", data);
const listLines = async (client, id) =>
  (await client.query("SELECT * FROM delivery_note_line WHERE delivery_note_id = $1 ORDER BY delivery_note_line_id", [id])).rows;

async function listDN(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const { rows } = await client.query("SELECT * FROM delivery_note WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertDN, getDN, listDN, insertLine, listLines };
