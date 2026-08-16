/**
 * Worker job: post monthly leave accrual for one tenant environment (MOD-15).
 *
 * ── WHY ACCRUAL IS A JOB AND NOT A COMPUTED COLUMN ─────────────────────────
 *
 * "Months employed × rate" looks like something to derive on read, and deriving
 * it is wrong the first time anything changes: alter the rate and last year's
 * approved balance silently re-computes under the new rule, so a manager who
 * approved 18 days against 18 accrued finds they approved against 15. Posting
 * makes entitlement a fact with a date on it — the month it was earned, at the
 * rate in force then.
 *
 * ── WHY RE-RUNNING THIS IS FREE ────────────────────────────────────────────
 *
 * A monthly job WILL be re-run by hand — after a deploy, after a failure, after
 * somebody wonders whether it ran at all. `ux_leave_ledger_accrual` (0696) is a
 * unique index on (employee, type, year, month) for ACCRUAL rows and the insert
 * is ON CONFLICT DO NOTHING, so a second run posts nothing rather than handing
 * the whole workforce another month of leave. That property is the reason the
 * month is stored on the row.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 *
 * It never accrues past `max_days_per_year`, and it never accrues for a month
 * the employee had not started — `accrualMonths` requires service from the
 * first of the month, because crediting a full month's entitlement for eleven
 * days of it is a gift the employer did not make.
 *
 * Types with no `accrual_days_per_month` are skipped entirely: sick and
 * maternity leave are granted per event against a ceiling, not banked, and
 * showing an employee "12.5 sick days saved up" would misrepresent both.
 *
 * Job data: { tenantMeta, env }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const repo = require("../../modules/hr/leave_allowance/leave_allowance.repo");
const rules = require("../../modules/hr/leave_allowance/leave.rules");
const { logger } = require("../../config/logger");

/** Accrue for one already-open tenant connection. Exported for tests. */
async function accrueOn(client, { today = new Date() } = {}) {
  const upto = today.toISOString().slice(0, 10);
  const year = today.getUTCFullYear();

  const types = (await repo.listTypes(client)).filter(
    (t) => Number(t.accrual_days_per_month) > 0,
  );
  if (!types.length) return { employees: 0, posted: 0, types: 0 };

  const roster = await repo.accrualRoster(client);
  let posted = 0;

  for (const emp of roster) {
    for (const type of types) {
      const rate = Number(type.accrual_days_per_month);
      const cap = type.max_days_per_year === null ? null : Number(type.max_days_per_year);

      // What this employee has already accrued this year, so the cap is
      // enforced against the ledger rather than against a count of months.
      const entries = await repo.ledgerFor(client, {
        employeeId: emp.employee_id,
        leaveTypeId: type.leave_type_id,
        year,
      });
      let accrued = rules.balanceFrom(entries).accrued;

      const months = rules.accrualMonths({ hired_on: emp.hired_on, upto, year });
      for (const m of months) {
        const room = cap === null ? rate : Math.min(rate, cap - accrued);
        // At the ceiling. Nothing to post — and nothing to record either, since
        // the ledger's CHECK refuses a zero movement. A later run re-evaluates
        // it, which is right: the cap can be raised.
        if (!(room > 0)) break;
        const row = await repo.insertAccrual(client, {
          employee_id: emp.employee_id,
          leave_type_id: type.leave_type_id,
          period_year: m.year,
          period_month: m.month,
          days: Math.round(room * 100) / 100,
          note: `Accrual ${String(m.month).padStart(2, "0")}/${m.year}`,
        });
        // Null = this month was already posted (the ON CONFLICT above). The
        // ledger read at the top of the loop already counted it, so `accrued`
        // must not move again.
        if (row) {
          posted += 1;
          accrued += Number(row.days);
        }
      }
    }
  }

  return { employees: roster.length, types: types.length, posted };
}

module.exports = async function leaveAccrual(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("leave-accrual job needs tenantMeta");
  const out = await registry.withTenantConnection(tenantMeta, env, (c) => accrueOn(c));
  logger.info({ tenant: tenantMeta.slug, env, ...out }, "[leave] accrual posted");
  return out;
};

module.exports.accrueOn = accrueOn;
