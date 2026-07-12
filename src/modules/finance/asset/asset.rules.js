/**
 * Asset depreciation engine (MOD-54) — pure, no I/O (KB §11).
 * Builds a monthly depreciation schedule from an asset's cost, residual value,
 * useful life and method. Depreciable base = acquisition_cost − residual_value.
 * LINEAR: equal instalments. DECLINING: a fixed rate on the reducing net book
 * value, never taking NBV below residual, with the final period absorbing rounding.
 */
"use strict";

const round = (n) => Math.round(Number(n) * 100) / 100;

/** 'YYYY-MM' for the month `offset` months after a start date. */
function periodOf(startDate, offset) {
  const d = new Date(startDate + "T00:00:00Z");
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + offset;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function buildSchedule(asset = {}, opts = {}) {
  const cost = Number(asset.acquisition_cost || 0);
  const residual = Number(asset.residual_value || 0);
  const life = parseInt(asset.useful_life_months, 10);
  const method = asset.method || "LINEAR";
  const start = String(asset.acquired_on || "").slice(0, 10);
  const base = round(cost - residual);
  if (!life || life <= 0 || base <= 0 || !start) return [];

  const rows = [];
  if (method === "DECLINING") {
    // Declining-balance rate: default 2× the straight-line rate (configurable).
    const factor = Number(opts.decliningFactor || 2);
    const rate = (factor * 1) / life; // monthly rate
    let nbv = cost;
    for (let i = 0; i < life; i += 1) {
      let amount = round(nbv * rate);
      // Don't depreciate below residual; last period takes the remainder.
      if (i === life - 1 || nbv - amount < residual) amount = round(nbv - residual);
      if (amount < 0) amount = 0;
      rows.push({ period_code: periodOf(start, i), amount });
      nbv = round(nbv - amount);
      if (nbv <= residual) break;
    }
  } else {
    const monthly = round(base / life);
    let accumulated = 0;
    for (let i = 0; i < life; i += 1) {
      let amount = monthly;
      if (i === life - 1) amount = round(base - accumulated); // absorb rounding
      accumulated = round(accumulated + amount);
      rows.push({ period_code: periodOf(start, i), amount });
    }
  }
  return rows;
}

/** Sum of a schedule (should equal the depreciable base). */
function scheduleTotal(rows) {
  return round((rows || []).reduce((s, r) => s + Number(r.amount || 0), 0));
}

module.exports = { buildSchedule, scheduleTotal, periodOf };
