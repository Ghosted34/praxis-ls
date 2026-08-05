/**
 * EMBEDDED FONTS FOR GENERATED DOCUMENTS.
 *
 * THE PROBLEM THIS SOLVES. PDF templates named `'Noto Sans', Arial` and the
 * Excel title block named `Playfair Display`, and neither font existed anywhere
 * near the renderer. The Docker image installs `ttf-freefont` and nothing else,
 * so every invoice, payslip and report this system has produced came out set in
 * FreeSans — a Helvetica clone — while the code, the templates and the config
 * all said otherwise. Client-facing documents were the last place that should
 * have been true.
 *
 * WHY EMBED RATHER THAN INSTALL. Adding `font-noto` to the Dockerfile would fix
 * the body face and leave the mono face to whatever Alpine happens to package
 * this month; it also makes correct output depend on a distro package rather
 * than on the repo. Embedding the exact woff2 this product ships to browsers
 * makes a PDF render identically to the screen it came from, on any host, with
 * no image-level dependency — the same file, from the same lockfile.
 *
 * COST. The latin + latin-ext subsets only: ~208 kB of woff2, ~280 kB once
 * base64'd, added to each document's HTML. Read from disk once and memoised, so
 * the cost is per-document string size, not per-document I/O. Latin-ext covers
 * French — the accented output this system actually produces — which the full
 * unicode range would only bloat.
 *
 * Both families come from the shipped library (client/src/lib/fonts.ts): Noto
 * Sans for text, JetBrains Mono for figures. Keep them in step.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { logger } = require("../config/logger");

/**
 * One @font-face per subset. `wght-normal` is the variable weight axis file, so
 * a single face covers the whole 400–700 range the templates use — no separate
 * bold file, and no synthetic bolding.
 */
const FACES = [
  {
    family: "Noto Sans",
    pkg: "@fontsource-variable/noto-sans",
    files: ["noto-sans-latin-wght-normal.woff2", "noto-sans-latin-ext-wght-normal.woff2"],
    weight: "100 900",
  },
  {
    family: "JetBrains Mono",
    pkg: "@fontsource-variable/jetbrains-mono",
    files: ["jetbrains-mono-latin-wght-normal.woff2", "jetbrains-mono-latin-ext-wght-normal.woff2"],
    weight: "100 800",
  },
];

/** The CSS font-family values templates should use. Library faces, generic
 *  fallback only — no named font from outside the library, per doc/TYPOGRAPHY.md. */
const PDF_FONT_BODY = "'Noto Sans', sans-serif";
const PDF_FONT_MONO = "'JetBrains Mono', monospace";

let cached = null;

/**
 * `<style>`-ready @font-face rules with the font binary inlined as a data URI.
 *
 * Never throws. A document that renders in the fallback is a cosmetic problem;
 * an invoice that fails to generate because a font file moved is an outage, and
 * these are called on the invoice path.
 */
function fontFaceCss() {
  if (cached !== null) return cached;

  const rules = [];
  for (const face of FACES) {
    for (const file of face.files) {
      try {
        // Resolved from the package's own entry point rather than a hand-built
        // node_modules path, so a hoisted or pnpm-style layout still finds it.
        const pkgDir = path.dirname(require.resolve(`${face.pkg}/package.json`));
        const buf = fs.readFileSync(path.join(pkgDir, "files", file));
        rules.push(
          `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};` +
            `font-display:block;src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2')}`,
        );
      } catch (err) {
        // Log once (the result is memoised) and carry on with whatever loaded.
        logger.warn({ font: face.family, file, err: err.message }, "embedded PDF font unavailable");
      }
    }
  }
  cached = rules.join("");
  return cached;
}

/** Test seam. */
function __reset() {
  cached = null;
}

module.exports = { fontFaceCss, PDF_FONT_BODY, PDF_FONT_MONO, __reset };
