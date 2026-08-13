/**
 * Report → spreadsheet projection + csv/xlsx rendering (MOD-63). Reports return
 * mixed shapes (flat row arrays, objects wrapping rows[], nested statement
 * objects); tabulate() must give each a sensible {columns, rows}, and toExport()
 * must render real csv/xlsx buffers so the (previously unwired) toolkit is usable.
 */
"use strict";

const {
  tabulate,
  toExport,
} = require("../../src/modules/vault/report/report-export");

describe("tabulate", () => {
  it("projects an array of objects into columns + rows", () => {
    const t = tabulate("procurement_spend", [
      { supplier: "ACME", amount: 1000 },
      { supplier: "Globex", amount: 2000 },
    ]);
    expect(t.columns.map((c) => c.key)).toEqual(["supplier", "amount"]);
    expect(t.rows).toEqual([
      { supplier: "ACME", amount: 1000 },
      { supplier: "Globex", amount: 2000 },
    ]);
  });

  it("unions keys across rows so a sparse row doesn't drop a column", () => {
    const t = tabulate("x", [{ a: 1 }, { a: 2, b: 3 }]);
    expect(t.columns.map((c) => c.key)).toEqual(["a", "b"]);
    expect(t.rows[0]).toEqual({ a: 1, b: "" });
  });

  it("uses a wrapped rows-like array (trial_balance {rows, totals})", () => {
    const t = tabulate("trial_balance", {
      rows: [{ account_code: "601", debit: 5 }],
      totals: { debit: 5 },
    });
    expect(t.columns.map((c) => c.key)).toEqual(["account_code", "debit"]);
    expect(t.rows).toHaveLength(1);
  });

  it("flattens a nested statement object to Field/Value pairs", () => {
    const t = tabulate("income_statement", {
      revenue: 100,
      sections: { sales: 80, other: 20 },
    });
    expect(t.columns.map((c) => c.key)).toEqual(["field", "value"]);
    expect(t.rows).toEqual([
      { field: "revenue", value: 100 },
      { field: "sections.sales", value: 80 },
      { field: "sections.other", value: 20 },
    ]);
  });

  it("handles an array of scalars via a single Value column", () => {
    const t = tabulate("x", ["a", "b"]);
    expect(t.columns).toEqual([{ header: "Value", key: "value" }]);
    expect(t.rows).toEqual([{ value: "a" }, { value: "b" }]);
  });

  it("JSON-encodes a nested cell rather than dropping it", () => {
    const t = tabulate("x", [{ id: 1, tags: ["a", "b"] }]);
    expect(t.rows[0].tags).toBe('["a","b"]');
  });
});

describe("toExport", () => {
  it("renders csv with a BOM and header row", async () => {
    const { buffer, contentType, extension } = await toExport(
      "x",
      [{ a: 1, b: 2 }],
      "csv",
    );
    expect(extension).toBe("csv");
    expect(contentType).toMatch(/text\/csv/);
    const text = buffer.toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(text).toContain("A,B");
    expect(text).toContain("1,2");
  });

  it("renders a real xlsx (ZIP magic 'PK')", async () => {
    const { buffer, contentType, extension } = await toExport(
      "x",
      [{ a: 1 }],
      "xlsx",
    );
    expect(extension).toBe("xlsx");
    expect(contentType).toMatch(/spreadsheetml/);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("rejects an unsupported format (pdf has its own endpoint)", async () => {
    await expect(toExport("x", [], "pdf")).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      status: 422,
    });
  });
});
