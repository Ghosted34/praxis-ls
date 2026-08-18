/**
 * Spreadsheet statement parser (.xlsx / .xlsm), on ExcelJS.
 *
 * Separate from src/services/spreadsheet.service.js on purpose. That one reads
 * a workbook WE generated, where row 1 is the header by construction. This one
 * reads a workbook a bank generated, where the header is somewhere in the first
 * twenty rows, under a logo, beside a merged title cell, and the sheet we want
 * may not be the first one.
 *
 * THE ONE REAL ADVANTAGE OVER CSV, and the reason to prefer .xlsx when a bank
 * offers both: cells carry TYPES. A date cell comes back as a JS Date and a
 * money cell as a Number, which removes the two ambiguities (§3 and §4 of
 * reconciliation.rules.js) that cause most mis-parses. Typed values are passed
 * through untouched so the rules layer can see they were typed.
 */
"use strict";

const ExcelJS = require("exceljs");
const { findHeaderRow } = require("./csv");

const MAX_ROWS = 20000;

/**
 * Flatten one ExcelJS cell to something the rules layer understands.
 * Dates and numbers stay typed; formulas yield their cached result; rich text
 * collapses to its runs.
 */
function cellValue(v) {
  if ((v === null || v === undefined)) return "";
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ((v.text !== null && v.text !== undefined)) return v.text;                      // hyperlink
    if (v.result !== undefined) return v.result;            // formula
    if (v.error) return "";
    if (v.hyperlink) return v.hyperlink;
  }
  return String(v);
}

/**
 * Pick the sheet holding the statement.
 *
 * A bank workbook routinely carries a cover sheet, the transactions, and a
 * legend. The transactions are the sheet with the most rows that also has at
 * least two columns - length is a far better signal here than the sheet's name,
 * which is localised and inconsistent.
 */
function pickSheet(workbook, wanted) {
  if (wanted) {
    const named = workbook.worksheets.find((w) => w.name === wanted);
    if (named) return named;
  }
  let best = null;
  for (const ws of workbook.worksheets) {
    if (ws.state === "hidden" || ws.state === "veryHidden") continue;
    const score = ws.actualRowCount || ws.rowCount || 0;
    if ((ws.actualColumnCount || ws.columnCount || 0) < 2) continue;
    if (!best || score > best.score) best = { ws, score };
  }
  return best ? best.ws : workbook.worksheets[0];
}

async function parse(buffer, opts = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = pickSheet(workbook, opts.sheet);
  if (!ws) return { headers: [], rows: [], meta: { sheet: null, sheets: [], header_row_index: 0, preamble: [] } };

  // Materialise as a dense grid first: findHeaderRow needs to look at rows as
  // arrays, exactly as it does for CSV, so the two formats agree on where a
  // header is rather than each having its own opinion.
  const grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > MAX_ROWS) return;
    const cells = [];
    const width = ws.actualColumnCount || ws.columnCount || 0;
    for (let col = 1; col <= width; col += 1) cells.push(cellValue(row.getCell(col).value));
    grid.push(cells);
  });
  while (grid.length && grid[grid.length - 1].every((c) => String(c === null ? "" : c).trim() === "")) grid.pop();
  if (!grid.length) {
    return { headers: [], rows: [], meta: { sheet: ws.name, sheets: workbook.worksheets.map((w) => w.name), header_row_index: 0, preamble: [] } };
  }

  const headerIndex = (opts.headerRowIndex !== null && opts.headerRowIndex !== undefined)
    ? opts.headerRowIndex - 1
    : findHeaderRow(grid.map((r) => r.map((c) => (c instanceof Date ? c.toISOString() : String(c === null ? "" : c)))));

  const seen = new Map();
  const headers = (grid[headerIndex] || []).map((h, idx) => {
    let name = String(h ?? "").trim() || `column_${idx + 1}`;
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name} (${n})`; }
    else seen.set(name, 1);
    return name;
  });

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const obj = { __row: i + 1 };
    headers.forEach((h, idx) => {
      const v = cells[idx];
      obj[h] = v instanceof Date ? v : ((v === null || v === undefined) ? "" : (typeof v === "number" ? v : String(v).trim()));
    });
    rows.push(obj);
  }

  return {
    headers,
    rows,
    meta: {
      sheet: ws.name,
      sheets: workbook.worksheets.map((w) => w.name),
      header_row_index: headerIndex + 1,
      preamble: grid.slice(0, headerIndex)
        .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ""))).join(" ").trim())
        .filter(Boolean),
    },
  };
}

module.exports = { parse, cellValue, pickSheet };
