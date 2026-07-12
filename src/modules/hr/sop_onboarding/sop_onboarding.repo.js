/**
 * SOP repository (MOD-16). Standard-operating-procedure documents with
 * versioning. Adds category/active filtering and a supersede helper (new version
 * deactivates the prior one).
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "sop_document", data);
const findById = (client, id) => getById(client, "sop_document", "sop_document_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE sop_document SET " + set + " WHERE sop_document_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.category) { params.push(q.category); wh.push("category = $" + params.length); }
  if (q.active !== undefined) { params.push(q.active === "true" || q.active === true); wh.push("is_active = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("title ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM sop_document ${where} ORDER BY title, version_no DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insert, findById, update, list };
