/**
 * Worker job: SLA fan-out tick. One `mail-sla-sweep` per LIVE tenant.
 *
 * LIVE only. A sandbox breach notification would page a real team lead about a
 * conversation that does not exist.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mailSlaSweepScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "mail-sla-sweep",
      "sweep",
      { tenantMeta: meta, env: "live" },
      { jobId: `mailsla:${meta.db_name}:live`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] SLA sweep scheduler tick");
  return { tenants: tenants.length, enqueued };
};
