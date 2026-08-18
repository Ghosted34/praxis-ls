/**
 * PDF statement parser - text-layer extraction and table reconstruction.
 *
 * WHY THIS EXISTS. PDF is the most common statement export from CEMAC
 * e-banking, ahead of CSV. An engine that cannot read one sends the accountant
 * back to re-keying, which is the problem this module was built to remove.
 *
 * WHY IT IS SAFE TO SHIP A BEST-EFFORT EXTRACTOR. PDF is a page-description
 * format: it stores glyphs at coordinates, not a table. Reconstructing rows and
 * columns from positions is inference, and inference is sometimes wrong. Two
 * things make that acceptable here, and neither is optional:
 *
 *   1. NOTHING IS ACCEPTED WITHOUT A HUMAN LOOKING AT IT. Extraction feeds the
 *      same mapping-preview screen as every other format. The treasurer sees the
 *      parsed grid beside the values it produced before a single row is stored.
 *   2. THE ARITHMETIC CHECKS THE PARSE. A dropped row, a column read into the
 *      wrong field, a page footer counted as data - all of them break the
 *      footing identity in reconciliation.rules.js §6, and a statement that
 *      does not foot cannot be advanced to VALIDATED. The reviewer is not being
 *      asked to eyeball 300 rows; the arithmetic does that, and points at the
 *      row that broke.
 *
 * SCOPE. Text-layer PDFs only - the kind a bank's system generated. A SCANNED
 * statement (a photograph of paper) has no text layer and returns zero rows
 * with `scanned: true`, so the caller can say "this is a scan, OCR is not in
 * this release" instead of silently producing an empty statement.
 *
 * NO PDF LIBRARY, deliberately: only Node's own zlib. The subset of PDF needed
 * to pull a text layer is small, and a full parser on untrusted input is a
 * wider attack surface than this feature justifies.
 */
"use strict";

const zlib = require("zlib");

const MAX_ITEMS = 200000;
const ROW_TOLERANCE = 3.2;      // points; glyphs within this share a baseline
const COLUMN_TOLERANCE = 12;    // points; x-starts within this are one column

/* ── 1. Object and stream extraction ─────────────────────────────────────── */

/**
 * Pull every FlateDecode stream out of the file and inflate it.
 *
 * Streams whose filter we do not implement are skipped rather than guessed at,
 * and an inflate failure skips that stream instead of failing the document - a
 * statement with one damaged object should still yield its other pages.
 */
function inflateStreams(buffer) {
  const out = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    // The object dictionary sits immediately before the `stream` keyword.
    const dictStart = buffer.lastIndexOf(Buffer.from("<<"), start);
    const dict = dictStart === -1 ? "" : buffer.slice(dictStart, start).toString("latin1");

    let dataStart = start + marker.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const data = buffer.slice(dataStart, end);

    if (/\/FlateDecode/.test(dict)) {
      try {
        out.push({ dict, data: zlib.inflateSync(data) });
      } catch {
        try { out.push({ dict, data: zlib.inflateRawSync(data) }); } catch { /* skip damaged stream */ }
      }
    } else if (!/\/(DCT|JPX|CCITT|JBIG2|RunLength|LZW)Decode/.test(dict)) {
      out.push({ dict, data });                      // uncompressed content stream
    }
    cursor = end + endMarker.length;
  }
  return out;
}

/* ── 2. ToUnicode CMaps ──────────────────────────────────────────────────── */

/**
 * Parse a ToUnicode CMap into `code -> character`.
 *
 * Subset fonts (the norm in generated PDFs) map byte values to arbitrary glyph
 * indices, so without this the extracted text is mojibake. Both CMap forms are
 * handled: `beginbfchar` (explicit pairs) and `beginbfrange` (runs).
 */
function parseToUnicode(text) {
  const map = new Map();
  const hexToStr = (h) => {
    let s = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const code = parseInt(h.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code > 0) s += String.fromCharCode(code);
    }
    return s;
  };

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = charRe.exec(text)) !== null) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pairRe.exec(m[1])) !== null) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }

  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text)) !== null) {
    const simple = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = simple.exec(m[1])) !== null) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      const base = parseInt(p[3], 16);
      if (hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c += 1) map.set(c, String.fromCharCode(base + (c - lo)));
    }
    const listed = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((p = listed.exec(m[1])) !== null) {
      const lo = parseInt(p[1], 16);
      const items = p[3].match(/<([0-9A-Fa-f]+)>/g) || [];
      items.forEach((item, i) => map.set(lo + i, hexToStr(item.replace(/[<>]/g, ""))));
    }
  }
  return map;
}

/* ── 3. Content-stream text extraction ───────────────────────────────────── */

/** A PDF literal string `(...)`, with escapes and balanced inner parentheses. */
function readLiteral(s, start) {
  let out = "";
  let depth = 1;
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const next = s[i + 1];
      const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (simple[next] !== undefined) { out += simple[next]; i += 2; continue; }
      const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
      if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += 1 + oct[0].length; continue; }
      i += 2; continue;
    }
    if (ch === "(") { depth += 1; out += ch; i += 1; continue; }
    if (ch === ")") { depth -= 1; if (depth === 0) return { text: out, next: i + 1 }; out += ch; i += 1; continue; }
    out += ch; i += 1;
  }
  return { text: out, next: i };
}

/** A PDF hex string `<...>`, decoded through the active ToUnicode map. */
function readHex(s, start, cmap) {
  const end = s.indexOf(">", start);
  if (end === -1) return { text: "", next: s.length };
  const hex = s.slice(start, end).replace(/\s+/g, "");
  let text = "";
  const step = cmap && cmap.size ? 4 : 2;
  for (let i = 0; i < hex.length; i += step) {
    const code = parseInt(hex.slice(i, i + step), 16);
    if (!Number.isFinite(code)) continue;
    if (cmap && cmap.has(code)) text += cmap.get(code);
    else if (step === 4) text += String.fromCharCode(code);
    else text += String.fromCharCode(code);
  }
  return { text, next: end + 1 };
}

/**
 * Walk one content stream, emitting `{ x, y, text }` in DEVICE space for every
 * show-text operator.
 *
 * A PROPER TOKENISER, not a regex sweep over the operators. PostScript-style
 * content is postfix - operands precede their operator - so the only correct
 * way to read `1 0 0 -1 8 30 Tm` is to push six numbers and let `Tm` consume
 * them. An earlier draft re-scanned the preceding bytes for numbers instead,
 * which happily picked up operands belonging to the previous operator and
 * placed text at coordinates that never appeared in the file.
 *
 * THE PAGE IS USUALLY UPSIDE DOWN, and this is the detail that decides whether
 * the extracted table comes out in reading order or reversed. PDF device space
 * has y increasing UPWARD, but generators (Chromium among them) routinely
 * install a flipping CTM - `0.24 0 0 -0.24 0 841.92 cm` - and then a flipped
 * text matrix - `1 0 0 -1 8 30 Tm` - so that they can emit coordinates in the
 * screen convention of y increasing downward. Read naively, a statement comes
 * out with its last transaction first and its header in the middle.
 *
 * So the CTM is tracked through `cm`, `q` and `Q`, and every text origin is
 * mapped into device space before it is used. After that, "higher y is higher
 * on the page" is true again and the rest of the file can rely on it.
 *
 * Rotation and skew (the b and c matrix components) are ignored: a statement
 * table is axis-aligned, and rotated text is a watermark or a page-edge label,
 * which should not become a table cell.
 */
function extractItems(content, cmap) {
  const items = [];

  // Graphics state: the current transformation matrix, and the q/Q stack.
  let ctm = { a: 1, d: 1, e: 0, f: 0 };
  const gsStack = [];

  // Text state.
  let tmA = 1;
  let tmD = 1;
  let originX = 0;
  let originY = 0;
  let leading = 0;

  // Operand stack. Numbers and strings accumulate here until an operator eats
  // them, exactly as the PDF imaging model specifies.
  let operands = [];
  const nums = (n) => {
    const vals = operands.filter((o) => typeof o === "number");
    return vals.length >= n ? vals.slice(-n) : null;
  };
  const lastString = () => {
    for (let i = operands.length - 1; i >= 0; i -= 1) if (typeof operands[i] === "string") return operands[i];
    return null;
  };

  const push = (text) => {
    if (!text || !text.trim()) return;
    items.push({
      x: ctm.a * originX + ctm.e,
      y: ctm.d * originY + ctm.f,
      text,
    });
  };

  let i = 0;
  while (i < content.length && items.length < MAX_ITEMS) {
    const ch = content[i];

    // Whitespace.
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0") { i += 1; continue; }

    // Comment.
    if (ch === "%") { while (i < content.length && content[i] !== "\n") i += 1; continue; }

    // Strings.
    if (ch === "(") { const r = readLiteral(content, i + 1); operands.push(r.text); i = r.next; continue; }
    if (ch === "<" && content[i + 1] === "<") {           // inline dictionary - skip it
      let depth = 1; i += 2;
      while (i < content.length && depth > 0) {
        if (content[i] === "<" && content[i + 1] === "<") { depth += 1; i += 2; continue; }
        if (content[i] === ">" && content[i + 1] === ">") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }
    if (ch === "<") { const r = readHex(content, i + 1, cmap); operands.push(r.text); i = r.next; continue; }

    // A TJ array: strings interleaved with kerning numbers. A large negative
    // kern is an inter-word gap and becomes a space, which is what keeps
    // "DUPONT SARL" from arriving as "DUPONTSARL".
    if (ch === "[") {
      let j = i + 1;
      let assembled = "";
      while (j < content.length && content[j] !== "]") {
        if (content[j] === "(") { const r = readLiteral(content, j + 1); assembled += r.text; j = r.next; continue; }
        if (content[j] === "<") { const r = readHex(content, j + 1, cmap); assembled += r.text; j = r.next; continue; }
        const num = /^-?\d+(\.\d+)?/.exec(content.slice(j, j + 16));
        if (num) { if (Number(num[0]) <= -120) assembled += " "; j += num[0].length; continue; }
        j += 1;
      }
      operands.push(assembled);
      i = j + 1;
      continue;
    }
    if (ch === "]" || ch === ")" || ch === ">" || ch === "{" || ch === "}") { i += 1; continue; }

    // Numbers.
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(content.slice(i, i + 32));
    if (num) { operands.push(Number(num[0])); i += num[0].length; continue; }

    // Names (/F4, /P) - not operands we use, but they must not be read as ops.
    if (ch === "/") {
      i += 1;
      while (i < content.length && !/[\s/[\]<>(){}%]/.test(content[i])) i += 1;
      continue;
    }

    // An operator token.
    const opMatch = /^[A-Za-z'"*][A-Za-z0-9'"*]*/.exec(content.slice(i, i + 24));
    if (!opMatch) { i += 1; continue; }
    const op = opMatch[0];
    i += op.length;

    switch (op) {
      case "q":
        gsStack.push({ ...ctm });
        break;
      case "Q":
        if (gsStack.length) ctm = gsStack.pop();
        break;
      case "cm": {
        const v = nums(6);
        if (v) {
          // Concatenate: new = m x ctm (axis-aligned components only).
          ctm = {
            a: v[0] * ctm.a,
            d: v[3] * ctm.d,
            e: v[4] * ctm.a + ctm.e,
            f: v[5] * ctm.d + ctm.f,
          };
        }
        break;
      }
      case "BT":
        tmA = 1; tmD = 1; originX = 0; originY = 0;
        break;
      case "Tm": {
        const v = nums(6);
        if (v) { tmA = v[0]; tmD = v[3]; originX = v[4]; originY = v[5]; }
        break;
      }
      case "Td": case "TD": {
        const v = nums(2);
        if (v) {
          originX += tmA * v[0];
          originY += tmD * v[1];
          if (op === "TD") leading = -v[1];
        }
        break;
      }
      case "TL": { const v = nums(1); if (v) leading = v[0]; break; }
      case "T*":
        originY += tmD * -leading;
        break;
      case "Tj": case "TJ":
        push(lastString());
        break;
      case "'":
        originY += tmD * -leading;
        push(lastString());
        break;
      case '"':
        originY += tmD * -leading;
        push(lastString());
        break;
      default:
        break;
    }
    operands = [];
  }
  return items;
}

/* ── 4. Table reconstruction ─────────────────────────────────────────────── */

/** Group items sharing a baseline into visual rows, top of page first. */
function groupRows(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let current = null;
  for (const it of sorted) {
    if (!current || Math.abs(current.y - it.y) > ROW_TOLERANCE) {
      current = { y: it.y, items: [] };
      rows.push(current);
    }
    current.items.push(it);
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Find the column boundaries by clustering x-starts across every row.
 *
 * A table's columns are the x positions that recur on many rows; a one-off x is
 * a heading or a stray. Clusters seen on fewer than a fifth of rows are dropped,
 * which is what stops a page title becoming a column.
 */
function detectColumns(rows) {
  const xs = [];
  for (const r of rows) for (const it of r.items) xs.push(it.x);
  if (!xs.length) return [];
  xs.sort((a, b) => a - b);

  const clusters = [];
  let cur = { x: xs[0], count: 1, sum: xs[0] };
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] - cur.x <= COLUMN_TOLERANCE) { cur.count += 1; cur.sum += xs[i]; cur.x = xs[i]; }
    else { clusters.push({ x: cur.sum / cur.count, count: cur.count }); cur = { x: xs[i], count: 1, sum: xs[i] }; }
  }
  clusters.push({ x: cur.sum / cur.count, count: cur.count });

  const floor = Math.max(2, rows.length * 0.2);
  return clusters.filter((c) => c.count >= floor).map((c) => c.x).sort((a, b) => a - b);
}

/** Assign each row's items to the nearest column, joining co-located glyphs. */
function toGrid(rows, columns) {
  if (!columns.length) return rows.map((r) => [r.items.map((i) => i.text).join(" ").trim()]);
  return rows.map((r) => {
    const cells = new Array(columns.length).fill("");
    for (const it of r.items) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < columns.length; c += 1) {
        const d = Math.abs(it.x - columns[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      cells[best] = cells[best] ? `${cells[best]} ${it.text.trim()}` : it.text.trim();
    }
    return cells.map((c) => c.replace(/\s+/g, " ").trim());
  });
}

/* ── 5. Entry point ──────────────────────────────────────────────────────── */

/**
 * Parse a PDF statement into the `{ headers, rows, meta }` contract the other
 * parsers use, so the mapping and preview screens do not care which format the
 * treasurer uploaded.
 */
function parse(buffer, opts = {}) {
  const { findHeaderRow } = require("./csv");
  const streams = inflateStreams(buffer);

  // Merge every ToUnicode CMap in the document. Fonts are per-page but codes
  // rarely collide across a single generated statement, and merging avoids
  // resolving the page/font/resource graph for a marginal gain.
  const cmap = new Map();
  for (const s of streams) {
    const text = s.data.toString("latin1");
    if (/beginbfchar|beginbfrange/.test(text)) {
      for (const [k, v] of parseToUnicode(text)) if (!cmap.has(k)) cmap.set(k, v);
    }
  }

  const items = [];
  let pageOffset = 0;
  for (const s of streams) {
    const text = s.data.toString("latin1");
    if (!/(\bTj\b|\bTJ\b|\bTd\b|\bTm\b)/.test(text)) continue;
    const pageItems = extractItems(text, cmap);
    if (!pageItems.length) continue;
    // Stack pages vertically so a multi-page statement reads top to bottom
    // rather than interleaving page 2 into page 1 by coincidence of y.
    for (const it of pageItems) items.push({ ...it, y: it.y - pageOffset });
    pageOffset += 100000;
  }

  if (!items.length) {
    return {
      headers: [], rows: [],
      meta: { format: "PDF", scanned: true, pages: streams.length, text_items: 0,
        reason: "no text layer found - this looks like a scanned or image-only PDF, which needs OCR" },
    };
  }

  const visualRows = groupRows(items);
  const columns = detectColumns(visualRows);
  const grid = toGrid(visualRows, columns).filter((r) => r.some((c) => c !== ""));
  if (!grid.length) return { headers: [], rows: [], meta: { format: "PDF", scanned: false, pages: streams.length, text_items: items.length } };

  const headerIndex = (opts.headerRowIndex !== null && opts.headerRowIndex !== undefined) ? opts.headerRowIndex - 1 : findHeaderRow(grid);
  const seen = new Map();
  const headers = (grid[headerIndex] || []).map((h, idx) => {
    let name = String(h || "").trim() || `column_${idx + 1}`;
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name} (${n})`; }
    else seen.set(name, 1);
    return name;
  });

  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const cells = grid[i];
    if (cells.every((c) => c === "")) continue;
    const obj = { __row: i + 1 };
    headers.forEach((h, idx) => { obj[h] = cells[idx] || ""; });
    rows.push(obj);
  }

  return {
    headers,
    rows,
    meta: {
      format: "PDF",
      scanned: false,
      pages: streams.filter((s) => /(\bTj\b|\bTJ\b)/.test(s.data.toString("latin1"))).length,
      text_items: items.length,
      columns_detected: columns.length,
      header_row_index: headerIndex + 1,
      preamble: grid.slice(0, headerIndex).map((r) => r.join(" ").trim()).filter(Boolean),
      // Said out loud so the UI can say it too. PDF is the one format where the
      // grid is inferred rather than declared.
      advisory: "PDF tables are reconstructed from glyph positions. Confirm the preview and rely on the footing check before importing.",
    },
  };
}

module.exports = { parse, inflateStreams, parseToUnicode, extractItems, groupRows, detectColumns, toGrid };
