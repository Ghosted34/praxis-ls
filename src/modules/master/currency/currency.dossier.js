/**
 * Currency 360 (MOD-08) — one call returns everything the per-currency dossier
 * renders, modelled on entity-360 but far smaller: the tenant record, its
 * catalogue facts (ISO numeric, canonical name/symbol/decimals, the countries
 * that trade in it), the rate history vs base with its sparkline, the last feed
 * sync and the manual-override audit, and where the currency is used across the
 * system.
 *
 * Built to render for a currency with ZERO rates and ZERO usage — every list
 * defaults to [] and every figure to 0 — so a just-added currency shows a
 * working page that explains what is missing, not an error.
 *
 * The base currency has no base→self pair, so its rate blocks are empty by
 * construction (a currency is always 1:1 with itself); the client shows the
 * "base" state instead of an empty rate table.
 */
"use strict";
const repo = require("./currency.repo");
const { currencies } = require("@praxis/shared");
const { AppError } = require("../../../utils/errors");

async function dossier(client, code) {
  const currency = await repo.getCurrency(client, code);
  if (!currency) throw new AppError("NOT_FOUND", "Currency not found", 404);

  const base = await repo.getBaseCode(client);
  const isBase = currency.is_base === true;

  // Rates are stored base→quote; the dossier shows this currency AS a quote of
  // base. The base itself has no such pair.
  const pair = base && !isBase ? { base, quote: code } : null;
  // First page of the Gate-0 rate-history contract; the client pages the rest
  // through GET /currencies/rate-history. `rate_history_total`/`has_more` let the
  // UI show a "load more" without a second request just to learn the count.
  const HISTORY_PAGE = 50;

  // These four reads are INDEPENDENT (audit #10 — dossier query count/latency):
  // rate history, last feed sync, override log and the usage scan don't depend on
  // each other, so run them concurrently on the one tenant client instead of the
  // old sequential await-chain. `usageForCode` is the expensive cross-table scan;
  // overlapping it with the cheap rate reads hides most of its cost.
  const [history, last_sync, overrides, usage] = await Promise.all([
    pair ? repo.rateHistory(client, { ...pair, limit: HISTORY_PAGE, offset: 0 }) : Promise.resolve({ rows: [], total: 0, limit: HISTORY_PAGE, offset: 0 }),
    pair ? repo.lastSync(client, pair) : Promise.resolve(null),
    pair ? repo.overrideLog(client, { ...pair, limit: 25 }) : Promise.resolve([]),
    repo.usageForCode(client, code),
  ]);
  const rate_history = history.rows;
  const rate_history_total = history.total;
  const rate_history_has_more = history.offset + history.rows.length < history.total;
  const usage_total = usage.reduce((sum, u) => sum + u.count, 0);

  return {
    currency,
    base,
    is_base: isBase,
    // Canonical facts from @praxis/shared — numeric code, and the countries that
    // trade in it (the "where it's used in the world" panel).
    catalogue: currencies.byCode(code) || null,
    countries: currencies.countriesFor(code),
    rate_history,
    rate_history_total,
    rate_history_page_size: HISTORY_PAGE,
    rate_history_has_more,
    latest_rate: rate_history[0] || null,
    last_sync,
    overrides,
    usage,
    usage_total,
  };
}

module.exports = { dossier };
