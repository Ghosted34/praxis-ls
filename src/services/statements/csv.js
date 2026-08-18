/**
 * CSV / delimited-text statement parser.
 *
 * WHY HAND-ROLLED rather than a library. Three reasons, in order of weight:
 *
 *   1. ENCODING. CEMAC portal exports are frequently Windows-1252, not UTF-8,
 *      and the tell is a mangled accent in a header - which silently changes
 *      the header signature and invalidates a confirmed profile. Deciding the
 *      encoding is part of parsing here, not something done to the buffer
 *      beforehand and hoped about.
 *   2. DELIMITER. French-locale exports use `;` because `,` is the decimal
 *      mark. A parser that assumes a comma turns "1,50" into two columns and
 *      every row after it is garbage.
 *   3. PREAMBLE. Portal exports put the account number, the period and a blank
 *      line above the real header row. Every library wants row 1 to be the
 *      header; here, finding the header is the job.
 *
 * Fully RFC 4180 for quoting: doubled quotes inside quoted fields, embedded
 * delimiters, embedded newlines.
 */
"use strict";

const DELIMITERS = [";", ",", "\t", "|"];
const MAX_ROWS = 20000;

/**
 * Decode bytes to text.
 *
 * BOM wins outright - a file that declares itself is not guessed at. Otherwise
 * UTF-8 is tried and REJECTED if it produced replacement characters, which is
 * the reliable signal of a single-byte encoding being read as UTF-8. Windows-1252
 * is the fallback because it is what Excel on a francophone Windows box emits.
 */
function decode(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.slice(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.slice(2).toString("utf16le"), encoding: "utf-16le" };
  }
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return { text: utf8, encoding: "utf-8" };
  return { text: buffer.toString("latin1"), encoding: "windows-1252" };
}

/**
 * Pick the delimiter by consistency, not by frequency.
 *
 * The right delimiter produces the SAME field count on every line; a wrong one
 * produces a count that wobbles with the data (a comma inside a narrative, a
 * decimal comma in an amount). So the winner is the candidate whose modal field
 * count covers the most lines, tie-broken by more columns.
 */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  if (!lines.length) return ",";
  let best = { delimiter: ",", score: -1, columns: 0 };
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const tally = new Map();
    for (const c of counts) tally.set(c, (tally.get(c) || 0) + 1);
    let modal = 1;
    let hits = 0;
    for (const [cols, n] of tally) if (n > hits || (n === hits && cols > modal)) { modal = cols; hits = n; }
    if (modal < 2) continue;
    const score = hits / lines.length;
    if (score > best.score || (score === best.score && modal > best.columns)) {
      best = { delimiter: d, score, columns: modal };
    }
  }
  return best.delimiter;
}

/** Split ONE physical line. Used only by the sniffer; the real parse is below. */
function splitLine(line, delimiter) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Full RFC 4180 parse, honouring newlines inside quoted fields - which a
 * line-by-line split cannot do, and which real statements contain whenever a
 * narrative wrapped.
 */
function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { quoted = true; i += 1; continue; }
    if (ch === delimiter) { endField(); i += 1; continue; }
    if (ch === "\r") { i += 1; continue; }
    if (ch === "\n") { endRow(); i += 1; if (rows.length > MAX_ROWS) break; continue; }
    field += ch; i += 1;
  }
  if (field !== "" || row.length) endRow();

  // Drop trailing all-empty rows (a file ending in blank lines).
  while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === "")) rows.pop();
  return rows;
}

/**
 * Find the header row.
 *
 * The header is the first row that looks like LABELS rather than DATA: mostly
 * non-empty cells, few or no parsable numbers, and at least as many columns as
 * the rows below it. Scanning only the first 25 rows bounds the damage a
 * pathological file can do.
 */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 25);
  let best = { index: 0, score: -1 };
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i].map((c) => String(c ?? "").trim());
    const filled = cells.filter((c) => c !== "").length;
    if (filled < 2) continue;
    const numeric = cells.filter((c) => c !== "" && /^[\d\s.,()-]+$/.test(c)).length;
    const below = rows.slice(i + 1, i + 6);
    const widthOk = below.length ? below.every((r) => r.length <= cells.length + 1) : true;
    const score = filled - numeric * 2 + (widthOk ? 1 : -2) - i * 0.1;
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

/**
 * Parse a CSV statement buffer into `{ headers, rows, meta }`.
 *
 * `rows` are objects keyed by the header cell, plus `__row` (the 1-based line
 * number in the source, for error messages that point at the file the user is
 * looking at). Ragged rows are padded, never dropped: a short row is a parse
 * signal the reviewer needs to see, not a row to hide.
 */
function parse(buffer, opts = {}) {
  const { text, encoding } = decode(buffer);
  const delimiter = opts.delimiter || sniffDelimiter(text);
  const all = parseRows(text, delimiter);
  if (!all.length) return { headers: [], rows: [], meta: { encoding, delimiter, header_row_index: 0, preamble: [] } };

  const headerIndex = (opts.headerRowIndex !== null && opts.headerRowIndex !== undefined) ? opts.headerRowIndex - 1 : findHeaderRow(all);
  const headerRow = all[headerIndex] || [];

  // Blank header cells still need a stable key, or two of them collide.
  const seen = new Map();
  const headers = headerRow.map((h, idx) => {
    let name = String(h ?? "").trim() || `column_${idx + 1}`;
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name} (${n})`; }
    else seen.set(name, 1);
    return name;
  });

  const rows = [];
  for (let i = headerIndex + 1; i < all.length; i += 1) {
    const cells = all[i];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const obj = { __row: i + 1 };
    headers.forEach((h, idx) => { obj[h] = (cells[idx] === null || cells[idx] === undefined) ? "" : String(cells[idx]).trim(); });
    rows.push(obj);
  }

  return {
    headers,
    rows,
    meta: {
      encoding,
      delimiter,
      header_row_index: headerIndex + 1,
      // Kept and returned: the preamble is where the account number and the
      // statement period usually live, and the service mines it for both.
      preamble: all.slice(0, headerIndex).map((r) => r.join(" ").trim()).filter(Boolean),
    },
  };
}

module.exports = { parse, decode, sniffDelimiter, parseRows, findHeaderRow };
