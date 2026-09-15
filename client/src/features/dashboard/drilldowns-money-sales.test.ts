/**
 * PR-3 drill builders — Money, Sales & Procurement (guide §9, §11).
 *
 * The rules each builder has to keep, and which each test falsifies:
 *   · a figure the TILE computed is passed through, never recomputed off the
 *     clipped page — the modal must not contradict the card it opened from;
 *   · status vocabularies are filtered the same way the SQL filters them, so
 *     the table is the scan behind the tile and not a second definition;
 *   · an empty result is an honest empty state, never a zero dressed as data;
 *   · masked per-row figures render "—", decided by the SERVER's omission of
 *     the field, never by a client-side permission test.
 */
import { describe, expect, it } from "vitest";
import {
  buildCashCollectedDrill,
  buildCashRequestsDrill,
  buildDsoDrill,
  buildMarginDrill,
  buildPayablesDrill,
  buildPipelineWonDrill,
  buildPosInFlightDrill,
  buildPurchaseRequestsDrill,
  buildQuoteRequestsDrill,
} from "./drilldowns";

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86400_000).toISOString();

describe("buildCashCollectedDrill", () => {
  it("totals the receipts it was given and lists them", () => {
    const d = buildCashCollectedDrill(
      [
        { receipt_id: "r1", amount: 55000, method: "BANK", received_on: iso(2) },
        { receipt_id: "r2", amount: 15000, method: "CASH", received_on: iso(1) },
      ],
      "XAF",
    );
    expect(d.badge.text).toContain("XAF");
    expect(d.meta[0]).toEqual({ label: "Receipts", value: "2" });
    expect(d.rows).toHaveLength(2);
  });

  it("an empty month is an empty STATE, not a zero row", () => {
    const d = buildCashCollectedDrill([], "XAF");
    expect(d.rows).toHaveLength(0);
    expect(d.empty.title).toMatch(/Nothing collected/i);
  });
});

describe("buildPayablesDrill", () => {
  const rows = [
    { supplier_invoice_id: "a", doc_number: "SI-1", status: "POSTED_LOCKED", amount_ttc: 80000, amount_paid: 30000, due_on: iso(5) },
    { supplier_invoice_id: "b", doc_number: "SI-2", status: "PAID", amount_ttc: 40000, amount_paid: 40000, due_on: iso(5) },
    { supplier_invoice_id: "c", doc_number: "SI-3", status: "POSTED_LOCKED", amount_ttc: 10000, amount_paid: 0, due_on: iso(-9) },
  ];

  it("counts only what is still owed AND past due — settled and not-yet-due drop out", () => {
    const d = buildPayablesDrill(rows, "XAF");
    expect(d.meta[0]).toEqual({ label: "Invoices", value: "1" });
    expect(d.rows[0].cells[0]).toBe("SI-1");
  });

  it("ranks by outstanding, biggest first", () => {
    const d = buildPayablesDrill(
      [
        { supplier_invoice_id: "s", doc_number: "SMALL", status: "MATCHED", amount_ttc: 100, amount_paid: 0, due_on: iso(3) },
        { supplier_invoice_id: "b", doc_number: "BIG", status: "MATCHED", amount_ttc: 900, amount_paid: 0, due_on: iso(3) },
      ],
      "XAF",
    );
    expect(d.rows.map((r) => r.cells[0])).toEqual(["BIG", "SMALL"]);
  });
});

describe("buildCashRequestsDrill", () => {
  it("names which desk each request sits at, and ignores everything past approval", () => {
    const d = buildCashRequestsDrill(
      [
        { cash_request_id: "1", doc_number: "CR-1", status: "SUBMITTED", amount: 100, created_at: iso(1) },
        { cash_request_id: "2", doc_number: "CR-2", status: "VALIDATED", amount: 200, created_at: iso(2) },
        { cash_request_id: "3", doc_number: "CR-3", status: "DISBURSED", amount: 300, created_at: iso(3) },
      ],
      "XAF",
    );
    expect(d.meta[0].value).toBe("2");
    expect(d.rows[0].cells[1]).toBe("Awaiting validation");
    expect(d.rows[1].cells[1]).toBe("Awaiting approval");
  });
});

describe("buildMarginDrill", () => {
  const sims = [
    { margin_simulation_id: "m1", status: "APPROVED", margin_percent: 31, approved_at: iso(3) },
    { margin_simulation_id: "m2", status: "DRAFT", margin_percent: 99, approved_at: null },
  ];

  it("shows the TILE's average, not one recomputed off the page", () => {
    const d = buildMarginDrill(sims, 24, 12);
    expect(d.badge.text).toBe("24 %");
    expect(d.meta[0]).toEqual({ label: "Closed files measured", value: "12" });
    // Only the approved simulation is listed; the draft is a what-if.
    expect(d.rows).toHaveLength(1);
  });

  it("an unmeasurable tile says so rather than printing 0 %", () => {
    const d = buildMarginDrill([], null, 0);
    expect(d.badge.text).toBe("Not measurable");
    expect(d.meta[1].value).toBe("—");
  });

  it("a per-row margin the server withheld renders as a dash, and the note says why", () => {
    const d = buildMarginDrill(
      [{ margin_simulation_id: "m3", status: "APPROVED", margin_percent: null, approved_at: iso(1) }],
      18,
      4,
    );
    expect(d.rows[0].cells[2]).toBe("—");
    expect(d.note).toMatch(/not shown for your role/i);
    // The aggregate the reader IS allowed still shows.
    expect(d.meta[1].value).toBe("18 %");
  });
});

describe("buildDsoDrill", () => {
  const invoices = [
    { invoice_id: "i1", doc_number: "INV-OLD", type: "FINAL", status: "ISSUED_LOCKED", total_ttc: 100000, amount_paid: 0, created_at: iso(60) },
    { invoice_id: "i2", doc_number: "INV-NEW", type: "FINAL", status: "ISSUED_LOCKED", total_ttc: 50000, amount_paid: 0, created_at: iso(5) },
  ];

  it("shows the TILE's weighted average and ranks the page oldest first", () => {
    const d = buildDsoDrill(invoices, 47, "XAF");
    expect(d.badge.text).toBe("47 days");
    expect(d.rows.map((r) => r.cells[0])).toEqual(["INV-OLD", "INV-NEW"]);
  });

  it("nothing outstanding is 'not measurable', never 0 days", () => {
    const d = buildDsoDrill([], null, "XAF");
    expect(d.badge.text).toBe("Not measurable");
    expect(d.empty.title).toMatch(/Nothing is outstanding/i);
  });
});

describe("buildPipelineWonDrill", () => {
  it("counts this month's settled wins only", () => {
    const d = buildPipelineWonDrill(
      [
        { opportunity_id: "o1", name: "Won now", status: "WON", estimated_value: 70000, settled_at: new Date().toISOString() },
        { opportunity_id: "o2", name: "Won long ago", status: "WON", estimated_value: 5, settled_at: iso(70) },
        { opportunity_id: "o3", name: "Still open", status: "OPEN", estimated_value: 999, settled_at: null },
      ],
      "XAF",
    );
    expect(d.meta[0]).toEqual({ label: "Opportunities", value: "1" });
    expect(d.rows[0].cells[0]).toBe("Won now");
  });
});

describe("buildQuoteRequestsDrill", () => {
  it("lists what the client is still waiting on, longest wait first", () => {
    const d = buildQuoteRequestsDrill([
      { quote_request_id: "q1", public_ref: "QR-1", status: "RECEIVED", requester_company: "Alpha", created_at: iso(9) },
      { quote_request_id: "q2", public_ref: "QR-2", status: "UNDER_REVIEW", requester_company: "Beta", created_at: iso(20) },
      { quote_request_id: "q3", public_ref: "QR-3", status: "QUOTED", requester_company: "Gamma", created_at: iso(30) },
    ]);
    expect(d.meta[0].value).toBe("2");
    expect(d.rows.map((r) => r.cells[0])).toEqual(["QR-2", "QR-1"]);
  });
});

describe("buildPosInFlightDrill", () => {
  it("shows the TILE's in-flight count and flags that the table is a wider scan", () => {
    const d = buildPosInFlightDrill(
      [
        { po_id: "p1", doc_number: "PO-1", status: "ISSUED_LOCKED", supplier_name: "Acme", total_ttc: 1000, delivery_on: iso(-3) },
        { po_id: "p2", doc_number: "PO-2", status: "APPROVED_LOCKED", supplier_name: "Beta", total_ttc: 2000, delivery_on: iso(-1) },
        { po_id: "p3", doc_number: "PO-3", status: "DRAFT", supplier_name: "Gamma", total_ttc: 5, delivery_on: null },
      ],
      1,
      "XAF",
    );
    expect(d.badge.text).toBe("1 in flight");
    // Two issued on the page, one still awaiting goods: the note owns the gap
    // rather than letting the reader think the table IS the count.
    expect(d.rows).toHaveLength(2);
    expect(d.note).toMatch(/no goods received/i);
  });

  it("no note when the page and the tile agree", () => {
    const d = buildPosInFlightDrill(
      [{ po_id: "p1", doc_number: "PO-1", status: "ISSUED_LOCKED", supplier_name: "Acme", total_ttc: 1000, delivery_on: null }],
      1,
      "XAF",
    );
    expect(d.note).toBeUndefined();
  });
});

describe("buildPurchaseRequestsDrill", () => {
  it("counts what is raised and not yet ordered, naming the stage", () => {
    const d = buildPurchaseRequestsDrill([
      { pr_id: "r1", doc_number: "PR-1", status: "SUBMITTED", department: "Ops", created_at: iso(2) },
      { pr_id: "r2", doc_number: "PR-2", status: "APPROVED", department: "Fleet", created_at: iso(1) },
      { pr_id: "r3", doc_number: "PR-3", status: "ORDERED", department: "Ops", created_at: iso(5) },
    ]);
    expect(d.meta[0]).toEqual({ label: "Awaiting a PO", value: "2" });
    expect(d.meta[1]).toEqual({ label: "Approved", value: "1" });
    expect(d.rows[0].cells[2]).toBe("Awaiting approval");
    expect(d.rows[1].cells[2]).toBe("Approved, awaiting PO");
  });
});
