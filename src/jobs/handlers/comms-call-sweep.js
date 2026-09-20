"use strict";
/**
 * Smart Comms Calls (PR-1) — the per-tenant call sweep.
 *
 * Ends the calls the row says are overdue: RINGING past 60 s → NO_ANSWER,
 * IN_CALL past 30 min → ENDED(max_duration). The service's transitions are
 * guarded, so this is safe to run concurrently with a real hang-up and from
 * several replicas — the first writer wins and the rest see an already-moved
 * row. The tenant slug is threaded to the publish (the worker has no ambient
 * request context), so the "ended" event reaches every replica's sockets.
 */
const registry = require("../../services/tenant/registry.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");

module.exports = async function commsCallSweep(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-sweep requires a live or sandbox tenant");
  }
  // `tenantMeta`/`env` ride along for the PR-2 half: a call this sweep ends on
  // the 30-minute cap is a call whose recording must still be transcribed, and
  // the enqueue needs to name the tenant database to put the job in the right
  // schema's queue entry.
  return registry.withTenantConnection(tenantMeta, env, (c) =>
    callService.sweep(c, { tenantSlug: tenantMeta.slug, tenantMeta, env }),
  );
};
