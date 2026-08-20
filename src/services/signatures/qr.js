/**
 * QR generation for the verification seal
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.12).
 *
 * Server-side and inline, because the document is rendered to PDF by Puppeteer:
 * inline SVG rasterises at print resolution and needs no network fetch, where a
 * <img src> would have to survive the renderer's CSP and an external request.
 *
 * ── Error correction: Q, not M ─────────────────────────────────────────────
 * A verification QR on a logistics document is photocopied, faxed, stapled
 * through, and photographed at an angle in a badly-lit warehouse. Level Q
 * tolerates ~25% damage against M's ~15%. For a payload this short the version
 * bump that buys is small, and the robustness is the entire point of printing
 * the thing.
 */
"use strict";

const QRCode = require("qrcode");

/**
 * Render a QR as inline SVG sized in millimetres.
 *
 * `margin` is in MODULES, not mm — the spec's quiet zone is 4 modules and
 * scanners genuinely fail without it. It is left at 4 rather than trimmed for
 * space: a QR that does not scan has no reason to be on the page.
 */
async function svg(text, { sizeMm = 20, margin = 4 } = {}) {
  const raw = await QRCode.toString(String(text), {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin,
    // Rendered at a nominal size then re-attributed below; the viewBox is what
    // actually drives the geometry, so this number never reaches the output.
    width: 256,
  });
  // Force physical units and drop the library's fixed px width/height, so the
  // symbol lands at a known millimetre size on the printed page rather than at
  // whatever the CSS cascade makes of 256px.
  return raw
    .replace(/<svg([^>]*?)width="[^"]*"/, "<svg$1width=\"" + sizeMm + "mm\"")
    .replace(/<svg([^>]*?)height="[^"]*"/, "<svg$1height=\"" + sizeMm + "mm\"")
    .replace("<svg", "<svg shape-rendering=\"crispEdges\"");
}

/** Module count on a side, excluding the quiet zone. Used by the size test. */
async function moduleCount(text) {
  const raw = await QRCode.toString(String(text), { type: "svg", errorCorrectionLevel: "Q", margin: 0 });
  const m = raw.match(/viewBox="0 0 (\d+) \d+"/);
  return m ? Number(m[1]) : 0;
}

module.exports = { svg, moduleCount };
