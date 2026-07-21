/**
 * Employee master repository (MOD-02). All employee SQL lives here.
 * Backs the `employee` table (0300_masterdata.sql) and exposes the read shapes
 * the rest of Phase 3 consumes: the active roster (payroll), the driver pool
 * (fleet dispatch/incidents), and a cross-module reference count (delete guard).
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "employee", data);

/** Single employee joined to its corporate entity name. */
async function get(client, id) {
  const { rows } = await client.query(
    `SELECT e.*, ce.legal_name AS entity_name
       FROM employee e
       LEFT JOIN corporate_entity ce ON ce.entity_id = e.entity_id
      WHERE e.employee_id = $1`,
    [id],
  );
  return rows[0] || null;
}

const getBare = (client, id) => getById(client, "employee", "employee_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getBare(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE employee SET " + set + ", updated_at = now() WHERE employee_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

/** Filtered, paginated list. Filters: entity_id, department, employment_type, is_driver, active, q. */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("e.entity_id = $" + params.length); }
  if (q.department) { params.push(q.department); wh.push("e.department = $" + params.length); }
  if (q.employment_type) { params.push(q.employment_type); wh.push("e.employment_type = $" + params.length); }
  if (q.is_driver !== undefined) { params.push(q.is_driver === "true" || q.is_driver === true); wh.push("e.is_driver = $" + params.length); }
  if (q.active !== undefined) { params.push(q.active === "true" || q.active === true); wh.push("e.is_active = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(e.full_name ILIKE $" + params.length + " OR e.job_title ILIKE $" + params.length + " OR e.cnps_number ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT e.*, ce.legal_name AS entity_name
       FROM employee e
       LEFT JOIN corporate_entity ce ON ce.entity_id = e.entity_id
       ${where}
      ORDER BY e.is_active DESC, e.full_name ASC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Active-employee roster for payroll — minimal computed-payroll inputs. */
async function roster(client, { entity_id } = {}) {
  const params = [];
  let where = "WHERE e.is_active = true";
  if (entity_id) { params.push(entity_id); where += " AND e.entity_id = $" + params.length; }
  const { rows } = await client.query(
    `SELECT e.employee_id, e.entity_id, e.full_name, e.department, e.job_title,
            e.employment_type, e.cnps_number, e.base_salary, e.risk_class_rate,
            e.bank_block, e.is_driver
       FROM employee e ${where}
      ORDER BY e.full_name ASC`,
    params,
  );
  return rows;
}

/** Active drivers — consumed by fleet dispatch / incident assignment. */
async function drivers(client, { entity_id } = {}) {
  const params = [];
  let where = "WHERE e.is_active = true AND e.is_driver = true";
  if (entity_id) { params.push(entity_id); where += " AND e.entity_id = $" + params.length; }
  const { rows } = await client.query(
    `SELECT e.employee_id, e.entity_id, e.full_name, e.department, e.job_title
       FROM employee e ${where}
      ORDER BY e.full_name ASC`,
    params,
  );
  return rows;
}

/**
 * Count references to an employee across the modules that FK to it. Drives the
 * delete guard (never orphan payroll/contract/attendance history). Each entry is
 * best-effort: a table that doesn't exist yet is skipped, not fatal.
 */
const REFERENCING = [
  ["app_user", "employee_id", "user account"],
  ["hr_contract", "employee_id", "contracts"],
  ["payroll_run_item", "employee_id", "payroll lines"],
  ["leave_request", "employee_id", "leave requests"],
  ["attendance_log", "employee_id", "attendance logs"],
  ["appraisal", "employee_id", "appraisals"],
  ["kpi_target", "employee_id", "KPI targets"],
  ["onboarding_checklist", "employee_id", "onboarding checklists"],
  ["training_attendance", "employee_id", "training records"],
  ["succession_plan", "incumbent_id", "succession (incumbent)"],
  ["succession_plan", "successor_id", "succession (successor)"],
  ["driver_license", "employee_id", "driver licences"],
  ["fleet_dispatch", "driver_employee_id", "dispatch assignments"],
  ["fleet_incident", "driver_employee_id", "incidents"],
];

async function countReferences(client, id) {
  const breakdown = {};
  let total = 0;
  for (const [table, col, label] of REFERENCING) {
    try {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`,
        [id],
      );
      const n = rows[0] ? rows[0].n : 0;
      if (n > 0) { breakdown[label] = (breakdown[label] || 0) + n; total += n; }
    } catch (err) {
      if (err && err.code === "42P01") continue; // undefined_table — module not migrated yet
      throw err;
    }
  }
  return { total, breakdown };
}

module.exports = { insert, get, getBare, update, list, roster, drivers, countReferences };
