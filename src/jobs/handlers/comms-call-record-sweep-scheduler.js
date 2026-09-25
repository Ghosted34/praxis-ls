/**
 * Worker job: the scheduler half of the daily call-record sweep. One tick a
 * day (a working-hours cron, src/jobs/call-record-sweep-schedule.js), fanning
 * out per tenant and env to `comms-call-record-sweep`: once to reprocess, once
 * to apply audio retention. Daily, because neither is a deadline and every
 * retry spends the tenant's transcription budget.
 *
 * Spread across the working day (audit D2): each tenant's jobs are delayed by
 * a hash of its slug over SPREAD_MS, so the fleet's retries never land on the
 * providers in one burst, and a tenant keeps the same slot every day.
 */
"use strict";

const crypto = require("crypto");
const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");

/** 10:00 → 16:00 in the corridor, with the default cron. */
const SPREAD_MS = 6 * 60 * 60 * 1000;

function spreadDelay(slug) {
  const h = crypto.createHash("sha256").update(String(slug)).digest();
  return h.readUInt32BE(0) % SPREAD_MS;
}

module.exports = async function commsCallRecordSweepScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const tenantMeta of tenants) {
    // The sandbox schema has calls in it (training runs), so both get their
    // tick — same reasoning as comms-call-sweep-scheduler.
    const envs = tenantMeta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      for (const kind of ["reprocess", "retain"]) {
        await enqueue("comms-call-record-sweep", kind, { tenantMeta, env, kind }, {
          jobId: `callrecordsweep-${kind}-${tenantMeta.db_name}-${env}`,
          delay: spreadDelay(tenantMeta.slug),
          attempts: 2,
          removeOnComplete: true,
          removeOnFail: 50,
        });
        enqueued += 1;
      }
    }
  }
  return { enqueued };
};
module.exports.spreadDelay = spreadDelay;
module.exports.SPREAD_MS = SPREAD_MS;
