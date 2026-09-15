/**
 * The band's query guards.
 *
 * The contract is `dashboard.repo.js`'s — `count()` answers 0 for empty and
 * null when the table is not there; `num()` preserves SQL NULL so "0" and
 * "nothing was measured" stay different values — restated HERE rather than
 * imported because of the guide's structural promise (§5.6): the legacy
 * endpoint's keys freeze where they are, the band's queries evolve in the
 * domain files, and the shared text is the SEMANTICS, which are nine lines
 * and fully covered by this module's tests. Two functions that must never
 * drift are a require away from drifting only if one of them grows quietly;
 * the growth of the band happens here and nowhere else after PR-1.
 *
 * `ratio` is the band's third guard and the new one: `{ value, denominator }`
 * or null, so a pct tile can tell "0 % on time over 30 arrivals" from "0 %
 * over nothing". The card renders 0 either way (the assert-the-zero policy,
 * D3) but the drill-down and the hint line must know the difference (§6.4).
 */
"use strict";

// The catch bodies RETURN the fallback rather than being comment-only: that is
// `dashboard.repo.js`'s existing shape (`catch { return null; }`), it satisfies
// the silent-catch scanner without inventing a taxonomy entry, and it keeps
// the contract — "guard failed" and "guard answered" are different returns —
// visible on the same line rather than in a marker.

/** count → integer, null when the relation/query is missing. */
async function count(client, sql) {
  try { const { rows } = await client.query(sql); return Number(rows[0].n); } catch { return null; }
}

/** scalar → number, SQL NULL preserved as null. */
async function num(client, sql) {
  try {
    const { rows } = await client.query(sql);
    const v = rows[0] && rows[0].n;
    return v === null || v === undefined ? null : Number(v);
  } catch { return null; }
}

/** two columns → { value, denominator }; null only when the query itself fails. */
async function ratio(client, sql) {
  try {
    const { rows } = await client.query(sql);
    if (!rows[0]) return null;
    const value = rows[0].value;
    return {
      value: value === null || value === undefined ? 0 : Number(value),
      denominator: Number(rows[0].denominator) || 0,
    };
  } catch { return null; }
}

module.exports = { count, num, ratio };
