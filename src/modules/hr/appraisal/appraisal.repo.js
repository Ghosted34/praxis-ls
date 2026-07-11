/**
 * Appraisal repository (MOD-13). Performance ratings against KPI targets. Joins
 * the linked kpi_target so the service can compute attainment, and filters by
 * employee/period.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "appraisal", data);
const findById = (client, id) => getById(client, "appraisal", "appraisal_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE appraisal SET " + set + " WHERE appraisal_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.employee_id) { params.push(q.employee_id); wh.push("a.employee_id = $" + params.length); }
  if (q.period_code) { params.push(q.period_code); wh.push("a.period_code = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT a.*, e.full_name AS employee_name, kt.metric, kt.target_value, kt.weight
       FROM appraisal a
       LEFT JOIN employee e ON e.employee_id = a.employee_id
       LEFT JOIN kpi_target kt ON kt.kpi_target_id = a.kpi_target_id
       ${where}
      ORDER BY a.period_code DESC, e.full_name
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** The KPI target a rating is measured against (target_value + weight). */
async function getTarget(client, kpiTargetId) {
  return getById(client, "kpi_target", "kpi_target_id", kpiTargetId);
}

module.exports = { insert, findById, update, list, getTarget };
