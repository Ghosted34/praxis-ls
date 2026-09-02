/**
 * EMBEDDED FONTS FOR THE SIGNATURE CARD.
 *
 * Same problem and same shape as src/services/pdf.fonts.js — read that file
 * first; this is the signature-renderer's copy of the idea, not a second
 * mechanism. Headless Chromium has whatever the base image installs (ttf-
 * freefont and nothing else), so a card asking for Montserrat renders in a
 * Helvetica clone and the exported PNG quietly stops being the card anyone
 * approved. Embedding the binary as a data URI makes the render identical on
 * any host with no image-level dependency.
 *
 * WHY THIS IS NOT JUST pdf.fonts.js. That module ships the two families the
 * DOCUMENT templates use — Noto Sans and JetBrains Mono — and is called on the
 * invoice path. The card needs a different pair, one of which is not an
 * @fontsource package at all, and loading four families to use two would put
 * ~200 kB of unused base64 into every screenshot. The two lists are meant to
 * differ; what must not differ is the reasoning, so it is written down once
 * over there and pointed at from here.
 *
 * WHY THE BRITTANY FILE IS READ FROM client/. It is the single copy — the same
 * binary the browser preview loads through client/src/fonts. A second copy
 * under src/ would be the drift that makes the on-screen preview and the
 * exported PNG disagree about the one thing the card is judged on, and the
 * runtime image copies the whole tree, so there is nothing to gain by moving
 * it. See the note at the top of client/src/fonts/brittany-signature.css.
 *
 * COST. Montserrat latin + latin-ext (~60 kB woff2) plus Brittany (~90 kB otf)
 * ≈ 200 kB base64 per rendered document. Read once and memoised, so it is a
 * per-render string cost, not per-render I/O.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../config/logger");

/**
 * `pkg` faces resolve through require.resolve so a hoisted or pnpm-style
 * node_modules still finds them. `repoPath` faces are vendored in this repo and
 * resolve from its root.
 *
 * Latin + latin-ext only, matching pdf.fonts.js: latin-ext covers the French
 * this system actually produces, and the full unicode range would only bloat.
 */
const FACES = [
  {
    family: "Montserrat",
    pkg: "@fontsource-variable/montserrat",
    files: ["montserrat-latin-wght-normal.woff2", "montserrat-latin-ext-wght-normal.woff2"],
    weight: "100 900",
    format: "woff2",
    mime: "font/woff2",
  },
  {
    family: "Brittany Signature",
    repoPath: "client/src/fonts/brittany-signature.otf",
    weight: "400",
    format: "opentype",
    mime: "font/otf",
  },
];

const REPO_ROOT = path.resolve(__dirname, "../../../..");

let cached = null;

function faceRule(family, weight, mime, format, buf) {
  return (
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};`
    + `font-display:block;src:url(data:${mime};base64,${buf.toString("base64")}) format('${format}')}`
  );
}

/**
 * `<style>`-ready @font-face rules with the binaries inlined.
 *
 * Never throws, for pdf.fonts.js's reason: a card that renders in the fallback
 * is a cosmetic problem, and a signature PNG that fails to generate because a
 * font file moved is a broken download on a screen someone is standing in front
 * of. The card's own stacks end in a generic keyword, so a missing face
 * degrades rather than disappears.
 */
function fontFaceCss() {
  if (cached !== null) return cached;

  const rules = [];
  for (const face of FACES) {
    const files = face.files || [null];
    for (const file of files) {
      try {
        let full;
        if (face.pkg) {
          const pkgDir = path.dirname(require.resolve(`${face.pkg}/package.json`));
          full = path.join(pkgDir, "files", file);
        } else {
          full = path.join(REPO_ROOT, face.repoPath);
        }
        const buf = fs.readFileSync(full);
        rules.push(faceRule(face.family, face.weight, face.mime, face.format, buf));
      } catch (err) {
        // Log once (the result is memoised) and carry on with whatever loaded.
        logger.warn(
          { font: face.family, file: file || face.repoPath, err: err.message },
          "embedded signature font unavailable",
        );
      }
    }
  }
  cached = rules.join("");
  return cached;
}

/** Which families actually loaded. The card's preview surfaces this so a
 *  missing binary is visible rather than silently substituted. */
function loadedFamilies() {
  const css = fontFaceCss();
  return FACES.filter((f) => css.includes(`font-family:'${f.family}'`)).map((f) => f.family);
}

/** Test seam — mirrors pdf.fonts.js.__reset. */
function __reset() {
  cached = null;
}

module.exports = { fontFaceCss, loadedFamilies, FACES, __reset };
