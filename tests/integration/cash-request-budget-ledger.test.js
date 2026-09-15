"use strict";

/**
 * The budget ledger against a REAL Postgres (migration 12771).
 *
 * ── WHY THIS EXISTS AS AN INTEGRATION TEST ─────────────────────────────────
 *
 * `tests/unit/cash-request-budget.test.js` pins the arithmetic, and it is pure,
 * so it can prove that 150 000 minus a 100 000 claim leaves 50 000. What it
 * cannot prove is that the SQL which produces those inputs is right — and the
 * SQL is where the interesting mistakes live. Writing this test found one: a
 * settled line's disbursed share was scaled by the request's paid ratio a
 * SECOND time, so a request settled at 1 000 000 reported 377 358 disbursed.
 * The unit tests could not have caught it; a person reading the column would
 * have believed it.
 *
 * The scenario is the owner's own worked example, walked end to end:
 * Port Charges 150 000, Customs Duties 2 500 000, Terminal Handling 2 × 99 000
 * plus the carrier's VAT — all three débours, which is what a cash request
 * mostly pays.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (CI sets it
 * after `provision-tenant`); self-skips otherwise, like every other suite here.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("cash-request budget ledger (real Postgres)", () => {
  let pool;
  let client;
  let repo;
  let rules;
  const ids = {};

  const round2 = (n) => Math.round(Number(n) * 100) / 100;

  /** The ledger, summarised, keyed by budget line for readable assertions. */
  async function ledger() {
    const { lines, totals } = rules.summariseBudget(await repo.budgetForCosting(client, ids.costing));
    return { by: new Map(lines.map((l) => [l.costing_line_id, l])), lines, totals };
  }

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("SET search_path TO live, public");
    repo = require("../../src/modules/costing/costing/costing.repo");
    rules = require("../../src/modules/costing/costing/costing.rules");

    const cl = await client.query("INSERT INTO client_master (name) VALUES ($1) RETURNING client_id", ["Budget Ledger Test Co"]);
    ids.client = cl.rows[0].client_id;
    const ds = await client.query("INSERT INTO dossier (ref, client_id) VALUES ($1,$2) RETURNING dossier_id", [`BLT-${Date.now()}`, ids.client]);
    ids.dossier = ds.rows[0].dossier_id;
    const cs = await client.query(
      "INSERT INTO costing (dossier_id, currency, exchange_rate_to_xaf, status, doc_number) " +
        "VALUES ($1,'XAF',1,'APPROVED_LOCKED',$2) RETURNING costing_id",
      [ids.dossier, `CST-BLT-${Date.now()}`],
    );
    ids.costing = cs.rows[0].costing_id;

    const line = async (no, label, qty, unit, upstreamVat) => (await client.query(
      "INSERT INTO costing_line (costing_id, line_no, label, qty, unit_cost, is_disbursement, upstream_vat_amount) " +
        "VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING costing_line_id",
      [ids.costing, no, label, qty, unit, upstreamVat],
    )).rows[0].costing_line_id;

    ids.port = await line(1, "Port Charges", 1, 150000, null);
    ids.duties = await line(2, "Customs Duties & Taxes", 1, 2500000, null);
    ids.thc = await line(3, "Terminal Handling (THC)", 2, 99000, 38115);
  });

  afterAll(async () => {
    if (client) {
      // Children first — cash_request_line is RESTRICT onto costing_line, which
      // is the constraint this whole feature rides on.
      await client.query("DELETE FROM cash_request_line WHERE cash_request_id IN (SELECT cash_request_id FROM cash_request WHERE dossier_id = $1)", [ids.dossier]);
      await client.query("DELETE FROM cash_request WHERE dossier_id = $1", [ids.dossier]);
      await client.query("DELETE FROM costing_line WHERE costing_id = $1", [ids.costing]);
      await client.query("DELETE FROM costing WHERE costing_id = $1", [ids.costing]);
      await client.query("DELETE FROM dossier WHERE dossier_id = $1", [ids.dossier]);
      await client.query("DELETE FROM client_master WHERE client_id = $1", [ids.client]);
      client.release();
    }
    if (pool) await pool.end();
  });

  /** A cash request with lines against named budget lines. */
  async function raise({ status, amount, disbursed = 0, claims }) {
    const cr = await client.query(
      "INSERT INTO cash_request (dossier_id, costing_id, status, amount, disbursed_amount, category, currency) " +
        "VALUES ($1,$2,$3,$4,$5,'OPS','XAF') RETURNING cash_request_id",
      [ids.dossier, ids.costing, status, amount, disbursed],
    );
    const id = cr.rows[0].cash_request_id;
    let no = 0;
    for (const [costingLineId, net, vatPercent] of claims) {
      no += 1;
       
      await client.query(
        "INSERT INTO cash_request_line (cash_request_id, costing_line_id, label, qty, unit_cost, budget_amount, vat_percent, line_no, source) " +
          "VALUES ($1,$2,'claim',1,$3,$3,$4,$5,'IMPORTED')",
        [id, costingLineId, net, vatPercent, no],
      );
    }
    return id;
  }

  test("the budget is the costing line, TTC — including the carrier's VAT on a débours", async () => {
    const { by, totals } = await ledger();
    expect(by.get(ids.port).budget).toBe(150000);
    expect(by.get(ids.duties).budget).toBe(2500000);
    // 2 × 99 000 net plus the supplier's 38 115, budgeted because it is cash
    // we hand over (12768).
    expect(by.get(ids.thc).budget).toBe(236115);
    expect(totals.budget).toBe(2886115);
    expect(totals.remaining).toBe(2886115);
  });

  test("an APPROVED request commits its lines BEFORE any cash moves", async () => {
    // The defect this prevents: between approval and payment the budget would
    // read as free, so a second request gets approved against headroom the
    // first was already promised — two valid approvals, one overspent file.
    ids.first = await raise({
      status: "APPROVED", amount: 2650000,
      claims: [[ids.port, 150000, null], [ids.duties, 2500000, null]],
    });
    const { by, totals } = await ledger();
    expect(by.get(ids.port).remaining).toBe(0);
    expect(by.get(ids.duties).remaining).toBe(0);
    expect(by.get(ids.thc).remaining).toBe(236115);
    expect(totals.committed).toBe(2650000);
    expect(totals.disbursed).toBe(0);
  });

  test("paying an instalment apportions across the lines and sums to the cash issued", async () => {
    await client.query("UPDATE cash_request SET status='PARTIALLY_DISBURSED', disbursed_amount=1000000 WHERE cash_request_id=$1", [ids.first]);
    const { totals } = await ledger();
    expect(round2(totals.disbursed)).toBe(1000000);
    // Commitment is unmoved by payment — it was taken at approval.
    expect(totals.committed).toBe(2650000);
  });

  test("a SUBMITTED request is pending and consumes nothing", async () => {
    ids.second = await raise({ status: "SUBMITTED", amount: 100000, claims: [[ids.thc, 100000, null]] });
    const { by } = await ledger();
    expect(by.get(ids.thc).remaining).toBe(236115);
    expect(by.get(ids.thc).pending).toBe(100000);
  });

  test("settling short releases the unpaid commitment and reports the cash once", async () => {
    // CLOSE_BALANCE writes each line's pro-rata share of what was actually
    // paid. The bug this pins: that share was then scaled by the request's paid
    // ratio a second time, so a request settled at 1 000 000 reported 377 358.
    await client.query(
      "UPDATE cash_request_line SET settled_amount = ROUND(budget_amount * 1000000.0 / 2650000, 2) WHERE cash_request_id = $1",
      [ids.first],
    );
    await client.query("UPDATE cash_request SET status='CLOSED_SHORT' WHERE cash_request_id=$1", [ids.first]);
    const { totals, by } = await ledger();
    expect(round2(totals.committed)).toBe(1000000);
    expect(round2(totals.disbursed)).toBe(1000000);
    // The headroom the treasury will never spend is claimable again.
    expect(by.get(ids.duties).remaining).toBeGreaterThan(1500000);
  });

  test("a budget amended below its commitments goes NEGATIVE, it does not clamp", async () => {
    // The owner's case: a line reduced under what is already committed must
    // read over-consumed, so the difference can be reallocated or refunded.
    // Clamping at zero would hide the one row somebody has to act on.
    await client.query("UPDATE costing_line SET unit_cost = 40000 WHERE costing_line_id = $1", [ids.port]);
    const { by, totals } = await ledger();
    expect(by.get(ids.port).budget).toBe(40000);
    expect(by.get(ids.port).remaining).toBeLessThan(0);
    expect(by.get(ids.port).over_committed).toBe(true);
    expect(totals.over_committed_lines).toBe(1);
  });

  test("a claimed budget line cannot be deleted out from under its claim", async () => {
    // The FK is RESTRICT on purpose: SET NULL would orphan the claim and the
    // committed amount would silently vanish from the ledger.
    await expect(
      client.query("DELETE FROM costing_line WHERE costing_line_id = $1", [ids.port]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
