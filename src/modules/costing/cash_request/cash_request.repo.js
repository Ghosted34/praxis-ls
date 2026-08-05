/** Cash-request repository (MOD-49). Header, lines, payments. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertCR = (client, data) => insertOne(client, "cash_request", data);
const getCR = (client, id) => getById(client, "cash_request", "cash_request_id", id);
const insertLine = (client, data) => insertOne(client, "cash_request_line", data);
const insertPayment = (client, data) => insertOne(client, "cash_request_payment", data);

async function deleteLines(client, id) { await client.query("DELETE FROM cash_request_line WHERE cash_request_id = $1", [id]); }
async function listLines(client, id) {
  const { rows } = await client.query("SELECT * FROM cash_request_line WHERE cash_request_id = $1 ORDER BY cash_request_line_id", [id]);
  return rows;
}
async function listPayments(client, id) {
  const { rows } = await client.query("SELECT * FROM cash_request_payment WHERE cash_request_id = $1 ORDER BY paid_on", [id]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getCR(client, id);
  return updateOne(client, "cash_request", "cash_request_id", id, fields, "*", null, { touch: "updated_at" });
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM cash_request " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertCR, getCR, insertLine, insertPayment, deleteLines, listLines, listPayments, update, list };
