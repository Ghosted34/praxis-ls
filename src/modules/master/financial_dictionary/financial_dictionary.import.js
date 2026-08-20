/**
 * Financial dictionary — bulk Excel I/O (MOD-05 PR2).
 *
 * Three artefacts, one column contract. The template a user downloads, the sheet
 * they upload, and the error file they get back are all driven by
 * `rules.IMPORT_COLUMNS`, so a column can never exist in one and not the others
 * — which is the failure mode of every hand-rolled importer: a template that
 * has drifted from the parser and rejects the file it just produced.
 *
 * WHY A TEMPLATE AT ALL, rather than "upload any sheet with these headers".
 * Because the expensive part of a bulk import is not the upload, it is the
 * round trips: 400 rows uploaded, 380 rejected for a mistyped category, fixed,
 * re-uploaded, 200 rejected for an account code that is not postable. Excel data
 * validation moves that whole class of error to the moment of typing — the
 * dropdown will not let a user write "Expence" — and the Reference sheet puts
 * the tenant's REAL account codes, tax codes and service keys in front of them
 * instead of making them guess. What is left for the server to reject is the
 * genuinely ambiguous: an incomplete OHADA mapping, a duplicate name.
 *
 * RENDERING goes through the ONE shared builder (services/spreadsheet) with the
 * tenant's WorkbookContext — brand colours on header rows, protected Reference
 * sheet, injection-locked text — so this file declares WHAT each artefact
 * contains and owns nothing about HOW it is drawn. The private Maroon palette
 * it used to carry is gone on purpose.
 *
 * FILE I/O ONLY. Every judgement — what a valid row is, what the OHADA-mapping
 * completeness rule means, how a duplicate is spotted — lives in
 * financial_dictionary.rules.js and is unit-tested without a spreadsheet.
 */
"use strict";

const ExcelJS = require("exceljs");
const { buildWorkbook } = require("../../../services/spreadsheet");
const { IMPORT_COLUMNS, CATEGORIES, DIRECTIONS, APPLICABILITIES, RECEIPTS } = require("./financial_dictionary.rules");
const { AppError } = require("../../../utils/errors");

const SHEET_ITEMS = "Items";
const SHEET_REF = "Reference";
const SHEET_REJECTED = "Rejected";
const MAX_ROWS = 2000;

/** The template's column list: the IMPORT_COLUMNS contract, plus the enum
 *  dropdowns the rules define (a `bool` column is a Y/N list). Column keys,
 *  header text and the sheet names are frozen — parsers and docs key on them. */
function templateColumns() {
  return IMPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 18,
    ...(c.enum ? { list: c.enum } : {}),
    ...(c.bool ? { list: ["Y", "N"] } : {}),
  }));
}

/**
 * Build the import template.
 *
 * Data validations are applied to a deep row range (not just the rows we wrote)
 * because the user WILL paste 300 rows in, and a dropdown that stops at row 2 is
 * a dropdown that does nothing.
 *
 * No cover sheet: row 1 of the Items sheet IS the header contract, and the
 * parser (here) plus the error file key on it staying put.
 */
async function buildTemplate({ context = null, accounts = [], taxCodes = [], serviceTypes = [], refs = {} } = {}) {
  return buildWorkbook({
    sheets: [
      {
        name: SHEET_ITEMS,
        title: "Financial dictionary — import template",
        columns: templateColumns(),
        validateRows: MAX_ROWS,
        // One worked example, in the muted fill so it reads as a sample and not
        // data. Deleting it is a one-row delete; guessing the shape of 27
        // columns is not.
        sample: {
          label_fr: "Frais portuaires (THC)",
          label_en: "Port charges (THC)",
          category: "disbursement",
          direction: "DISBURSEMENT",
          subcategory: "THC",
          applicability_mode: "ANY_OPERATIONS",
          unit_of_measure: "CONTAINER_20",
          default_price: 85000,
          currency: "XAF",
          is_billable: "Y",
          provider_kind: "PORT_TERMINAL",
          proof_source: "PORT_TERMINAL",
          receipt_requirement: "ALWAYS_REQUIRED",
          requires_justification: "N",
          disbursement_vat_transparent: "Y",
          description: "EXAMPLE ROW — delete before importing.",
          purchase_debit: accounts[0] ? accounts[0].code : "6271",
          purchase_credit: "4011",
        },
      },
    ],
    reference: [
      { title: "Category", values: CATEGORIES.map((c) => [c, ""]) },
      { title: "Direction", values: DIRECTIONS.map((d) => [d, `code letter ${d[0]}`]) },
      { title: "Applicability", values: APPLICABILITIES.map((a) => [a, ""]) },
      { title: "Receipt requirement", values: RECEIPTS.map((r) => [r, ""]) },
      { title: "Service type key", values: serviceTypes.map((s) => [s.key, s.name_en || s.name_fr || ""]) },
      { title: "Postable account", values: accounts.map((a) => [a.code, a.label_fr || ""]) },
      { title: "Tax code", values: taxCodes.map((t) => [t.code, t.rate_percent === null || t.rate_percent === undefined ? "" : `${t.rate_percent}%`]) },
      { title: "Sub-category", values: (refs.SUBCATEGORY || []).map((r) => [r.code, r.name_en || r.name_fr]) },
      { title: "Unit", values: (refs.UNIT || []).map((r) => [r.code, r.name_en || r.name_fr]) },
      { title: "Proof source", values: (refs.PROOF_SOURCE || []).map((r) => [r.code, r.name_en || r.name_fr]) },
    ],
    context,
  });
}

const HEADER_TO_KEY = new Map(IMPORT_COLUMNS.map((c) => [c.header.toLowerCase().trim(), c.key]));
// Also accept the bare key as a header, so a sheet exported from the error file
// (or built by hand from the docs) still parses.
for (const c of IMPORT_COLUMNS) HEADER_TO_KEY.set(c.key.toLowerCase(), c.key);
// …and the header without its "*" required marker.
for (const c of IMPORT_COLUMNS) HEADER_TO_KEY.set(c.header.toLowerCase().replace(/\s*\*\s*$/, "").trim(), c.key);

/** ExcelJS hands back rich text / formula objects for some cells; flatten them. */
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v.hyperlink !== undefined) return String(v.hyperlink);
    return "";
  }
  return v;
}

/**
 * Parse an uploaded workbook into header-keyed rows.
 *
 * Reads the sheet named "Items" if present, else the first sheet — a user who
 * copies the rows into a new workbook should not be told their file is
 * unreadable. Rows keep `__row`, the real spreadsheet row number, so every
 * rejection points at the line they can see on screen.
 *
 * UNCHANGED BY THE TEMPLATE FOLD: header aliases (the "*" required marker, the
 * bare key) and every rule about what a row is stay exactly here.
 */
async function parseUpload(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError("BAD_FILE", "That file could not be read as an .xlsx workbook", 422);
  }
  const ws = wb.getWorksheet(SHEET_ITEMS) || wb.worksheets[0];
  if (!ws) throw new AppError("BAD_FILE", "The workbook has no sheets", 422);

  const headerRow = ws.getRow(1);
  const colKey = new Map();
  headerRow.eachCell((cell, col) => {
    const key = HEADER_TO_KEY.get(String(cellText(cell.value)).toLowerCase().trim());
    if (key) colKey.set(col, key);
  });
  if (colKey.size === 0) {
    throw new AppError("BAD_HEADERS", "No recognised column headers on the first row — download the template and keep its header row", 422);
  }

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAX_ROWS) return;
    const obj = { __row: rowNumber };
    let any = false;
    for (const [col, key] of colKey) {
      const v = cellText(row.getCell(col).value);
      obj[key] = v;
      if (String(v).trim() !== "") any = true;
    }
    if (any) rows.push(obj);
  });
  return { rows, sheet: ws.name, columns: [...colKey.values()] };
}

/**
 * The error file: the rejected rows exactly as uploaded, with a "Why rejected"
 * column in front of them.
 *
 * Original values preserved, deliberately — the point of the file is that the
 * user fixes it and re-uploads it, so a normalised or blanked-out cell would
 * destroy the very thing they need to correct. Rendered by the shared builder
 * (brand header, injection lock on the raw text) with the reason column
 * emphasised and wrapped; no cover, because this file exists to be re-uploaded.
 */
async function buildErrorFile(rejected = [], context = null) {
  return buildWorkbook({
    sheets: [
      {
        name: SHEET_REJECTED,
        title: "Financial dictionary — rejected rows",
        columns: [
          { header: "Sheet row", key: "__row", width: 10 },
          { header: "Why rejected", key: "__why", width: 60, wrap: true, emphasis: true },
          ...IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 })),
        ],
        freeze: { x: 2, y: 1 },
        rows: rejected.map((r) => {
          const values = { __row: r.row, __why: (r.reasons || []).join(" · ") };
          for (const c of IMPORT_COLUMNS) values[c.key] = (r.raw && r.raw[c.key]) !== undefined ? r.raw[c.key] : "";
          return values;
        }),
      },
    ],
    context,
  });
}

module.exports = { buildTemplate, parseUpload, buildErrorFile, SHEET_ITEMS, SHEET_REF, SHEET_REJECTED, MAX_ROWS };
