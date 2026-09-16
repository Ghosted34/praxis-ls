"use strict";

/**
 * The posted-HT read is SIGNED (MOD-76 PR 2 follow-up).
 *
 * settle() posts a downward correction as a `reconciliation_reversal` cost_entry
 * with a POSITIVE amount — chk_cost_entry_amount_nonneg (0497) forbids a
 * negative — and lets the journal move the money the other way. The ledger
 * therefore treats that row as a credit, so every read of "HT already posted to
 * this line" MUST subtract it. An unsigned `SUM(ce.amount)` reads a correction
 * DOWN as spend UP, and because settle() computes each line's delta as
 * `target − posted`, the inflated read feeds straight back into the next delta
 * and the error COMPOUNDS into the ledger on every re-settle.
 *
 * There is no live Postgres in unit tests, so these pin the invariant where it
 * lives — in the SQL text of the two live reads. The writer half (settle stamps
 * exactly this category) is pinned in budget-reconciliation-settlement.test.js;
 * the two must name the SAME category string or the read and the write drift
 * apart, which is the whole bug.
 */

const repo = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.repo");

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function sqlCapturingClient() {
  const seen = [];
  return {
    seen,
    async query(sql) {
      seen.push(sql);
      return { rows: [] };
    },
  };
}

const SIGNED = /WHEN ce\.category = 'reconciliation_reversal' THEN -ce\.amount/g;

describe("posted_ht / posted_ttc subtract reconciliation reversals", () => {
  test("gridFor signs BOTH posted_ht and posted_ttc", async () => {
    const c = sqlCapturingClient();
    await repo.gridFor(c, { dossierId: UUID(1), reconciliationId: UUID(2) });
    const sql = c.seen.join("\n");
    const hits = sql.match(SIGNED) || [];
    // Two sites: the posted_ht sum, and the posted_ttc gross-up that reuses it.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // And the naive unsigned form must not be what the post-LATERAL sums.
    expect(sql).not.toMatch(/AS posted_ht,\s*\n\s*ROUND\(COALESCE\(SUM\(ce\.amount\), 0\)/);
  });

  test("postedTotalsByLine signs the sum", async () => {
    const c = sqlCapturingClient();
    await repo.postedTotalsByLine(c, { dossierId: UUID(1), reconciliationId: UUID(2) });
    const sql = c.seen.join("\n");
    expect(sql).toMatch(/WHEN ce\.category = 'reconciliation_reversal' THEN -ce\.amount/);
  });
});
