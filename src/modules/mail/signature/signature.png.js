/**
 * Signature PNG — screenshots the SAME HTML `signature.html.js` produces.
 *
 * Puppeteer is already a dependency (pdf.service.js). The renderer is injected
 * so unit tests never launch Chromium. Dimensions match the standalone tool:
 * 650 × 325 CSS px at 1×, 1300 × 650 at 2×, 1950 × 975 at 3×.
 */
"use strict";

const html = require("./signature.html");
const card = require("./signature.card");
const signatureFonts = require("./signature.fonts");

const BASE_W = 650;
const BASE_H = 325;

function dimensions(model, scale) {
  const s = [1, 2, 3].includes(Number(scale)) ? Number(scale) : 1;
  const w = Number(model && model.width_px) || BASE_W;
  const h = Number(model && model.height_px) || BASE_H;
  return { width: w * s, height: h * s, cssWidth: w, cssHeight: h, scale: s };
}

function wrap(fragment, model, scale) {
  const d = dimensions(model, scale);
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ffffff;width:${d.cssWidth}px;height:${d.cssHeight}px">
${fragment}
</body></html>`;
}

/** A `card` model screenshots the CARD document; anything else screenshots the
 *  email-safe fragment, exactly as before. */
function isCard(model) {
  return Boolean(model) && model.kind === "card";
}

/**
 * The document to screenshot, and the text that must match it.
 *
 * Both renderers are fed the SAME resolved model, which is what keeps the
 * PNG and the email body from drifting: `textContent` is computed from the
 * model, not scraped from either rendering.
 */
function page(model, scale) {
  if (isCard(model)) {
    return card.document(
      model,
      model.palette || {},
      model.fonts || {},
      signatureFonts.fontFaceCss(),
    );
  }
  return wrap(html.render(model), model, scale);
}

/**
 * @param {object} model
 * @param {1|2|3} scale
 * @param {function} [shot]  async (html, {width,height,scale}) => Buffer
 */
async function render(model, scale = 1, shot = defaultShot, { optimise = true } = {}) {
  const fragment = isCard(model) ? card.body(model, model.palette || {}) : html.render(model);
  const d = dimensions(model, scale);
  const doc = page(model, scale);
  const raw = await shot(doc, d);
  const buffer = optimise ? await compress(raw) : raw;
  return { buffer, ...d, html: fragment, text: html.textContent(model) };
}

/**
 * Palette-quantise the screenshot.
 *
 * The standalone generator offered the user a choice of 256/128-colour palettes
 * and a raw 32-bit mode, and reported the saving in a stats panel. That is a
 * decision nobody choosing a signature should have to make, so it is made here.
 *
 * Measured on the card at 2× (1300 × 650): lossless 153 kB, 256-colour palette
 * 71 kB. The palette differs from lossless on 861 of 845 000 pixels (0.1%), all
 * of them faint edges in the background gradient. 128 colours would save a
 * further 6 kB and visibly band 5% of the image, which is why the generator's
 * "maximum compression" option is not offered here — it trades something people
 * notice for something they do not.
 *
 * `sharp` rather than the UPNG the browser tool used: it is already a
 * dependency, it quantises better, and it does the work off the main thread.
 * Never throws — an unoptimised PNG is a correct PNG.
 */
async function compress(buffer) {
  try {
    const sharp = require("sharp");
    return await sharp(buffer).png({ palette: true, colours: 256, effort: 7 }).toBuffer();
  } catch {
    /* @silent:render the uncompressed screenshot is still the right image */
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }
}

/**
 * P2-1. One Chromium, many screenshots.
 *
 * `defaultShot` used to `launch` → `screenshot` → `close` on every call. PNG
 * download is user-initiated so that was acceptable at one-at-a-time, but a
 * manager regenerating a team's signatures pays a multi-second launch per
 * person and the machine runs unbounded Chrome processes. A reused browser
 * is the robust form; a disconnected one is dropped so the next call launches
 * a fresh instance rather than writing into a dead handle.
 *
 * Tests never reach this: they inject `shot`.
 */
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = require("puppeteer");
    // `resolveChromiumPath()`, NOT `config.PUPPETEER_EXECUTABLE_PATH || undefined`.
    //
    // That expression is what broke every signature card in production. The env
    // schema defaults the key to `""`, so on any deployment that does not set it
    // the value is `undefined`; Puppeteer then looks for the Chromium it
    // downloads at install time, and the Dockerfile sets
    // PUPPETEER_SKIP_DOWNLOAD=true because the image installs Alpine's package
    // instead. Launch threw on every send, the catch in signature.service
    // swallowed it, and recipients got the text fallback with no card — while
    // PDFs rendered perfectly, because pdf.service had always probed for the
    // binary. The browser was at /usr/bin/chromium the whole time.
    const { resolveChromiumPath } = require("../../../services/chromium");
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: resolveChromiumPath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }).then((browser) => {
      browser.on("disconnected", () => { browserPromise = null; });
      return browser;
    }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

async function defaultShot(pageHtml, d) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: d.cssWidth,
      height: d.cssHeight,
      deviceScaleFactor: d.scale,
    });
    await page.setContent(pageHtml, { waitUntil: "networkidle0" });
    // Buffer.from, for the reason pdf.service.js records at length
    // (BAD_STORAGE_BUFFER, live 22 Aug 2026): Puppeteer 23 resolves a
    // Uint8Array where it used to resolve a Buffer, `storage.put` requires a
    // real Buffer, and `Buffer.isBuffer(uint8Array)` is false — so the bytes
    // reach the storage boundary and are rejected there with a 400. It has not
    // bitten the card yet only because `compress()` runs sharp in between and
    // sharp hands back a Buffer; the day sharp throws, its own catch returns
    // the raw screenshot and this becomes the same outage one file over.
    //
    // Not `Buffer.from(u8.buffer)`: a typed array can be a VIEW into a larger
    // ArrayBuffer, and `.buffer` would take the whole backing store.
    return Buffer.from(await page.screenshot({ type: "png", omitBackground: false }));
  } finally {
    await page.close().catch(() => { /* @silent:teardown the next shot opens a new page */ });
  }
}

/** Test / shutdown hook — never required for a render. */
async function closeBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* @silent:teardown browser already disconnected */
  }
}

module.exports = {
  render, dimensions, wrap, page, isCard, compress,
  BASE_W, BASE_H, closeBrowser, getBrowser,
};
