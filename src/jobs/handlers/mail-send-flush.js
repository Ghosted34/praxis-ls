/**
 * Worker job: send one tenant's due queued mail.
 *
 * ── `attempts: 1` ON THE BULLMQ JOB IS DELIBERATE ───────────────────────────
 *
 * Retrying is the QUEUE ROW's job, not BullMQ's. The row carries `attempts`,
 * `last_error` and a `release_at` that the backoff moves forward, so a transient
 * failure is retried on a later tick with state that survived the process.
 *
 * Letting BullMQ retry the job as well would layer two independent retry loops
 * over the same message and could send it twice — the outer retry has no idea
 * the inner one already succeeded for some of the rows in its batch.
 *
 * The adapter and the outbound recorder are injected rather than imported by the
 * service, so the state machine stays testable without a mail server.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const outbox = require("../../modules/mail/mail/outbox.service");
const mail = require("../../modules/mail/mail/mail.service");

module.exports = async function mailSendFlush(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-send-flush job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) =>
    outbox.flush(c, {
      resolveAdapter: mail.resolveAdapter,
      recordOutbound: mail.recordOutbound,
      explainSendError: mail.explainSendError,
      slug: tenantMeta.slug,
    }));
};
