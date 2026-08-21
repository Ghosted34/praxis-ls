/**
 * Worker job: compute SLA due dates and raise breaches for one tenant (§9.2).
 *
 * `attempts: 1` on the enqueue side, for the same reason as the send flush: the
 * sweep is idempotent and runs again in five minutes, so a BullMQ retry buys
 * nothing and a retry storm during an outage would notify a team lead once per
 * attempt about the same overdue thread.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const sla = require("../../modules/mail/triage/sla.service");

module.exports = async function mailSlaSweep(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-sla-sweep job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) => sla.sweep(c));
};
