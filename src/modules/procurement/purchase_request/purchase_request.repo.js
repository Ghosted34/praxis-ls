/** Purchase-request repository (MOD-62). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertPR = (client, data) => insertOne(client, "purchase_request", data);
const getPR = (client, id) => getById(client, "purchase_request", "pr_id", id);
const insertLine = (client, data) => insertOne(client, "purchase_request_line", data);
const listLines = async (client, prId) =>
  (await client.query("SELECT * FROM purchase_request_line WHERE pr_id = $1 ORDER BY purchase_request_line_id", [prId])).rows;

async function setStatus(client, id, status) {
  const { rows } = await client.query("UPDATE purchase_request SET status = $2 WHERE pr_id = $1 RETURNING *", [id, status]);
  return rows[0] || null;
}
async function setDocNumber(client, id, docNumber) {
  const { rows } = await client.query("UPDATE purchase_request SET doc_number = $2 WHERE pr_id = $1 RETURNING *", [id, docNumber]);
  return rows[0] || null;
}
async function listPR(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const { rows } = await client.query(
    "SELECT *, doc_number AS ref FROM purchase_request WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params,
  );
  return rows;
}
module.exports = { insertPR, getPR, setStatus, setDocNumber, listPR, insertLine, listLines };
