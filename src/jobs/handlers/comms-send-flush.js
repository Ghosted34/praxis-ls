"use strict";
const registry = require("../../services/tenant/registry.service");
const schedule = require("../../modules/smartcomm/smartcomm.schedule.service");
module.exports = async function commsSendFlush(job) {
  // Scheduled chat is delivered in LIVE and in the sandbox Test environment
  // (training rehearses on Test). The scheduler enqueues one flush per env, so
  // each job flushes its own schema's due rows against its own data. Anything
  // else is a malformed job.
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta || (env !== "live" && env !== "sandbox")) {
    throw new Error("comms-send-flush requires a live or sandbox tenant");
  }
  return registry.withTenantConnection(tenantMeta, env, (c) => schedule.flush(c));
};
