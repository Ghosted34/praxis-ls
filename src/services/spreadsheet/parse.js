/**
 * Workbook/xlsx parsing — the upload half of the spreadsheet service.
 *
 * Reads files WE HANDED OUT (templates) or files shaped like them: row 1 is
 * the header, by construction. The BANK-statement parser
 * (services/statements/xlsx.js) is deliberately separate — its inputs have
 * covers, merged titles and a header somewhere in the first twenty rows — but
 * both flatten cells through the same shared helpers so an ExcelJS rich-text
 * or formula cell can never parse two different ways.
 */
"use strict";

const ExcelJS = require("exceljs");
const { cellValue } = require("./helpers");
const { parseCsv } = require("./csv");

const REFERENCE_SHEET = "Reference";

/* ── Upload ceilings ────────────────────────────────────────────────────────
 * An .xlsx is a ZIP: a small buffer can expand into an enormous document.
 * ExcelJS decompresses the whole archive on load, so the honest bounds are
 * (a) a compressed-size cap at the door and (b) sheet/row/column caps that
 * stop the materialisation into JS objects before a workbook built as a bomb
 * takes the process down. Generous vs real imports (registers in the low
 * thousands of rows) and loud when tripped.
 */
const XLSX_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_ROWS = 100000;
const MAX_COLS = 256;

function tooLarge(limitMb) {
  const e = new Error(`Spreadsheet is too large — the limit is ${limitMb} MB`);
  e.status = 413;
  return e;
}

/**
 * Parse an uploaded workbook into { sheetName: rows[] }, where each row is an
 * object keyed by the (trimmed) header cells. Blank rows are skipped; cell
 * values are coerced to primitives (rich text / formula results unwrapped).
 * The Reference sheet is skipped — it is guidance, never data.
 * @param {Buffer} buffer
 * @returns {Promise<Record<string, Object[]>>}
 */
async function parseWorkbook(buffer) {
  if (buffer && buffer.length > XLSX_MAX_BYTES) throw tooLarge(10);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  if (wb.worksheets.length > MAX_SHEETS) {
    const e = new Error(`Workbook has too many sheets — the limit is ${MAX_SHEETS}`);
    e.status = 413;
    throw e;
  }
  const out = {};
  let total = 0;
  wb.eachSheet((ws) => {
    if (ws.name === REFERENCE_SHEET) return; // read-only guidance, never data
    const headers = [];
    ws.getRow(1).eachCell((cell, col) => {
      if (col > MAX_COLS) return;
      headers[col] = String(cellValue(cell) ?? "").trim();
    });
    const rows = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      total += 1;
      if (total > MAX_ROWS) {
        const e = new Error(`Workbook has too many rows — the limit is ${MAX_ROWS}`);
        e.status = 413;
        throw e;
      }
      const obj = {};
      let any = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (col > MAX_COLS) return;
        const key = headers[col];
        if (!key) return;
        const v = cellValue(cell);
        if (v !== null && v !== undefined && v !== "") any = true;
        obj[key] = v;
      });
      if (any) rows.push(obj);
    });
    out[ws.name] = rows;
  });
  return out;
}

/** An .xlsx is a ZIP — its first bytes are the local-file-header magic "PK". */
function looksLikeXlsx(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 2 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  );
}

/**
 * Parse an uploaded import file (CSV or .xlsx) into a single array of header-
 * keyed rows. Format is auto-detected by content, so the same import endpoint
 * accepts either — the filename is advisory only.
 * @param {{buffer:Buffer, filename?:string}} opts
 * @returns {Promise<Object[]>}
 */
async function parseUpload({ buffer, filename = "" }) {
  if (looksLikeXlsx(buffer)) {
    const sheets = await parseWorkbook(buffer);
    const names = Object.keys(sheets);
    return names.length ? sheets[names[0]] : [];
  }
  // Extension is a last-resort hint; content detection above is authoritative.
  void filename;
  return parseCsv(buffer);
}

module.exports = {
  parseWorkbook,
  parseUpload,
  looksLikeXlsx,
  XLSX_MAX_BYTES,
  MAX_SHEETS,
  MAX_ROWS,
};
