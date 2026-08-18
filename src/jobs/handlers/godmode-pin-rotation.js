/**
 * Worker job: rotate ONE tenant's God-Mode PIN (G24).
 *
 * Mirrors the legacy cron exactly: mint → store hash + 7-day expiry → deliver
 * the plaintext to the CEO out of band. The plaintext is delivered through the
 * notification EMAIL channel (SECURITY category forces the email even for a
 * user who disabled emails), and is never written to any log or the ledger.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const service = require("../../modules/dashboard/godmode/godmode.service");
const { logger } = require("../../config/logger");

module.exports = async function godmodePinRotation(job) {
  const meta = job.data && job.data.tenantMeta;
  if (!meta || !meta.slug) throw new Error("godmode-pin-rotation job without tenantMeta");
  const out = await registry.withTenantConnection(meta, "live", (c) =>
    service.rotatePin(c, { deliver: true }),
  );
  // Never log the PIN itself; the email is the only delivery.
  logger.info({ slug: meta.slug, rotated: out.rotated, reason: out.reason || null, expires_at: out.expires_at || null }, "[godmode] PIN rotated");
  return { slug: meta.slug, rotated: out.rotated };
};
