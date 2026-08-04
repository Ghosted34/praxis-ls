"use strict";
/**
 * Server-side pagination + search for the Finance hub lists (audit F8).
 *
 * THE BUG THESE GUARD. `page()` clamps every list endpoint to 50 rows, but the
 * endpoints reported no total and supported no text search, so the Finance hub
 * fetched 50 rows and filtered them in the browser. A tenant with 300 invoices
 * searching for the 200th got "No invoices match" for an invoice that exists.
 * That is wrong data, not slow data — hence tests at the SQL-shape level rather
 * than only on the happy path.
 */
const { splitTotal, TOTAL_COL, page } = require("../../src/shared/db/query-helpers");
const invoiceRepo = require("../../src/modules/finance/final_invoice/final_invoice.repo");
const journalRepo = require("../../src/modules/finance/journal_entry/journal_entry.repo");
const receiptRepo = require("../../src/modules/finance/smart_receivables/smart_receivables.repo");
const proformaRepo = require("../../src/modules/finance/proforma/proforma.repo");
const { sendPaged } = require("../../src/shared/http/paged");

/** A pg client that records the SQL it was handed and replays canned rows. */
function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    query: (sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows });
    },
  };
}

describe("splitTotal", () => {
  test("strips _total off every row and reports it once", () => {
    const { rows, total } = splitTotal([
      { invoice_id: "a", _total: "300" },
      { invoice_id: "b", _total: "300" },
    ]);
    expect(total).toBe(300);
    expect(rows).toEqual([{ invoice_id: "a" }, { invoice_id: "b" }]);
    // The window-function column is an implementation detail; leaking it would
    // put a "_total" column in every consumer's row objects.
    expect(rows.every((r) => !("_total" in r))).toBe(true);
  });

  test("an empty page is total 0, not a crash reading rows[0]", () => {
    expect(splitTotal([])).toEqual({ rows: [], total: 0 });
    expect(splitTotal(undefined)).toEqual({ rows: [], total: 0 });
  });

  test("total survives pg returning COUNT as a string", () => {
    // node-pg returns bigint columns as strings; Number() here is deliberate.
    const { total } = splitTotal([{ x: 1, _total: "42" }]);
    expect(total).toBe(42);
    expect(typeof total).toBe("number");
  });
});

describe("invoice list: total + search across the fields the hub searches", () => {
  test("asks for the window-function total", async () => {
    const c = fakeClient([{ invoice_id: "a", _total: "300" }]);
    const out = await invoiceRepo.listInvoices(c, {});
    expect(c.calls[0].sql).toContain(TOTAL_COL);
    expect(out.total).toBe(300);
    expect(out.rows).toEqual([{ invoice_id: "a" }]);
  });

  test("q matches doc_number, client name AND dossier ref", async () => {
    const c = fakeClient([]);
    await invoiceRepo.listInvoices(c, { q: "SBX-2026" });
    const { sql, params } = c.calls[0];
    expect(sql).toMatch(/i\.doc_number ILIKE/);
    expect(sql).toMatch(/c\.name ILIKE/);
    expect(sql).toMatch(/d\.ref ILIKE/);
    expect(params).toContain("%SBX-2026%");
    // One placeholder reused for all three — not three copies of the term.
    expect(params.filter((p) => p === "%SBX-2026%")).toHaveLength(1);
  });

  test("joins are LEFT so an invoice with no client or dossier still lists", async () => {
    const c = fakeClient([]);
    await invoiceRepo.listInvoices(c, {});
    expect(c.calls[0].sql).toMatch(/LEFT JOIN client_master/);
    expect(c.calls[0].sql).toMatch(/LEFT JOIN dossier/);
    expect(c.calls[0].sql).not.toMatch(/\bINNER JOIN\b/);
  });

  test("limit/offset are the first two params and are clamped", async () => {
    const c = fakeClient([]);
    await invoiceRepo.listInvoices(c, { limit: "9999", offset: "50" });
    expect(c.calls[0].params[0]).toBe(200); // page() ceiling
    expect(c.calls[0].params[1]).toBe(50);
  });

  test("still filters to FINAL invoices", async () => {
    const c = fakeClient([]);
    await invoiceRepo.listInvoices(c, {});
    expect(c.calls[0].sql).toMatch(/i\.type = 'FINAL'/);
  });
});

describe("the other three hub lists", () => {
  test("journals search source_doc_ref and source, and clamp via page()", async () => {
    const c = fakeClient([{ entry_id: "e", _total: "7" }]);
    const out = await journalRepo.listEntries(c, { q: "INV-1", limit: "9999" });
    expect(c.calls[0].sql).toContain(TOTAL_COL);
    expect(c.calls[0].sql).toMatch(/source_doc_ref ILIKE/);
    expect(c.calls[0].sql).toMatch(/source ILIKE/);
    expect(c.calls[0].params[0]).toBe(200);
    expect(out.total).toBe(7);
  });

  test("receipts search client name and no longer take limit raw", async () => {
    const c = fakeClient([{ receipt_id: "r", _total: "12" }]);
    const out = await receiptRepo.listReceipts(c, { q: "Acme", limit: "9999" });
    expect(c.calls[0].sql).toContain(TOTAL_COL);
    expect(c.calls[0].sql).toMatch(/c\.name ILIKE/);
    // Previously `limit` went to SQL unclamped, straight off the query string.
    expect(c.calls[0].params[0]).toBe(200);
    expect(out.total).toBe(12);
  });

  test("receipts called with no arguments still page sanely", async () => {
    const c = fakeClient([]);
    await receiptRepo.listReceipts(c);
    expect(c.calls[0].params[0]).toBe(page({}).limit);
    expect(c.calls[0].params[1]).toBe(0);
  });

  test("proformas search client name", async () => {
    const c = fakeClient([{ advance_id: "a", _total: "3" }]);
    const out = await proformaRepo.listAdvances(c, { q: "Acme" });
    expect(c.calls[0].sql).toContain(TOTAL_COL);
    expect(c.calls[0].sql).toMatch(/c\.name ILIKE/);
    expect(out.total).toBe(3);
  });
});

describe("sendPaged", () => {
  test("puts the count in X-Total-Count and leaves the body a bare array", () => {
    const headers = {};
    const res = {
      set: (k, v) => { headers[k] = v; },
      json: (b) => b,
    };
    const body = sendPaged(res, { rows: [{ a: 1 }], total: 300 });
    expect(headers["X-Total-Count"]).toBe("300");
    // The body shape must NOT change — every existing consumer reads `data` as
    // an array, and wrapping it would break all of them at once.
    expect(body).toEqual({ data: [{ a: 1 }] });
  });
});
