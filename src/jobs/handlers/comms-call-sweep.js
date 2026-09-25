"use strict";
/**
 * The per-tenant call SAFETY sweep (calls audit D1), for a tenant in the
 * active set. Ends overdue rings, calls past the cap and calls both of whose
 * participants are gone (smartcomm.call.service.sweep), then drops the tenant
 * from the set once it has no live call and has been quiet for a while.
 */
const registry = require("../../services/tenant/registry.service");
const callService = require("../../modules/smartcomm/smartcomm.call.service");
const clock = require("../../modules/smartcomm/smartcomm.call.clock");

module.exports = async function commsCallSweep(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-call-sweep requires a live or sandbox tenant");
  }
  const result = await registry.withTenantConnection(tenantMeta, env, (c) =>
    callService.sweep(c, { tenantSlug: tenantMeta.slug, tenantMeta, env }),
  );
  const released = result.live === 0 ? await clock.releaseIfIdle(tenantMeta.slug, env) : false;
  return { ...result, released };
};
