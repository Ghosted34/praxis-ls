"use strict";
const registry = require("../../services/tenant/registry.service");
const service = require("../../modules/mail/deliverability/deliverability.service");

module.exports = async function deliverabilityCheck(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("deliverability-check job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (client) => service.checkAll(client));
};
