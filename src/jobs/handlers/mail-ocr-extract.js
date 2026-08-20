/**
 * Worker job: read the fields off ONE email attachment into the
 * `attachment_extraction` staging table (§8.6).
 *
 * Job data: { tenantMeta, env, attachmentId, user }.
 *
 * ── WHY ONE ATTACHMENT PER JOB ──────────────────────────────────────────────
 *
 * A vision call takes seconds and costs money, and a message can carry twenty
 * files. Batching them into one job means a single bad PDF fails the whole
 * batch, a retry re-bills every sibling, and the queue's visibility timeout
 * becomes a function of how many attachments happened to be on one email. One
 * per job makes the unit of retry the unit of cost.
 *
 * ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
 *
 * BullMQ is at-least-once, and `attempts: 3` on the enqueue side means a
 * timeout during a call that actually succeeded WILL be redelivered.
 * `ocr.extract` returns the existing row for an attachment it has already
 * processed rather than calling the vendor again, so redelivery is free instead
 * of double-billed. The `force` flag is the deliberate way to re-run one.
 *
 * ── FAILURE IS DATA ─────────────────────────────────────────────────────────
 *
 * A vision provider that cannot read a scan produces a FAILED row, not a thrown
 * job. Only infrastructure faults — no tenant, no attachment — throw, because
 * those are the ones a retry can fix.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const ocr = require("../../modules/mail/assist/ocr.service");

module.exports = async function mailOcrExtract(job) {
  const { tenantMeta, env = "live", attachmentId, user = null, force = false } = job.data || {};
  if (!tenantMeta) throw new Error("mail-ocr-extract job needs tenantMeta");
  if (!attachmentId) throw new Error("mail-ocr-extract job needs attachmentId");

  return registry.withTenantConnection(tenantMeta, env, (c) =>
    ocr.extract(c, { attachmentId, force }, user));
};
