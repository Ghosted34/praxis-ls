/**
 * Worker job: generate tax obligations and remind on the ones coming due
 * (MOD-01, PR-05 / audit CE-16). One job per tenant environment.
 *
 * ── WHY THIS JOB EXISTS ────────────────────────────────────────────────────
 *
 * `entity_tax_registration` has said "this entity files TVA in Cameroon,
 * monthly, by the 15th, Ada owns it" since 0516, and until now nothing read
 * that sentence: `tax_calendar` was written only by hand, so the filing
 * calendar the dossier displayed was a list somebody had to remember to
 * maintain. This is the job that reads the registration and writes the
 * filings.
 *
 * ── WHY GENERATION AND REMINDERS SHARE ONE JOB ─────────────────────────────
 *
 * Because they are two halves of one promise. Split them and there is a window
 * in which an obligation exists and nobody has been told about it, or — worse —
 * a reminder fires for a deadline the generator has since superseded, asking a
 * person to file something that is no longer owed. Running them in one pass,
 * generate first and remind second, means a reminder can only ever name an
 * obligation the current registration model still implies.
 *
 * ── WHY IT IS SAFE TO RUN OFTEN, AND WHY THAT MATTERS ──────────────────────
 *
 * A nightly job gets re-run by hand — after a deploy, after a failure, after
 * somebody wonders whether it ran. Both halves are built to be run twice:
 *
 *   generation is idempotent on `ux_tax_calendar_generation_key` (13970), an
 *     `ON CONFLICT DO NOTHING` insert, so a second pass writes nothing;
 *   the reminder ladder is watermarked on `last_reminder_step`, so a second
 *     pass on the same day re-notifies nobody.
 *
 * That is what makes an operator able to press this at 16:00 without spending
 * the afternoon explaining why the accountant received four copies of the same
 * deadline. See the module header in `corporate_entity.tax-calendar.js`.
 *
 * ── WHY BOTH ENVIRONMENTS ──────────────────────────────────────────────────
 *
 * `contract-lapse` is LIVE-only because it warns a MANAGER about an EMPLOYEE,
 * and a rehearsal contract in Test would put a warning about a person who does
 * not exist into a real inbox. This one has no such audience problem, for the
 * reason `workspace-reminder-scheduler` gives: a tax obligation names the
 * person the OPERATOR put on the registration, and in Test that is the person
 * who set the registration up and is watching to see whether the calendar
 * appears. Sweeping sandbox too is what makes the feature verifiable before it
 * is in production — a generator that only ever runs in LIVE cannot be tested
 * until it has already generated.
 *
 * Job data: { tenantMeta, env, horizon?, backfill? }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const taxCalendar = require("../../modules/master/corporate_entity/corporate_entity.tax-calendar");
const { logger } = require("../../config/logger");

/** Generate + remind on one already-open tenant connection. Exported for tests. */
async function runOn(client, opts = {}) {
  const { today = new Date().toISOString().slice(0, 10) } = opts;

  const generated = await taxCalendar.generateAll(client, {
    today,
    horizon: opts.horizon,
    backfill: opts.backfill,
    actor: {}, // no human: the actor is the worker, and the audit row says so
  });
  const reminded = await taxCalendar.remindOpen(client, { today });

  return { ...generated, reminders: reminded };
}

module.exports = async function taxObligation(job) {
  const { tenantMeta, env = "live", horizon, backfill } = job.data || {};
  if (!tenantMeta) throw new Error("tax-obligation job needs tenantMeta");

  const out = await registry.withTenantConnection(tenantMeta, env, (c) => runOn(c, { horizon, backfill }));

  // Logged when it did something, and when it could not. The `failed` list is
  // the part worth reading: a tenant where one entity cannot generate has a
  // defect, and `generateAll` collects those rather than throwing so one bad
  // registration does not cost the other nine their calendars.
  if (out.created || out.superseded || out.marked_late || out.reminders.reminded || out.failed.length) {
    logger.info(
      {
        tenant: tenantMeta.slug, env,
        created: out.created, superseded: out.superseded, marked_late: out.marked_late,
        unassigned: out.unassigned, skipped: out.skipped,
        reminded: out.reminders.reminded, failed: out.failed,
      },
      "[mod01] tax obligations generated",
    );
  }
  return out;
};

module.exports.runOn = runOn;
