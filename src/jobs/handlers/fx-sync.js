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

module.exports = async function fxSync(job) {
  const { tenantMeta, env = "live", base, quotes } = job.data || {};
  if (!tenantMeta) throw new Error("fx-sync job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, async (c) => sync.syncRates(c, { base, quotes }));
};
