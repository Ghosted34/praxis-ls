"use strict";
/**
 * F6 KPI partition proof, against a real Postgres.
 *
 * THE INVARIANT: every quote_request row lands in exactly one tile, and the
 * tiles sum to the visible TOTAL under any non-status filter. The legacy showed
 * 5 of 26 rows because intake statuses and pipeline stages shared one column,
 * so its KPI query counted only the intake-named rows and the rest leaked
 * silently. `quote_request.rules` derives one tile per status from the status
 * list itself and `assertPartitions` proves the fold; this test proves the same
 * thing end to end, through the SQL.
 *
 * TWO THINGS THIS TEST GOT WRONG BEFORE, both invisible because it is skipped
 * unless DATABASE_URL is set:
 *
 *   1. It asserted on `repo.list(...).kpi`. The repo returns `kpiRows` — the
 *      raw GROUP BY — and the fold into tiles happens in the SERVICE. Every
 *      assertion in it would have thrown on `undefined`. It goes through
 *      `service.list` now, which is also what the controller calls, so the test
 *      exercises the path the register actually uses.
 *
 *   2. It asserted a hand-listed FIVE tiles and described CLARIFICATION_REQUIRED
 *      and CLOSED_NO_ACTION as counting toward TOTAL but appearing in no tile —
 *      "the same split the legacy had". That is the defect, not the design.
 *
 * Skipped unless DATABASE_URL is set (per the test-env convention used by the
 * other integration tests in tests/integration/).
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("F6 quote_request KPI partition (real Postgres)", () => {
  let pool, service, rules;
  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    service = require("../../src/modules/sales/quote_request/quote_request.service");
    rules = require("../../src/modules/sales/quote_request/quote_request.rules");

    // The migrator is keyed on the relative path; the CI step that calls this
    // test runs the standard tenant set first, so the F6 migration should
    // already be in the ledger. Assert the table exists before going further.
    const { rows: tbl } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'quote_request' LIMIT 1",
    );
    if (tbl.length === 0) {
      throw new Error(
        "quote_request table not present — apply migrations/tenant/0683_sales_crm_f6_lead_intake.sql first.",
      );
    }
  });

  afterAll(async () => { if (pool) await pool.end(); });

  /** Sum every status tile plus OTHER — what assertPartitions checks, restated. */
  const sumTiles = (kpi) =>
    rules.STATUSES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER || 0);

  test("the KPI tiles partition the result set under any filter", async () => {
    // 2 RECEIVED, 1 UNDER_REVIEW, 1 CLARIFICATION_REQUIRED, 1 QUOTED,
    // 1 CONVERTED, 1 CLOSED_NO_ACTION = 7 rows.
    const marker = "KPI-" + Date.now();
    const seed = [
      { status: "RECEIVED", channel: "WEBSITE", ref: marker + "-R1" },
      { status: "RECEIVED", channel: "MANUAL", ref: marker + "-R2" },
      { status: "UNDER_REVIEW", channel: "MANUAL", ref: marker + "-U1" },
      { status: "QUOTED", channel: "MANUAL", ref: marker + "-Q1" },
      { status: "CONVERTED_TO_OPPORTUNITY", channel: "MANUAL", ref: marker + "-C1" },
      { status: "CLOSED_NO_ACTION", channel: "MANUAL", ref: marker + "-X1" },
      { status: "CLARIFICATION_REQUIRED", channel: "WEBSITE", ref: marker + "-L1" },
    ];
    for (const r of seed) {
      await pool.query(
        "INSERT INTO quote_request (public_ref, intake_channel, requester_name, incoterm, status) VALUES ($1, $2, $3, $4, $5)",
        [r.ref, r.channel, "Test " + r.ref, "FOB", r.status],
      );
    }
    try {
      // 1. No filter. Every one of the 7 rows is in a tile — including the two
      //    the previous version of this test expected to disappear.
      const all = await service.list(pool, { q: marker });
      expect(all.total).toBe(7);
      expect(all.kpi.TOTAL).toBe(7);
      expect(sumTiles(all.kpi)).toBe(7);
      expect(all.kpi.RECEIVED).toBe(2);
      expect(all.kpi.UNDER_REVIEW).toBe(1);
      expect(all.kpi.CLARIFICATION_REQUIRED).toBe(1);
      expect(all.kpi.QUOTED).toBe(1);
      expect(all.kpi.CONVERTED_TO_OPPORTUNITY).toBe(1);
      expect(all.kpi.CLOSED_NO_ACTION).toBe(1);
      // Nothing unrecognised — the CHECK constraint holds.
      expect(all.kpi.OTHER).toBeUndefined();

      // 2. A non-status filter narrows BOTH the list and the summary, and they
      //    still add up: 2 WEBSITE rows, one RECEIVED and one
      //    CLARIFICATION_REQUIRED.
      const web = await service.list(pool, { q: marker, intake_channel: "WEBSITE" });
      expect(web.total).toBe(2);
      expect(web.kpi.TOTAL).toBe(2);
      expect(sumTiles(web.kpi)).toBe(2);
      expect(web.kpi.RECEIVED).toBe(1);
      expect(web.kpi.CLARIFICATION_REQUIRED).toBe(1);
      expect(web.kpi.QUOTED).toBe(0);

      // 3. The STATUS filter narrows the list and is DROPPED from the summary.
      //    Applying it to both would make one tile equal the total and the rest
      //    zero — a tautology, and the legacy's version of it is why a user
      //    filtering to RECEIVED saw "UNDER_REVIEW: 0, QUOTED: 0" and concluded
      //    the other rows were missing data.
      const recv = await service.list(pool, { q: marker, status: "RECEIVED" });
      expect(recv.total).toBe(2);
      expect(recv.kpi.TOTAL).toBe(7);
      expect(sumTiles(recv.kpi)).toBe(7);
      expect(recv.kpi.RECEIVED).toBe(2);
      expect(recv.kpi.UNDER_REVIEW).toBe(1);
      expect(recv.kpi.CLOSED_NO_ACTION).toBe(1);
    } finally {
      // Clean up the marker rows so the test is idempotent.
      await pool.query("DELETE FROM quote_request WHERE public_ref LIKE $1", [marker + "%"]);
    }
  });

  /**
   * A status the enum does not know must show up as a discrepancy rather than
   * unbalancing the tiles. The CHECK constraint should make this unreachable,
   * so the row is written by dropping the constraint for the length of the
   * insert — the point is that the FOLD is safe even when the table is not,
   * because a value written before a constraint change, or by a hand-run
   * UPDATE, is exactly how the legacy's counters stopped adding up.
   */
  test("an unconstrained status value surfaces as OTHER, never as a silent loss", async () => {
    const marker = "KPIX-" + Date.now();
    // The definition is captured VERBATIM and put back verbatim. Rebuilding it
    // from a hard-coded status list here would mean that the day someone adds a
    // seventh status, this test quietly restores a constraint that forbids it —
    // a cleanup path that corrupts the schema it was meant to leave alone.
    const { rows: con } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'quote_request'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
        LIMIT 1`,
    );
    if (con.length === 0) return; // no status CHECK to lift — nothing to prove
    const { conname: name, def } = con[0];
    await pool.query(`ALTER TABLE quote_request DROP CONSTRAINT ${name}`);
    try {
      await pool.query(
        "INSERT INTO quote_request (public_ref, intake_channel, requester_name, incoterm, status) VALUES ($1,$2,$3,$4,$5)",
        [marker + "-SP", "MANUAL", "Test legacy", "FOB", "SP-NEW"],
      );
      await pool.query(
        "INSERT INTO quote_request (public_ref, intake_channel, requester_name, incoterm, status) VALUES ($1,$2,$3,$4,$5)",
        [marker + "-R1", "MANUAL", "Test ok", "FOB", "RECEIVED"],
      );
      const out = await service.list(pool, { q: marker });
      expect(out.kpi.TOTAL).toBe(2);
      expect(out.kpi.RECEIVED).toBe(1);
      expect(out.kpi.OTHER).toBe(1);
      // service.list runs assertPartitions before returning; reaching here at
      // all means the tiles balanced with the stray row counted.
      expect(sumTiles(out.kpi)).toBe(2);
    } finally {
      await pool.query("DELETE FROM quote_request WHERE public_ref LIKE $1", [marker + "%"]);
      await pool.query(`ALTER TABLE quote_request ADD CONSTRAINT ${name} ${def}`);
    }
  });
});
