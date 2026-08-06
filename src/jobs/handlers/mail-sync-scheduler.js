/**
 * Worker job: mail sync fan-out tick (doc/EMAIL_ENGINE_PLAN.md §5). Runs on a
 * BullMQ repeat schedule; enumerates LIVE tenants and enqueues one `mail-sync`
 * job per tenant so each tenant's IMAP connections are polled on its own
 * connection (isolated + retryable).
 *
 * Live only: mailbox connections are real credentials; sandbox holds test data
 * and should not poll production inboxes. Per-tenant jobId dedupes an in-flight
 * poll so a slow mailbox never piles up duplicate jobs.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mailSyncScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
     
    await enqueue(
      "mail-sync",
      "sync",
      { tenantMeta: meta, env: "live" },
      { jobId: `mailsync:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: 100 },
    );
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] sync scheduler tick");
  return { tenants: tenants.length, enqueued };
};
