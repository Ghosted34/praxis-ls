/**
 * Cycle count repository (MOD-38). Stock audits per location. Joins the location
 * for context and filters by location.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "cycle_count", data);
const findById = (client, id) => getById(client, "cycle_count", "cycle_count_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE cycle_count SET " + set + " WHERE cycle_count_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.location_id) { params.push(q.location_id); wh.push("cc.location_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT cc.*, wl.zone, wl.aisle, wl.rack, wl.bin
       FROM cycle_count cc
       LEFT JOIN warehouse_location wl ON wl.location_id = cc.location_id
       ${where}
      ORDER BY cc.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insert, findById, update, list };
