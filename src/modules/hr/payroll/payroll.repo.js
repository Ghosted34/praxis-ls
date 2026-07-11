/**
 * Payroll repository (MOD-17). Runs (per entity+period) and their per-employee
 * items. All payroll SQL lives here.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const createRun = (client, data) => insertOne(client, "payroll_run", data);
const findRun = (client, id) => getById(client, "payroll_run", "payroll_run_id", id);

async function runByPeriod(client, entityId, periodCode) {
  const { rows } = await client.query(
    "SELECT * FROM payroll_run WHERE entity_id = $1 AND period_code = $2",
    [entityId, periodCode],
  );
  return rows[0] || null;
}

async function updateRun(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findRun(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE payroll_run SET " + set + ", updated_at = now() WHERE payroll_run_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function listRuns(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM payroll_run ${where} ORDER BY period_code DESC, created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

const deleteItems = (client, runId) =>
  client.query("DELETE FROM payroll_run_item WHERE payroll_run_id = $1", [runId]);

const insertItem = (client, item) => insertOne(client, "payroll_run_item", item);

async function listItems(client, runId) {
  const { rows } = await client.query(
    `SELECT pri.*, e.full_name AS employee_name
       FROM payroll_run_item pri
       LEFT JOIN employee e ON e.employee_id = pri.employee_id
      WHERE pri.payroll_run_id = $1
      ORDER BY e.full_name`,
    [runId],
  );
  return rows;
}

module.exports = { createRun, findRun, runByPeriod, updateRun, listRuns, deleteItems, insertItem, listItems };
