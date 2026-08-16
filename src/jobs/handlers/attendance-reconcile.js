/**
 * Worker job: reconcile one tenant environment's attendance for a date (0697).
 *
 * Runs on completed days, not live ones — see `reconcileDate`'s default. A day
 * still in progress has no absences, only people who have not arrived yet, and
 * charging them at 09:00 would be nonsense.
 *
 * Re-running is free by construction (upsert on (employee, date), waivers and
 * raised queries preserved), which is what lets this be scheduled daily AND
 * pressed by hand after a punch correction or a late leave approval without
 * anybody having to think about it.
 *
 * Job data: { tenantMeta, env, date? }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const reconcile = require("../../modules/hr/attendance/attendance.reconcile");
const { logger } = require("../../config/logger");

module.exports = async function attendanceReconcile(job) {
  const { tenantMeta, env = "live", date = null } = job.data || {};
  if (!tenantMeta) throw new Error("attendance-reconcile job needs tenantMeta");
  const out = await registry.withTenantConnection(tenantMeta, env, (c) => reconcile.reconcileDate(c, { date }));
  logger.info({ tenant: tenantMeta.slug, env, ...out }, "[attendance] day reconciled");
  return out;
};
