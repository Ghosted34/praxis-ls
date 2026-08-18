/**
 * Worker job: rebuild ONE tenant's sandbox (G3, PRD §5.5).
 *
 * Thin wrapper over provisioning.wipeSandbox (which drops ONLY the `sandbox`
 * schema — the live schema is unreachable from this path by construction: the
 * DROP/CREATE statements name `sandbox` literally and the tracked migration
 * scope is `sandbox`/`sandbox-seed`). After a successful rebuild the platform
 * tenant row is stamped with last_sandbox_wipe_at so the scheduler does not
 * wipe again inside the tenant's `sandbox_wipe_days` window.
 *
 * Job data: { tenantMeta } — the registry row for the tenant.
 */
"use strict";

const svc = require("../../services/platform/provisioning.service");
const { logger } = require("../../config/logger");

module.exports = async function sandboxWipe(job) {
  const meta = job.data && job.data.tenantMeta;
  if (!meta || !meta.slug) throw new Error("sandbox-wipe job without tenantMeta");
  if (!meta.sandbox_schema) {
    logger.info({ slug: meta.slug }, "sandbox wipe skipped — tenant has no sandbox schema");
    return { slug: meta.slug, skipped: true };
  }
  await svc.wipeSandbox({ slug: meta.slug });
  await svc.stampSandboxWipe({ slug: meta.slug });
  logger.info({ slug: meta.slug }, "sandbox rebuilt by scheduler");
  return { slug: meta.slug, wiped: true };
};
