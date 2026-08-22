/**
 * Worker job: rebuild ONE tenant's sandbox (G3, PRD §5.5).
 *
 * Thin wrapper over provisioning.wipeSandbox (which drops ONLY the `sandbox`
 * schema — the live schema is unreachable from this path by construction: the
 * DROP/CREATE statements name `sandbox` literally and the tracked migration
 * scope is `sandbox`/`sandbox-seed`).
 *
 * NOTE (2026-08-22). This handler used to call `stampSandboxWipe` itself, as a
 * second step after the wipe. Two problems came out of that split:
 *
 *   1. The stamp hung — a missing `connect()`, see provisioning.service — so
 *      the job never completed, was retried, and `last_sandbox_wipe_at` stayed
 *      NULL. The scheduler reads NULL as "never wiped → wipe now", so the
 *      tenant was rebuilt nightly instead of on its interval.
 *   2. Only this path stamped. A manual wipe from the console did not, so the
 *      cron would rebuild a hand-rebuilt sandbox again hours later.
 *
 * Both are fixed by folding the stamp (and the new `sandbox.wiped` audit row)
 * into `wipeSandbox` itself, where every caller gets it.
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
  const out = await svc.wipeSandbox({ slug: meta.slug, source: "scheduler" });
  logger.info({ slug: meta.slug, audited: out.audited }, "sandbox rebuilt by scheduler");
  return { slug: meta.slug, wiped: true, audited: out.audited };
};
