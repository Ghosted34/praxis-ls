"use strict";
/**
 * Colour mathematics for the palette engine — sRGB ⇄ OKLCH, WCAG contrast, and
 * gamut mapping. Zero dependencies, pure functions, no DOM.
 *
 * WHY OKLCH AND NOT HSL. The engine's central operation is "walk this colour's
 * lightness until it clears 4.5:1 against that surface". In HSL, lightness is
 * not perceptual: walking a saturated orange down in HSL-L desaturates it into
 * brown long before it clears, and walking a blue down barely moves its
 * measured contrast at all. Both are the tenant palette we actually have
 * (Smart Logistics is orange + blue), so the failure is not hypothetical.
 *
 * OKLab's lightness IS perceptually uniform, so the same step means the same
 * apparent change at every hue, and a hue held constant through a lightness
 * walk still reads as the same colour at the end of it. That is the whole
 * property this engine rests on.
 *
 * WHY IT IS HAND-WRITTEN AND NOT A DEPENDENCY. `culori` and friends are
 * excellent and would add 10-40 kB to a package the API requires at boot and
 * the ERP bundles. The conversions below are ~60 lines of arithmetic from
 * Björn Ottosson's published matrices; the test suite pins them against known
 * values. A dependency here would be carried by every consumer forever to save
 * work that is done once.
 *
 * ── ON PRECISION ───────────────────────────────────────────────────────────
 *
 * Everything is float in, float out; rounding happens ONCE, at the boundary
 * where a hex string is produced. Rounding between conversions is how a
 * round-trip drifts a channel by a unit per hop, which shows up as a palette
 * that changes slightly every time it is re-derived from its own output.
 */

/* ── sRGB transfer function ─────────────────────────────────────────────────
 * The gamma curve, exactly as the sRGB spec defines it — including the linear
 * segment near black, which the common `x^2.2` approximation drops. That
 * segment matters here: it is where the dark theme's surfaces live, and a
 * contrast figure computed with the approximation is wrong by enough to pass a
 * pair that actually fails.
 */
const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/* ── Parsing ────────────────────────────────────────────────────────────────
 *
 * Accepts `#rgb`, `#rrggbb`, and the same without the hash. Returns null rather
 * than throwing or coercing: a tenant's branding row can hold anything a past
 * migration or a hand-edited seed put there, and the engine's contract is to
 * fall back to a default palette rather than to take the API down at boot.
 */
function parseHex(value) {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** `[0..1, 0..1, 0..1]` → `#rrggbb`. The ONE place rounding happens. */
function toHex(rgb) {
  const part = (c) => {
    const v = Math.round(clamp01(c) * 255);
    return v.toString(16).padStart(2, "0");
  };
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** `[0..1,…]` → `"R G B"`, the triplet form tokens consumed as
 *  `rgb(var(--x) / <alpha>)` require. See the note in public-web/src/index.css
 *  about `--brand-orange` being a bare triplet: handing one of these to a
 *  plain `background:` silently drops the declaration. */
function toTriplet(rgb) {
  return rgb.map((c) => Math.round(clamp01(c) * 255)).join(" ");
}

/* ── OKLab / OKLCH ──────────────────────────────────────────────────────────
 * Ottosson's matrices, unmodified. The cube roots are the perceptual step.
 */
function linearRgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** `#rrggbb` → `{ l, c, h }`. `l` is 0..1, `c` is unbounded-ish (0..~0.4 in
 *  sRGB), `h` is degrees 0..360. Hue of a neutral is meaningless and is
 *  reported as 0 — callers that harmonise must check chroma, not hue. */
function hexToOklch(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [L, a, b] = linearRgbToOklab(rgb.map(srgbToLinear));
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-6 ? 0 : h };
}

function oklchToLinearRgb({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  return oklabToLinearRgb([l, Math.cos(rad) * c, Math.sin(rad) * c]);
}

const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/**
 * OKLCH → `#rrggbb`, reducing chroma until the colour fits sRGB.
 *
 * WHY CHROMA AND NOT A CHANNEL CLAMP. Clamping the out-of-range channel is what
 * most quick conversions do, and it shifts hue: clamping a too-blue blue pins B
 * at 1 while R and G stay put, and the result is a different colour, not a less
 * saturated one. Binary-searching chroma holds hue and lightness — the two
 * properties every derivation in the engine depends on — and gives up only the
 * saturation that sRGB cannot represent anyway.
 *
 * 20 iterations resolves chroma to ~1e-6, well below a 1/255 step.
 */
function oklchToHex({ l, c, h }) {
  let lin = oklchToLinearRgb({ l, c, h });
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 20; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinearRgb({ l, c: lo, h });
  }
  return toHex(lin.map(linearToSrgb));
}

/* ── WCAG 2.1 contrast ──────────────────────────────────────────────────────
 *
 * Deliberately WCAG 2.1 relative luminance and not APCA. APCA is a better model
 * of perceived contrast and it is not what this product is measured against:
 * `doc/WEB_BUILD_BRIEF.md` N10 says WCAG AA, the existing gates compute 2.1
 * ratios, and an engine that optimised for a different metric would produce
 * palettes those gates then reject.
 */
function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, 1..21. Order-independent. */
function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Walk a colour's LIGHTNESS until it clears `target` against `against`, holding
 * hue and (as far as gamut allows) chroma.
 *
 * `direction` is "darker" on light grounds and "lighter" on dark ones. The
 * caller decides, because the right direction is a property of the surface, not
 * of the colour: on the dark theme's card the brand orange already clears AA
 * and must not be touched, which is why the engine checks before it walks.
 *
 * Returns the ORIGINAL hex when it already passes — not a re-derived equivalent
 * — so a tenant whose colour is already accessible sees their exact value in
 * the settings preview rather than one that differs in the last digit.
 *
 * When even L=0 or L=1 cannot reach the target (a mid-grey surface leaves no
 * room in either direction), returns the best it achieved. The caller is
 * expected to assert; silently returning a failing colour is acceptable here
 * only because the test suite is what turns it into a build failure.
 */
function walkToContrast(hex, against, target, direction) {
  if (contrast(hex, against) >= target) return hex;
  const base = hexToOklch(hex);
  if (!base) return hex;

  const limit = direction === "darker" ? 0 : 1;
  let lo = base.l;
  let hi = limit;
  let best = oklchToHex({ ...base, l: limit });

  // If even the extreme fails there is nothing to search for; hand back the
  // extreme, which is the most contrast this hue can produce on this ground.
  if (contrast(best, against) < target) return best;

  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = oklchToHex({ ...base, l: mid });
    if (contrast(candidate, against) >= target) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/** Rotate a hue by `deg`, holding lightness and chroma. Used to derive a
 *  secondary and tertiary for a tenant who supplied only one colour. */
function rotateHue(hex, deg) {
  const c = hexToOklch(hex);
  if (!c) return hex;
  return oklchToHex({ ...c, h: (((c.h + deg) % 360) + 360) % 360 });
}

/** Shortest signed distance from `a` to `b` in degrees, −180..180. Hue is
 *  circular and `b - a` is wrong across the 0/360 seam — which is exactly where
 *  the road-orange anchor sits. */
function hueDelta(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

/**
 * `"40 148 94"` → `#28945e`.
 *
 * Needed because the token set mixes two representations on purpose: colours
 * consumed as `rgb(var(--x) / <alpha>)` must be stored as bare triplets, and
 * everything else is a hex string. Any code MEASURING a token therefore has to
 * normalise first — the audit did not, every triplet parsed as null, and four
 * mode colours reported a 1.15:1 contrast that was really an unparsed string.
 * Keeping the conversion here means there is one place that knows the two
 * forms exist.
 */
function tripletToHex(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map(Number);
  if (parts.some((n) => n > 255)) return null;
  return toHex(parts.map((n) => n / 255));
}

/** A token value in either representation → hex, or null. */
function normaliseColor(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.startsWith("#")) return parseHex(t) ? t : null;
  const trip = tripletToHex(t);
  if (trip) return trip;
  const m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return toHex([Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]);
  return parseHex(t) ? t : null;
}

exports.tripletToHex = tripletToHex;
exports.normaliseColor = normaliseColor;
exports.parseHex = parseHex;
exports.toHex = toHex;
exports.toTriplet = toTriplet;
exports.hexToOklch = hexToOklch;
exports.oklchToHex = oklchToHex;
exports.contrast = contrast;
exports.relativeLuminance = relativeLuminance;
exports.walkToContrast = walkToContrast;
exports.rotateHue = rotateHue;
exports.hueDelta = hueDelta;
exports.srgbToLinear = srgbToLinear;
exports.linearToSrgb = linearToSrgb;
