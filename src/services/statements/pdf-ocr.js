/**
 * Scanned-statement OCR — reading a statement nobody exported.
 *
 * WHEN THIS RUNS. `pdf-table.js` pulls the text layer out of a PDF a bank's
 * system generated. A SCAN has no text layer: it is a photograph of paper
 * wrapped in a PDF container, and pdf-table correctly reports `scanned: true`
 * and zero rows. This module is what happens next.
 *
 * ── HOW THE PAGE IMAGES ARE OBTAINED, and why there is no rasteriser ────────
 *
 * The obvious approach is to render each PDF page to a bitmap (pdftoppm,
 * Ghostscript, a headless renderer) and OCR the bitmap. That needs a native
 * binary this container does not have and the deployment would have to grow.
 *
 * It is also unnecessary for the case that actually occurs. A scan is not a
 * page that happens to contain an image — the page IS one image, placed
 * full-bleed, and in a PDF that image is stored as its own stream. For the
 * overwhelmingly common encodings that stream is ALREADY a file we can hand to
 * a vision model:
 *
 *   /DCTDecode  the stream bytes are a JPEG, verbatim. Phone photos, every
 *               modern flatbed scanner, every "Print to PDF" of a photo.
 *   /JPXDecode  the stream bytes are a JPEG 2000, verbatim.
 *
 * So we do not rasterise. We lift the image out of the container and send it
 * on. No new dependency, no native binary, and the bytes the model sees are
 * the bytes the scanner produced rather than our re-rendering of them.
 *
 * ── WHAT WE CANNOT READ, AND SAY SO ────────────────────────────────────────
 *
 * /CCITTFaxDecode and /JBIG2Decode are bitonal fax encodings — genuinely
 * compressed formats that must be decoded before anything can look at them.
 * Rather than fail obscurely, those are detected and reported by name, with the
 * advice that actually resolves it (ask for a CSV, or re-scan in colour/grey).
 *
 * ── THE MODEL READS; IT DOES NOT DECIDE ────────────────────────────────────
 *
 * This is the third and last place a model touches reconciliation, and it sits
 * where the other two sit: UPSTREAM of every money decision.
 *
 *   column mapping   proposes what a column means      → a human confirms
 *   counterparty hint suggests who a line refers to     → a hint on a screen
 *   OCR (here)       proposes what the paper says       → a human confirms
 *
 * Matching stays the deterministic ladder in reconciliation.rules.js. And an
 * OCR'd statement is checked by exactly the same arithmetic as every other one:
 * if the read is wrong, the declared balances stop agreeing with the sum of the
 * lines and §6 refuses to let it reach VALIDATED. That gate is why an
 * imperfect reader is safe to offer at all — and why `bank_statement.ocr_used`
 * records that a machine did the reading.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

/** Bitonal encodings we cannot decode without a native library. */
const UNDECODABLE = {
  CCITTFaxDecode: "CCITT Group 3/4 fax",
  JBIG2Decode: "JBIG2",
};

const MAX_PAGES = 12;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Lift embedded raster images out of a PDF.
 *
 * Walks the object stream the same way pdf-table.js does — `stream` … 
 * `endstream` with the preceding dictionary — and keeps the ones whose filter
 * says the bytes are already a picture file.
 *
 * Returns `{ images, undecodable }` so the caller can distinguish "there was
 * nothing to read" from "there was something and we cannot open it", which are
 * different messages to a treasurer.
 */
function extractImages(buffer) {
  const images = [];
  const undecodable = new Set();
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  let cursor = 0;

  while (cursor < buffer.length && images.length < MAX_PAGES) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    const dictStart = buffer.lastIndexOf(Buffer.from("<<"), start);
    const dict = dictStart === -1 ? "" : buffer.slice(dictStart, start).toString("latin1");

    // Only image XObjects. A content stream also lives between stream/endstream.
    if (/\/Subtype\s*\/Image/.test(dict)) {
      for (const [filter, label] of Object.entries(UNDECODABLE)) {
        if (new RegExp(`/${filter}`).test(dict)) undecodable.add(label);
      }

      let dataStart = start + marker.length;
      if (buffer[dataStart] === 0x0d) dataStart += 1;
      if (buffer[dataStart] === 0x0a) dataStart += 1;
      const data = buffer.slice(dataStart, end);

      if (/\/DCTDecode/.test(dict) && data.length <= MAX_IMAGE_BYTES) {
        images.push({ data, mimeType: "image/jpeg" });
      } else if (/\/JPXDecode/.test(dict) && data.length <= MAX_IMAGE_BYTES) {
        images.push({ data, mimeType: "image/jp2" });
      }
    }
    cursor = end + endMarker.length;
  }

  return { images, undecodable: [...undecodable] };
}

/**
 * What the model is asked for.
 *
 * Deliberately narrow: read the table, do not interpret it. No "categorise this
 * transaction", no "identify the counterparty from context" — those are
 * judgements, and a judgement made by a model on a photograph is not something
 * an accountant can defend. It transcribes, in the source's own words and the
 * source's own figures, and hands back the balances so the arithmetic can be
 * checked against them.
 */
const OCR_PROMPT = `You are transcribing a scanned bank or mobile-money statement. Read it exactly; do not interpret, categorise, summarise or correct it.

Return ONLY a JSON object, no prose and no code fence:
{"opening_balance":<number|null>,"closing_balance":<number|null>,"currency":"<3-letter code or null>","period_start":"<YYYY-MM-DD|null>","period_end":"<YYYY-MM-DD|null>","rows":[{"booking_date":"YYYY-MM-DD","description":"<text exactly as printed>","amount":<number>,"fee":<number>,"running_balance":<number|null>,"external_ref":"<reference as printed, or null>"}]}

Rules you must follow:
- "amount" is SIGNED: positive for money INTO the account (a credit, deposit, receipt), negative for money OUT (a debit, withdrawal, charge).
- Convert every date to YYYY-MM-DD. If the statement's date order is ambiguous, prefer day-first (DD/MM) — this is a Central African statement.
- Figures are commonly written in French locale (1 234 567,89). Return them as plain JSON numbers: 1234567.89.
- Copy "description" verbatim. Do not translate, expand abbreviations, or tidy it.
- Set "fee" to 0 unless the statement shows a separate fee for that transaction.
- Use null where the statement does not show a value. Never invent one.
- Transcribe EVERY transaction row you can see, in the order printed. Do not include totals, sub-totals, or the balance-brought-forward line as rows.`;

/** Coerce a model number that may have arrived as "1 234,56". */
function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d.,-]/g, "").replace(/\s/g, "");
  // Trust the model's instruction to emit plain numbers; this only rescues the
  // occasional locale-formatted string rather than re-implementing §3.
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const isoDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? m[0].slice(0, 10) : null;
};

/**
 * Read a scanned statement.
 *
 * Returns the same `{ headers, rows, meta }` contract every other adapter in
 * this directory returns, with `meta.canonical = true` — the rows already speak
 * the §1 vocabulary, so no column mapping is needed. `meta.ocr` carries the
 * provenance that lands on `bank_statement.ocr_used`.
 */
async function parse(buffer, { client = null, vision = null } = {}) {
  const { images, undecodable } = extractImages(buffer);

  if (!images.length) {
    if (undecodable.length) {
      throw new AppError(
        "SCAN_ENCODING_UNSUPPORTED",
        `This scan is stored as ${undecodable.join(" / ")}, a bitonal fax format this reader cannot open. Re-scan it in greyscale or colour, or ask the institution for a CSV or Excel export.`,
        422,
        { encodings: undecodable },
      );
    }
    throw new AppError(
      "SCANNED_PDF",
      "This PDF has no text layer and no readable page image. Ask the institution for a CSV, Excel or text-based PDF export.",
      422,
    );
  }

  const visionService = vision || require("../ai/vision.service");

  // Pages are read INDEPENDENTLY and concatenated rather than stitched into one
  // request: a statement's pages are the same table continued, one image per
  // request keeps each read small enough to stay accurate, and a page that
  // fails to read does not take the other eleven with it.
  const rows = [];
  const pageMeta = [];
  let opening = null;
  let closing = null;
  let currency = null;
  let periodStart = null;
  let periodEnd = null;
  let provider = null;
  let readPages = 0;

  for (const [index, image] of images.entries()) {
    let fields;
    try {
      const answer = await visionService.extract({
        image: image.data,
        mimeType: image.mimeType,
        prompt: OCR_PROMPT,
      });
      fields = answer && answer.fields;
      provider = (answer && answer.provider) || provider;
    } catch (err) {
      logger.warn({ err, page: index + 1 }, "statement OCR failed on a page");
      pageMeta.push({ page: index + 1, read: false, reason: "the reader could not process this page" });
      continue;
    }

    if (!fields || !Array.isArray(fields.rows)) {
      pageMeta.push({ page: index + 1, read: false, reason: "no transaction rows were found on this page" });
      continue;
    }

    readPages += 1;
    // Balances and the period are taken from the FIRST page that states them —
    // a continuation page repeats a carried-forward figure, and letting a later
    // page overwrite the opening balance is how a statement stops footing.
    if (opening === null) opening = toNumber(fields.opening_balance);
    if (closing !== null || toNumber(fields.closing_balance) !== null) {
      closing = toNumber(fields.closing_balance) ?? closing;
    }
    currency = currency || (fields.currency ? String(fields.currency).toUpperCase().slice(0, 3) : null);
    periodStart = periodStart || isoDate(fields.period_start);
    periodEnd = isoDate(fields.period_end) || periodEnd;

    for (const r of fields.rows) {
      const amount = toNumber(r && r.amount);
      const bookingDate = isoDate(r && r.booking_date);
      if (amount === null || !bookingDate) continue;         // unusable; the count difference shows up in the preview
      rows.push({
        __row: rows.length + 1,
        booking_date: bookingDate,
        value_date: null,
        amount,
        currency,
        description: r.description ? String(r.description).replace(/\s+/g, " ").trim() : null,
        counterparty: null,
        external_ref: r.external_ref ? String(r.external_ref).trim() : null,
        cheque_no: null,
        running_balance: toNumber(r.running_balance),
        fee: Math.abs(toNumber(r.fee) || 0),
        raw: { ocr_page: index + 1, ...r },
      });
    }
    pageMeta.push({ page: index + 1, read: true, rows: fields.rows.length });
  }

  if (!rows.length) {
    throw new AppError(
      "SCAN_UNREADABLE",
      `The scan was opened (${images.length} page image(s)) but no transaction rows could be read from it. A sharper scan, or a CSV/Excel export from the institution, will work better.`,
      422,
      { pages: pageMeta },
    );
  }

  return {
    headers: Object.keys(rows[0]).filter((k) => k !== "__row" && k !== "raw"),
    rows,
    meta: {
      format: "PDF",
      canonical: true,
      opening_balance: opening,
      closing_balance: closing,
      currency,
      period_start: periodStart,
      period_end: periodEnd,
      ocr: {
        used: true,
        provider: provider || "vision",
        pages: images.length,
        pages_read: readPages,
        page_detail: pageMeta,
      },
      // Surfaced by the preview screen. An OCR'd statement is never imported on
      // the strength of the read alone.
      advisory: "These figures were read off a scan by OCR, not exported by the institution. Check the preview against the paper, and rely on the totals check before importing.",
    },
  };
}

module.exports = { parse, extractImages, toNumber, OCR_PROMPT, UNDECODABLE, MAX_PAGES };
