/**
 * Spreadsheet helpers — the pure primitives every spreadsheet artefact shares:
 * cell unwrapping, sheet naming, formula-injection locking, colour conversion,
 * currency-aware number formats and timezone-correct date serials.
 *
 * PURE ON PURPOSE. Nothing here touches a client, a workbook context or the DB:
 * the builder (build.js), the CSV writer (csv.js), the parsers (parse.js) and
 * the bank-statement parser (services/statements/xlsx.js) all call these, and
 * the statement parser must keep its exact behaviour — sharing a primitive is
 * only safe when the primitive cannot grow opinions.
 */
"use strict";

/* ── Cell values ──────────────────────────────────────────────────────────── */

/**
 * Flatten one ExcelJS cell VALUE (not the cell) to a primitive-ish thing.
 *
 * Dates and numbers stay typed — that typing is the whole reason to prefer
 * .xlsx over CSV for machine-read files (see statements/xlsx.js). Formulas
 * yield their cached result, rich text collapses to its runs, hyperlinks to
 * their text. Returns null for empty cells so callers can pick their own
 * blank sentinel (the import parser wants null, the statement parser "").
 */
function cellRawValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text !== null && v.text !== undefined) return v.text; // hyperlink / rich text
    if (v.result !== undefined) return v.result; // formula's cached result
    if (v.error) return ""; // #REF! etc. — an error is not a value
    if (v.hyperlink !== undefined) return v.hyperlink; // link object with no text
  }
  return String(v);
}

/**
 * Unwrap an ExcelJS CELL for the import parser: null for blanks, ISO string
 * for dates (import rows are plain, JSON-serialisable objects).
 */
function cellValue(cell) {
  const v = cellRawValue(cell ? cell.value : null);
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/* ── Sheet names ──────────────────────────────────────────────────────────── */

/**
 * Sanitise + dedupe a sheet title: strip the characters Excel forbids in sheet
 * names ([ ] : * ? / \), collapse whitespace, cap at 31 chars.
 *
 * THE ONE SHARED IMPLEMENTATION — report-export, the assistant export and the
 * builder each used to carry a private copy of this rule, which is how a
 * 32-char report key would have passed two of them and blown up the third.
 *
 * `taken` (optional Set of lower-cased names already used in this workbook)
 * makes the name unique by appending " (2)", " (3)"… — comparison is
 * case-insensitive because Excel resolves sheet references that way. When
 * `taken` is given the chosen name is ADDED to it, so consecutive calls for
 * one workbook cannot collide.
 */
function sheetName(name, { fallback = "Sheet", taken } = {}) {
  const clean =
    String(name ?? "")
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || fallback;
  if (!taken) return clean;
  let out = clean;
  let n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${n})`;
    out = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  taken.add(out.toLowerCase());
  return out;
}

/* ── Formula-injection lock ──────────────────────────────────────────────── */

/**
 * Excel/Sheets/LibreOffice treat a value that STARTS with = + - @, tab or CR
 * as a formula when the file is opened. Cell contents in an ERP are
 * user-supplied (client names, journal narratives), so `=HYPERLINK(...)`
 * typed into a name field must not become live code on the auditor's machine
 * (OWASP "CSV Injection"). One leading apostrophe neutralises it while still
 * displaying the original text — the same lock the client applies
 * (client/src/lib/export-csv.ts); the server exported without it.
 *
 * STRINGS ONLY. A typed number/date/bool cannot be a formula, and prefixing
 * one would turn a summable amount into text — the exact defect this service
 * exists to prevent.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeFormula(v) {
  if (typeof v !== "string") return v;
  return FORMULA_LEAD.test(v) ? `'${v}` : v;
}

/* ── Colours ─────────────────────────────────────────────────────────────── */

/**
 * A branding hex (#RRGGBB, RRGGBB, #AARRGGBB, AARRGGBB) → Excel ARGB.
 * Anything else (rgb() functions, named colours, garbage) → null so the
 * caller falls back to the neutral default rather than writing a fill Excel
 * silently drops.
 */
function hexToArgb(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const body = m[1].toUpperCase();
  return body.length === 6 ? `FF${body}` : body;
}

/* ── Money formats ───────────────────────────────────────────────────────── */

/**
 * The Excel number format for a currency with `decimals` minor units:
 * XAF/XOF/JPY → "#,##0" (no cents — the franc has no subdivision), USD/EUR →
 * "#,##0.00", Gulf dinars → "#,##0.000".
 *
 * Locale-independent section codes only: no [$FCFA] / [$USD] currency
 * templates (regional Excel builds render those wrong or not at all) and no
 * thousands-space grouping (French Excel accepts it, others do not). The ISO
 * code lives in the column HEADER, never in the cell — that keeps the cell a
 * raw number that SUMs across a whole ledger.
 */
function moneyNumFmt(decimals) {
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 6 ? decimals : 2;
  return d === 0 ? "#,##0" : `#,##0.${"0".repeat(d)}`;
}

/* ── Language ────────────────────────────────────────────────────────────── */

/** Yes/No in the corporate entity's language (the one label pair we emit). */
function boolLabels(language) {
  return language === "fr" ? { yes: "Oui", no: "Non" } : { yes: "Yes", no: "No" };
}

/** Pick the fr/en string for the entity's default_language; anything else → en. */
function pickLang(fr, en, language) {
  return language === "fr" ? fr : en;
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

/**
 * Guard a timezone string: an IANA name the runtime rejects would make every
 * Intl call throw mid-export, so validate once and fall back to UTC — a
 * slightly wrong offset on a label beats no file at all.
 */
function safeTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: String(tz || "UTC") });
    return String(tz);
  } catch {
    return "UTC";
  }
}

/**
 * Wall-clock parts of an instant in a timezone, via Intl — never the host's
 * own timezone, and never Date.toLocaleString's implicit one. An ERP whose
 * books close at midnight in Douala must not print 23:00 the previous day
 * because the container runs in UTC.
 */
function wallClock(value, timezone) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/**
 * An ExcelJS-writable Date for a spreadsheet cell, in the ENTITY's timezone.
 *
 * ExcelJS serialises a Date with UTC arithmetic, and an Excel serial is
 * timezone-less — so the instant must first be converted to the entity's
 * wall clock, then rebuilt as a fake-UTC Date. Writing the raw instant would
 * silently display the container's UTC as if it were local time.
 *
 * `hasTime: false` (a calendar-date column) keeps only the wall date: a date
 * column has no instant to shift, and 2026-08-20 must survive any timezone.
 */
function serialDate(value, { timezone = "UTC", hasTime = true } = {}) {
  if (value === null || value === undefined || value === "") return null;
  // A bare YYYY-MM-DD is a calendar date already — no tz conversion applies.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const wall = wallClock(value, timezone);
  if (!wall) return null;
  return hasTime
    ? new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second))
    : new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
}

/** "2026-08-20 15:42" in the entity timezone — cover/meta text, not a cell. */
function formatInstant(value, timezone) {
  const wall = wallClock(value, timezone);
  if (!wall) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${wall.year}-${p(wall.month)}-${p(wall.day)} ${p(wall.hour)}:${p(wall.minute)}`;
}

/* ── Filenames ───────────────────────────────────────────────────────────── */

/**
 * Download filename with the date and, in Test mode, an unmistakable SANDBOX
 * segment — a statutory-looking file named like a live one is a compliance
 * hazard the moment someone attaches it to a real dossier (mirrors
 * kit.watermarkFor's forced "TEST SANDBOX" for PDFs).
 */
function exportFilename({ base, env, extension, date = new Date() }) {
  // BOUND BEFORE ANY REGEX WORK (CodeQL js/polynomial-regex). `base` can be a
  // user-chosen scheduled-report name whose validator sets no max length, and
  // this chain used to normalise the FULL string before slicing to 80 —
  // quadratic-shaped regex work on unbounded input to keep 80 characters.
  // Sliced first, every pattern below runs over at most 80 chars.
  const bounded = String(base || "export").slice(0, 80);
  const safe = bounded
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    // Trim the ends as two SINGLE-alternative anchored patterns. The old
    // `/^[-.]+|[-.]+$/` — one alternation, two overlapping greedy quantifiers —
    // is exactly the ambiguous shape CodeQL flags as polynomial on adversarial
    // input; each of these has one path and is linear. House precedent is that
    // the flagged sink GOES rather than being fenced (see the rateMap rewrite
    // in currency.service.js).
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "") || "export";
  const stamp = date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
  return env === "sandbox" ? `${safe}-SANDBOX-${stamp}.${extension}` : `${safe}-${stamp}.${extension}`;
}

module.exports = {
  cellRawValue,
  cellValue,
  sheetName,
  escapeFormula,
  hexToArgb,
  moneyNumFmt,
  boolLabels,
  pickLang,
  safeTimezone,
  serialDate,
  formatInstant,
  exportFilename,
};
