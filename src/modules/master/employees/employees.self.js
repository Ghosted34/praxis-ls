/**
 * SELF-SERVICE on one's own employee record — PURE except for the two queries.
 *
 * WHAT THIS IS FOR. A person's signature carries their desk and mobile number.
 * Those now live on the employee record (`12759`), which is MOD-02 data — and
 * MOD-02 is all-or-nothing: `requirePermission('MOD-02','view')` opens the whole
 * roster, salaries and bank blocks included. Handing every member of staff that
 * grant so they can correct their own phone number would be an enormous
 * over-grant to solve a small problem.
 *
 * So this is the narrow path: the caller's OWN row, an explicit allow-list of
 * fields, and no id parameter anywhere. It follows the pattern attendance
 * already set with its `/mine` endpoints — "an employee is always entitled to
 * see what was recorded about them" — and takes no grant for the same reason.
 *
 * THE SELF LOCK. `employee_id` is resolved from the session's user id, never
 * from the request. There is no parameter to tamper with, no id to enumerate,
 * and a user whose account is not linked to an employee gets `null` rather than
 * an unscoped read. That is the same lock `attendance.mapLayer` describes, in
 * the same words, for the same reason.
 *
 * WHAT IS NOT EDITABLE HERE. Everything else. Name, job title, department,
 * salary, bank block, employment type, reporting line — all of it stays MOD-02,
 * because those are the fields the company asserts about a person, not the ones
 * the person asserts about themselves. A staff member who could edit their own
 * job title could put "Director" in the signature on every email they send.
 */
"use strict";

const service = require("./employees.service");
const { AppError } = require("../../../utils/errors");

/**
 * The fields a person may change on their own record.
 *
 * Deliberately tiny, and deliberately a list rather than a denylist: a denylist
 * silently grants every column added later, which is how `base_salary` ends up
 * self-editable the day someone adds a column next to it.
 */
const EDITABLE = ["phone_desk", "phone_mobile"];

/**
 * The fields a person may READ about themselves here. A superset of EDITABLE —
 * the signature screen shows the derived values (name, title) so a person can
 * see WHY their signature says what it says — but far short of the row: no
 * salary, no bank block, no risk class.
 */
const READABLE = [
  "employee_id", "full_name", "job_title", "department",
  "email", "phone_desk", "phone_mobile", "entity_id", "is_active",
];

/** The linked employee id, from the SESSION. Never from the request. */
async function employeeIdForUser(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query(
    "SELECT employee_id FROM app_user WHERE user_id = $1",
    [userId],
  );
  return (rows[0] && rows[0].employee_id) || null;
}

function project(row) {
  if (!row) return null;
  const out = {};
  for (const k of READABLE) out[k] = row[k] === undefined ? null : row[k];
  return out;
}

/**
 * The caller's own record, projected.
 *
 * An unlinked account is not an error: plenty of users (a system account, an
 * external auditor) have no employee row, and the screen that calls this needs
 * to say "your account is not linked to a staff record" rather than show a 404
 * that reads as a bug.
 */
async function getMine(client, { actor = {} } = {}) {
  const employeeId = await employeeIdForUser(client, actor.user_id);
  if (!employeeId) return { linked: false, employee: null };
  const row = await service.get(client, employeeId);
  if (!row) return { linked: false, employee: null };
  return { linked: true, employee: project(row) };
}

/**
 * Update the caller's own record, allow-listed.
 *
 * Routed through `service.update` rather than the repo so the edit emits
 * `employee.updated` and writes an audit row exactly as an HR edit does. That
 * matters twice over: the orchestration handler listening for that event is
 * what invalidates the person's cached signature renders, and a phone number
 * that changed with no audit trail is a phone number nobody can explain later.
 */
async function updateMine(client, { patch = {}, actor = {} } = {}) {
  const employeeId = await employeeIdForUser(client, actor.user_id);
  if (!employeeId) {
    // `NO_EMPLOYEE`, not a new code. Attendance, payroll, leave and hr_query all
    // already raise this exact condition under this exact name — a synonym would
    // be a 507th code for a client to switch on for something it already handles.
    throw new AppError("NO_EMPLOYEE", "No employee record on this account", 422);
  }

  // Belt and braces: the validator already rejects unknown keys, but the
  // allow-list is applied here too so the lock does not depend on a middleware
  // being wired to this route rather than another.
  const fields = {};
  for (const k of EDITABLE) {
    if (patch[k] !== undefined) fields[k] = patch[k] === "" ? null : patch[k];
  }
  if (!Object.keys(fields).length) {
    throw new AppError("VALIDATION_ERROR", "Nothing to update", 422);
  }

  const row = await service.update(client, { id: employeeId, patch: fields, actor });
  return { linked: true, employee: project(row) };
}

module.exports = { getMine, updateMine, employeeIdForUser, EDITABLE, READABLE };
