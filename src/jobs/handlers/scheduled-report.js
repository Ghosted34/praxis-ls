/**
 * Worker job: run a tenant's due scheduled reports (1.3). Job data:
 * { tenantMeta, env }. Opens the tenant connection and calls report.runDue,
 * which generates each due report, enqueues its email deliveries, and advances
 * next_run_at. Mirrors the per-tenant enqueue pattern used by regie-aging — the
 * periodic trigger (an app scheduled-task or external cron) enqueues one job per
 * live tenant, or POST /reports/scheduled/run-due drives a single tenant directly.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const report = require("../../modules/vault/report/report.service");

module.exports = async function scheduledReport(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("scheduled-report job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) =>
    report.runDue(c, { tenantMeta, env, actor: { user_id: null } }),
  );
};
