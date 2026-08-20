/**
 * Report → spreadsheet projection (MOD-63). Turns a report producer's `data`
 * (which varies: a flat array of rows, an object wrapping a rows[] array, or a
 * nested statement object) into the generic `{columns, rows}` contract the
 * branded spreadsheet toolkit (services/spreadsheet) consumes, and renders it
 * to a csv or xlsx buffer.
 *
 * Deliberately generic rather than per-report bespoke: it gives every report
 * in the catalogue a usable csv/xlsx immediately. Tabular reports export as a
 * real table; nested statement objects flatten to a Field/Value sheet —
 * honest, not pixel-perfect DGI output.
 *
 * BRANDING: the render functions are pure shape-mappers; the tenant's
 * WorkbookContext is resolved by the CALLER inside its tenant connection and
 * passed through as the last argument. Without one (unit tests) the toolkit
 * falls back to the neutral Praxis default — production paths always pass it.
 */
"use strict";

const { buildCsv, buildWorkbook, sheetName: safeSheetName } = require("../../../services/spreadsheet");
const { AppError } = require("../../../utils/errors");

const CONTENT_TYPE = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Array properties a report object might wrap its rows in, in priority order.
const ROW_KEYS = ["rows", "reminders", "buckets", "lines", "entries", "items", "accounts", "results", "data"];

/** "receivables_ageing" → "Receivables ageing"; "d1_30" → "D1 30". */
function titleize(key) {
  const s = String(key || "").replace(/[._]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Report";
}

/**
 * Excel-safe sheet name for a report key. Thin wrapper over the ONE shared
 * sanitizer (services/spreadsheet/helpers.js) so a 32-char or punctuation-heavy
 * report key cannot render differently here and in the builder.
 */
function sheetName(reportKey) {
  return safeSheetName(titleize(reportKey), { fallback: "Report" });
}

/** A cell must be a scalar; objects/arrays are JSON so nothing is silently dropped. */
function scalar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/** Flatten a nested object to dot-path → scalar pairs (for statement objects). */
function flattenPairs(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flattenPairs(v, path, out);
    else out.push({ field: path, value: scalar(v) });
  }
  return out;
}

/** rows[] of objects → {columns, rows} with columns = union of keys, order-preserved. */
function fromRows(name, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = [];
  const seen = new Set();
  for (const r of list) {
    if (r && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  if (!keys.length) {
    // Array of scalars (or empty) → single Value column.
    return { sheetName: name, columns: [{ header: "Value", key: "value" }], rows: list.map((v) => ({ value: scalar(v) })) };
  }
  const columns = keys.map((k) => ({ header: titleize(k), key: k }));
  const outRows = list.map((r) => {
    const o = {};
    for (const k of keys) o[k] = scalar(r ? r[k] : "");
    return o;
  });
  return { sheetName: name, columns, rows: outRows };
}

/** Field/Value sheet for a flat or nested object. */
function fromObject(name, obj) {
  return {
    sheetName: name,
    columns: [{ header: "Field", key: "field" }, { header: "Value", key: "value" }],
    rows: flattenPairs(obj),
  };
}

/**
 * Project a report's `data` into { sheetName, columns, rows }.
 */
function tabulate(reportKey, data) {
  const name = sheetName(reportKey);
  if (Array.isArray(data)) return fromRows(name, data);
  if (data && typeof data === "object") {
    const arrKey = ROW_KEYS.find((k) => Array.isArray(data[k]));
    if (arrKey) return fromRows(name, data[arrKey]);
    return fromObject(name, data);
  }
  return { sheetName: name, columns: [{ header: "Value", key: "value" }], rows: [{ value: scalar(data) }] };
}

/**
 * Render a report's data to a downloadable buffer.
 * @param {string} reportKey
 * @param {*} data        the report producer's output
 * @param {string} format "csv" | "xlsx"
 * @param {Object} [context] WorkbookContext (resolveContext) — required in
 *        production; drives brand colours, cover sheet, language, timezone.
 * @returns {Promise<{buffer:Buffer, contentType:string, extension:string}>}
 */
async function toExport(reportKey, data, format, context = null) {
  const fmt = String(format || "").toLowerCase();
  const { sheetName: name, columns, rows } = tabulate(reportKey, data);
  if (fmt === "csv") {
    return { buffer: buildCsv({ columns, rows, context }), contentType: CONTENT_TYPE.csv, extension: "csv" };
  }
  if (fmt === "xlsx") {
    const buffer = await buildWorkbook({
      sheets: [{ name, title: titleize(reportKey), columns, rows }],
      context,
      // A scheduled/on-demand report is a document that circulates: it gets
      // the cover (identity, timestamp, sandbox stamp, Powered-by). Import
      // templates are the artefacts that must NOT.
      cover: !!context,
    });
    return { buffer, contentType: CONTENT_TYPE.xlsx, extension: "xlsx" };
  }
  throw new AppError("UNSUPPORTED_FORMAT", `Export format must be csv or xlsx (got '${format}'). PDF is at /run/:key/pdf.`, 422);
}

module.exports = { tabulate, toExport, sheetName, CONTENT_TYPE };
