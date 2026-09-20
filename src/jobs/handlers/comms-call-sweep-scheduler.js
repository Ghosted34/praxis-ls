"use strict";
/**
 * Smart Comms Calls (PR-1) — the scheduler half of the call sweep.
 *
 * The call row owns its two deadlines (60 s ring, 30 min call) and the sweep
 * is the only clock that enforces them: an abandoned call — the phone put in
 * a pocket, the tab closed, the process restarted — ends by the row, not by
 * whoever happens to be in the API process that started it. One tick per
 * tenant+env, every 15 s: the granularity is invisible against a 60-second
 * ring and a 30-minute cap, and 15 s keeps the tick cheap enough to run on
 * every tenant.
 */
const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");

module.exports = async function commsCallSweepScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const tenantMeta of tenants) {
    // Calls can happen in the sandbox Test environment too (training runs),
    // so both schemas get their tick — same pattern as comms-send-scheduler.
    const envs = tenantMeta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue("comms-call-sweep", "sweep", { tenantMeta, env }, {
        jobId: `commscallsweep-${tenantMeta.db_name}-${env}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 50,
      });
      enqueued += 1;
    }
  }
  return { enqueued };
};
