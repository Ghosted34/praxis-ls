"use strict";

/**
 * CSP hashes for the inline `<script>` blocks of a built HTML shell.
 *
 * `script-src` is `'self'` platform-wide and deliberately carries no
 * `'unsafe-inline'` — SEC-M8 removed it, and the comment above the helmet
 * config in `src/server.js` explains what that bought. public-web's shell has
 * one inline script all the same: the no-flash theme block, which reads the
 * stored mode and writes `data-theme` BEFORE first paint. Moving it to a file
 * would reintroduce exactly the flash it exists to prevent, so the script is
 * legitimately inline and the CSP has to name it.
 *
 * Naming it by HASH rather than by `'unsafe-inline'` keeps the mitigation for
 * every other page, including login. Naming it by a hash COMPUTED FROM THE
 * BUILT FILE rather than a constant pasted from a browser console is what stops
 * the two drifting: edit the theme block and the allowance follows it, instead
 * of failing silently in production the way a stale literal would.
 *
 * A missing or unreadable file yields no hashes rather than throwing. The app
 * boots without `public-web/dist` (that is what `hasPublicWeb` is for), and a
 * CSP helper is not the thing that should stop it.
 */

const crypto = require("crypto");
const fs = require("fs");

/**
 * Inline scripts only — anything carrying `src=` is an external load that
 * `'self'` already covers, and hashing it would be meaningless.
 */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * @param {string} html
 * @returns {string[]} CSP source expressions, e.g. `'sha256-…'`, ready to be
 *   spread into a `script-src` array. Deduplicated and order-stable.
 */
function hashesForHtml(html) {
  const seen = new Set();
  for (const match of String(html || "").matchAll(INLINE_SCRIPT)) {
    const body = match[1];
    // An empty block is not a script the browser will run, and hashing "" would
    // add a source expression that matches every other empty block on the site.
    if (!body) continue;
    const digest = crypto.createHash("sha256").update(body, "utf8").digest("base64");
    seen.add(`'sha256-${digest}'`);
  }
  return [...seen];
}

/**
 * @param {string} file absolute path to a built HTML shell
 * @returns {string[]} hashes, or `[]` when the file is absent or unreadable
 */
function hashesForFile(file) {
  try {
    return hashesForHtml(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

module.exports = { hashesForHtml, hashesForFile };
