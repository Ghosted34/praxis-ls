"use strict";
/**
 * F7 — the seven-stage ladder, as a freshly provisioned tenant actually gets it.
 *
 * WHY A REAL DATABASE. The unit suite asserts `opportunity.rules.DEFAULT_STAGES`,
 * which is a hand-written constant, and reads 0686's SQL as text. Both passed
 * while a provisioned tenant had something else entirely: `migrateTenantDb`
 * applies migrations/tenant/* BEFORE migrations/seeds/90*, so 0686 ran against
 * an empty `pipeline_stage` — its `UPDATE … SET default_probability` statements
 * matched no rows, and its gap-opening shift had nothing to shift. Seed 9030
 * then inserted the six defaults on top, leaving PROPOSAL and
 * PRICING_IN_PROGRESS both at sort_order 2 and six of seven stages with a NULL
 * probability.
 *
 * That is not cosmetic. `opportunity.probability` is derived from
 * `pipeline_stage.default_probability`, so on a fresh tenant every deal got a
 * NULL probability and the board's forecast column read 0 — a 10,000,000 XAF
 * deal in NEW reported `weighted_value: 0`.
 *
 * seeds/9031 repairs it for both populations. This test is the proof that only
 * a database can give, and it is the reason the fix is not "trust the SQL".
 *
 * Skipped unless DATABASE_URL is set, per the convention in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("F7 pipeline_stage ladder (real Postgres)", () => {
  let pool, rows;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const c = await pool.connect();
    try {
      await c.query("SET search_path = live, public");
      rows = (
        await c.query(
          "SELECT code, sort_order, default_probability, is_won, is_lost FROM pipeline_stage ORDER BY sort_order",
        )
      ).rows;
    } finally {
      c.release();
    }
  });

  afterAll(async () => pool && pool.end());

  test("all seven stages are seeded, PRICING_IN_PROGRESS included", () => {
    const codes = rows.map((r) => r.code).sort();
    expect(codes).toEqual(
      [
        "LOST",
        "NEGOTIATION",
        "NEW",
        "PRICING_IN_PROGRESS",
        "PROPOSAL",
        "QUALIFIED",
        "WON",
      ].sort(),
    );
  });

  test("no two stages share a sort_order", () => {
    const orders = rows.map((r) => Number(r.sort_order));
    expect(new Set(orders).size).toBe(orders.length);
  });

  test("pricing sits between qualified and proposal", () => {
    const at = (code) => Number(rows.find((r) => r.code === code).sort_order);
    expect(at("QUALIFIED")).toBeLessThan(at("PRICING_IN_PROGRESS"));
    expect(at("PRICING_IN_PROGRESS")).toBeLessThan(at("PROPOSAL"));
  });

  test("every stage carries a probability, so the forecast column is not zero", () => {
    for (const r of rows) {
      expect(r.default_probability).not.toBeNull();
    }
    const p = (code) => Number(rows.find((r) => r.code === code).default_probability);
    expect(p("NEW")).toBe(10);
    expect(p("QUALIFIED")).toBe(30);
    expect(p("PRICING_IN_PROGRESS")).toBe(50);
    expect(p("PROPOSAL")).toBe(70);
    expect(p("WON")).toBe(100);
    expect(p("LOST")).toBe(0);
  });

  test("the shipped default ladder and the database agree", () => {
    const { DEFAULT_STAGES } = require("../../src/modules/sales/opportunity/opportunity.rules");
    const dbOrder = rows.map((r) => r.code);
    const codeOrder = [...DEFAULT_STAGES]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => s.code);
    expect(dbOrder).toEqual(codeOrder);
    for (const s of DEFAULT_STAGES) {
      const row = rows.find((r) => r.code === s.code);
      expect(Number(row.default_probability)).toBe(s.probability);
    }
  });
});
