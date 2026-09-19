/**
 * Worker job: fetch daily FX from exchangerate-api and upsert into fx_rate_daily
 * for one tenant. Job data: { tenantMeta, env, base?, quotes? }. Base and quotes
 * are resolved from the tenant DB when omitted (base = the tenant's base
 * currency, quotes = every other active currency), so the daily fan-out keeps
 * every active pair fresh without the scheduler needing to know each tenant's
 * currency set.
 *
 * The actual fetch/upsert and the key-resolution order live in
 * currency.sync.syncRates — the SAME core the in-app "Sync now" button calls, so
 * the two paths can never drift. A manual override (is_override) always wins in
 * the resolver, so a failed/late/unconfigured feed never corrupts a hand-set rate.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const sync = require("../../modules/master/currency/currency.sync");
const repo = require("../../modules/master/currency/currency.repo");

module.exports = async function fxSync(job) {
  const { tenantMeta, env = "live", base, quotes } = job.data || {};
  if (!tenantMeta) throw new Error("fx-sync job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    // Record the nightly run in fx_sync_run so the master page can show when the
    // scheduler last ran and its outcome (audit #6). trigger='cron', no actor.
    // The record wraps the SAME shared core the "Sync now" button calls, so the
    // two paths stay identical while each gets its own run row.
    const runId = await repo.startSyncRun(c, { trigger: "cron", actorUserId: null });
    try {
      const result = await sync.syncRates(c, { base, quotes });
      if (result.skipped === true) {
        await repo.finishSyncRun(c, runId, { status: "skipped", reason: result.reason || null, base: result.base || null });
      } else {
        const status = result.unsupported && result.unsupported.length ? "partial" : "ok";
        await repo.finishSyncRun(c, runId, {
          status,
          updatedCount: result.updated ? result.updated.length : 0,
          unsupported: result.unsupported || [],
          base: result.base || null,
        });
      }
      return result;
    } catch (e) {
      await repo.finishSyncRun(c, runId, { status: "error", reason: e && e.message ? String(e.message).slice(0, 500) : "sync failed" });
      throw e;
    }
  });
};
