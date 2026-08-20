"use strict";
/**
 * @praxis/brand — the Praxis LS brand constants. Read packages/brand/README.md
 * before changing a value in here.
 *
 * THE BOUNDARY THIS PACKAGE EXISTS TO DRAW.
 *
 * The product already had disciplined *tenant* theming: client/src/lib/theme.ts
 * overrides --primary per tenant and derives an accessible --primary-ink for it.
 * What it had no name for was the layer above — the colours that are PRAXIS's
 * and that no tenant may ever repaint: the marketing site, the platform console,
 * the PWA install chrome, transactional mail from praxisls.com, the splash
 * screen, the mark itself.
 *
 * With nowhere to put those, "Praxis orange" survived only as the fallback a
 * tenant had not yet overridden — so it got copied. #F5821F was a literal in
 * src/routes/pwa.js, packages/shared/pwa-design.js, the two document-template
 * modules, portal_auth, app_user, seed-branding (x3), theme.ts and the
 * appearance editor. Ten files, no source of truth, and a splash screen in
 * #9aa8a6 that matched none of them.
 *
 * So: --brand-* comes from here and is never tenant-overridable. --primary and
 * friends stay exactly as they are — tenant-owned, runtime-overridden. A
 * surface belongs to one layer or the other, never both.
 *
 * WHY THE ORANGE MOVED. #F5821F was never the brand colour; it was the value
 * that happened to be in the code. The brand sheet says Optical Orange
 * #FF5A00, and that is now what this file says. See README.md §"Migrating off
 * #F5821F" for the ten call sites.
 */

/* ── Core palette ────────────────────────────────────────────────────────────
 *
 * Three colours. Not four. The blue family that had accumulated as a de-facto
 * secondary (#1C9BD7 / #0C4A7A / #34AAE2 / #1884C4, and --brand-2 in the
 * platform console) is not part of the brand — it survives only as the
 * SEMANTIC info colour in `status` below, which is a different job.
 */
exports.palette = {
  /** Optical Orange. The single accent. Roughly 5% of any given surface. */
  orange: "#FF5A00",
  /** Slate Gray. The mark's structure, and the neutral the ramp is built from. */
  slate: "#7E8286",
  /** Carbon Black. The ground of the primary (dark) expression. */
  carbon: "#0A0A0A",
};

/* Neutral ramp, derived from Slate Gray by mixing toward white and black so the
 * greys stay in the mark's family instead of drifting to a generic cool grey.
 * Contrast figures are against white and against carbon, measured, not
 * estimated — see scripts/marketing/ and README.md §"How these were derived". */
exports.slateRamp = {
  100: "#EDEEEE", // 17.03:1 on carbon — body text on dark
  200: "#DBDCDD", // 14.42:1 on carbon
  300: "#BFC1C3", // 10.97:1 on carbon — muted text on dark
  400: "#9EA1A4", //  7.65:1 on carbon
  500: "#7E8286", //  5.11:1 on carbon ·  3.87:1 on white  (the brand slate)
  600: "#626569", //  5.86:1 on white  — muted text on light
  700: "#494B4E", //  8.71:1 on white
  800: "#303133", // 12.97:1 on white
  900: "#191A1B", // 17.43:1 on white  — body text on light
};

/* ── Accessible variants ─────────────────────────────────────────────────────
 *
 * Same discipline as --primary-ink in client/src/index.css, applied to the
 * brand colour: a hue chosen to look right as a FILL is usually illegible as
 * TEXT. Measured against both surfaces of each theme, WCAG 2.1 AA (4.5:1).
 *
 * The asymmetry is real and worth knowing: on dark grounds the brand orange
 * ALREADY passes as text, so there is nothing to derive. On light grounds it
 * does not, and #C74600 is where it clears.
 */
exports.ink = {
  /** Orange as TEXT on light. #FF5A00 measures 3.13:1 on white — fails AA. */
  orangeLight: "#C74600", // 4.88:1 on white · 4.50:1 on the light app background
  /** Orange as TEXT on dark. The brand orange itself already clears AA. */
  orangeDark: "#FF5A00", //  5.79:1 on the dark card · 6.33:1 on carbon
  /** Slate as TEXT on light. #7E8286 measures 3.87:1 on white — fails AA. */
  slateLight: "#6E7175", // 4.90:1 on white · 4.53:1 on the light app background
  /** Slate as TEXT on dark. Passes as-is. */
  slateDark: "#7E8286", //  5.11:1 on carbon · 4.68:1 on the dark card
};

/**
 * The label colour for text sitting ON an orange fill — a button, a badge, a
 * pill.
 *
 * THIS IS THE ONE THAT BITES. White on #FF5A00 measures 3.13:1 and fails AA at
 * body sizes, so `--primary-foreground: white` cannot come along to the new
 * orange. Carbon on the same fill measures 6.33:1. The platform console already
 * had this right (`.btn.primary { color: #1c1204 }`); the tenant app did not.
 */
exports.onOrange = "#0A0A0A"; // 6.33:1

/* ── Semantic status colours ─────────────────────────────────────────────────
 *
 * Deliberately NOT brand colours, and deliberately not tinted toward orange:
 * a status colour that shares a hue with the accent stops reading as a status.
 * `info` is where the old #1C9BD7 blue lives on — demoted from brand to
 * semantics, and re-derived so it passes as text rather than only as a fill.
 */
exports.status = {
  okLight: "#1F7A47",
  okDark: "#4FCB86",
  warnLight: "#8A5A00",
  warnDark: "#F0B34A",
  dangerLight: "#B3241B",
  dangerDark: "#F0837B",
  infoLight: "#0B5E86",
  infoDark: "#5CBDE8",
};

/* ── Typography ──────────────────────────────────────────────────────────────
 *
 * Three roles, three faces, all already in the shipped library
 * (client/src/lib/fonts.ts) and therefore already self-hosted under OFL/Apache.
 * The stack strings are byte-identical to what variableStack() emits there —
 * @fontsource-variable declares the family as "<Name> Variable", the static
 * name follows for anyone with it installed locally, and the tail is a bare
 * generic keyword so no unlicensed face is ever named. scripts/check-fonts.mjs
 * enforces that rule across the product; nothing here may break it.
 *
 * WHY THESE THREE. The wordmark is wide, geometric and flat-terminalled — a
 * drawn thing, not a typeface, and it stays that way (it is a logo, not a text
 * face). IBM Plex Sans is the shipped face closest to its engineered register,
 * so headings read as continuous with the mark. Inter carries interface and
 * dense tables, which is what it is for. JetBrains Mono takes every figure that
 * has to align in a column — invoice totals, GL balances, container numbers,
 * tenant ids. In an accounting product that last one is not a flourish: a DAF
 * reading a screenshot with ragged decimals has already made up their mind.
 */
exports.type = {
  display: '"IBM Plex Sans Variable", "IBM Plex Sans", sans-serif',
  body: '"Inter Variable", "Inter", sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
};

/* ── Wordmark & lockup ───────────────────────────────────────────────────────
 *
 * There is no tagline in the lockup. "GLOBAL ERP. INTELLIGENT OPERATIONS." was
 * retired deliberately: a claim welded into a logo has to be redrawn every time
 * the company grows past it, and that one was already wrong — the product is
 * OHADA-native today, IFRS next, US GAAP after. Campaign lines carry the claim
 * instead, and they live in copy where changing them costs a pull request.
 */
exports.wordmark = {
  text: "PRAXIS-LS",
  /** Wide tracking is the wordmark's signature. Never set it tighter. */
  tracking: "0.14em",
  /** Below this the node network fills in and the mark turns to mud. */
  minWidthPx: 32,
  /** Clear space on all four sides = the cube's face width. */
  clearSpaceRatio: 1,
};

/**
 * Contrast ratio between two hex colours, WCAG 2.1. Exported so the guarantees
 * in the comments above are testable rather than asserted — a value edited in
 * this file without re-checking it is the exact failure this package exists to
 * end.
 */
exports.contrast = function contrast(hexA, hexB) {
  const rgb = (h) => {
    let s = String(h).replace("#", "");
    if (s.length === 3) s = s.replace(/./g, (c) => c + c);
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rel = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const a = rel(rgb(hexA));
  const b = rel(rgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
