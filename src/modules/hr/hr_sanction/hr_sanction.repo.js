/**
 * HR sanction repository (MOD-71). Disciplinary outcomes, optionally tied to the
 * query that triggered them. Standard CRUD + employee-name join + self-scoped
 * list + a "lift" state change.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const crud = makeRepo({ table: "hr_sanction", pk: "hr_sanction_id", activeColumn: null, orderBy: "effective_date DESC",
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
  if (q.employee_id) { params.push(q.employee_id); wh.push("hs.employee_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("hs.status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT hs.*, e.full_name AS employee_name
       FROM hr_sanction hs
       LEFT JOIN employee e ON e.employee_id = hs.employee_id
       ${where}
      ORDER BY hs.effective_date DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

async function lift(client, id) {
  const { rows } = await client.query(
    "UPDATE hr_sanction SET status = 'LIFTED', end_date = COALESCE(end_date, current_date) WHERE hr_sanction_id = $1 AND status = 'ACTIVE' RETURNING *",
    [id],
  );
  return rows[0] || null;
}

module.exports = { ...crud, list, lift };
