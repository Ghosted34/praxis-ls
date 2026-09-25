/**
 * Worker job: one call's deadline (calls audit D1; smartcomm.call.clock.js).
 *
 *   "ring"      dial + 60 s: NO_ANSWER if the row still rings;
 *   "cap"       answer + 30 min: ENDED(max_duration) if still in the call;
 *   "liveness"  60 s after a participant's last socket left mid-call:
 *               ENDED(disconnected) if both are still gone.
 *
 * Each re-reads the row and moves it through the guarded transition, so a
 * job that runs after a real hang-up, or twice, changes nothing.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");

const RUN = {
  ring: callService.expireRing,
  cap: callService.capCall,
  liveness: callService.checkLiveness,
};

module.exports = async function commsCallClock(job) {
  const { callId, tenantMeta, env = "live" } = job.data || {};
  const run = RUN[job.name];
  if (!run) throw new Error(`comms-call-clock: unknown job ${job.name}`);
  if (!callId || !tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-clock requires callId + a live or sandbox tenant");
  }
  return registry.withTenantConnection(tenantMeta, env, (c) => run(c, { callId, tenantMeta, env }));
};
