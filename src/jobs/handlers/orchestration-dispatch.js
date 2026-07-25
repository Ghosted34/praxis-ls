/**
 * Worker job: drain a tenant's orchestration outbox (Plan A). Job data:
 * { tenantMeta, env, limit? }. Scheduled per-tenant like regie-aging (a recurring
 * fan-out enqueues it; low-latency triggering after a business op is a follow-up).
 * Runs on the tenant connection so event_log / event_dispatch resolve to the
 * caller's schema (live vs sandbox).
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { dispatchPending } = require("../../orchestration/dispatcher");

module.exports = async function orchestrationDispatch(job) {
  const { tenantMeta, env = "live", limit } = job.data || {};
  if (!tenantMeta) throw new Error("orchestration-dispatch job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) => dispatchPending(c, { limit }));
};
