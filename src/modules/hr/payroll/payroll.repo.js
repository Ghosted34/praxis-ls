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
/** One run item, but only when it belongs to this employee (self-service
 *  payslip download — ownership enforced here, not in the handler). */
async function itemBelongsToEmployee(client, runItemId, employeeId) {
  const { rows } = await client.query(
    `SELECT pri.payroll_run_item_id, pri.gross, pri.net_pay,
            pr.period_code, pr.status
       FROM payroll_run_item pri
       JOIN payroll_run pr ON pr.payroll_run_id = pri.payroll_run_id
      WHERE pri.payroll_run_item_id = $1 AND pri.employee_id = $2
        AND pr.status IN ('APPROVED','VALIDATED','DISBURSED')`,
    [runItemId, employeeId],
  );
  return rows[0] || null;
}

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

/**
 * What the month actually did to each employee's pay (0697/0698).
 *
 * ── WHY THIS IS ONE QUERY AND NOT THREE ───────────────────────────────────
 *
 * All three figures come off the same reconciled rows, and computing them apart
 * would let them disagree: the unpaid-leave amount is the sum of the DAILY RATE
 * on those days, which is the rate frozen at reconciliation — the same rate the
 * lateness on the day before was charged at. Recomputing it here from today's
 * salary would price a January absence at a June salary.
 *
 * `justified` days are excluded from the deduction and from nothing else: a
 * waived lateness still happened, and the count is what a manager reviews.
 *
 * The period is a month code ('2026-08'); the window is the calendar month,
 * which is what `payroll_run.period_code` has always meant.
 */
async function attendanceInputs(client, periodCode) {
  const { rows } = await client.query(
    `WITH period_window AS (
       SELECT (to_date($1, 'YYYY-MM'))::date AS from_date,
              (to_date($1, 'YYYY-MM') + interval '1 month - 1 day')::date AS to_date
     )
     SELECT d.employee_id,
            -- Off GROSS: time not worked and not earned.
            coalesce(sum(d.deduction_amount) FILTER (WHERE NOT d.justified), 0)::numeric(18,2) AS attendance_deduction,
            -- Also off gross, and priced at the rate frozen on the day.
            coalesce(sum(d.daily_rate) FILTER (WHERE d.status = 'ON_LEAVE' AND lt.is_paid = false), 0)::numeric(18,2) AS unpaid_leave_deduction,
            count(*) FILTER (WHERE d.status = 'LATE' AND NOT d.justified)::int AS late_days,
            count(*) FILTER (WHERE d.status = 'ABSENT' AND NOT d.justified)::int AS absent_days,
            count(*) FILTER (WHERE d.status = 'ON_LEAVE' AND lt.is_paid = false)::int AS unpaid_leave_days,
            count(*) FILTER (WHERE d.justified)::int AS waived_days
       FROM attendance_day d
       CROSS JOIN period_window w
       LEFT JOIN leave_request lr ON lr.leave_request_id = d.leave_request_id
       LEFT JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
      WHERE d.work_date BETWEEN w.from_date AND w.to_date
      GROUP BY d.employee_id`,
    [periodCode],
  );
  const byEmployee = {};
  for (const r of rows) byEmployee[r.employee_id] = r;
  return byEmployee;
}

/** Has this period been reconciled at all? A payslip computed over a month with
 *  no reconciled days is not "nobody was late" — it is "nobody looked", and the
 *  run says so rather than implying the first. */
async function periodReconciled(client, periodCode) {
  const { rows } = await client.query(
    `SELECT 1 FROM attendance_day
      WHERE work_date BETWEEN (to_date($1, 'YYYY-MM'))::date
                          AND (to_date($1, 'YYYY-MM') + interval '1 month - 1 day')::date
      LIMIT 1`,
    [periodCode],
  );
  return !!rows[0];
}

module.exports = { createRun, findRun, runByPeriod, updateRun, listRuns, deleteItems, insertItem, listItems, payslipsForEmployee, itemBelongsToEmployee, attendanceInputs, periodReconciled };
