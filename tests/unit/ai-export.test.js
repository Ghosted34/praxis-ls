/**
 * The assistant's Excel export.
 *
 * WHAT THIS IS GUARDING. The rows come out of a markdown table in an answer, so
 * every cell arrives as a string — "18,000,000", "**Total revenue (HT)**",
 * "(2,810,000)", "SBX-2026-0001". Whether each becomes a number or stays text is
 * the whole difference between a workbook you can sum and one you have to
 * retype, and it is the kind of thing that regresses silently: nothing throws
 * when an amount lands as text, the file just quietly stops being useful.
 *
 * The reference case is the one that would do real damage. `SBX-2026-0001` must
 * never be parsed as arithmetic — a document reference turning into a negative
 * number in an exported ledger is a data-integrity failure, not a formatting
 * one.
 */
"use strict";

const ExcelJS = require("exceljs");
const { buildTablesWorkbook, coerce, sheetName } = require("../../src/modules/ai/assistant/assistant.export");

describe("coerce — markdown cell to spreadsheet value", () => {
  it("reads grouped amounts as numbers", () => {
    expect(coerce("18,000,000")).toBe(18000000);
    expect(coerce("1 250 000")).toBe(1250000);
    expect(coerce("21465000")).toBe(21465000);
  });

  it("sees through the emphasis models put on total rows", () => {
    expect(coerce("**18,000,000**")).toBe(18000000);
    expect(coerce("**Total revenue (HT)**")).toBe("Total revenue (HT)");
  });

  it("reads a parenthesised amount as negative, per accounting convention", () => {
    expect(coerce("(2,810,000)")).toBe(-2810000);
    expect(coerce("-2,810,000")).toBe(-2810000);
  });

  it("keeps a percentage as a real fraction so Excel can format it", () => {
    expect(coerce("19.25%")).toBeCloseTo(0.1925);
  });

  it("tolerates a trailing currency code", () => {
    expect(coerce("5,940,000 XAF")).toBe(5940000);
  });

  it("NEVER turns a document reference into arithmetic", () => {
    // The failure worth a test of its own: SBX-2026-0001 parsed as a number is
    // a corrupted reference in an exported ledger.
    expect(coerce("SBX-2026-0001")).toBe("SBX-2026-0001");
    expect(coerce("SBX-INV-0001")).toBe("SBX-INV-0001");
    expect(coerce("7064 — Services rendered")).toBe("7064 — Services rendered");
    expect(coerce("1–30 days")).toBe("1–30 days");
  });

  it("leaves prose, blanks and nullish cells alone", () => {
    expect(coerce("Current")).toBe("Current");
    expect(coerce("")).toBe("");
    expect(coerce(null)).toBe("");
    expect(coerce(undefined)).toBe("");
  });
});

describe("sheetName", () => {
  it("strips the characters Excel forbids and caps at 31", () => {
    expect(sheetName("Scenario A — Conservative (flat run-rate, no pipeline)", 0)).toHaveLength(31);
    expect(sheetName("a/b:c*d?e[f]g", 0)).not.toMatch(/[[\]:*?/\\]/);
  });

  it("falls back to a positional name when the title is empty", () => {
    expect(sheetName("", 2)).toBe("Table 3");
  });
});

describe("buildTablesWorkbook", () => {
  const tables = [
    {
      title: "Revenue (from trial balance)",
      header: ["Account", "Amount (XAF)"],
      rows: [
        ["7064 — Services rendered", "18,000,000"],
        ["**Total revenue (HT)**", "**18,000,000**"],
      ],
    },
    {
      title: "Receivables (from ageing)",
      header: ["Bucket", "Amount (XAF)"],
      rows: [["Current", "21,465,000"]],
    },
  ];

  it("writes one sheet per table, named after its heading", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTablesWorkbook(tables));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Revenue (from trial balance)",
      "Receivables (from ageing)",
    ]);
  });

  it("lands amounts as numbers and labels as text", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTablesWorkbook(tables));
    const ws = wb.getWorksheet(1);
    expect(ws.getCell("B2").value).toBe(18000000);
    expect(typeof ws.getCell("B2").value).toBe("number");
    // Row 3 is the total: emphasis stripped from the label, value still numeric.
    expect(ws.getCell("A3").value).toBe("Total revenue (HT)");
    expect(ws.getCell("B3").value).toBe(18000000);
  });

  it("disambiguates two tables that share a heading", async () => {
    const dup = [tables[0], { ...tables[0], rows: [["x", "1"]] }];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTablesWorkbook(dup));
    const [a, b] = wb.worksheets.map((w) => w.name);
    expect(a).not.toBe(b);
    expect(wb.worksheets).toHaveLength(2);
  });

  it("produces a real xlsx (a zip) rather than an empty buffer", async () => {
    const buf = await buildTablesWorkbook(tables);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 2).toString()).toBe("PK");
  });
});
