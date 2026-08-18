/**
 * Expense rates — bulk Excel I/O (G7, meeting §11.3).
 *
 * Same three-artefact contract as the financial-dictionary importer: the
 * template a user downloads, the sheet they upload, and the error file they
 * get back all share `rules.IMPORT_COLUMNS`, so a column can never exist in
 * one and not the others.
 *
 * FILE I/O ONLY. Row judgement lives in expense_rate.rules.js (unit-tested
 * without a spreadsheet); this file only builds and parses workbooks.
 */
"use strict";

const ExcelJS = require("exceljs");
const { IMPORT_COLUMNS } = require("./expense_rate.rules");
const { parseUpload } = require("../../../services/spreadsheet.service");

const ACCENT = "FF690909";
const CREAM = "FFF4E9D9";
const MAX_ROWS = 2000;
const SHEET_ITEMS = "Rates";
const SHEET_REF = "Reference";

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
 * The reference sheet — the tenant's REAL dictionary items, providers and
 * container types, so a user copies valid values instead of guessing.
 */
function addReferenceSheet(wb, { dictionaryItems = [], rateProviders = [], containerTypes = [] }) {
  const ws = wb.addWorksheet(SHEET_REF, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.getCell("A1").value = "Reference — the values this tenant accepts. Copy them into the Rates sheet.";
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: ACCENT } };
  ws.mergeCells("A1:F1");

  const blocks = [
    { title: "Dictionary item", rows: dictionaryItems.map((r) => [r.code || "", r.name_en || r.name_fr || ""]) },
    { title: "Rate provider", rows: rateProviders.map((r) => [r.code || "", r.name || ""]) },
    { title: "Container type", rows: containerTypes.map((r) => [r.code || "", r.name_en || r.name_fr || ""]) },
  ];
  let col = 1;
  for (const block of blocks) {
    ws.getColumn(col).width = 26;
    ws.getColumn(col + 1).width = 34;
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

/** Build the import template workbook (binary). */
async function buildTemplate({ dictionaryItems = [], rateProviders = [], containerTypes = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Praxis LS";
  wb.created = new Date();
  const ws = wb.addWorksheet(SHEET_ITEMS, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
  styleHeaderRow(ws);
  addReferenceSheet(wb, { dictionaryItems, rateProviders, containerTypes });
  return wb.xlsx.writeBuffer();
}

/** Parse an uploaded workbook → { sheet, rows } where rows are raw objects keyed by IMPORT_COLUMNS keys. */
async function parseUploaded(buffer) {
  const rows = await parseUpload({ buffer });
  const headerKeys = IMPORT_COLUMNS.map((c) => c.key);
  const out = [];
  for (const raw of rows) {
    const row = {};
    for (const key of headerKeys) {
      const v = raw[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") row[key] = v;
    }
    // A fully blank line is not a row.
    if (Object.keys(row).length) out.push(row);
  }
  return { sheet: SHEET_ITEMS, rows: out };
}

module.exports = { buildTemplate, parseUploaded };
