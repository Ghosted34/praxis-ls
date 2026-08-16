/**
 * Worker job: warn before a contract term or a probation lapses (0700).
 *
 * ── THE TWO DATES NOTHING HAS EVER READ ────────────────────────────────────
 *
 * `hr_contract.end_on` has existed since 0360 and no code has ever looked at
 * it. A fixed-term contract that expires unnoticed is an employee turning up to
 * work without one — which in most jurisdictions converts the arrangement to
 * something the employer did not choose, and always leaves the company without
 * the document it would need if the relationship went wrong.
 *
 * A probation that passes unnoticed is worse in a quieter way: confirmation is
 * usually automatic on silence, so the deadline the employer needed to act
 * before goes by and the decision is made by nobody.
 *
 * ── WHY IT EMITS RATHER THAN EMAILS ────────────────────────────────────────
 *
 * `emitEvent` is the tenant's own notification and orchestration spine: an
 * event reaches whoever the tenant has configured to watch MOD-12, through
 * whichever channel they chose, and appears in the Control Tower feed. Sending
 * mail from here would bypass all of that and hard-code an audience.
 *
 * ── WHY A CONTRACT IS WARNED ABOUT ONCE ────────────────────────────────────
 *
 * The repo's `lapsingWithin` excludes contracts that already got this event
 * inside the same window, so a daily job warns once per contract per window
 * rather than every morning until somebody acts. A warning that arrives thirty
 * times is a warning nobody reads.
 *
 * Job data: { tenantMeta, env, days? }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const repo = require("../../modules/hr/hr_contract/hr_contract.repo");
const events = require("../../modules/hr/hr_contract/hr_contract.events");
const { emitEvent } = require("../../shared/events/emit");
const { logger } = require("../../config/logger");

/** Warn on a contract this far ahead. Long enough to renegotiate a fixed term
 *  or run a probation review, short enough not to be noise. */
const DEFAULT_DAYS = 30;

async function warnOn(client, { days = DEFAULT_DAYS } = {}) {
  let expiring = 0;
  let probation = 0;

  for (const row of await repo.lapsingWithin(client, { days, kind: "expiry" })) {
    await emitEvent(client, {
      eventTypeKey: events.EXPIRING,
      moduleKey: events.MODULE,
      entityRef: `hr_contract:${row.hr_contract_id}`,
      priority: row.days_left <= 7 ? "HIGH" : "NORMAL",
      payload: {
        employee_name: row.employee_name,
        kind: row.kind,
        end_on: row.end_on,
        days_left: row.days_left,
      },
    });
    expiring += 1;
  }

  for (const row of await repo.lapsingWithin(client, { days, kind: "probation" })) {
    await emitEvent(client, {
      eventTypeKey: events.PROBATION_ENDING,
      moduleKey: events.MODULE,
      entityRef: `hr_contract:${row.hr_contract_id}`,
      // Always HIGH: unlike an expiry, silence here IS a decision — the
      // employee is usually confirmed by default when the date passes.
      priority: "HIGH",
      payload: {
        employee_name: row.employee_name,
        probation_ends_on: row.probation_ends_on,
        days_left: row.days_left,
      },
    });
    probation += 1;
  }

  return { expiring, probation };
}

module.exports = async function contractLapse(job) {
  const { tenantMeta, env = "live", days = DEFAULT_DAYS } = job.data || {};
  if (!tenantMeta) throw new Error("contract-lapse job needs tenantMeta");
  const out = await registry.withTenantConnection(tenantMeta, env, (c) => warnOn(c, { days }));
  if (out.expiring || out.probation) {
    logger.info({ tenant: tenantMeta.slug, env, ...out }, "[hr_contract] lapse warnings emitted");
  }
  return out;
};

module.exports.warnOn = warnOn;
module.exports.DEFAULT_DAYS = DEFAULT_DAYS;
