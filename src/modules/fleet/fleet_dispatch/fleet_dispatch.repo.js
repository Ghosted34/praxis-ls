/**
 * Fleet-dispatch repository (MOD-42). Factory base + a bespoke joined/filtered
 * list (vehicle registration + driver name, filter by status/vehicle/driver).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "fleet_dispatch", pk: "fleet_dispatch_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.vehicle_id) { params.push(q.vehicle_id); wh.push("fd.vehicle_id = $" + params.length); }
    if (q.driver_employee_id) { params.push(q.driver_employee_id); wh.push("fd.driver_employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("fd.status = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT fd.*, v.registration, e.full_name AS driver_name
         FROM fleet_dispatch fd
         LEFT JOIN vehicle v ON v.vehicle_id = fd.vehicle_id
         LEFT JOIN employee e ON e.employee_id = fd.driver_employee_id
         ${where}
        ORDER BY fd.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
