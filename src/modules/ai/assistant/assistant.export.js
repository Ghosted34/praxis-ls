/**
 * Excel export for the assistant's answers — one workbook, one sheet per table.
 *
 * WHY THIS EXISTS. An answer routinely comes back with several tables in it: a
 * financial model arrives as actuals, receivables ageing, tax position, model
 * inputs and then a sheet per scenario. The workspace lifts them out of the
 * markdown and shows them as real tables, and the obvious next thing a person
 * wants is all of them in Excel — as sheets of one workbook, because they are
 * one analysis and comparing them across three separate downloads is not
 * comparing them.
 *
 * WHY THE SERVER BUILDS IT. The platform already owns a workbook builder —
 * `services/spreadsheet.service.buildWorkbook`, the one the Vault report export
 * uses — so a browser-built file would be a second implementation of something
 * that exists, and it would mean shipping a spreadsheet writer to every client
 * that loads the app, for one button, into a bundle the frontend gates on size.
 *
 * NOTE for whoever looks for the other one: `services/excel/workbook.js` is a
 * richer-looking toolkit and it is DEAD. It requires `../../utils/dates`, which
 * does not exist in this repo (`src/utils/` holds only `errors.js`), so it
 * cannot even be loaded; nothing imports it; and its house style is another
 * product's — "Pixie Girl Hub", Maroon Noir, ₦ number formats. It was reached
 * for first here and failed on the first call. `spreadsheet.service` is the live
 * one.
 *
 * NOTHING IS READ FROM THE DATABASE HERE, and that is the security property
 * worth stating: the rows arrive in the request because they were already on the
 * caller's screen, in an answer produced under their own permissions. This
 * endpoint formats what they can already see. It has no query, so it has no way
 * to widen what they can see — which is why it needs no RBAC check beyond the
 * auth and AI-feature gate the router already applies.
 *
 * The bound on the payload is therefore about resource use rather than access:
 * a request cannot ask the server to build an arbitrarily large workbook.
 */
"use strict";

const { buildWorkbook } = require("../../../services/spreadsheet.service");

/** Payload ceilings. Generous for an answer, far below a denial-of-service. */
const MAX_SHEETS = 25;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

/**
 * Is this cell a number written for people?
 *
 * The rows come from markdown, so every cell is a string — including
 * "18,000,000", "1 250 000" and "5,940,000 XAF". Writing those to Excel as text
 * gives a spreadsheet that cannot sum its own totals, which defeats the point of
 * exporting to a spreadsheet at all.
 *
 * The separator class covers U+00A0 and U+202F as well as ASCII space: OHADA
 * and French formatting group thousands with a (narrow) no-break space, so
 * "1\u00A0250\u00A0000" is the normal way an amount reaches this function, not an
 * edge case. They are written as escapes because a literal no-break space in a
 * regex is invisible to the next reader and to `no-irregular-whitespace`.
 *
 * Deliberately conservative. It coerces only when the cell is a number with
 * grouping and an optional currency-ish suffix or leading sign; anything with
 * other letters in it stays text. A document reference like "SBX-2026-0001" must
 * never become -20260001, and a date must not silently become a serial.
 */
function coerce(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  // Strip markdown emphasis the model uses on total rows.
  const bare = v.replace(/^\*\*(.*)\*\*$/, "$1").trim();
  // Optional sign / parenthesised negative, digits with , . or space grouping,
  // optional trailing % or a short currency code.
  const m = bare.match(/^\(?\s*([-+]?)\s*([\d][\d.,\s\u00A0\u202F]*)\s*\)?\s*(%|[A-Z]{3})?$/);
  if (!m) return bare;
  const negative = /^\(.*\)$/.test(bare) || m[1] === "-";
  const digits = m[2].replace(/[\s\u00A0\u202F,]/g, "");
  // A second decimal point means it was never a number (a version, an id).
  if ((digits.match(/\./g) || []).length > 1) return bare;
  const n = Number(digits);
  if (!Number.isFinite(n)) return bare;
  if (m[3] === "%") return (negative ? -n : n) / 100;
  return negative ? -n : n;
}

/** Excel forbids some characters in sheet names and caps them at 31 chars. */
function sheetName(title, index) {
  const clean = String(title || "")
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || `Table ${index + 1}`).slice(0, 31);
}

/**
 * Build the workbook.
 *
 * `buildWorkbook` takes `{ sheets: [{ name, columns, rows }] }` where columns
 * are `{ header, key }` and rows are objects. An answer's table is a header
 * array and row arrays, so the shape is adapted here rather than a second
 * builder being introduced.
 *
 * Column keys are POSITIONAL (`c0`, `c1`). A markdown header can repeat, be
 * blank, or be an emoji, and none of those make a usable object key — the
 * visible header text is carried separately in `header`.
 */
async function buildTablesWorkbook(tables) {
  const used = new Set();
  const sheets = tables.slice(0, MAX_SHEETS).map((t, i) => {
    // Sheet names must be unique within a workbook, or ExcelJS throws.
    let name = sheetName(t.title, i);
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n})`;
      name = `${sheetName(t.title, i).slice(0, 31 - suffix.length)}${suffix}`;
      n += 1;
    }
    used.add(name.toLowerCase());

    const header = (t.header || []).slice(0, MAX_COLS);
    const columns = header.map((label, c) => ({
      key: `c${c}`,
      // The header itself can carry markdown emphasis.
      header: String(label ?? "").replace(/^\*\*(.*)\*\*$/, "$1").trim() || `Column ${c + 1}`,
      width: 22,
    }));

    const rows = (t.rows || []).slice(0, MAX_ROWS).map((r) => {
      const o = {};
      header.forEach((_, c) => {
        o[`c${c}`] = coerce(r[c]);
      });
      return o;
    });

    return { name, columns, rows };
  });

  return buildWorkbook({ sheets });
}

module.exports = { buildTablesWorkbook, coerce, sheetName, MAX_SHEETS, MAX_ROWS, MAX_COLS };
