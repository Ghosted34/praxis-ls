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
 * FILE I/O ONLY. Every judgement — what a valid row is, what the OHADA-mapping
 * completeness rule means, how a duplicate is spotted — lives in
 * financial_dictionary.rules.js and is unit-tested without a spreadsheet.
 */
"use strict";

const ExcelJS = require("exceljs");
const { IMPORT_COLUMNS, CATEGORIES, DIRECTIONS, APPLICABILITIES, RECEIPTS } = require("./financial_dictionary.rules");
const { AppError } = require("../../../utils/errors");

// House style, matching src/services/excel/workbook.js (Maroon Noir).
const ACCENT = "FF690909";
const CREAM = "FFF4E9D9";
const MUTED = "FFF6F2F2";
const SHEET_ITEMS = "Items";
const SHEET_REF = "Reference";
const MAX_ROWS = 2000;

/** Excel needs a quoted, comma-joined list for an inline list validation. */
const inlineList = (values) => `"${values.join(",")}"`;

function styleHeaderRow(ws) {
  const row = ws.getRow(1);
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    cell.font = { bold: true, color: { argb: CREAM } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 30;
}

/**
 * The reference sheet — the tenant's own valid values, not a generic legend.
 *
 * Laid out as parallel labelled blocks rather than one long table because a user
 * reads it by scanning for "which account code do I put in Sale · credit?", and
 * a single column of 900 mixed values answers that question badly.
 */
function addReferenceSheet(wb, { accounts = [], taxCodes = [], serviceTypes = [], refs = {} }) {
  const ws = wb.addWorksheet(SHEET_REF, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.getCell("A1").value = "Reference — the values this tenant accepts. Copy them into the Items sheet.";
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: ACCENT } };
  ws.mergeCells("A1:H1");

  const blocks = [
    { title: "Category", rows: CATEGORIES.map((c) => [c, ""]) },
    { title: "Direction", rows: DIRECTIONS.map((d) => [d, `code letter ${d[0]}`]) },
    { title: "Applicability", rows: APPLICABILITIES.map((a) => [a, ""]) },
    { title: "Receipt requirement", rows: RECEIPTS.map((r) => [r, ""]) },
    { title: "Service type key", rows: serviceTypes.map((s) => [s.key, s.name_en || s.name_fr || ""]) },
    { title: "Postable account", rows: accounts.map((a) => [a.code, a.label_fr || ""]) },
    { title: "Tax code", rows: taxCodes.map((t) => [t.code, t.rate_percent === null || t.rate_percent === undefined ? "" : `${t.rate_percent}%`]) },
    { title: "Sub-category", rows: (refs.SUBCATEGORY || []).map((r) => [r.code, r.name_en || r.name_fr]) },
    { title: "Unit", rows: (refs.UNIT || []).map((r) => [r.code, r.name_en || r.name_fr]) },
    { title: "Proof source", rows: (refs.PROOF_SOURCE || []).map((r) => [r.code, r.name_en || r.name_fr]) },
  ];

  let col = 1;
  for (const block of blocks) {
    ws.getColumn(col).width = 26;
    ws.getColumn(col + 1).width = 30;
    const head = ws.getCell(2, col);
    head.value = block.title;
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    head.font = { bold: true, color: { argb: CREAM } };
    ws.getCell(2, col + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    block.rows.forEach(([code, label], i) => {
      ws.getCell(3 + i, col).value = code;
      ws.getCell(3 + i, col + 1).value = label;
    });
    col += 2;
  }
  return ws;
}

/**
 * Build the import template.
 *
 * Data validations are applied to a deep row range (not just the rows we wrote)
 * because the user WILL paste 300 rows in, and a dropdown that stops at row 2 is
 * a dropdown that does nothing.
 */
async function buildTemplate({ accounts = [], taxCodes = [], serviceTypes = [], refs = {} } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Praxis LS";
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_ITEMS, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  styleHeaderRow(ws);

  IMPORT_COLUMNS.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    if (c.enum) {
      for (let r = 2; r <= MAX_ROWS; r += 1) {
        ws.getCell(`${letter}${r}`).dataValidation = {
          type: "list", allowBlank: !c.required, formulae: [inlineList(c.enum)],
          showErrorMessage: true, errorStyle: "warning",
          errorTitle: c.header, error: `Pick one of: ${c.enum.join(", ")}`,
        };
      }
    }
    if (c.bool) {
      for (let r = 2; r <= MAX_ROWS; r += 1) {
        ws.getCell(`${letter}${r}`).dataValidation = {
          type: "list", allowBlank: true, formulae: [inlineList(["Y", "N"])], showErrorMessage: true, errorStyle: "warning",
        };
      }
    }
    if (c.required) ws.getColumn(i + 1).font = { bold: false };
  });

  // One worked example, in the muted fill so it reads as a sample and not data.
  // Deleting it is a one-row delete; guessing the shape of 27 columns is not.
  const sample = ws.addRow({
    label_fr: "Frais portuaires (THC)", label_en: "Port charges (THC)", category: "disbursement", direction: "DISBURSEMENT",
    subcategory: "THC", applicability_mode: "ANY_OPERATIONS", unit_of_measure: "CONTAINER_20",
    default_price: 85000, currency: "XAF", is_billable: "Y", provider_kind: "PORT_TERMINAL",
    proof_source: "PORT_TERMINAL", receipt_requirement: "ALWAYS_REQUIRED", requires_justification: "N",
    disbursement_vat_transparent: "Y", description: "EXAMPLE ROW — delete before importing.",
    purchase_debit: accounts[0] ? accounts[0].code : "6271", purchase_credit: "4011",
  });
  sample.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MUTED } }; });

  addReferenceSheet(wb, { accounts, taxCodes, serviceTypes, refs });
  return Buffer.from(await wb.xlsx.writeBuffer());
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
 * destroy the very thing they need to correct.
 */
async function buildErrorFile(rejected = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Praxis LS";
  wb.created = new Date();
  const ws = wb.addWorksheet("Rejected", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: "Sheet row", key: "__row", width: 10 },
    { header: "Why rejected", key: "__why", width: 60 },
    ...IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 })),
  ];
  styleHeaderRow(ws);
  for (const r of rejected) {
    const values = { __row: r.row, __why: (r.reasons || []).join(" · ") };
    for (const c of IMPORT_COLUMNS) values[c.key] = (r.raw && r.raw[c.key]) !== undefined ? r.raw[c.key] : "";
    const row = ws.addRow(values);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).font = { color: { argb: ACCENT } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildTemplate, parseUpload, buildErrorFile, SHEET_ITEMS, SHEET_REF, MAX_ROWS };
