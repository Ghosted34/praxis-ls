/**
 * HR-contract repository (MOD-12). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee/status/kind).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "hr_contract", pk: "hr_contract_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.employee_id) { params.push(q.employee_id); wh.push("hc.employee_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("hc.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("hc.kind = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT hc.*, e.full_name AS employee_name
         FROM hr_contract hc
         LEFT JOIN employee e ON e.employee_id = hc.employee_id
         ${where}
        ORDER BY hc.effective_on DESC NULLS LAST, hc.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
