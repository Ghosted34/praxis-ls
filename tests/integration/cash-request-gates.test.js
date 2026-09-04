"use strict";

/**
 * The gates between a cash request and the money, against a REAL Postgres
 * (migration 12771 — owner decisions Q3, Q4, Q5).
 *
 * ── WHY THESE CANNOT BE PURE TESTS ─────────────────────────────────────────
 *
 * `assertFundable` is a decision taken over a LEDGER, and the ledger is SQL.
 * The pure suite pins the arithmetic; this pins what the service actually
 * refuses, in the order it refuses it, with the ledger it really reads.
 *
 * Writing it found a defect the pure tests structurally could not: the budget
 * control block counted a request against ITSELF the moment it was approved —
 * its own claim landed in `committed`, `remaining` dropped by it, and the same
 * claim then read as a breach of the budget it had just been approved against.
 * Every approved request would have carried a red "over budget" banner.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every other suite here.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("cash-request budget gates (real Postgres)", () => {
  let pool;
  let client;
  let svc;
  let costingSvc;
  const ids = {};

  /** Assert the service refuses with a particular error code. */
  async function refuses(fn, code) {
    await expect(fn()).rejects.toMatchObject({ code });
  }

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("SET search_path TO live, public");
    svc = require("../../src/modules/costing/cash_request/cash_request.service");
    costingSvc = require("../../src/modules/costing/costing/costing.service");

    ids.client = (await client.query("INSERT INTO client_master (name) VALUES ($1) RETURNING client_id", ["Gates Test Co"])).rows[0].client_id;
    ids.dossier = (await client.query("INSERT INTO dossier (ref, client_id) VALUES ($1,$2) RETURNING dossier_id", [`GTE-${Date.now()}`, ids.client])).rows[0].dossier_id;
    // Raised as a DRAFT on purpose — the first thing asserted is that a budget
    // nobody has approved cannot fund anything.
    ids.costing = (await client.query(
      "INSERT INTO costing (dossier_id, currency, exchange_rate_to_xaf, status, doc_number) VALUES ($1,'XAF',1,'DRAFT',$2) RETURNING costing_id",
      [ids.dossier, `CST-GTE-${Date.now()}`],
    )).rows[0].costing_id;

    const line = async (n, label, qty, unit, upstreamVat) => (await client.query(
      "INSERT INTO costing_line (costing_id, line_no, label, qty, unit_cost, is_disbursement, upstream_vat_amount) " +
        "VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING costing_line_id",
      [ids.costing, n, label, qty, unit, upstreamVat],
    )).rows[0].costing_line_id;
    ids.port = await line(1, "Port Charges", 1, 150000, null);
    ids.duties = await line(2, "Customs Duties & Taxes", 1, 2500000, null);
    ids.thc = await line(3, "Terminal Handling (THC)", 2, 99000, 38115);

    ids.request = (await svc.createDraft(client, {
      dossierId: ids.dossier, costingId: ids.costing, category: "OPS",
      beneficiary: "DHL Global Forwarding", disbursementMethod: "CASH", lines: [], actor: {},
    })).cash_request_id;
  });

  afterAll(async () => {
    if (client) {
      await client.query("DELETE FROM cash_request_line WHERE cash_request_id = $1", [ids.request]);
      await client.query("DELETE FROM cash_request WHERE cash_request_id = $1", [ids.request]);
      await client.query("DELETE FROM costing_line WHERE costing_id = $1", [ids.costing]);
      await client.query("DELETE FROM costing WHERE costing_id = $1", [ids.costing]);
      await client.query("DELETE FROM dossier WHERE dossier_id = $1", [ids.dossier]);
      await client.query("DELETE FROM client_master WHERE client_id = $1", [ids.client]);
      client.release();
    }
    if (pool) await pool.end();
  });

  // Q5 — no cash against a budget nobody has approved.
  test("a DRAFT costing funds nothing — not an import, not a submission", async () => {
    await refuses(() => svc.importCostingLines(client, { id: ids.request, actor: {} }), "COSTING_NOT_APPROVED");
    await refuses(() => svc.transition(client, { id: ids.request, to: "SUBMITTED", actor: {} }), "COSTING_NOT_APPROVED");
  });

  test("importing an approved costing claims what is LEFT, TTC, keeping the sheet's shape", async () => {
    await client.query("UPDATE costing SET status='APPROVED_LOCKED' WHERE costing_id=$1", [ids.costing]);
    const imported = await svc.importCostingLines(client, { id: ids.request, actor: {} });
    // 150 000 + 2 500 000 + (198 000 + the carrier's 38 115).
    expect(Number(imported.amount)).toBe(2886115);
    expect(imported.currency).toBe("XAF");
    const thc = imported.lines.find((l) => l.costing_line_id === ids.thc);
    // Nothing claimed yet, so the costing's own shape carries across verbatim —
    // an approver can see the container count change.
    expect(Number(thc.qty)).toBe(2);
    expect(Number(thc.unit_cost)).toBe(99000);
    expect(Number(thc.vat_percent)).toBeCloseTo(19.25, 2);
  });

  // Q4 — no money leaves without a costing.
  test("a line not drawn from the costing cannot be submitted", async () => {
    await svc.updateDraft(client, { id: ids.request, lines: [{ label: "Unbudgeted sundry", budget_amount: 5000 }], actor: {} });
    await refuses(() => svc.transition(client, { id: ids.request, to: "SUBMITTED", actor: {} }), "EVERY_LINE_NEEDS_BUDGET");
  });

  // Q3 — a reason at submission, a refusal at approval.
  test("over budget: submittable with a written reason, never approvable", async () => {
    await svc.updateDraft(client, {
      id: ids.request,
      lines: [{ costing_line_id: ids.port, label: "Port Charges", qty: 1, unit_cost: 180000 }],
      actor: {},
    });
    await refuses(() => svc.transition(client, { id: ids.request, to: "SUBMITTED", actor: {} }), "OVER_BUDGET_REASON_REQUIRED");

    await svc.transition(client, {
      id: ids.request, to: "SUBMITTED",
      overBudgetReason: "Carrier revised the tariff — unlock requested on the costing",
      actor: {},
    });
    await svc.transition(client, { id: ids.request, to: "VALIDATED", actor: {} });
    await refuses(() => svc.transition(client, { id: ids.request, to: "APPROVED", actor: {} }), "OVER_BUDGET");
  });

  test("a rejection needs a reason, and the request reopens keeping it", async () => {
    await refuses(() => svc.transition(client, { id: ids.request, to: "REJECTED", actor: {} }), "REJECTION_REASON_REQUIRED");
    await svc.transition(client, { id: ids.request, to: "REJECTED", reason: "Amend the costing first", actor: {} });
    const reopened = await svc.transition(client, { id: ids.request, to: "DRAFT", actor: {} });
    expect(reopened.status).toBe("DRAFT");
    // The rejection stamp STAYS — it is why the request is back on the desk.
    expect(reopened.rejection_reason).toBe("Amend the costing first");
    // The account of the over-budget claim does not: the next submission makes
    // its own case.
    expect(reopened.over_budget_reason).toBeNull();
  });

  test("amending the budget UP lets the same claim through — the ledger reads live", async () => {
    await client.query("UPDATE costing_line SET unit_cost = 200000 WHERE costing_line_id = $1", [ids.port]);
    await svc.transition(client, { id: ids.request, to: "SUBMITTED", actor: {} });
    await svc.transition(client, { id: ids.request, to: "VALIDATED", actor: {} });
    const approved = await svc.transition(client, { id: ids.request, to: "APPROVED", actor: {} });
    expect(approved.status).toBe("APPROVED");
    // The costing had approved_at since 12766 and the request did not, so "when
    // was this approved" was answerable only from the audit ledger.
    expect(approved.approved_at).toBeTruthy();
  });

  /*
   * The defect this suite found. Once APPROVED the request's own claim is
   * committed, so a ledger that did not exclude it measured the request against
   * a balance it was itself inside — and every approved request read as a
   * breach of the budget it had just been approved against.
   */
  test("an APPROVED request is not a breach of the budget it was approved against", async () => {
    const control = (await svc.get(client, ids.request)).budget_control;
    expect(control.claimed_here).toBe(180000);
    expect(control.committed_elsewhere).toBe(0);
    expect(control.is_over_budget).toBe(false);
    expect(control.breaches).toEqual([]);
  });

  test("…while the registry ledger still counts it, because there it IS spent", async () => {
    // Same rows, different question: "what is left now" includes this request.
    const all = await costingSvc.budget(client, ids.costing);
    const port = all.lines.find((l) => l.costing_line_id === ids.port);
    expect(port.committed).toBe(180000);
    expect(port.remaining).toBe(20000);
  });
});
