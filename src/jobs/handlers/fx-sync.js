/**
 * Worker job: fetch daily FX from exchangerate-api and upsert into fx_rate_daily
 * for a tenant. Job data: { tenantMeta, env, base, quotes[] }. The API key comes
 * from tenant settings (section "fx", key "exchangerate_api_key"), NOT .env
 * (BUILD_CONVENTIONS §7). A manual override (is_override) always wins in the
 * resolver, so a failed/late/unconfigured feed never corrupts a hand-set rate.
 */
"use strict";
const axios = require("axios");
const registry = require("../../services/tenant/registry.service");
const currencyRepo = require("../../modules/master/currency/currency.repo");
const { getSetting } = require("../../shared/config/settings");

module.exports = async function fxSync(job) {
  const { tenantMeta, env = "live", base = "XAF", quotes = ["USD", "EUR"] } = job.data || {};
  if (!tenantMeta) throw new Error("fx-sync job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const key = await getSetting(c, "fx", "exchangerate_api_key", null);
    if (!key) return { skipped: true, reason: "no fx.exchangerate_api_key configured" };
    const url = "https://v6.exchangerate-api.com/v6/" + key + "/latest/" + base;
    const { data } = await axios.get(url, { timeout: 15000 });
    const rates = (data && data.conversion_rates) || {};
    const asOf = new Date().toISOString().slice(0, 10);
    const done = [];
    for (const quote of quotes) {
      if (!rates[quote]) continue;
      // eslint-disable-next-line no-await-in-loop
      await currencyRepo.upsertRate(c, { base, quote, rate: rates[quote], asOfDate: asOf, source: "exchangerate-api", isOverride: false });
      done.push(quote);
    }
    return { base, asOf, updated: done };
  });
};
