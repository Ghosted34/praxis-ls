/**
 * Wet-signature DataMatrix utilities (SIGNATURE_ENGINEERING_GUIDE §8.3–§8.4).
 *
 * The print code is NOT the verification token. It is an internal reconciliation
 * key printed on paper that has usually been photocopied before it returns. That
 * is why it is short, clear-text and DataMatrix ECC 200 rather than another QR:
 * the symbol has one job — survive a bad scan and let the server find a print
 * job. It grants no public read and writes no signature by itself.
 */
"use strict";

const crypto = require("crypto");
const bwipjs = require("bwip-js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { prepareZXingModule, readBarcodesFromImageData } = require("zxing-wasm/reader");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford without I, L, O, U.
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{18}$/;

/** Rejection-sampled Crockford Base32 — no modulo bias. */
function mintCode() {
  let out = "";
  while (out.length < 18) {
    const b = crypto.randomBytes(1)[0];
    if (b >= 224) continue; // 224 is the largest multiple of 32 below 256.
    out += ALPHABET[b % 32];
  }
  return out;
}

function normaliseCode(value) {
  const s = String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!CODE_RE.test(s)) return null;
  return s;
}

function formatCode(value) {
  const s = normaliseCode(value) || String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.replace(/(.{6})(?=.)/g, "$1-");
}

/**
 * Inline SVG for a 12 mm DataMatrix. Width is fixed by CSS in kit.printBarcode;
 * bwip's scale only affects the viewBox density. SVG keeps the modules crisp in
 * Puppeteer, unlike a PNG data URI resampled into a PDF.
 */
async function generateSvg(code) {
  const clean = normaliseCode(code);
  if (!clean) throw new Error("BAD_PRINT_CODE");
  return bwipjs.toSVG({
    bcid: "datamatrix",
    text: clean,
    scale: 4,
    paddingwidth: 0,
    paddingheight: 0,
    includetext: false,
  });
}

async function imageBuffer(buffer, { density = 300, cropBottomLeft = false } = {}) {
  let img = sharp(buffer, { density, limitInputPixels: 16000 * 16000 }).rotate().greyscale().normalise();
  if (cropBottomLeft) {
    const meta = await img.metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width > 1 && height > 1) {
      img = img.extract({ left: 0, top: Math.floor(height / 2), width: Math.floor(width / 2), height: Math.ceil(height / 2) });
    }
  }
  return img.png().toBuffer();
}

let prepared = null;
function prepareReader() {
  if (!prepared) {
    const wasm = fs.readFileSync(path.join(__dirname, "../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm"));
    prepared = prepareZXingModule({ overrides: { wasmBinary: wasm } });
  }
  return prepared;
}

async function decodePng(png) {
  await prepareReader();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hits = await readBarcodesFromImageData({
    data: new Uint8ClampedArray(data), width: info.width, height: info.height,
  }, {
    formats: ["DataMatrix"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 4,
  });
  for (const hit of hits || []) {
    const code = normaliseCode(hit.text || hit.bytes || "");
    if (code) return code;
  }
  return null;
}

/**
 * Decode a returned scan. First pass takes the image as received (or PDF page 1
 * if libvips can rasterise it). Second pass follows the hard placement spec and
 * retries the bottom-left quadrant at 600 dpi. The caller distinguishes
 * NO_BARCODE from UNREADABLE by passing `located: true` from a future detector;
 * until that spike lands, no hit means no decodable DataMatrix was found.
 */
async function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { status: "FAILED", code: null };
  try {
    const first = await decodePng(await imageBuffer(buffer, { density: 300 }));
    if (first) return { status: "DECODED", code: first };

    const second = await decodePng(await imageBuffer(buffer, { density: 600, cropBottomLeft: true }));
    if (second) return { status: "DECODED", code: second };
    return { status: "NO_BARCODE", code: null };
  } catch (err) {
    return { status: "UNREADABLE", code: null, error: err && err.message };
  }
}

module.exports = { mintCode, normaliseCode, formatCode, generateSvg, decode, CODE_RE };
