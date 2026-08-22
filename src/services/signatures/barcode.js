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
const fs = require("fs/promises");
const path = require("path");
const bwipjs = require("bwip-js");
const sharp = require("sharp");
const { createCanvas, DOMMatrix, Path2D, ImageData } = require("@napi-rs/canvas");
global.DOMMatrix = global.DOMMatrix || DOMMatrix;
global.Path2D = global.Path2D || Path2D;
global.ImageData = global.ImageData || ImageData;
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { prepareZXingModule, readBarcodesFromImageData } = require("zxing-wasm/reader");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford without I, L, O, U.
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{18}$/;
const PDF_MAGIC = Buffer.from("%PDF");

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
  const raw = value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value || "");
  const s = raw.toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
  if (!CODE_RE.test(s)) return null;
  return s;
}

function formatCode(value) {
  const s = normaliseCode(value) || String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.replace(/(.{6})(?=.)/g, "$1-");
}

/**
 * Inline SVG for a 12 mm DataMatrix. The module ink is #999 (40% grey), not an
 * opacity group — §8.3 specifies ink, and transparent PDF groups are not ink.
 */
async function generateSvg(code) {
  const clean = normaliseCode(code);
  if (!clean) throw new Error("BAD_PRINT_CODE");
  const svg = bwipjs.toSVG({
    bcid: "datamatrix",
    text: clean,
    scale: 4,
    paddingwidth: 0,
    paddingheight: 0,
    includetext: false,
  });
  return svg.replace(/#000000/g, "#999999").replace(/#000/g, "#999999");
}

function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 4).equals(PDF_MAGIC);
}

async function rasterisePdf(buffer, { density = 300 } = {}) {
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
    const page = await doc.getPage(1);
    const scale = density / 72;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    await doc.destroy();
    return canvas.toBuffer("image/png");
  } catch (err) {
    const e = new Error("PDF_RASTERIZE_FAILED: " + (err && err.message ? err.message : "could not open PDF"));
    e.code = "PDF_RASTERIZE_FAILED";
    throw e;
  }
}

async function rasterInput(buffer, { density = 300 } = {}) {
  if (isPdf(buffer)) return rasterisePdf(buffer, { density });
  return buffer;
}

async function imageBuffer(buffer, { density = 300, cropBottomLeft = false } = {}) {
  const raster = await rasterInput(buffer, { density });
  let img = sharp(raster, { density, limitInputPixels: 16000 * 16000 }).rotate().greyscale().normalise();
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
async function prepareReader() {
  if (!prepared) {
    prepared = (async () => {
      const wasmPath = path.join(path.dirname(require.resolve("zxing-wasm/reader")), "..", "..", "reader", "zxing_reader.wasm");
      const wasm = await fs.readFile(wasmPath);
      return prepareZXingModule({ overrides: { wasmBinary: wasm } });
    })();
    prepared.catch(() => { prepared = null; });
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
 * Decode a returned scan. First pass takes the image as received, rasterising
 * PDF page 1 first when needed. Second pass follows the hard placement spec and
 * retries the bottom-left quadrant at 600 dpi.
 */
async function decode(input) {
  const buffer = Buffer.isBuffer(input) ? input : (input instanceof Uint8Array ? Buffer.from(input) : null);
  if (!buffer || !buffer.length) return { status: "FAILED", code: null, reason: "EMPTY_INPUT" };
  try {
    const first = await decodePng(await imageBuffer(buffer, { density: 300 }));
    if (first) return { status: "DECODED", code: first };

    const second = await decodePng(await imageBuffer(buffer, { density: 600, cropBottomLeft: true }));
    if (second) return { status: "DECODED", code: second };
    return { status: "NO_BARCODE", code: null };
  } catch (err) {
    return {
      status: "UNREADABLE",
      code: null,
      reason: err && err.code === "PDF_RASTERIZE_FAILED" ? "PDF_RASTERIZE_FAILED" : "IMAGE_OPEN_FAILED",
      error: err && err.message,
    };
  }
}

module.exports = { mintCode, normaliseCode, formatCode, generateSvg, decode, CODE_RE };
