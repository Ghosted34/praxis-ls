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
  // Prefer the scope reference (0490). `department` matching stays for callers
  // that only have the text — but case- and whitespace-insensitively now, since
  // exact equality made "Operations", "operations" and " Operations" three
  // different departments and quietly returned an empty list for two of them.
  if (q.scope_id) { params.push(q.scope_id); wh.push("e.scope_id = $" + params.length); }
  else if (q.department) {
    params.push(q.department);
    wh.push(`lower(btrim(e.department)) = lower(btrim($${params.length}))`);
  }
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

/**
 * Direct reports — one level down the reporting line (0493).
 */
async function directReports(client, managerId) {
  const { rows } = await client.query(
    `SELECT employee_id, full_name, job_title, department, scope_id, is_active
       FROM employee
      WHERE reports_to = $1
      ORDER BY full_name ASC`,
    [managerId],
  );
  return rows;
}

/**
 * The whole team beneath a manager — direct reports and theirs, recursively.
 *
 * This is what `role.is_line_manager` ("approves for own team",
 * 9020_seed_rbac_events.sql:10) has always needed and never had. Depth-capped
 * and `UNION` (not UNION ALL) so a malformed tree can't spin a request: the
 * service prevents cycles on write, but data predating that guard may exist.
 *
 * Excludes the manager themselves — "my team" is the people under me.
 */
async function teamOf(client, managerId, { includeInactive = false } = {}) {
  const { rows } = await client.query(
    `WITH RECURSIVE team AS (
       SELECT employee_id, full_name, job_title, department, scope_id, is_active, reports_to, 1 AS depth
         FROM employee WHERE reports_to = $1
       UNION
       SELECT e.employee_id, e.full_name, e.job_title, e.department, e.scope_id, e.is_active, e.reports_to, team.depth + 1
         FROM employee e JOIN team ON e.reports_to = team.employee_id
        WHERE team.depth < 32
     )
     SELECT * FROM team ${includeInactive ? "" : "WHERE is_active = true"}
      ORDER BY depth ASC, full_name ASC`,
    [managerId],
  );
  return rows;
}

/**
 * Walk UP from `employeeId` — the chain of managers above them.
 *
 * The escalation path (audit W13): "this approval has gone stale, send it to
 * their manager" reads the first entry. Ordered nearest-first.
 */
async function managerChain(client, employeeId) {
  const { rows } = await client.query(
    `WITH RECURSIVE up AS (
       SELECT e.employee_id, e.full_name, e.job_title, e.reports_to, 1 AS depth
         FROM employee e
        WHERE e.employee_id = (SELECT reports_to FROM employee WHERE employee_id = $1)
       UNION
       SELECT m.employee_id, m.full_name, m.job_title, m.reports_to, up.depth + 1
         FROM employee m JOIN up ON m.employee_id = up.reports_to
        WHERE up.depth < 32
     )
     SELECT employee_id, full_name, job_title, depth FROM up ORDER BY depth ASC`,
    [employeeId],
  );
  return rows;
}

/** Would setting `employeeId`'s manager to `managerId` close a loop? */
async function wouldCycle(client, employeeId, managerId) {
  if (!managerId || !employeeId) return false;
  if (managerId === employeeId) return true;
  const { rows } = await client.query(
    `WITH RECURSIVE up AS (
       SELECT employee_id, reports_to, 0 AS depth FROM employee WHERE employee_id = $1
       UNION
       SELECT e.employee_id, e.reports_to, up.depth + 1
         FROM employee e JOIN up ON e.employee_id = up.reports_to
        WHERE up.depth < 32
     )
     SELECT 1 FROM up WHERE employee_id = $2 LIMIT 1`,
    [managerId, employeeId],
  );
  return rows.length > 0;
}

module.exports = {
  insert, get, getBare, update, list, roster, drivers, countReferences,
  directReports, teamOf, managerChain, wouldCycle,
};
