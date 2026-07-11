/**
 * Talent pool repository (MOD-19). Candidate bench (optionally linked to a job
 * applicant). Adds skill/name search over the pool.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "talent_pool", data);
const findById = (client, id) => getById(client, "talent_pool", "talent_pool_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE talent_pool SET " + set + " WHERE talent_pool_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(full_name ILIKE $" + params.length + " OR skills ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM talent_pool ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insert, findById, update, list };
