/**
 * Driver licence repository (MOD-44). Licences per employee with expiry. Adds an
 * employee join, by-employee filter and the expiring-soon scan that feeds renewal
 * alerts (mirrors vehicle_compliance).
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "driver_license", data);
const findById = (client, id) => getById(client, "driver_license", "driver_license_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE driver_license SET " + set + " WHERE driver_license_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.employee_id) { params.push(q.employee_id); wh.push("dl.employee_id = $" + params.length); }
  if (q.license_class) { params.push(q.license_class); wh.push("dl.license_class = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT dl.*, e.full_name AS driver_name
       FROM driver_license dl
       LEFT JOIN employee e ON e.employee_id = dl.employee_id
       ${where}
      ORDER BY dl.expires_on ASC NULLS LAST
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Licences expiring within `days` (or already lapsed), soonest first. */
async function expiringWithin(client, days = 30) {
  const { rows } = await client.query(
    `SELECT dl.*, e.full_name AS driver_name,
            (dl.expires_on - CURRENT_DATE) AS days_left
       FROM driver_license dl
       LEFT JOIN employee e ON e.employee_id = dl.employee_id
      WHERE dl.expires_on IS NOT NULL
        AND dl.expires_on <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY dl.expires_on ASC`,
    [String(days)],
  );
  return rows;
}

module.exports = { insert, findById, update, list, expiringWithin };
