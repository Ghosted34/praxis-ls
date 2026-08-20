/**
 * Daily per-tenant mail housekeeping: domain health, then retention.
 *
 * The send-window sweep rides along here rather than getting a queue of its own
 * because this is already the daily per-tenant mail slot, and `email_send_window`
 * needs exactly one visit a day. `mailbox.repo.sweepSendWindows` was written for
 * it — "counters are not a log; email_send_log is" — and then called by nothing,
 * so the throttle counters accumulated a row per mailbox per window forever, in
 * a table whose only readers ask about the last hour and the last day.
 *
 * Retention runs even when the health check throws: a DNS lookup failing is a
 * normal Tuesday, and it is not a reason to stop pruning.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const service = require("../../modules/mail/deliverability/deliverability.service");
const mailboxRepo = require("../../modules/mail/mail/mailbox.repo");
const { logger } = require("../../config/logger");

module.exports = async function deliverabilityCheck(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("deliverability-check job needs tenantMeta");

  return registry.withTenantConnection(tenantMeta, env, async (client) => {
    let health = null;
    let error = null;
    try {
      health = await service.checkAll(client);
    } catch (err) {
      error = err.message;
      logger.warn({ err, tenant: tenantMeta.db_name }, "[mail] deliverability check failed");
    }

    let sweptWindows = 0;
    try {
      const r = await mailboxRepo.sweepSendWindows(client);
      sweptWindows = (r && r.rowCount) || 0;
    } catch (err) {
      logger.warn({ err, tenant: tenantMeta.db_name }, "[mail] send-window sweep skipped");
    }

    // The health check's failure is re-thrown AFTER retention, so BullMQ still
    // sees a failed job and the operator still sees the reason.
    if (error) throw new Error(error);
    return { ...health, swept_send_windows: sweptWindows };
  });
};
