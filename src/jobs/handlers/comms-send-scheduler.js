"use strict";
const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
module.exports = async function commsSendScheduler() {
  const tenants = await registry.listActiveTenants();
  for (const tenantMeta of tenants) {
    await enqueue("comms-send-flush", "flush", { tenantMeta, env: "live" }, {
      jobId: `commsflush-${tenantMeta.db_name}-live`, attempts: 2, removeOnComplete: true, removeOnFail: 50,
    });
  }
  return { enqueued: tenants.length };
};
