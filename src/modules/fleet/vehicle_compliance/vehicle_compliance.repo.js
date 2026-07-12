/**
 * Vehicle compliance repository (MOD-40). Insurance / visite-technique records
 * with expiry. Adds a by-vehicle listing and the expiring-soon scan that feeds
 * renewal alerts.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "vehicle_compliance", data);
const findById = (client, id) => getById(client, "vehicle_compliance", "compliance_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE vehicle_compliance SET " + set + " WHERE compliance_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.vehicle_id) { params.push(q.vehicle_id); wh.push("vc.vehicle_id = $" + params.length); }
  if (q.kind) { params.push(q.kind); wh.push("vc.kind = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT vc.*, v.registration
       FROM vehicle_compliance vc
       LEFT JOIN vehicle v ON v.vehicle_id = vc.vehicle_id
       ${where}
      ORDER BY vc.expires_on ASC NULLS LAST
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Records expiring within `days` (or already lapsed), soonest first. */
async function expiringWithin(client, days = 30) {
  const { rows } = await client.query(
    `SELECT vc.*, v.registration, v.entity_id,
            (vc.expires_on - CURRENT_DATE) AS days_left
       FROM vehicle_compliance vc
       LEFT JOIN vehicle v ON v.vehicle_id = vc.vehicle_id
      WHERE vc.expires_on IS NOT NULL
        AND vc.expires_on <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY vc.expires_on ASC`,
    [String(days)],
  );
  return rows;
}

module.exports = { insert, findById, update, list, expiringWithin };
