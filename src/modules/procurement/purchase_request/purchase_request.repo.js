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
/**
 * `scopeIds` is the caller's scope closure (their organigramme nodes plus
 * everything beneath), or null when they have no assignment at all — in which
 * case they are unrestricted, as before. Record-level scope (audit finding A2);
 * this list is hand-written rather than makeRepo's, so it applies the same rule
 * itself.
 *
 * A request with a NULL scope stays visible to everyone: most records predate
 * the organigramme, and hiding them would empty a scoped user's list.
 */
async function listPR(client, q = {}, scopeIds = null) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (scopeIds) {
    params.push(scopeIds);
    wh.push(`(scope_id IS NULL OR scope_id = ANY($${params.length}::uuid[]))`);
  }
  const { rows } = await client.query(
    "SELECT *, doc_number AS ref FROM purchase_request WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params,
  );
  return rows;
}
module.exports = { insertPR, getPR, setStatus, setDocNumber, listPR, insertLine, listLines };
