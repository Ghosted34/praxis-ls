/**
 * Worker job: fan a push-subscription renewal job per LIVE tenant. Runs on a
 * BullMQ repeat (MAIL_WEBHOOK_RENEW_INTERVAL_MS). Cheap — a no-op for tenants
 * with no push subscriptions.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function mailWebhookRenewScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  for (const meta of tenants) {
    await enqueue("mail-webhook-renew", "renew", { tenantMeta: meta, env: "live" },
      { jobId: `mailrenew:${meta.db_name}:live`, attempts: 2, removeOnComplete: true, removeOnFail: true });
    enqueued += 1;
  }
  logger.debug({ tenants: tenants.length, enqueued }, "[mail] webhook-renew scheduler tick");
  return { tenants: tenants.length, enqueued };
};
