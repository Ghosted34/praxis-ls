/**
 * Statement source adapters - one entry point, one output contract.
 *
 * Every parser in this directory returns the same shape:
 *
 *   { headers: string[], rows: object[], meta: {...} }
 *
 * and everything downstream - mapping proposal, preview, normalisation,
 * matching - is written against that shape alone. Adding a format (BAI2,
 * CFONB 120, a MoMo API pull) means adding a parser and a line in DETECTORS;
 * no other file changes.
 *
 * TWO CLASSES OF SOURCE, and the difference drives the whole UX:
 *
 *   SELF-DESCRIBING  camt.053, MT940. The format states which field is the
 *                    date, which is the amount, and which way the sign runs.
 *                    `meta.canonical` is true, rows already use the §1 field
 *                    names, and no mapping profile is needed at all - the
 *                    treasurer uploads and it just works.
 *
 *   TABULAR          CSV, XLSX, PDF. Columns are whatever the institution
 *                    called them. These need a `statement_profile`: proposed
 *                    once, confirmed by a human, then reused by header
 *                    signature forever.
 *
 *   SCANNED          A PDF with no text layer — a photograph of paper. Falls
 *                    through to pdf-ocr.js, which reads the page images and
 *                    returns canonical rows like the self-describing formats
 *                    do. No mapping is needed, but `ocr_used` is recorded on
 *                    the statement: an OCR'd figure is our reading of a
 *                    picture, not something the institution asserted, and an
 *                    auditor is entitled to know which they are looking at.
 */
"use strict";

const csv = require("./csv");
const xlsx = require("./xlsx");
const camt053 = require("./camt053");
const mt940 = require("./mt940");
const pdfTable = require("./pdf-table");
const pdfOcr = require("./pdf-ocr");
const { AppError } = require("../../utils/errors");

/** Source kinds whose rows arrive already speaking the canonical vocabulary. */
const CANONICAL_KINDS = new Set(["CAMT053", "MT940"]);

/**
 * Identify the format from the bytes, not from the filename.
 *
 * A file called `statement.csv` that is actually an XLSX (which happens every
 * time someone renames an export) must be read as what it is. Magic bytes
 * first, structural markers second, extension only as a tie-break between the
 * two text formats that have no magic number.
 */
function detect(buffer, filename = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError("BAD_FILE", "The uploaded statement is empty", 400);
  }

  // XLSX is a ZIP container.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    return "XLSX";
  }
  if (buffer.slice(0, 5).toString("latin1") === "%PDF-") return "PDF";

  // The legacy .xls compound-file format. Detected so the error can say what is
  // wrong ("re-save as .xlsx") rather than failing as unreadable text.
  if (buffer.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new AppError(
      "BAD_FILE",
      "This is a legacy .xls workbook. Open it and re-save as .xlsx, or export the statement as CSV.",
      400,
    );
  }

  const head = buffer.slice(0, 4096).toString("latin1");
  if (/<\?xml|<Document[\s>]|BkToCstmrStmt|camt\.053/i.test(head)) return "CAMT053";
  // MT940's opening tags. `:20:` is mandatory and `:25:`/`:60F:` nearly always
  // follow, so requiring two of them avoids claiming any colon-heavy text file.
  if (/^\s*(\{1:|:20:)/.test(head) && /:(25|28C|60[FM]|61):/.test(head)) return "MT940";

  const ext = String(filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xlsm") return "XLSX";
  if (ext === "xml") return "CAMT053";
  if (ext === "sta" || ext === "mt940" || ext === "940") return "MT940";
  return "CSV";
}

/**
 * Parse a statement buffer. `opts` carries a confirmed profile's settings
 * (delimiter, sheet, header row) when one exists, so a second import of the
 * same bank reproduces the first import's parse exactly rather than re-sniffing.
 */
async function parse(buffer, { filename = "", sourceKind = null, client = null, allowOcr = true, ...opts } = {}) {
  const kind = sourceKind || detect(buffer, filename);
  let result;

  switch (kind) {
    case "XLSX": result = await xlsx.parse(buffer, opts); break;
    case "CSV": result = csv.parse(buffer, opts); break;
    case "PDF": result = pdfTable.parse(buffer, opts); break;
    case "CAMT053": result = camt053.parse(buffer); break;
    case "MT940": result = mt940.parse(buffer); break;
    default:
      throw new AppError("BAD_FILE", `Unsupported statement format "${kind}"`, 400);
  }

  // A PDF with no text layer is a photograph of paper. Rather than refuse it,
  // fall through to OCR — which lifts the page images out of the container and
  // reads them (see pdf-ocr.js). The result rejoins this pipeline as ordinary
  // canonical rows, so the preview, the footing check and the human
  // confirmation gate it exactly as they gate every other source.
  //
  // `allowOcr: false` is honoured so a caller can ask "is this readable
  // without a model?" without spending a vision call to find out.
  if (kind === "PDF" && result.meta && result.meta.scanned) {
    if (!allowOcr) {
      throw new AppError(
        "SCANNED_PDF",
        "This PDF has no text layer - it looks like a scan or a photograph.",
        422,
      );
    }
    const ocr = await pdfOcr.parse(buffer, { client });
    return { ...ocr, source_kind: "PDF", canonical: true };
  }
  if (!result.rows.length) {
    throw new AppError("EMPTY_STATEMENT", "No transaction rows could be read from this file", 422);
  }

  return { ...result, source_kind: kind, canonical: CANONICAL_KINDS.has(kind) };
}

module.exports = { parse, detect, CANONICAL_KINDS, csv, xlsx, camt053, mt940, pdfTable, pdfOcr };
