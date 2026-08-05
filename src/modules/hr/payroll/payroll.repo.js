/**
 * Payroll repository (MOD-17). Runs (per entity+period) and their per-employee
 * items. All payroll SQL lives here.
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

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
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findRun(client, id);
  return updateOne(client, "payroll_run", "payroll_run_id", id, fields, "*", null, { touch: "updated_at" });
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
    `SELECT pri.*, e.full_name AS employee_name, e.cnps_number AS cnps_number
       FROM payroll_run_item pri
       LEFT JOIN employee e ON e.employee_id = pri.employee_id
      WHERE pri.payroll_run_id = $1
      ORDER BY e.full_name`,
    [runId],
  );
  return rows;
}

/** An employee's own payslips across runs (My HR). Only DISBURSED/APPROVED runs
 *  are the employee's real pay history; drafts are excluded. */
async function payslipsForEmployee(client, employeeId) {
  const { rows } = await client.query(
    `SELECT pri.payroll_run_item_id, pri.gross, pri.net_pay,
            pr.period_code, pr.status
       FROM payroll_run_item pri
       JOIN payroll_run pr ON pr.payroll_run_id = pri.payroll_run_id
      WHERE pri.employee_id = $1 AND pr.status IN ('APPROVED','VALIDATED','DISBURSED')
      ORDER BY pr.period_code DESC`,
    [employeeId],
  );
  return rows;
}

module.exports = { createRun, findRun, runByPeriod, updateRun, listRuns, deleteItems, insertItem, listItems, payslipsForEmployee };
