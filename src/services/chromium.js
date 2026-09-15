/**
 * WHERE CHROMIUM IS.
 *
 * THE BUG THIS EXISTS TO STOP HAPPENING AGAIN. `pdf.service.js` had this logic
 * privately and every invoice, payslip and report rendered fine. The signature
 * card renderer, written later, launched with
 *
 *     executablePath: config.PUPPETEER_EXECUTABLE_PATH || undefined
 *
 * `PUPPETEER_EXECUTABLE_PATH` defaults to `""` in the env schema, so on any
 * deployment that does not set it the expression is `undefined`, Puppeteer
 * looks for the Chromium it downloads at install time, and the Dockerfile sets
 * `PUPPETEER_SKIP_DOWNLOAD=true` because the image installs Alpine's package
 * instead. The launch threw on every single send. Chromium was sitting at
 * /usr/bin/chromium the whole time — PDFs were using it — and the signature
 * renderer was the one caller that never looked.
 *
 * A second copy of "find the browser" is a second chance to get it wrong, so
 * there is one, here, and both callers use it.
 *
 * THE ORDER. Configured value first (an operator who names a path means it),
 * then the raw environment variable (the Dockerfile sets it, and a container
 * may pass it without it reaching the config schema), then the standard
 * install locations. Each candidate is checked for EXISTENCE rather than
 * trusted: a stale path in an env var is worse than no path at all, because
 * Puppeteer reports it as a spawn failure rather than as a missing browser.
 */
"use strict";

const fs = require("fs");
const { config } = require("../config/env");

/** Standard system paths where Chromium/Chrome might exist. */
const KNOWN_CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
  "/usr/local/bin/chrome",
  "/usr/local/bin/chromium",
];

const usable = (p) => {
  const v = String(p || "").trim();
  if (!v) return null;
  try {
    return fs.existsSync(v) ? v : null;
  } catch {
    /* @silent:storage an unreadable path is simply not a candidate */
    return null;
  }
};

/**
 * @returns {string|undefined} an executable that exists, or undefined to let
 *   Puppeteer try its own bundled download (correct in dev, where it has one).
 */
function resolveChromiumPath() {
  return usable(config.PUPPETEER_EXECUTABLE_PATH)
    || usable(process.env.PUPPETEER_EXECUTABLE_PATH)
    || KNOWN_CHROMIUM_PATHS.map(usable).find(Boolean)
    || undefined;
}

/**
 * Everything a caller needs to explain a launch failure without a redeploy.
 * Read by the signature diagnostics endpoint.
 */
function chromiumReport() {
  return {
    resolved: resolveChromiumPath() || null,
    configured: config.PUPPETEER_EXECUTABLE_PATH || null,
    from_env: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    candidates: KNOWN_CHROMIUM_PATHS.map((p) => ({ path: p, exists: Boolean(usable(p)) })),
  };
}

module.exports = { resolveChromiumPath, chromiumReport, KNOWN_CHROMIUM_PATHS };
