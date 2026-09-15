/**
 * The website's font registry and its stylesheet must agree.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 *
 * `public-web/src/fonts.css` declares four `@font-face` families. If the
 * registry in `packages/shared/design/site-fonts.js` ever names a fifth, a
 * tenant can select a face the public site does not self-host: the stack names
 * a family no `@font-face` declares, the browser falls silently through to the
 * generic, nothing errors and nothing is logged. It looks correct to every
 * developer who happens to have that font installed locally — which, for the
 * families in this library, is most of them.
 *
 * The reverse is quieter but also wrong: a face added to the stylesheet and not
 * to the registry is bytes shipped to every visitor that no tenant can choose.
 *
 * Both directions are asserted, because a one-way check is the one that gets
 * added after the first incident and misses the second.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SITE_FONT_IDS, SITE_FONT_ROLES, SITE_FONT_DEFAULTS, resolveSiteFont } =
  require("../../packages/shared/design/site-fonts");

const CSS = path.join(__dirname, "..", "..", "public-web", "src", "fonts.css");

/** "Archivo Variable" → "archivo"; the same id scheme client/src/lib/fonts.ts
 *  uses, so an ERP choice and a website choice speak one vocabulary. */
const idOf = (family) =>
  family.replace(/\s+Variable$/i, "").trim().toLowerCase().replace(/\s+/g, "-");

function familiesInStylesheet() {
  const css = fs.readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const ids = new Set();
  for (const block of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)) {
    const m = block[1].match(/font-family\s*:\s*["']([^"']+)["']/);
    if (m) ids.add(idOf(m[1]));
  }
  return ids;
}

describe("website font registry", () => {
  test("every registered font is self-hosted by public-web", () => {
    const shipped = familiesInStylesheet();
    const missing = SITE_FONT_IDS.filter((id) => !shipped.has(id));
    // A registered face with no @font-face is a silent fallback on the tenant's
    // own public site — invisible to anyone who has the font installed.
    expect({ missing, shipped: [...shipped].sort() }).toEqual({
      missing: [],
      shipped: [...shipped].sort(),
    });
  });

  test("every self-hosted font is offered to tenants", () => {
    const shipped = [...familiesInStylesheet()].sort();
    const unoffered = shipped.filter((id) => !SITE_FONT_IDS.includes(id));
    // Bytes shipped to every visitor that no tenant can select.
    expect(unoffered).toEqual([]);
  });

  test("every role's options and default are real registered fonts", () => {
    for (const [role, ids] of Object.entries(SITE_FONT_ROLES)) {
      for (const id of ids) expect(SITE_FONT_IDS).toContain(id);
      expect(ids).toContain(SITE_FONT_DEFAULTS[role]);
    }
  });

  test("an unknown or wrong-role id falls back rather than throwing", () => {
    // This resolves a STORED value at request time. A row naming a face a later
    // version removed must render the site, not fail the page.
    expect(resolveSiteFont("display", "comic-sans")).toBe(SITE_FONT_DEFAULTS.display);
    expect(resolveSiteFont("mono", "archivo")).toBe(SITE_FONT_DEFAULTS.mono);
    expect(resolveSiteFont("display", "archivo")).toBe("archivo");
  });
});
