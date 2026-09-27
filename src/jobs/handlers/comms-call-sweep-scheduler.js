"use strict";
/**
 * The scheduler half of the call SAFETY sweep (calls audit D1).
 *
 * Every 5 minutes, one sweep job per tenant+env in the active set
 * (smartcomm.call.clock.js): the tenants where a call was dialled or answered
 * recently. Each call's own clock jobs are the primary deadlines; this only
 * catches one that was lost. A tenant that has never made a call is never
 * visited, and the platform database is read once per tick, not every 15 s.
 */
const registry = require("../../services/tenant/registry.service");
const clock = require("../../modules/smartcomm/smartcomm.call.clock");
const { enqueue } = require("../queue-producer");

module.exports = async function commsCallSweepScheduler() {
  const active = await clock.activeTenants();
  if (!active.length) return { enqueued: 0 };
  const bySlug = new Map((await registry.listActiveTenants()).map((t) => [t.slug, t]));
  let enqueued = 0;
  for (const { slug, env } of active) {
    const tenantMeta = bySlug.get(slug);
    if (!tenantMeta || (env === "sandbox" && !tenantMeta.sandbox_schema)) continue;
    await enqueue("comms-call-sweep", "sweep", { tenantMeta, env }, {
      jobId: `commscallsweep-${tenantMeta.db_name}-${env}`,
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: 50,
    });
    enqueued += 1;
  }
  return { enqueued };
};
