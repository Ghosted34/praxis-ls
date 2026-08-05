/**
 * HR query repository (MOD-71). Disciplinary queries issued to an employee, which
 * the employee can respond to. Standard CRUD via the kit + an employee-name join
 * for the admin list, a self-scoped list, and a guarded self-response update.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const crud = makeRepo({ table: "hr_query", pk: "hr_query_id", activeColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.employee_id) { params.push(q.employee_id); wh.push("hq.employee_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("hq.status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT hq.*, e.full_name AS employee_name
       FROM hr_query hq
       LEFT JOIN employee e ON e.employee_id = hq.employee_id
       ${where}
      ORDER BY hq.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** The employee answers their own OPEN query. Guarded by employee_id so a user
 *  can never respond to someone else's. Returns null if not theirs/not OPEN. */
async function respond(client, id, employeeId, response) {
  const { rows } = await client.query(
    `UPDATE hr_query
        SET response = $3, status = 'RESPONDED', responded_at = now()
      WHERE hr_query_id = $1 AND employee_id = $2 AND status = 'OPEN'
      RETURNING *`,
    [id, employeeId, response],
  );
  return rows[0] || null;
}

module.exports = { ...crud, list, respond };
