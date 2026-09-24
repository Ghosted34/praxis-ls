/**
 * Worker job: the scheduler half of the daily call-record sweep. One tick a
 * day (a working-hours cron, src/jobs/call-record-sweep-schedule.js), fanning
 * out per tenant and env to `comms-call-record-sweep`: once to reprocess, once
 * to apply audio retention. Daily, because neither is a deadline and every
 * retry spends the tenant's transcription budget.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");

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
