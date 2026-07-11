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

module.exports = { pickRate, convert };
