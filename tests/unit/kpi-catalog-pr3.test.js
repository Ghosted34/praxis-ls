/**
 * KPI band PR-3 — Money, Sales & Procurement: the zero-vs-null split per tile
 * (guide §6.3/§6.4, §11), and the three corrections this PR had to make to
 * PR-1's placeholder declaration of `margin_closed`.
 *
 * Each tile gets the two falsifying cases the policy demands: an installed
 * tenant with nothing to count answers a NUMBER (0, or a {0, 0} pair), and a
 * tenant whose relation is missing answers NULL — never the other way round.
 *
 * `dso` is the one that differs on purpose, for the same reason `dwell_days`
 * does in PR-2: a weighted AVERAGE over no outstanding invoice is not "0 days
 * to collect", it is nothing measured, so SQL NULL must survive `num()` and
 * the tile must drop out rather than assert a collection speed.
 */
"use strict";

const guards = require("../../src/modules/dashboard/kpi_catalog/guards");
const money = require("../../src/modules/dashboard/kpi_catalog/money");
const sales = require("../../src/modules/dashboard/kpi_catalog/sales_procurement");
const { valuesFor, BY_ID, LIVE_IDS } = require("../../src/modules/dashboard/kpi_catalog");

const MONEY_PR3 = ["cash_collected", "payables_overdue", "cash_requests_awaiting", "margin_closed", "dso"];
const SALES_PR3 = ["pipeline_won", "quote_requests_open", "pos_in_flight", "purchase_requests"];

/** A client that answers by SQL shape, so each tile's statement is routable. */
const clientAnswering = (answer) => ({
  query: (sql) => {
    const out = answer(sql);
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ rows: out === undefined ? [] : [out] });
  },
});
const deadClient = { query: () => Promise.reject(new Error("relation does not exist")) };

const isReceipts = (sql) => /payment_receipt/.test(sql);
const isPayables = (sql) => /supplier_invoice/.test(sql);
const isCashReq = (sql) => /FROM cash_request/.test(sql);
const isMargin = (sql) => /margin_simulation/.test(sql);
const isDso = (sql) => /payment_allocation/.test(sql);
const isWon = (sql) => /FROM opportunity/.test(sql);
const isQuotes = (sql) => /quote_request/.test(sql);
const isPos = (sql) => /grn_inbound/.test(sql);
const isPr = (sql) => /FROM purchase_request/.test(sql);

describe("PR-3 catalogue entries", () => {
  it("all nine are live and keep their declared unit", () => {
    for (const id of [...MONEY_PR3, ...SALES_PR3]) {
      expect(BY_ID.get(id).status).toBe("live");
      expect(LIVE_IDS).toContain(id);
    }
    expect(BY_ID.get("dso").unit).toBe("days");
    expect(BY_ID.get("margin_closed").unit).toBe("pct");
    expect(BY_ID.get("cash_collected").unit).toBe("money");
    expect(BY_ID.get("purchase_requests").unit).toBe("count");
  });

  it("margin_closed is gated, sourced and drilled at the SAME module — the three PR-1 got wrong", () => {
    // PR-1 declared module MOD-46 (Costing) over a relation "costing_result"
    // that does not exist, while the figure is served by /margin-simulations
    // (MOD-27). All three now agree; see the note on the entry.
    expect(BY_ID.get("margin_closed")).toMatchObject({
      module: "MOD-27",
      sourceRelation: "margin_simulation",
      sensitive_field: "dossier.margin",
      drillTo: "/commercial/margin-simulation",
    });
  });

  it("every live tile's sourceRelation is a name, not a guess — no id keeps a relation no query reads", () => {
    // The offerability join in dashboard.service is `available.has(sourceRelation)`,
    // so a relation nothing queries makes a tile that is live, eligible and
    // absent from every picker, with nothing failing anywhere to say so.
    for (const id of [...MONEY_PR3, ...SALES_PR3]) {
      const entry = BY_ID.get(id);
      expect(typeof entry.sourceRelation).toBe("string");
      expect(entry.sourceRelation).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("Money — the zero-vs-null split", () => {
  it("an installed tenant with nothing to count answers numbers, and dso answers NULL", async () => {
    const out = await money.values(
      clientAnswering((sql) => {
        if (isMargin(sql)) return { value: null, denominator: 0 };
        if (isDso(sql)) return { n: null }; // no outstanding invoice
        return { n: 0 };
      }),
      guards,
    );
    expect(out.cash_collected).toBe(0);
    expect(out.payables_overdue).toBe(0);
    expect(out.cash_requests_awaiting).toBe(0);
    expect(out.margin_closed).toEqual({ value: 0, denominator: 0 });
    // The whole point: an average over nothing is not zero.
    expect(out.dso).toBeNull();
  });

  it("a missing relation answers NULL for every money tile — unavailable, not zero", async () => {
    const out = await money.values(deadClient, guards);
    for (const id of MONEY_PR3) expect(out[id]).toBeNull();
  });

  it("margin_closed keeps its denominator, so 0 % over 12 files differs from nothing closed", async () => {
    const measured = await money.values(
      clientAnswering((sql) => (isMargin(sql) ? { value: 0, denominator: 12 } : { n: 0 })),
      guards,
    );
    expect(measured.margin_closed).toEqual({ value: 0, denominator: 12 });

    const nothing = await money.values(
      clientAnswering((sql) => (isMargin(sql) ? { value: null, denominator: 0 } : { n: 0 })),
      guards,
    );
    expect(nothing.margin_closed).toEqual({ value: 0, denominator: 0 });
    // Same rendered 0, different statements — the denominator is what the
    // card's hint line and the drill read to tell them apart (§6.4).
    expect(measured.margin_closed.denominator).not.toBe(nothing.margin_closed.denominator);
  });

  it("a real dso survives as a number — the guard preserves it, it is not swallowed with the null", async () => {
    const out = await money.values(
      clientAnswering((sql) => (isDso(sql) ? { n: 47 } : isMargin(sql) ? { value: 0, denominator: 0 } : { n: 0 })),
      guards,
    );
    expect(out.dso).toBe(47);
  });

  it("one broken tile costs one tile — a failing receivables read does not take the domain down", async () => {
    const out = await money.values(
      clientAnswering((sql) => {
        if (isReceipts(sql)) return new Error("payment_receipt is gone");
        if (isMargin(sql)) return { value: 0, denominator: 0 };
        if (isDso(sql)) return { n: null };
        return { n: 3 };
      }),
      guards,
    );
    expect(out.cash_collected).toBeNull();
    expect(out.payables_overdue).toBe(3);
    expect(out.cash_requests_awaiting).toBe(3);
  });
});

describe("Sales & Procurement — four queues, where 0 is always the truth", () => {
  it("an installed tenant with empty queues answers 0, never null", async () => {
    const out = await sales.values(clientAnswering(() => ({ n: 0 })), guards);
    for (const id of SALES_PR3) expect(out[id]).toBe(0);
  });

  it("a missing relation answers NULL for every sales tile", async () => {
    const out = await sales.values(deadClient, guards);
    for (const id of SALES_PR3) expect(out[id]).toBeNull();
  });

  it("counts come through as numbers, per tile, independently", async () => {
    const out = await sales.values(
      clientAnswering((sql) => {
        if (isWon(sql)) return { n: 70000 };
        if (isQuotes(sql)) return { n: 4 };
        if (isPos(sql)) return { n: 2 };
        if (isPr(sql)) return { n: 9 };
        return { n: 0 };
      }),
      guards,
    );
    expect(out).toEqual({
      pipeline_won: 70000,
      quote_requests_open: 4,
      pos_in_flight: 2,
      purchase_requests: 9,
    });
  });

  it("pos_in_flight measures the ABSENCE of a GRN, not the PO's status", async () => {
    // The statement's shape is the assertion: a status-only count would let a
    // PO whose goods arrived keep counting until someone moved its status.
    let seen = "";
    await sales.values(clientAnswering((sql) => { if (isPos(sql)) seen = sql; return { n: 0 }; }), guards);
    expect(seen).toMatch(/NOT EXISTS/);
    expect(seen).toMatch(/grn_inbound/);
  });

  it("pipeline_won counts the month it was SETTLED in, not the month it was raised", async () => {
    let seen = "";
    await sales.values(clientAnswering((sql) => { if (isWon(sql)) seen = sql; return { n: 0 }; }), guards);
    expect(seen).toMatch(/settled_at >= date_trunc\('month', CURRENT_DATE\)/);
    expect(seen).not.toMatch(/created_at >= date_trunc/);
  });
});

describe("valuesFor over the whole catalogue", () => {
  it("answers every PR-3 id and normalises the pair, on a schema that has nothing", async () => {
    const out = await valuesFor(deadClient, [...MONEY_PR3, ...SALES_PR3]);
    expect(Object.keys(out).sort()).toEqual([...MONEY_PR3, ...SALES_PR3].sort());
    for (const id of [...MONEY_PR3, ...SALES_PR3]) expect(out[id]).toBeNull();
  });
});
