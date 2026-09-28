/**
 * How a costing's lines are split across A4 pages.
 *
 * ── THE RULE (owner decision, 28 Sep 2026) ─────────────────────────────────
 *
 *   · Up to ONE_PAGE_MAX lines (17): everything on one page — header, client,
 *     shipment, lines, totals, remark, the three seals. Tenants reject a
 *     costing that spills with fewer lines than that.
 *   · Above it: page 1 carries FIRST_PAGE lines (12) under the full header;
 *     the rest continue on page 2 under the repeated table header, with the
 *     totals and seals after them.
 *   · The last page holds at most LAST_PAGE_MAX lines (22) — it also carries
 *     the totals and the seals. At 35 lines that is exceeded, so a third page
 *     opens; a middle page (no totals, no seals) holds up to MIDDLE_PAGE_MAX.
 *
 * ── BALANCE ─────────────────────────────────────────────────────────────────
 *
 * The continuation pages share the remaining lines evenly rather than filling
 * one and leaving a single orphan line above the totals on the next: 35 lines
 * print as 12 / 12 / 11, not 12 / 22 / 1.
 *
 * Pure and deterministic from the line count, so the split is unit-tested
 * here and the layout that honours it is measured by
 * `scripts/dev/measure-costing.js`.
 */
"use strict";

const ONE_PAGE_MAX = 17;
const FIRST_PAGE = 12;
const LAST_PAGE_MAX = 22;
const MIDDLE_PAGE_MAX = 30;

/**
 * @param {number} n  line count
 * @returns {number[]} lines per page, in page order; always at least one page
 */
function paginate(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count <= ONE_PAGE_MAX) return [count];

  const rest = count - FIRST_PAGE;
  if (rest <= LAST_PAGE_MAX) return [FIRST_PAGE, rest];

  // Continuation pages needed: the last holds LAST_PAGE_MAX, the middles more.
  let cont = 2;
  while ((cont - 1) * MIDDLE_PAGE_MAX + LAST_PAGE_MAX < rest) cont += 1;

  // Even split, with the last page capped (it also carries totals and seals);
  // whatever the cap pushes back goes to the middle pages, still evenly.
  const last = Math.min(LAST_PAGE_MAX, Math.floor(rest / cont));
  const middles = cont - 1;
  const midTotal = rest - last;
  const base = Math.floor(midTotal / middles);
  const extra = midTotal % middles;
  const mids = Array.from({ length: middles }, (_, i) => base + (i < extra ? 1 : 0));
  return [FIRST_PAGE, ...mids, last];
}

/** Split an array of lines by `paginate`. */
function chunk(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const sizes = paginate(list.length);
  const out = [];
  let at = 0;
  for (const size of sizes) {
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out;
}

module.exports = { paginate, chunk, ONE_PAGE_MAX, FIRST_PAGE, LAST_PAGE_MAX, MIDDLE_PAGE_MAX };
