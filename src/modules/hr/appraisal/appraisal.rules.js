/** Appraisal pure rules (MOD-13) — KPI attainment → rating. */
"use strict";

/**
 * Rating on a 0–5 scale from attainment (actual / target), capped at 5.
 * target ≤ 0 or missing → null (cannot score without a target). "Lower is
 * better" metrics aren't modelled here; the caller can pass a precomputed rating.
 */
function computeRating(actual, target) {
  const a = Number(actual);
  const t = Number(target);
  if (!Number.isFinite(a) || !Number.isFinite(t) || t <= 0) return null;
  const rating = (a / t) * 5;
  return Math.round(Math.min(rating, 5) * 100) / 100; // cap at 5
}

/** Weighted contribution of a rating (rating × weight%). */
function weightedScore(rating, weight) {
  const r = Number(rating || 0);
  const w = Number(weight || 0);
  return Math.round(r * (w / 100) * 100) / 100;
}

module.exports = { computeRating, weightedScore };
