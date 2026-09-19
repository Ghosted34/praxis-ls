/**
 * FX resolution (MOD-08) — pure. Given fx_rate_daily rows, resolve the rate to
 * apply for (base→quote) at a date: identity when base===quote; else the latest
 * row on/before the date, preferring a manual override over the feed. Returns
 * null when no rate is known (caller falls back / errors).
 */
"use strict";

function pickRate(rows, base, quote, date) {
  if (base === quote) return { rate: 1, source: "identity", as_of_date: date, is_override: false };
  const onOrBefore = rows
    .filter((r) => r.base_code === base && r.quote_code === quote && r.as_of_date <= date)
    .sort((a, b) => {
      if (a.as_of_date !== b.as_of_date) return a.as_of_date < b.as_of_date ? 1 : -1; // newest first
      return (b.is_override ? 1 : 0) - (a.is_override ? 1 : 0); // override wins on same date
    });
  return onOrBefore[0] || null;
}

/** Convert an amount base→quote given a rate row; rounds to 2 decimals. */
function convert(amount, rateRow) {
  if (!rateRow) return null;
  return Math.round(Number(amount) * Number(rateRow.rate) * 100) / 100;
}

/**
 * Rebase the current cross-rate table from OLD base to NEW base — PURE.
 *
 * Rates are stored "1 base = rate × quote". To make NEW the anchor we need, for
 * every quote currency, the current NEW→quote rate, plus the NEW→OLD rate so the
 * old base stays priced. We derive them from the OLD→quote table:
 *
 *   old→new = R (the current OLD base → NEW rate; required — you cannot rebase
 *              onto a currency you have no rate for)
 *   new→quote = (old→quote) / R      — cancels the OLD base out of the cross
 *   new→old   = 1 / R                — the reciprocal keeps OLD priced under NEW
 *   new→new   = skipped              — a base is 1:1 with itself, never stored
 *
 * `rows` is the DISTINCT-ON-quote current table for OLD (repo.latestRatesFromBase):
 * `[{ quote_code, rate }]`. Returns `{ pairs: [{ quote, rate }], missing }` where
 * `pairs` are NEW→quote rows to write and `missing` is true when OLD→NEW is
 * unknown (the caller refuses the rebase — there is no meaningful anchor).
 *
 * Precision: division can produce long decimals; fx_rate_daily is numeric(18,8),
 * so we round to 8 dp here to match what the column would store, keeping the
 * pure math and the persisted value identical for tests.
 */
function round8(n) {
  return Math.round(Number(n) * 1e8) / 1e8;
}

function rebaseRates(rows, oldBase, newBase) {
  if (oldBase === newBase) return { pairs: [], missing: false };
  const byQuote = new Map();
  for (const r of rows || []) byQuote.set(r.quote_code, Number(r.rate));
  const oldToNew = byQuote.get(newBase);
  if (!(oldToNew > 0)) return { pairs: [], missing: true };

  const pairs = [];
  // NEW→OLD: the reciprocal of OLD→NEW keeps the old base priced under the new one.
  pairs.push({ quote: oldBase, rate: round8(1 / oldToNew) });
  // NEW→every other quote: cancel OLD out of the cross-rate.
  for (const [quote, rate] of byQuote) {
    if (quote === newBase || quote === oldBase) continue; // self / handled above
    if (!(rate > 0)) continue;
    pairs.push({ quote, rate: round8(rate / oldToNew) });
  }
  return { pairs, missing: false };
}

module.exports = { pickRate, convert, rebaseRates, round8 };
