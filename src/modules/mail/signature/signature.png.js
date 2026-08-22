/**
 * Signature PNG — screenshots the SAME HTML `signature.html.js` produces.
 *
 * Puppeteer is already a dependency (pdf.service.js). The renderer is injected
 * so unit tests never launch Chromium. Dimensions match the standalone tool:
 * 650 × 325 CSS px at 1×, 1300 × 650 at 2×, 1950 × 975 at 3×.
 */
"use strict";

const html = require("./signature.html");

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

/**
 * @param {object} model
 * @param {1|2|3} scale
 * @param {function} [shot]  async (html, {width,height,scale}) => Buffer
 */
async function render(model, scale = 1, shot = defaultShot) {
  const fragment = html.render(model);
  const d = dimensions(model, scale);
  const page = wrap(fragment, model, scale);
  const buf = await shot(page, d);
  return { buffer: buf, ...d, html: fragment, text: html.textContent(model) };
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
    const { config } = require("../../../config/env");
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: config.PUPPETEER_EXECUTABLE_PATH || undefined,
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
    return await page.screenshot({ type: "png", omitBackground: false });
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
    /* already gone */
  }
}

module.exports = { render, dimensions, wrap, BASE_W, BASE_H, closeBrowser, getBrowser };
