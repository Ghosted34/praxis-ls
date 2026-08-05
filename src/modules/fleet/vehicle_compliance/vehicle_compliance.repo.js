/**
 * Vehicle compliance repository (MOD-40). Insurance / visite-technique records
 * with expiry. Adds a by-vehicle listing and the expiring-soon scan that feeds
 * renewal alerts.
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "vehicle_compliance", data);
const findById = (client, id) => getById(client, "vehicle_compliance", "compliance_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findById(client, id);
  return updateOne(client, "vehicle_compliance", "compliance_id", id, fields, "*", null);
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
