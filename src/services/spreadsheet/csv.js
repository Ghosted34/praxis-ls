/**
 * CSV half of the spreadsheet service — same header text, same cell semantics
 * as the xlsx builder (money ISO in the header, localized bools, timezone
 * dates, formula-injection lock), because a report exported as csv and as
 * xlsx is ONE export in two formats, not two exports that happen to share a
 * name. What CSV cannot carry (brand colours, typed cells, dropdowns) is a
 * format limit, not a divergence: numbers are written raw so they land as
 * numbers, never grouped-French strings.
 *
 * UTF-8 WITH BOM, always: Windows Excel reads a BOM-less CSV in the legacy
 * code page, which turns `Société Générale` into mojibake — for a francophone
 * product that is every other row, not an edge case.
 */
"use strict";

const { neutralContext } = require("./context");
const { cellSpec, headerText } = require("./build");

/** Quote a CSV cell per RFC 4180 (escape embedded quotes, wrap if needed). */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serial dates become ISO text — the fake-UTC Date built by serialDate
 *  carries the entity-timezone wall clock, so slicing it is tz-correct.
 *  A datetime column keeps its minutes; a date column stops at the day. */
function csvText(v, fmt) {
  if (v instanceof Date) {
    return v.toISOString().slice(0, fmt && fmt.includes("hh") ? 16 : 10).replace("T", " ");
  }
  return v;
}

/**
 * Build a CSV buffer. `columns` is the same ColumnSpec list the xlsx builder
 * takes; only the presentation differs (no numFmt, no colours).
 * @param {{columns:import("./build").ColumnSpec[], rows?:Object[], context?:Object}} opts
 * @returns {Buffer}
 */
function buildCsv({ columns, rows = [], context } = {}) {
  const ctx = context || neutralContext();
  const specs = columns.map((c) => cellSpec(c, ctx));
  const headers = columns.map((c, i) => csvCell(headerText(c, specs[i])));
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c, i) => csvCell(csvText(specs[i].coerce(row[c.key]), specs[i].fmt)))
        .join(","),
    );
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

/**
 * Parse CSV text (RFC 4180: quoted fields, "" escapes, CRLF/LF, BOM) into an
 * array of objects keyed by the trimmed header row. Fully blank rows skipped.
 * @param {string|Buffer} input
 * @returns {Object[]}
 */
function parseCsv(input) {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  // Bound the input (CodeQL js/loop-bound-injection): the parse loop below is
  // O(text.length) with `length` user-controlled. A 25 MB upload would walk
  // 25 million characters in one request; imports are register-sized, so the
  // cap is generous and the rejection is loud.
  if (text.length > 5 * 1024 * 1024) {
    const e = new Error("Spreadsheet is too large — the limit is 5 MB");
    e.status = 413;
    throw e;
  }

  const grid = [];
  let row = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRow(); // lone CR = EOL; CRLF handled by \n
    } else field += ch;
  }
  if (field !== "" || row.length) endRow(); // flush trailing field/row

  if (!grid.length) return [];
  const headers = grid[0].map((h) => String(h ?? "").trim());
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
}

module.exports = { buildCsv, parseCsv };
