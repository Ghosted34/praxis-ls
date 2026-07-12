/**
 * Fuel log repository (MOD-43). Fuel fills per vehicle, optionally tagged to a
 * dossier for cost attribution. Adds by-vehicle/dossier listing, the last
 * odometer reading (monotonic guard) and a consumption summary.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "fuel_log", data);
const findById = (client, id) => getById(client, "fuel_log", "fuel_log_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE fuel_log SET " + set + " WHERE fuel_log_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.vehicle_id) { params.push(q.vehicle_id); wh.push("f.vehicle_id = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("f.dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT f.*, v.registration
       FROM fuel_log f
       LEFT JOIN vehicle v ON v.vehicle_id = f.vehicle_id
       ${where}
      ORDER BY f.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Highest odometer recorded for a vehicle (monotonic guard). */
async function lastOdometer(client, vehicleId) {
  const { rows } = await client.query(
    "SELECT max(odometer) AS odo FROM fuel_log WHERE vehicle_id = $1",
    [vehicleId],
  );
  return rows[0] && rows[0].odo !== null ? Number(rows[0].odo) : null;
}

/** Totals for a vehicle: litres, cost, distance span. */
async function summary(client, vehicleId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS fills,
            coalesce(sum(litres),0) AS total_litres,
            coalesce(sum(cost),0)   AS total_cost,
            max(odometer) - min(odometer) AS distance
       FROM fuel_log WHERE vehicle_id = $1`,
    [vehicleId],
  );
  return rows[0];
}

module.exports = { insert, findById, update, list, lastOdometer, summary };
