/**
 * Import-template round-trips (financial dictionary + expense rates).
 *
 * THE CONTRACT THESE PIN. A template this product emits must parse with the
 * importer that asked for it — same headers, same keys, same sheet names —
 * because the template, the parser and the error file are ONE contract
 * (rules.IMPORT_COLUMNS), not three artefacts that happen to ship together.
 * The round trip is also the regression net for the fold onto the shared
 * branded builder: colours and covers may change, the column contract may
 * not, and the fastest way to prove that is to build, parse and compare.
 *
 * No DB: a fixture WorkbookContext, exactly what production passes.
 */
"use strict";

const ExcelJS = require("exceljs");
const dict = require("../../src/modules/master/financial_dictionary/financial_dictionary.import");
const { IMPORT_COLUMNS: DICT_COLUMNS, CATEGORIES } = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
const rates = require("../../src/modules/master/expense_rate/expense_rate.import");
const { IMPORT_COLUMNS: RATE_COLUMNS } = require("../../src/modules/master/expense_rate/expense_rate.rules");
const { neutralContext } = require("../../src/services/spreadsheet");

const CONTEXT = neutralContext({
  tenant: { name: "Smart Logistics", primary: "#1D4ED8", primaryForeground: "#FFFFFF", accent: "#F5821F", logoUrl: null, logo: null, fontDisplay: null, fontBody: null },
  baseCurrency: "XAF",
  language: "fr",
});

async function sheetNames(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.map((w) => w.name);
}

describe("financial dictionary template round-trip", () => {
  const accounts = [{ code: "6271", label_fr: "Services bancaires" }];
  const taxCodes = [{ code: "TVA19.25", rate_percent: 19.25 }];
  const serviceTypes = [{ key: "FREIGHT", service_type_id: "st-1", name_en: "Freight" }];
  const refs = { SUBCATEGORY: [{ code: "THC", name_en: "Terminal handling" }], UNIT: [], PROOF_SOURCE: [] };

  it("parses back with the same keys, headers and sheet names", async () => {
    const buf = await dict.buildTemplate({ context: CONTEXT, accounts, taxCodes, serviceTypes, refs });
    expect(await sheetNames(buf)).toEqual(["Items", "Reference"]);

    const parsed = await dict.parseUpload(buf);
    expect(parsed.sheet).toBe("Items");
    expect(parsed.columns.sort()).toEqual([...DICT_COLUMNS.map((c) => c.key)].sort());
    // The sample row is data to the parser: it must arrive keyed by column KEY
    // with its example values intact (that is how the user edits it).
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].label_fr).toBe("Frais portuaires (THC)");
    expect(parsed.rows[0].currency).toBe("XAF");
    expect(parsed.rows[0].default_price).toBe(85000); // typed number, not "85000"
  });

  it("keeps the enum dropdowns on the right columns (validation is part of the contract)", async () => {
    const buf = await dict.buildTemplate({ context: CONTEXT, accounts, taxCodes, serviceTypes, refs });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Items");
    const categoryCol = DICT_COLUMNS.findIndex((c) => c.key === "category") + 1;
    const dv = ws.getCell(2, categoryCol).dataValidation;
    expect(dv.type).toBe("list");
    expect(dv.formulae[0]).toBe(`"${CATEGORIES.join(",")}"`);
    // Headers carry the "*" required marker exactly as the alias map expects.
    const headers = [];
    ws.getRow(1).eachCell((c, col) => (headers[col] = c.value));
    expect(headers[1]).toBe(DICT_COLUMNS[0].header);
  });

  it("error file keeps the Rejected shape and re-parses through the same importer", async () => {
    const buf = await dict.buildErrorFile(
      [{ row: 4, reasons: ["unknown category", "duplicate name"], raw: { label_fr: "Fret", category: "nope" } }],
      CONTEXT,
    );
    expect(await sheetNames(buf)).toEqual(["Rejected"]);
    // The "Sheet row" column carries the ORIGINAL template row so the fix maps
    // back to the line the user saw; __row is this file's own row (importer
    // semantics, unchanged).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet("Rejected").getCell("A2").value).toBe(4);
    expect(wb.getWorksheet("Rejected").getCell("B2").value).toBe("unknown category · duplicate name");

    const parsed = await dict.parseUpload(buf); // no "Items" sheet → first sheet
    expect(parsed.sheet).toBe("Rejected");
    expect(parsed.rows[0].label_fr).toBe("Fret");
    expect(parsed.rows[0].category).toBe("nope");
    expect(parsed.rows[0].__row).toBe(2);
  });
});

describe("expense-rate template round-trip", () => {
  const ctxData = {
    context: CONTEXT,
    dictionaryItems: [
      { dictionary_item_id: "d-1", code: "OCEAN_FREIGHT", name_en: "Ocean freight", name_fr: "Fret maritime" },
    ],
    rateProviders: [{ rate_provider_id: "p-1", code: "MAERSK", name: "Maersk" }],
    containerTypes: [{ ref_id: "c-1", code: "40HC", name_en: "40' High Cube", name_fr: "40' HC" }],
  };

  it("parses back with IMPORT_COLUMNS keys (headers are prose, keys are the contract)", async () => {
    const buf = await rates.buildTemplate(ctxData);
    expect(await sheetNames(buf)).toEqual(["Rates", "Reference"]);
    const { sheet, rows } = await rates.parseUploaded(buf);
    expect(sheet).toBe("Rates");
    expect(rows).toEqual([]); // the template ships empty: rows arrive on re-upload

    // Simulate the user's upload: write rows through the SAME headers.
    const { buildWorkbook } = require("../../src/services/spreadsheet");
    const upload = await buildWorkbook({
      sheets: [
        {
          name: "Rates",
          columns: RATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 })),
          rows: [
            { dictionary_item: "Ocean freight", rate_provider: "MAERSK", container_type: "40HC", rate: 1250.5, currency: "xaf", effective_from: "2026-09-01" },
          ],
        },
      ],
      context: CONTEXT,
    });
    const parsed = await rates.parseUploaded(upload);
    expect(parsed.rows).toEqual([
      {
        dictionary_item: "Ocean freight",
        rate_provider: "MAERSK",
        container_type: "40HC",
        rate: 1250.5,
        currency: "xaf",
        effective_from: "2026-09-01",
      },
    ]);
  });

  it("shows the tenant's real values on a protected, visible Reference sheet", async () => {
    const buf = await rates.buildTemplate(ctxData);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ref = wb.getWorksheet("Reference");
    expect(ref.state).toBe("visible");
    expect(ref.sheetProtection).toBeTruthy();
    expect(ref.getCell("A3").value).toBe("OCEAN_FREIGHT");
    expect(ref.getCell("B3").value).toBe("Ocean freight");
  });
});
