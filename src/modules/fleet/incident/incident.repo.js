/**
 * Fleet-incident repository (MOD-45). Factory base + a bespoke joined/filtered
 * list (vehicle + driver, filter by status/severity/vehicle/driver).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "fleet_incident", pk: "fleet_incident_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.vehicle_id) { params.push(q.vehicle_id); wh.push("fi.vehicle_id = $" + params.length); }
    if (q.driver_employee_id) { params.push(q.driver_employee_id); wh.push("fi.driver_employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("fi.status = $" + params.length); }
    if (q.severity) { params.push(q.severity); wh.push("fi.severity = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT fi.*, v.registration, e.full_name AS driver_name
         FROM fleet_incident fi
         LEFT JOIN vehicle v ON v.vehicle_id = fi.vehicle_id
         LEFT JOIN employee e ON e.employee_id = fi.driver_employee_id
         ${where}
        ORDER BY fi.occurred_at DESC NULLS LAST, fi.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
