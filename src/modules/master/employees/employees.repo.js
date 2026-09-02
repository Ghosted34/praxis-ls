/**
 * Employee master repository (MOD-02). All employee SQL lives here.
 * Backs the `employee` table (0300_masterdata.sql) and exposes the read shapes
 * the rest of Phase 3 consumes: the active roster (payroll), the driver pool
 * (fleet dispatch/incidents), and a cross-module reference count (delete guard).
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "employee", data);

/**
 * Single employee, joined to its corporate entity and to the login that belongs
 * to it.
 *
 * The account join is what makes the record answer "does this person have a way
 * in?" — the question the Provision-account affordance is built on. Before it,
 * the link existed only in the OTHER direction (a picker on the user form), so
 * an employee record could not say whether anyone had ever provisioned it and
 * HR had to go look on a different screen to find out.
 *
 * LEFT JOIN, and to at most one row: `app_user.employee_id` is not unique, and
 * a tenant that has linked two logins to one person must not make this read
 * return that person twice. The lateral takes the oldest, which is the one that
 * has been in use.
 */
async function get(client, id) {
  const { rows } = await client.query(
    `SELECT e.*, ce.legal_name AS entity_name, ce.code AS entity_code,
            m.full_name AS manager_name, m.job_title AS manager_job_title,
            u.user_id AS account_user_id, u.email AS account_email,
            u.username AS account_username, u.status AS account_status,
            u.last_login_at AS account_last_login_at
       FROM employee e
       LEFT JOIN corporate_entity ce ON ce.entity_id = e.entity_id
       LEFT JOIN employee m ON m.employee_id = e.reports_to
       LEFT JOIN LATERAL (
         SELECT au.user_id, au.email, au.username, au.status, au.last_login_at
           FROM app_user au
          WHERE au.employee_id = e.employee_id
          ORDER BY au.created_at ASC
          LIMIT 1
       ) u ON true
      WHERE e.employee_id = $1`,
    [id],
  );
  return rows[0] || null;
}

const getBare = (client, id) => getById(client, "employee", "employee_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getBare(client, id);
  return updateOne(client, "employee", "employee_id", id, fields, "*", null, { touch: "updated_at" });
}

/**
 * Filtered, paginated list.
 *
 * Filters: entity_id, scope_id/department, employment_type, is_driver, active,
 * status, has_account, q.
 *
 * `has_account` is the provisioning queue: "who has been hired and still has no
 * way to sign in". That list is the whole reason the account join is here —
 * legacy answered it with a bespoke `pending_users.php` endpoint, and the cost
 * of a bespoke endpoint is that the filter it implements is available nowhere
 * else. As a filter on the roster, the same question is one query parameter and
 * composes with every other one (this entity, this department, drivers only).
 */
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
  // Lifecycle (12763). Accepts a comma-separated set so the UI can ask for
  // "PENDING or ACTIVE" — the roster people actually work with — in one call.
  if (q.status) {
    const wanted = String(q.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (wanted.length) { params.push(wanted); wh.push("e.status = ANY($" + params.length + ")"); }
  }
  // The matricule is what HR quotes on the phone, so it searches alongside the
  // name — a roster you can only search by spelling is a roster you scroll.
  if (q.q) {
    params.push("%" + q.q + "%");
    const i = params.length;
    wh.push(`(e.full_name ILIKE $${i} OR e.job_title ILIKE $${i} OR e.cnps_number ILIKE $${i} OR e.staff_no ILIKE $${i} OR e.email ILIKE $${i})`);
  }
  // Applied AFTER the lateral, so it reads as a plain predicate on the joined
  // account rather than a correlated EXISTS repeated in two branches.
  const having = q.has_account === undefined
    ? ""
    : (q.has_account === "true" || q.has_account === true)
      ? "u.user_id IS NOT NULL"
      : "u.user_id IS NULL";
  if (having) wh.push(having);
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT e.*, ce.legal_name AS entity_name, ce.code AS entity_code,
            u.user_id AS account_user_id, u.email AS account_email,
            u.status AS account_status
       FROM employee e
       LEFT JOIN corporate_entity ce ON ce.entity_id = e.entity_id
       LEFT JOIN LATERAL (
         SELECT au.user_id, au.email, au.status
           FROM app_user au
          WHERE au.employee_id = e.employee_id
          ORDER BY au.created_at ASC
          LIMIT 1
       ) u ON true
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

/* ── The matricule (12763) ───────────────────────────────────────────────────
 * The contract assigns one — "Le matricule SLAS-137 lui est attribué" — so it
 * has to exist before the contract can be written, and it has to be stable
 * afterwards. It is allocated here, never typed: a number a human chooses is a
 * number two humans eventually choose.
 */

/** The prefix a corporate entity's staff numbers carry. `code` is already the
 *  entity's short form ('SLAS'), which is exactly what the matricule uses. */
async function staffNoPrefix(client, entityId) {
  if (!entityId) return "EMP";
  const { rows } = await client.query("SELECT code FROM corporate_entity WHERE entity_id = $1", [entityId]);
  const code = rows[0] && rows[0].code ? String(rows[0].code).trim().toUpperCase() : "";
  return code || "EMP";
}

/**
 * Allocate the next matricule for an entity.
 *
 * ONE statement. `INSERT … ON CONFLICT DO UPDATE … RETURNING` takes the row
 * lock and increments in the same round trip, so two clerks hiring at the same
 * moment get different numbers without either of them waiting on a table-wide
 * lock — which is what the legacy `SELECT MAX(employee_id) … FOR UPDATE` did,
 * for the length of a whole save including its file uploads.
 *
 * The stored `next_no` is the next FREE number, so the one just allocated is
 * `next_no - 1`. A fresh sequence therefore inserts 2 and hands out 1.
 *
 * The loop exists for the imported record: a tenant that has typed SLAS-003 by
 * hand before this ran would collide once, and the answer is to take the next
 * number rather than to fail the hire. Bounded, because an unbounded retry on a
 * unique violation is an outage waiting for a bad day.
 */
async function allocateStaffNo(client, { entity_id = null } = {}) {
  const key = entity_id ? String(entity_id) : "*";
  const prefix = await staffNoPrefix(client, entity_id);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { rows } = await client.query(
      `INSERT INTO employee_number_sequence (sequence_key, prefix, next_no)
            VALUES ($1, $2, 2)
       ON CONFLICT (sequence_key) DO UPDATE
          SET next_no = employee_number_sequence.next_no + 1,
              prefix = EXCLUDED.prefix,
              updated_at = now()
       RETURNING prefix, next_no`,
      [key, prefix],
    );
    const n = rows[0].next_no - 1;
    const candidate = `${rows[0].prefix}-${String(n).padStart(3, "0")}`;
    const { rows: clash } = await client.query(
      "SELECT 1 FROM employee WHERE staff_no = $1 LIMIT 1",
      [candidate],
    );
    if (!clash.length) return candidate;
  }
  // 25 consecutive numbers already taken by hand is not a race, it is a data
  // problem, and silently inventing a number outside the series would hide it.
  return null;
}

/* ── Staff file (12764) ─────────────────────────────────────────────────────*/

/** The EMPLOYEE document registry — what the wizard offers and the checklist reads. */
async function documentTypes(client) {
  const { rows } = await client.query(
    `SELECT document_type_id, code, name, requires_expiry, requires_issuing_authority, default_severity
       FROM party_document_type
      WHERE applies_to = 'EMPLOYEE' AND is_active = true
      ORDER BY name ASC`,
  );
  return rows;
}

const documentTypeByCode = async (client, code) => {
  const { rows } = await client.query(
    "SELECT document_type_id FROM party_document_type WHERE code = $1 LIMIT 1",
    [code],
  );
  return rows[0] ? rows[0].document_type_id : null;
};

async function listDocuments(client, employeeId) {
  const { rows } = await client.query(
    `SELECT d.*, t.code AS document_type_code, t.name AS document_type_name,
            t.requires_expiry,
            v.storage_path IS NOT NULL AS has_file, v.original_name
       FROM employee_document d
       LEFT JOIN party_document_type t ON t.document_type_id = d.document_type_id
       LEFT JOIN document_vault v ON v.doc_id = d.vault_id
      WHERE d.employee_id = $1 AND d.is_active = true
      ORDER BY t.name NULLS LAST, d.created_at DESC`,
    [employeeId],
  );
  return rows;
}

const insertDocument = (client, data) => insertOne(client, "employee_document", data);
const getDocument = (client, id) => getById(client, "employee_document", "document_id", id);
const updateDocument = (client, id, fields) =>
  updateOne(client, "employee_document", "document_id", id, fields, "*", null, { touch: "updated_at" });

/** Soft-delete. A staff file is evidence: the row stops showing, it does not vanish. */
const archiveDocument = (client, id) =>
  updateOne(client, "employee_document", "document_id", id, { is_active: false }, "*", null, { touch: "updated_at" });

/* ── Standing pay lines (12765) ─────────────────────────────────────────────*/

/**
 * Live allowances. `on` defaults to today, so the ordinary read is "what is this
 * person entitled to now" — the figure a contract prints and payroll adds. Pass
 * a date to ask the same question about a month that has already been paid.
 */
async function listAllowances(client, employeeId, { on = null } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM employee_allowance
      WHERE employee_id = $1
        AND (effective_on IS NULL OR effective_on <= COALESCE($2::date, CURRENT_DATE))
        AND (ends_on      IS NULL OR ends_on      >= COALESCE($2::date, CURRENT_DATE))
      ORDER BY kind ASC, label ASC`,
    [employeeId, on],
  );
  return rows;
}

/** Every line ever recorded, live or lapsed — the audit view on the pay history. */
async function listAllAllowances(client, employeeId) {
  const { rows } = await client.query(
    "SELECT * FROM employee_allowance WHERE employee_id = $1 ORDER BY effective_on DESC NULLS LAST, label ASC",
    [employeeId],
  );
  return rows;
}

const insertAllowance = (client, data) => insertOne(client, "employee_allowance", data);
const getAllowance = (client, id) => getById(client, "employee_allowance", "employee_allowance_id", id);
const updateAllowance = (client, id, fields) =>
  updateOne(client, "employee_allowance", "employee_allowance_id", id, fields, "*", null, { touch: "updated_at" });
const deleteAllowance = async (client, id) => {
  await client.query("DELETE FROM employee_allowance WHERE employee_allowance_id = $1", [id]);
};

/* ── The login (0100 app_user) ──────────────────────────────────────────────*/

/**
 * The account(s) linked to this employee. Plural because `app_user.employee_id`
 * carries no unique constraint — reporting one and hiding a second would make
 * the screen lie about who can sign in as this person.
 */
async function accountsFor(client, employeeId) {
  const { rows } = await client.query(
    `SELECT user_id, email, username, full_name, status, last_login_at, created_at
       FROM app_user
      WHERE employee_id = $1
      ORDER BY created_at ASC`,
    [employeeId],
  );
  return rows;
}

module.exports = {
  insert, get, getBare, update, list, roster, drivers, countReferences,
  directReports, teamOf, managerChain, wouldCycle,
  allocateStaffNo, staffNoPrefix,
  documentTypes, documentTypeByCode, listDocuments, insertDocument, getDocument,
  updateDocument, archiveDocument,
  listAllowances, listAllAllowances, insertAllowance, getAllowance, updateAllowance, deleteAllowance,
  accountsFor,
};
