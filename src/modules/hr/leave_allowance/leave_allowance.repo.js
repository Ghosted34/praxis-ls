/**
 * Leave/allowance repository (MOD-15). Factory base + a bespoke joined/filtered
 * list (employee name, filter by employee/status/kind).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "leave_request", pk: "leave_request_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("lr.employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("lr.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("lr.kind = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT lr.*, e.full_name AS employee_name
         FROM leave_request lr
         LEFT JOIN employee e ON e.employee_id = lr.employee_id
         ${where}
        ORDER BY lr.starts_on DESC NULLS LAST, lr.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
