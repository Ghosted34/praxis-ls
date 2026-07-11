/** Cycle count pure rules (MOD-38) — discrepancy summary. */
"use strict";

/**
 * Summarise a discrepancy payload. Accepts an array of line objects shaped
 * { item_id?, expected, counted } and returns net/absolute variance and whether
 * any line is off. Non-array / empty input → a clean zero summary.
 */
function summariseDiscrepancy(discrepancy) {
  const lines = Array.isArray(discrepancy) ? discrepancy : Array.isArray(discrepancy?.lines) ? discrepancy.lines : [];
  let net = 0;
  let absolute = 0;
  let offLines = 0;
  for (const l of lines) {
    const diff = Number(l.counted || 0) - Number(l.expected || 0);
    if (diff !== 0) offLines += 1;
    net += diff;
    absolute += Math.abs(diff);
  }
  return { lines: lines.length, off_lines: offLines, net_variance: net, absolute_variance: absolute, has_discrepancy: offLines > 0 };
}

module.exports = { summariseDiscrepancy };
