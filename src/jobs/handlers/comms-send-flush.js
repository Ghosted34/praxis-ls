"use strict";
const registry = require("../../services/tenant/registry.service");
const schedule = require("../../modules/smartcomm/smartcomm.schedule.service");
module.exports = async function commsSendFlush(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta || env !== "live") throw new Error("comms-send-flush requires a live tenant");
  return registry.withTenantConnection(tenantMeta, env, (c) => schedule.flush(c));
};
