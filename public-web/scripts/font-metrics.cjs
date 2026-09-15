"use strict";
/**
 * The numbers behind `src/fonts-fallback.css`, in CommonJS.
 *
 * ── WHY THIS IS SPLIT OUT OF THE GENERATOR ────────────────────────────────
 *
 * The generator is ESM (it is a `scripts/*.mjs` like every other gate in this
 * app). The backend's jest runs CommonJS and cannot `import()` it without
 * `--experimental-vm-modules`, so the choice was to loosen the test runner for
 * one file or to put the part worth testing where both can reach it.
 *
 * The part worth testing is all of it: the metric table, the reader that pulls
 * our faces out of their real `.woff2`, and the override arithmetic — which is
 * the half that is easy to get subtly wrong, because the vertical overrides are
 * stated against the em AFTER `size-adjust` has scaled it.
 *
 * `tests/unit/font-fallback-metrics.test.js` is the pin.
 */

const { join } = require("node:path");

const ROOT = join(__dirname, "..");

/** Our faces, by the id `packages/shared/design/site-fonts.js` uses. */
const FACES = {
  archivo: "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  "ibm-plex-sans": "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2",
  inter: "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "jetbrains-mono": "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
};

/**
 * What a browser substitutes, and its metrics.
 *
 * `local()` is the whole mechanism: the fallback face is not a download, it is
 * a re-declaration of a font already on the machine. The names are listed
 * widest-reach first, and every name in one group shares the group's metrics —
 * Arial, Helvetica, Liberation Sans and Arimo are one metric family by design.
 *
 * `verifyAgainst` names a file the test uses to prove these numbers when the
 * machine has it. That is what keeps this table honest.
 */
const FALLBACK_METRICS = {
  sans: {
    locals: ["Arial", "Helvetica Neue", "Helvetica", "Liberation Sans", "Arimo"],
    upm: 2048,
    ascent: 1854,
    descent: -434,
    lineGap: 67,
    xAvgCharWidth: 1187,
    verifyAgainst: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  },
  mono: {
    locals: ["Courier New", "Liberation Mono", "Cousine"],
    upm: 2048,
    ascent: 1705,
    descent: -615,
    lineGap: 0,
    xAvgCharWidth: 1229,
    verifyAgainst: "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
  },
};

/** Which substitute each of our faces is measured against. */
const TARGET = {
  archivo: "sans",
  "ibm-plex-sans": "sans",
  inter: "sans",
  "jetbrains-mono": "mono",
};

function readFaceMetrics(id) {
  const fontkit = require("fontkit");
  const path = require.resolve(FACES[id], { paths: [ROOT] });
  const f = fontkit.openSync(path);
  return {
    upm: f.unitsPerEm,
    ascent: f.ascent,
    descent: f.descent,
    lineGap: f.lineGap,
    xAvgCharWidth: f["OS/2"].xAvgCharWidth,
  };
}

/**
 * The four overrides, from two fonts' metrics.
 *
 * `size-adjust` is the ratio of average advance widths, normalised by each
 * font's em. The vertical overrides are then DIVIDED by that ratio: they are
 * expressed against the ADJUSTED em, so a fallback scaled to 115% needs its
 * ascent stated as a smaller fraction to land in the same place.
 *
 * Exported so `font-fallback-metrics.test.js` can pin the arithmetic on a
 * worked example rather than on the generated file's text.
 */
function overrides(face, fallback) {
  const sizeAdjust = (face.xAvgCharWidth / face.upm) / (fallback.xAvgCharWidth / fallback.upm);
  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  return {
    sizeAdjust: pct(sizeAdjust),
    ascentOverride: pct(face.ascent / face.upm / sizeAdjust),
    descentOverride: pct(Math.abs(face.descent) / face.upm / sizeAdjust),
    lineGapOverride: pct(face.lineGap / face.upm / sizeAdjust),
  };
}


module.exports = { FACES, FALLBACK_METRICS, TARGET, readFaceMetrics, overrides };
