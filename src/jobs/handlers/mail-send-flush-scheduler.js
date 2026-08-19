/**
 * Worker job: send-queue fan-out tick. Enumerates live tenants and enqueues one
 * `mail-send-flush` per tenant, so a slow mail host in one tenant never delays
 * another's mail.
 *
 * LIVE ONLY, for the same reason the sync scheduler is: a queued row holds a
 * real message addressed to a real person, and a sandbox that flushed its queue
 * would send test mail to customers.
 *
 * The per-tenant `jobId` dedupes an in-flight flush. That matters more here than
 * for sync: two overlapping flushes would both be claiming rows, and although
 * FOR UPDATE SKIP LOCKED makes that safe, it also makes it pointless work.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mailSendFlushScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue(
      "mail-send-flush",
      "flush",
      { tenantMeta: meta, env: "live" },
      { jobId: `mailflush:${meta.db_name}:live`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] send-flush scheduler tick");
  return { tenants: tenants.length, enqueued };
};
