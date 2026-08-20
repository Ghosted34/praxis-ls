/**
 * The branded workbook builder. PURE: rows in → .xlsx buffer out. All tenant
 * facts arrive in the WorkbookContext (see context.js), so unit tests feed a
 * fixture and production callers must feed `resolveContext(client, …)` run
 * inside their tenant connection — a missing context falls back to the neutral
 * Praxis default, which is a test affordance, never an excuse for unbranded
 * production output.
 *
 * What "branded" means here, concretely:
 *   - header fill = tenant primary; header font = tenant primaryForeground
 *     (contrast is branding's problem — theme.ts enforces AA); accent = the
 *     tenant accent or primary
 *   - `wb.creator`/`lastModifiedBy` = the tenant's display name, never another
 *     product's; no context → "Praxis LS"
 *   - optional Cover sheet: logo, entity letterhead (legal name, RCCM, NIU,
 *     address), title, filters, generated-at in the ENTITY timezone, actor,
 *     TEST SANDBOX stamp for sandbox exports, and a "Powered by Praxis LS"
 *     hyperlink to https://praxisls.com
 *   - money cells are raw typed numbers formatted from the currency row's own
 *     decimals (0 for XAF — no cents, no symbol, no [$FCFA] template); the ISO
 *     code rides in the column HEADER, so a franc ledger still SUMs
 */
"use strict";

const ExcelJS = require("exceljs");
const { currencies } = require("@praxis/shared");
const { neutralContext } = require("./context");
const {
  sheetName,
  escapeFormula,
  hexToArgb,
  moneyNumFmt,
  boolLabels,
  pickLang,
  serialDate,
  formatInstant,
} = require("./helpers");

const REFERENCE_SHEET = "Reference";
const POWERED_BY_URL = "https://praxisls.com";
// Sandbox stamp colour. Deliberately NOT the tenant brand: a Test file must be
// recognisable as Test even for a tenant whose primary is also orange (the
// neutral default is). Red is the universal "not real" signal on a document.
const SANDBOX_STAMP = "FFB91C1C";

/**
 * @typedef {Object} ColumnSpec
 * @property {string} header     Human header shown in row 1.
 * @property {string} key        Object key used for rows + parsed rows.
 * @property {number} [width]
 * @property {string} [note]     Cell comment on the header (guidance).
 * @property {string} [format]   money|qty|int|num|pct|date|datetime|bool|text|ref
 * @property {string} [currency] ISO code for a money column (header suffix +
 *                                decimals source; defaults to the tenant base).
 * @property {string[]} [list]   Inline dropdown values (small, fixed lists).
 * @property {string} [refColumn] Reference-sheet block title whose values
 *                                become this column's dropdown.
 * @property {boolean} [total]   Add a =SUM() cell for this column in a totals row.
 * @property {boolean} [wrap]    Wrap text in data cells (long reason strings).
 * @property {boolean} [emphasis] Data-cell font in the brand primary (the
 *                                "why rejected" column of an import error file).
 */

/** Minor units for a code: the context catalogue (tenant row composed with
 *  @praxis/shared), then the shared catalogue alone, then 2. */
function decimalsFor(context, code) {
  const known = context.currencies && context.currencies[code];
  if (known && Number.isInteger(known.decimals)) return known.decimals;
  return currencies.decimalsFor(code);
}

/** numFmt + coercion for one column format. */
function cellSpec(column, context) {
  const lang = context.language;
  const bools = boolLabels(lang);
  switch (column.format) {
    case "money": {
      const code = column.currency || context.baseCurrency || null;
      return {
        fmt: code ? moneyNumFmt(decimalsFor(context, code)) : moneyNumFmt(2),
        code,
        coerce: (v) => num(v),
        align: "right",
      };
    }
    case "int":
      return { fmt: "#,##0", coerce: num, align: "right" };
    case "qty":
      // Quantities in logistics are counts (containers) OR measures (m³, kg
      // with three decimals) — show what is there, up to 3 places.
      return { fmt: "#,##0.###", coerce: num, align: "right" };
    case "num":
      return { fmt: "#,##0.00", coerce: num, align: "right" };
    case "pct":
      // Fraction in, % out (0.1925 → 19.3%) — the same convention the
      // assistant export's coerce() produces.
      return { fmt: "0.0%", coerce: num, align: "right" };
    case "date":
      return {
        fmt: "yyyy-mm-dd",
        coerce: (v) => serialDate(v, { timezone: context.timezone, hasTime: false }) ?? textOut(v),
      };
    case "datetime":
      return {
        fmt: "yyyy-mm-dd hh:mm",
        coerce: (v) => serialDate(v, { timezone: context.timezone, hasTime: true }) ?? textOut(v),
      };
    case "bool":
      return {
        coerce: (v) =>
          v === true || v === "true" || v === 1
            ? bools.yes
            : v === false || v === "false" || v === 0
              ? bools.no
              : null,
        align: "left",
      };
    default:
      // text / ref / anything undeclared: string + injection lock.
      return { coerce: textOut, align: "left" };
  }
}

/** Postgres NUMERIC arrives as a string — coerce for a typed number cell. */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Typed cells (number/bool/Date) pass through untouched — they cannot be
 *  formulas, and re-typing one as text is how a summable amount column quietly
 *  dies. Strings get the injection lock; objects JSON-encode so a nested cell
 *  is visible rather than silently dropped ("[object Object]"). */
function textOut(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s === "" ? null : escapeFormula(s);
}

/**
 * Effective header text. A money column carries its ISO code in the header
 * (`Original Amount · USD`) — the only place the code lives, because the cell
 * itself must stay a raw number. Skipped when the caller already suffixed it
 * or the base column was declared by moneyColumns().
 */
function headerText(column, spec) {
  const header = String(column.header ?? column.key ?? "");
  if (column.format === "money" && spec.code && !header.includes(`· ${spec.code}`)) {
    return `${header} · ${spec.code}`;
  }
  return header;
}

/** First family of a CSS stack (`"Plus Jakarta Sans", sans-serif` → the face).
 *  Excel can NAME a font, never embed one — naming the tenant's configured
 *  display face is the most this format can honestly promise (it renders
 *  where the face is installed and substitutes elsewhere), which is why the
 *  neutral default sets no name at all rather than a face we do not ship. */
function firstFamily(stack) {
  if (!stack) return null;
  // Single-alternative anchored trims, not `/^["']+|["']+$/`: the two-arm form
  // is the ambiguous shape CodeQL flags (js/polynomial-regex), and the stack is
  // tenant-configured text (font_display) with no schema length cap. The
  // split(",") already bounds the work to the first family; these two are each
  // one path, linear, and say what they do.
  const name = String(stack)
    .split(",")[0]
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .trim();
  return name || null;
}

/** Header/footer text: `&` is the control character in Excel headers, so a
 *  tenant name containing one must be doubled to render literally. */
const hfEscape = (s) => String(s ?? "").replace(/&/g, "&&");

/** Brand palette from the context, with the neutral default already applied
 *  by neutralContext — hexToArgb returns null for unparseable values, and the
 *  ?? chain then lands on the neutral fill rather than a dropped style. */
function palette(context) {
  const primary = hexToArgb(context.tenant.primary) || "FFF5821F";
  const foreground = hexToArgb(context.tenant.primaryForeground) || "FFFFFFFF";
  const accent = hexToArgb(context.tenant.accent) || primary;
  return { primary, foreground, accent, muted: "FFF3F4F6", ink: "FF111827" };
}

/** Brand header row: tenant fill + contrast font, frozen below it. `freeze`
 *  overrides the split ({ x, y }) — the import error file pins its two
 *  leading columns as well as the header. */
function styleHeaderRow(ws, colors, freeze) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: colors.foreground } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.primary } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
  ws.views = [{ state: "frozen", xSplit: (freeze && freeze.x) || 0, ySplit: freeze ? freeze.y : 1 }];
}

/** Apply a list data-validation to a column across a generous row range —
 *  users paste hundreds of rows under the sample, and a dropdown that stops
 *  at the last written row is a dropdown that does nothing. */
function applyDropdown(ws, colIndex, formulae, message, validateRows) {
  const letter = ws.getColumn(colIndex).letter;
  const last = Math.min(validateRows || 1000, 1048576);
  for (let r = 2; r <= last; r++) {
    ws.getCell(`${letter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: "warning",
      error: message,
    };
  }
}

/** Freeze/autofilter/print packaging shared by every data sheet. A4, header
 *  row repeated on every printed page, tenant + generated-at + page numbers
 *  in the header/footer, fit-to-width so a wide ledger prints instead of
 *  spilling columns across pages. Portrait under ~7 columns, landscape above. */
function packageSheet(ws, displayTitle, context, cols) {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: cols > 6 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws.pageSetup.printTitlesRow = "1:1";
  const who = context.tenant.name || "Praxis LS";
  const when = formatInstant(context.generatedAt, context.timezone);
  ws.headerFooter = {
    oddHeader: `&L${hfEscape(who)}&R${hfEscape(displayTitle)}`,
    oddFooter: `&L${hfEscape(pickLang("Généré le", "Generated", context.language))} ${when} (${context.timezone})&R${pickLang("Page", "Page", context.language)} &P / &N`,
  };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
}

/* ── Cover sheet ─────────────────────────────────────────────────────────── */

/**
 * The cover: identity first (who exported, for whom, when, under which
 * environment), because a downloaded ledger circulates for years without the
 * app that made it. Row 1 stays the title; the logo sits top-right; the
 * entity's legal identity follows; generated-at/actor/filters close it. The
 * footer line is the product's, always: Powered by Praxis LS → praxisls.com.
 */
function addCoverSheet(wb, taken, context, colors) {
  const lang = context.language;
  const ws = wb.addWorksheet(
    sheetName(pickLang("Couverture", "Cover", lang), { fallback: "Cover", taken }),
    { properties: { tabColor: { argb: colors.accent } } },
  );
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 14;

  const face = firstFamily(context.tenant.fontDisplay) || firstFamily(context.tenant.fontBody);
  const titleCell = ws.getCell("A1");
  titleCell.value = textOut(context.title) || pickLang("Exportation", "Export", lang);
  titleCell.font = { size: 20, bold: true, color: { argb: colors.ink }, ...(face ? { name: face } : {}) };
  ws.getRow(1).height = 30;

  // Logo top-right, already scaled by context.resolveLogo. ExcelJS anchors by
  // tile; a null logo simply leaves the corner to the title.
  if (context.tenant.logo) {
    try {
      const imgId = wb.addImage({
        base64: context.tenant.logo.base64,
        extension: context.tenant.logo.extension,
      });
      ws.addImage(imgId, {
        ext: { width: context.tenant.logo.width, height: context.tenant.logo.height },
        tl: { col: 3.05, row: 0.1 }, // top-right of the identity block
      });
    } catch {
      /* @silent:storage — a logo ExcelJS refuses must not fail the export;
         the tenant name below is the designed fallback. */
    }
  }

  let r = 3;
  const line = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true, color: { argb: colors.ink } };
    ws.getCell(r, 2).value = textOut(value);
    r += 1;
  };

  if (context.tenant.name) {
    ws.getCell(r, 1).value = textOut(context.tenant.name);
    ws.getCell(r, 1).font = { size: 14, bold: true, color: { argb: colors.primary } };
    r += 2;
  }
  // Entity letterhead lines — the OHADA identity a commercial document must
  // carry, derived from the entity row, never retyped.
  const e = context.entity || {};
  line(pickLang("Entité", "Entity", lang), e.legal_name);
  line("RCCM", e.rccm);
  line("NIU", e.niu);
  line(pickLang("Adresse", "Address", lang), e.address);
  r = Math.max(r + 1, 9);

  line(pickLang("Généré le", "Generated", lang), `${formatInstant(context.generatedAt, context.timezone)} (${context.timezone})`);
  if (context.actor && context.actor.name) {
    line(pickLang("Généré par", "Generated by", lang), context.actor.name);
  }
  if (context.baseCurrency) {
    line(pickLang("Devise de base", "Base currency", lang), context.baseCurrency);
  }
  if (context.filters && typeof context.filters === "object") {
    const parts = Object.entries(context.filters)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join("|") : v}`);
    if (parts.length) line(pickLang("Filtres", "Filters", lang), parts.join(", "));
  }

  // Statutory-looking Test files are a compliance bug: a sandbox export must
  // be identifiable with the file open AND from the filename (exportFilename).
  if (context.env === "sandbox") {
    r += 1;
    const stamp = ws.getCell(r, 1);
    stamp.value = "TEST SANDBOX";
    stamp.font = { bold: true, size: 16, color: { argb: SANDBOX_STAMP } };
    ws.getRow(r).height = 24;
  }

  r += 2;
  const powered = ws.getCell(r, 1);
  powered.value = { text: "Powered by Praxis LS", hyperlink: POWERED_BY_URL };
  powered.font = { color: { argb: colors.accent }, underline: true };
  return ws;
}

/* ── Reference sheet ─────────────────────────────────────────────────────── */

/**
 * The read-only guidance sheet: the tenant's REAL valid values, laid out as
 * parallel labelled blocks a human scans ("which account code goes in Sale ·
 * credit?"), not one 900-row table. Protected (locked, no password circus —
 * unprotecting is one click, which is the right trade for a guidance sheet)
 * but VISIBLE, because the whole point is that users copy from it.
 *
 * Block shapes: `{ title, values }` with values either strings (one column)
 * or `[code, label]` pairs (two columns, header on the first).
 */
function addReferenceSheet(wb, context, colors, blocks, lang) {
  const ws = wb.addWorksheet(REFERENCE_SHEET, {
    views: [{ state: "frozen", ySplit: 2 }],
    properties: { tabColor: { argb: colors.accent } },
  });
  ws.state = "visible";
  ws.getCell("A1").value = pickLang(
    "Référence — les valeurs acceptées par ce tenant. Copiez-les dans la feuille de données.",
    "Reference — the values this tenant accepts. Copy them into the data sheet.",
    lang,
  );
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: colors.primary } };

  const refLetters = {};
  let col = 1;
  for (const block of blocks) {
    const paired = block.values.length && Array.isArray(block.values[0]);
    const span = paired ? 2 : 1;
    ws.getColumn(col).width = 26;
    if (paired) ws.getColumn(col + 1).width = 30;
    for (let c = 0; c < span; c++) {
      const head = ws.getCell(2, col + c);
      head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.primary } };
      head.font = { bold: true, color: { argb: colors.foreground } };
    }
    ws.getCell(2, col).value = block.title;
    block.values.forEach((entry, i) => {
      const [code, label] = paired ? entry : [entry, null];
      ws.getCell(3 + i, col).value = textOut(code);
      if (paired && label !== null && label !== undefined) ws.getCell(3 + i, col + 1).value = textOut(label);
    });
    // Dropdown formulae point at the VALUES column, which starts at row 3.
    const letter = ws.getColumn(col).letter;
    refLetters[block.title] = { letter, count: block.values.length };
    col += span;
  }
  ws.protect(undefined, { selectLockedCells: true, selectUnlockedCells: true });
  return refLetters;
}

/* ── Builder ─────────────────────────────────────────────────────────────── */

/**
 * Build an .xlsx buffer.
 *
 * @param {Object} opts
 * @param {{name:string, title?:string, columns:ColumnSpec[], rows?:Object[],
 *          sample?:Object, validateRows?:number,
 *          freeze?:{x?:number, y?:number}}}[] opts.sheets
 * @param {{title:string, values:(string[]|[string,string][])[]}[]} [opts.reference]
 * @param {Object} [opts.context]  WorkbookContext from resolveContext(); a
 *        missing context renders the neutral Praxis default (unit tests only).
 * @param {boolean} [opts.cover]   Emit a Cover sheet first. Reports and the AI
 *        workspace export use it; import TEMPLATES must not — their row 1 is
 *        the header contract the parser keys on.
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook({ sheets, reference = [], context, cover = false } = {}) {
  const ctx = context || neutralContext();
  const colors = palette(ctx);
  const lang = ctx.language;
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.tenant.name || "Praxis LS";
  wb.lastModifiedBy = ctx.tenant.name || "Praxis LS";
  wb.company = ctx.tenant.name || "Praxis LS";
  const createdAt = ctx.generatedAt instanceof Date ? ctx.generatedAt : new Date(ctx.generatedAt);
  wb.created = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  // Uniqueness across the whole workbook, cover + reference included. The
  // Reference name is reserved whenever the sheet will exist — a data sheet
  // stealing it would be silently skipped by parseUpload (which treats
  // "Reference" as non-data) and would collide at addWorksheet anyway.
  const taken = new Set();
  if (reference.length) taken.add(REFERENCE_SHEET.toLowerCase());
  if (cover) addCoverSheet(wb, taken, ctx, colors);

  // Data sheets FIRST, reference last: parseUpload reads the first sheet, so
  // a template whose Reference sheet led would parse guidance as data rows.
  // (Dropdown formulae reference the sheet by name — order is irrelevant.)
  const created = [];
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.name, { taken }));
    created.push(ws);
    const specs = sheet.columns.map((c) => cellSpec(c, ctx));

    ws.columns = sheet.columns.map((c, i) => ({
      header: headerText(c, specs[i]),
      key: c.key,
      width: c.width ?? 20,
      style: specs[i].fmt ? { numFmt: specs[i].fmt } : undefined,
    }));
    styleHeaderRow(ws, colors, sheet.freeze);

    const writeRow = (values, { muted = false } = {}) => {
      const out = {};
      sheet.columns.forEach((c, i) => {
        out[c.key] = specs[i].coerce(values[c.key]);
      });
      const row = ws.addRow(out);
      sheet.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (specs[i].align) cell.alignment = { horizontal: specs[i].align };
        if (c.wrap) cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: "top" };
        if (c.emphasis) cell.font = { color: { argb: colors.primary } };
        if (muted) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.muted } };
        }
      });
      return row;
    };

    for (const row of sheet.rows ?? []) writeRow(row);
    // One worked example in the muted fill — reads as a sample, deletes as a
    // one-row delete. Guessing the shape of 27 columns is not a workflow.
    if (sheet.sample) writeRow(sheet.sample, { muted: true });

    // Header comments + dropdowns.
    sheet.columns.forEach((c, idx) => {
      const colIndex = idx + 1;
      if (c.note) ws.getCell(`${ws.getColumn(colIndex).letter}1`).note = c.note;
      if (c.list && c.list.length) {
        applyDropdown(ws, colIndex, [`"${c.list.join(",")}"`],
          pickLang("Choisissez une valeur de la liste.", "Pick a value from the list.", lang),
          sheet.validateRows);
      }
    });

    // Totals row: live SUM formulas, never pre-baked numbers — a total that
    // is a constant keeps looking right after the user edits a row above it.
    const totalIdx = sheet.columns.map((c, i) => (c.total ? i : -1)).filter((i) => i >= 0);
    const dataRows = (sheet.rows ?? []).length + (sheet.sample ? 1 : 0);
    if (totalIdx.length && dataRows > 0) {
      const row = ws.addRow({});
      row.getCell(1).value = pickLang("Total", "Total", lang);
      row.font = { bold: true };
      for (const i of totalIdx) {
        const letter = ws.getColumn(i + 1).letter;
        const cell = row.getCell(i + 1);
        cell.value = { formula: `SUM(${letter}2:${letter}${dataRows + 1})` };
        if (specs[i].fmt) cell.numFmt = specs[i].fmt;
        cell.border = { top: { style: "thin", color: { argb: colors.primary } } };
      }
    }

    packageSheet(ws, sheet.title || sheet.name, ctx, sheet.columns.length);
  }

  // refColumn dropdowns last: they need the Reference sheet's letters. Kept
  // separate from the inline-list pass so a column can never get both.
  if (reference.length) {
    const refLetters = addReferenceSheet(wb, ctx, colors, reference, lang);
    sheets.forEach((sheet, s) => {
      const ws = created[s];
      sheet.columns.forEach((c, idx) => {
        if (!c.refColumn || !refLetters[c.refColumn]) return;
        const { letter, count } = refLetters[c.refColumn];
        const last = Math.max(count + 2, 3); // values start at row 3
        applyDropdown(ws, idx + 1, [`${REFERENCE_SHEET}!$${letter}$3:$${letter}$${last}`],
          pickLang("Choisissez une valeur de la feuille Reference.", "Pick a value from the Reference sheet.", lang),
          sheet.validateRows);
      });
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* Exported for csv.js, which must emit the SAME header text and cell
   semantics (money ISO in header, localized bools, tz dates, injection lock)
   — a csv/xlsx pair that disagrees on headers is two different exports. */
module.exports = {
  buildWorkbook,
  cellSpec,
  headerText,
  num,
  textOut,
  REFERENCE_SHEET,
};
