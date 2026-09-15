"use strict";
/**
 * The faces the PUBLIC WEBSITE can actually render.
 *
 * ── WHY THIS IS A SHORTER LIST THAN THE ERP'S ──────────────────────────────
 *
 * `client/src/lib/fonts.ts` offers seventeen families and loads each one
 * lazily, per family, on demand. `public-web` does not: it declares four
 * `@font-face` blocks in `src/fonts.css`, subset to latin + latin-ext, and
 * ships nothing else.
 *
 * That difference is deliberate — the public site has a first-paint budget the
 * ERP does not — and it creates a trap this file exists to close. A tenant who
 * picks Montserrat in Settings › Appearance gets Montserrat in the ERP and, on
 * their public site, a stack naming a family no `@font-face` declares. The
 * browser falls silently through to the generic. Nothing errors, nothing is
 * logged, and it looks fine to everyone who has Montserrat installed.
 *
 * So the WEBSITE picker offers these four, and the API refuses the rest with a
 * message that says why.
 *
 * ── IT IS CHECKED, NOT ASSERTED ────────────────────────────────────────────
 *
 * `tests/unit/site-fonts-match-stylesheet.test.js` parses
 * `public-web/src/fonts.css` and fails if these ids and that file disagree in
 * either direction. Adding a face to the stylesheet without adding it here
 * hides it from tenants; adding it here without the stylesheet is the silent
 * fallback above. Neither can now happen quietly.
 */

/** Font ids — the same ids `client/src/lib/fonts.ts` uses, so a tenant's ERP
 *  choice and their website choice are the same vocabulary. */
const SITE_FONT_IDS = ["archivo", "ibm-plex-sans", "inter", "jetbrains-mono"];

/** Which of them may fill each role on the website. */
const SITE_FONT_ROLES = {
  display: ["archivo", "ibm-plex-sans", "inter"],
  body: ["inter", "ibm-plex-sans"],
  mono: ["jetbrains-mono"],
};

const SITE_FONT_DEFAULTS = {
  display: "archivo",
  body: "inter",
  mono: "jetbrains-mono",
};

/**
 * The `font-family` name each id resolves to — the name `public-web/src/fonts.css`
 * actually declares in its `@font-face` blocks.
 *
 * ── WHY THIS EXISTS, AND WHAT WAS BROKEN WITHOUT IT ───────────────────────
 *
 * `publicTheme()` has returned `fonts: { display, body, mono }` since PR 2, the
 * settings picker has written it, and the API has refused faces the site cannot
 * render. Nothing in the browser ever read it: `applySiteTheme` wrote the
 * palette and the radius and dropped `payload.fonts` on the floor.
 *
 * So a tenant chose Inter for their display face, saw it accepted, and got
 * Archivo. The whole path was built except its last three lines — the same
 * shape as the theme toggle that flipped a class and repainted nothing.
 *
 * The ids are shared vocabulary with `client/src/lib/fonts.ts`; the FAMILY
 * NAMES are what `@font-face` declares, and the two are not the same string
 * ("jetbrains-mono" vs "JetBrains Mono Variable"). `check:fonts` reads a bare id
 * as an unlicensed family name if it finds one in CSS — F-13 — which is exactly
 * why the mapping belongs here rather than being spelt out at a call site.
 */
const SITE_FONT_FAMILIES = {
  archivo: "Archivo Variable",
  "ibm-plex-sans": "IBM Plex Sans Variable",
  inter: "Inter Variable",
  "jetbrains-mono": "JetBrains Mono Variable",
};

/**
 * The metric-matched fallback family for an id — see
 * `public-web/src/fonts-fallback.css`, which `scripts/gen-font-fallbacks.mjs`
 * generates from the real font files.
 *
 * A stack that goes straight from a webfont to `sans-serif` reflows when the
 * webfont arrives, because the two occupy different widths. The fallback face
 * below is the SAME local font the generic would have picked, re-declared with
 * `size-adjust` and vertical overrides so it occupies the real face's space.
 * Naming it in the stack is what makes `font-display: swap` cost no layout
 * shift.
 */
const siteFontFallback = (id) => `${SITE_FONT_FAMILIES[id] || "Inter Variable"} Fallback`;

/**
 * The full `font-family` value for an id: the real face, its metric-matched
 * fallback, then the generic.
 *
 * ONE function, so the pre-paint stacks in `index.css`, the runtime stacks
 * `applySiteTheme` writes, and the generator that emits the fallback faces
 * cannot describe three different stacks.
 */
function siteFontStack(id, generic = "sans-serif") {
  const family = SITE_FONT_FAMILIES[id];
  if (!family) return generic;
  return `"${family}", "${siteFontFallback(id)}", ${generic}`;
}

/** Is `id` allowed in `role`? Falls back to the role default rather than
 *  throwing, for the reason the palette engine does: this resolves a stored
 *  value at request time, and a row naming a face a later version removed must
 *  render the site, not fail the page. */
function resolveSiteFont(role, id) {
  const allowed = SITE_FONT_ROLES[role] || [];
  return allowed.includes(id) ? id : SITE_FONT_DEFAULTS[role];
}

exports.SITE_FONT_IDS = SITE_FONT_IDS;
exports.SITE_FONT_ROLES = SITE_FONT_ROLES;
exports.SITE_FONT_DEFAULTS = SITE_FONT_DEFAULTS;
exports.resolveSiteFont = resolveSiteFont;
exports.SITE_FONT_FAMILIES = SITE_FONT_FAMILIES;
exports.siteFontFallback = siteFontFallback;
exports.siteFontStack = siteFontStack;
