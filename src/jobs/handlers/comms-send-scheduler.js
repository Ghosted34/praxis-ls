"use strict";
const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
module.exports = async function commsSendScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const tenantMeta of tenants) {
    // LIVE always; the sandbox Test environment as well when the tenant has one,
    // so a scheduled message written while training on Test is actually
    // delivered. Same pattern as attendance-reconcile-scheduler. A distinct
    // jobId per env keeps the two flushes independent.
    const envs = tenantMeta.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      await enqueue("comms-send-flush", "flush", { tenantMeta, env }, {
        jobId: `commsflush-${tenantMeta.db_name}-${env}`, attempts: 2, removeOnComplete: true, removeOnFail: 50,
      });
      enqueued += 1;
    }
  }
  return { enqueued };
};
