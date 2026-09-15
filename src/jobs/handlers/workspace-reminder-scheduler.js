/**
 * Worker job: workspace reminder fan-out (13810). One job per tenant environment.
 *
 * ── WHY BOTH ENVIRONMENTS, WHEN contract-lapse IS LIVE-ONLY ────────────────
 *
 * contract-lapse warns a MANAGER about an employee, so a rehearsal contract
 * expiring in Test would put a warning about a person who does not exist into
 * a real manager's inbox. A workspace reminder has no such audience problem:
 * it goes to whoever owns the task, and in Test that is the person who wrote a
 * test task and is presumably watching to see whether reminders work.
 *
 * Sweeping sandbox too is what makes the feature testable at all. A reminder
 * that only ever fires in production cannot be verified before it is in
 * production.
 *
 * ── WHY EVERY MINUTE RATHER THAN A CRON ────────────────────────────────────
 *
 * A reminder is promised to a minute, not to a wall-clock slot. A daily cron
 * would make "remind me 15 minutes before" mean "remind me tomorrow morning",
 * and the reminder_minutes the picker offers would be a lie. The cost of the
 * minute is one indexed partial scan per tenant per minute, over rows that are
 * armed and due — which is empty almost always (see 13810's partial index).
 *
 * Job data: { tenantMeta, env }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function workspaceReminderScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    for (const env of ["live", "sandbox"]) {
      await enqueue(
        "workspace-reminder",
        "sweep",
        { tenantMeta: meta, env },
        // jobId per tenant+env so a tick that overlaps its predecessor cannot
        // stack up two sweeps of the same tenant. BullMQ dedupes on it.
        { jobId: `wsreminder:${meta.db_name}:${env}`, attempts: 2, removeOnComplete: true, removeOnFail: true },
      );
      enqueued += 1;
    }
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[workspace] reminder scheduler tick");
  return { tenants: tenants.length, enqueued };
};
