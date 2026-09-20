/**
 * Worker job: the scheduler half of the daily call-record sweep (PR-2).
 *
 * One tick a day, per tenant and environment, fanning out to
 * `comms-call-record-sweep` twice: once to REPROCESS the calls whose transcript
 * fell back (or never ran), once to apply the D7 retention window to the audio.
 *
 * Why a day and not the 15 s the ring/cap sweep runs on: neither job is a
 * deadline. A flagged transcript is already readable, already labelled and
 * already alerted — retrying it hourly would spend the tenant's provider budget
 * three times an hour on a call nobody is waiting for, and would make the
 * "sustained TRANSCRIPTION_FAILED" signal PR-3 alerts on impossible to read.
 * Retention is a 30-day window; a day of granularity is invisible inside it.
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
