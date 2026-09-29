/**
 * Copy live PEOPLE into the sandbox — live employees, the companies they belong
 * to, and the link from each provisioned account to its employee.
 *
 * WHY (owner decision, 2026-09-29). "The sandbox shows real employees, but the
 * live never shows sandbox." A person hired in LIVE has to be there when someone
 * switches to TEST to try a payroll run or a leave request on them; a person
 * hired in TEST must never reach LIVE.
 *
 * The copying itself is in the database (migration 14250): a trigger on
 * `live.employee` and `live.corporate_entity` copies every live write into the
 * sandbox as it happens, and only ever in that direction. This module is the
 * OTHER half — the backfill, for the moments the trigger cannot cover:
 *
 *   · a sandbox that has just been rebuilt (the wipe drops the schema, and the
 *     copies with it);
 *   · people who existed before 14250 landed;
 *   · a copy the trigger had to skip (it never fails a live write, so a clash
 *     or a lock only logs a warning and waits for this pass).
 *
 * The backfill only fills gaps. It never replaces an existing copy, so an edit
 * made to a real person in TEST stands until that person next changes in LIVE —
 * the "live wins" rule, applied by the trigger, not by a deploy.
 *
 * Call it AFTER `mirrorUsersIntoSandbox`: a copied company can carry an actor
 * (`status_changed_by`) that must already exist in `sandbox.app_user`, and the
 * account links it writes need both the user and the employee copied.
 */
"use strict";

/** Has 14250 reached this database? False on a deployment that has not migrated
 *  yet — checked rather than assumed, so a deploy ordered the wrong way round
 *  logs nothing instead of failing. */
async function backfillAvailable(client) {
  const { rows } = await client.query(
    "SELECT to_regprocedure('live.sandbox_backfill_from_live()') IS NOT NULL AS ok",
  );
  return rows[0] ? rows[0].ok === true : false;
}

/**
 * Copy every live company and employee the sandbox does not have yet, then link
 * accounts to their employees. Returns the counts written.
 *
 * Safe inside a transaction (the wipe runs it inside its own): the SQL function
 * traps every per-row and per-step error itself and reports it as a WARNING, so
 * a problem costs some copies and never the caller's transaction. It still
 * throws on a connection-level failure, like any query.
 */
async function copyLivePeopleIntoSandbox(client) {
  if (!(await backfillAvailable(client))) {
    return { entities: 0, employees: 0, accounts: 0, skipped: "not-migrated" };
  }
  const { rows } = await client.query(
    "SELECT entities, employees, accounts FROM live.sandbox_backfill_from_live()",
  );
  const r = rows[0] || {};
  return {
    entities: Number(r.entities) || 0,
    employees: Number(r.employees) || 0,
    accounts: Number(r.accounts) || 0,
  };
}

module.exports = { copyLivePeopleIntoSandbox };
