/**
 * Talent pool repository (MOD-19). Candidate bench (optionally linked to a job
 * applicant). Adds skill/name search over the pool.
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "talent_pool", data);
const findById = (client, id) => getById(client, "talent_pool", "talent_pool_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findById(client, id);
  return updateOne(client, "talent_pool", "talent_pool_id", id, fields, "*", null);
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
