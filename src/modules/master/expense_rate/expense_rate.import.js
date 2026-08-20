/**
 * Expense rates — bulk Excel I/O (G7, meeting §11.3).
 *
 * Same three-artefact contract as the financial-dictionary importer: the
 * template a user downloads, the sheet they upload, and the error file they
 * get back all share `rules.IMPORT_COLUMNS`, so a column can never exist in
 * one and not the others.
 *
 * FILE I/O ONLY. Row judgement lives in expense_rate.rules.js (unit-tested
 * without a spreadsheet); this file only builds and parses workbooks. The
 * template itself is emitted by the ONE shared builder
 * (services/spreadsheet.buildWorkbook) with the tenant's WorkbookContext —
 * brand colours on the header row, the tenant's real values on a protected
 * Reference sheet, no cover (row 1 is the parser's header contract). The
 * local ExcelJS palette this file used to carry is gone; there is no second
 * writer to drift from the first.
 */
"use strict";

const { buildWorkbook, parseUpload } = require("../../../services/spreadsheet");
const { IMPORT_COLUMNS } = require("./expense_rate.rules");

const MAX_ROWS = 2000;
const SHEET_ITEMS = "Rates";

/**
 * Build the import template workbook (binary). `context` is the tenant
 * WorkbookContext (the service resolves it inside the tenant connection).
 *
 * The reference sheet — the tenant's REAL dictionary items, providers and
 * container types, so a user copies valid values instead of guessing — is
 * declared as reference blocks, not hand-drawn: the shared builder renders,
 * protects and brand-styles it identically for every importer.
 */
async function buildTemplate({ context = null, dictionaryItems = [], rateProviders = [], containerTypes = [] } = {}) {
  return buildWorkbook({
    sheets: [
      {
        name: SHEET_ITEMS,
        title: "Expense rates",
        columns: IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 })),
        // Import template: rows arrive typed by the user; no sample row here —
        // the effective-dated rate card is self-explanatory and a stale sample
        // rate is a trap (someone imports it as a real price).
        validateRows: MAX_ROWS,
      },
    ],
    reference: [
      { title: "Dictionary item", values: dictionaryItems.map((r) => [r.code || "", r.name_en || r.name_fr || ""]) },
      { title: "Rate provider", values: rateProviders.map((r) => [r.code || "", r.name || ""]) },
      { title: "Container type", values: containerTypes.map((r) => [r.code || "", r.name_en || r.name_fr || ""]) },
    ],
    context,
  });
}

/** Parse an uploaded workbook → { sheet, rows } where rows are raw objects keyed by IMPORT_COLUMNS keys.
 *
 * The shared parser keys cells by the HEADER TEXT it read (row 1 as seen on
 * screen); the rules layer keys by column key. This map joins them — and also
 * accepts the bare key as a header, so a sheet built by hand from the docs or
 * exported from the error file still parses. Without it the template this
 * module emits would round-trip to zero rows: its headers are prose ("Rate
 * provider (name or code)"), never the raw keys.
 */
const HEADER_TO_KEY = new Map(IMPORT_COLUMNS.map((c) => [c.header.toLowerCase().trim(), c.key]));
for (const c of IMPORT_COLUMNS) HEADER_TO_KEY.set(c.key.toLowerCase(), c.key);

async function parseUploaded(buffer) {
  const rows = await parseUpload({ buffer });
  const out = [];
  for (const raw of rows) {
    const row = {};
    for (const [header, v] of Object.entries(raw)) {
      const key = HEADER_TO_KEY.get(String(header).toLowerCase().trim());
      if (key && v !== undefined && v !== null && String(v).trim() !== "") row[key] = v;
    }
    // A fully blank line is not a row.
    if (Object.keys(row).length) out.push(row);
  }
  return { sheet: SHEET_ITEMS, rows: out };
}

module.exports = { buildTemplate, parseUploaded };
