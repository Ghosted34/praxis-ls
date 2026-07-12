/**
 * Attendance repository (MOD-14). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee, open shifts, or date).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "attendance_log", pk: "attendance_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("al.employee_id = $" + params.length); }
    if (q.open === "true" || q.open === true) wh.push("al.clock_out_at IS NULL");
    if (q.date) { params.push(q.date); wh.push("al.clock_in_at::date = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         ${where}
        ORDER BY al.clock_in_at DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
