"use strict";

/**
 * THE PRINTED MARK'S GEOMETRY, RESOLVED RATHER THAN GREPPED.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §8.3 fixes the DataMatrix as a hard spec —
 * 12 mm square, 2 mm quiet zone, 40% grey ink — because "discreet" is otherwise
 * a matter of taste. §8.8 criterion 1 is that spec restated as an acceptance
 * criterion.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * PR-5 originally shipped the mark rendering 8 mm × 12 mm. The stylesheet said
 * all the right things:
 *
 *     .wet-code .dm     { width: 12mm; height: 12mm; padding: 2mm; }
 *     .wet-code .dm svg { width: 12mm; height: 12mm; }
 *
 * but `* { box-sizing: border-box }` earlier in the same sheet turned that
 * 12 mm width into an 8 mm CONTENT box, and the flex child shrank into it.
 * The symbol came out non-square, the quiet zone was consumed, and the
 * human-readable code overflowed its container and was clipped mid-string.
 *
 * The test that was supposed to catch it read:
 *
 *     expect(html).toContain(".wet-code .dm { width: 12mm; height: 12mm; padding: 2mm;");
 *
 * — an assertion about the TEXT OF THE STYLESHEET, which cannot fail while the
 * stylesheet says the right thing and the browser does something else. It
 * passed throughout.
 *
 * So this file resolves the cascade instead: it reads the declarations the
 * shell actually emits, applies the one CSS rule that broke it (`box-sizing`
 * decides whether padding eats the declared width), and asserts the resulting
 * geometry in millimetres. Re-introduce the border-box bug and these fail.
 *
 * ── WHY NOT A REAL BROWSER ─────────────────────────────────────────────────
 *
 * Because it would not run where it matters. CI cannot download Chromium —
 * .github/workflows/ci.yaml lists the Chromium-dependent e2e gate among the
 * jobs it deliberately skips — so a puppeteer test here would be skipped on
 * every pull request and would be exactly as useful as the string match it
 * replaces. `scripts/dev/render-wet-signature.js` is the real render, run by
 * hand and pasted into the PR; this is the part that can hold the line on
 * every commit.
 *
 * The model below is deliberately narrow: it implements `box-sizing` and
 * nothing else. That is the rule that broke, it is unambiguous, and a wider
 * model would be a browser re-implementation nobody should trust.
 */

const kit = require("../../src/services/documents/templates/kit");

/** §8.3's spec, in one place so a drift is a one-line diff. */
const SPEC = { symbolMm: 12, quietMm: 2, capPt: 5, inkHex: "#999999" };

/** The stylesheet the shell inlines. */
function stylesheet() {
  const html = kit.shell("geometry", "", kit.defaults());
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("kit.shell emitted no <style> block");
  return match[1];
}

/**
 * Declarations for one selector, as `{ prop: value }`. Comments are stripped
 * first: these sheets DOCUMENT the spec in prose, and a reader that cannot
 * tell a rule from an explanation of a rule is the bug this file is about.
 */
function declarationsFor(css, selector) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(body);
  if (!rule) throw new Error(`no rule found for selector '${selector}'`);
  const out = {};
  for (const part of rule[2].split(";")) {
    const i = part.indexOf(":");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** `12mm` → 12. Only mm is used in this block, so anything else is a drift. */
function mm(value, what) {
  const m = /^(-?[\d.]+)mm$/.exec(String(value || "").trim());
  if (!m) throw new Error(`${what} is '${value}', which is not a millimetre length`);
  return Number(m[1]);
}

/**
 * The content box of an element, which is the whole point: with `border-box`,
 * padding is subtracted from the declared width; with `content-box` it is
 * added outside it. Getting this backwards is what shipped an 8 mm symbol.
 */
function contentBoxMm(decls, { inheritedBoxSizing }) {
  const boxSizing = decls["box-sizing"] || inheritedBoxSizing;
  const width = mm(decls.width, "width");
  const height = mm(decls.height, "height");
  const padding = decls.padding ? mm(decls.padding, "padding") : 0;
  return boxSizing === "border-box"
    ? { width: width - 2 * padding, height: height - 2 * padding, boxSizing, padding }
    : { width, height, boxSizing, padding };
}

describe("the printed wet-signature mark, as the box model resolves it", () => {
  const css = stylesheet();

  /** What `*` sets, and therefore what `.dm` inherits unless it says otherwise. */
  const universal = declarationsFor(css, "*");

  test("the universal reset is border-box, which is the trap this file guards", () => {
    // Not a style preference — the rest of the file only means something
    // because this is border-box. If it ever stops being, these assertions
    // would pass for the wrong reason, so state it out loud.
    expect(universal["box-sizing"]).toBe("border-box");
  });

  test("the symbol's content box is a full 12 mm square, not shrunk by its own quiet zone", () => {
    const dm = declarationsFor(css, ".wet-code .dm");
    const box = contentBoxMm(dm, { inheritedBoxSizing: universal["box-sizing"] });

    // The regression, stated exactly: under the inherited border-box this
    // resolved to 12 - 2*2 = 8 mm and the symbol was squashed into it.
    expect(box.width).toBe(SPEC.symbolMm);
    expect(box.height).toBe(SPEC.symbolMm);
    expect(box.width).toBe(box.height); // a DataMatrix that is not square is not a DataMatrix
  });

  test("the svg asks for exactly the space its container resolves to", () => {
    const dm = declarationsFor(css, ".wet-code .dm");
    const svg = declarationsFor(css, ".wet-code .dm svg");
    const box = contentBoxMm(dm, { inheritedBoxSizing: universal["box-sizing"] });

    // A flex child larger than its content box shrinks; smaller, and the
    // quiet zone is bigger than specified. Equality is the only value that
    // renders the spec.
    expect(mm(svg.width, "svg width")).toBe(box.width);
    expect(mm(svg.height, "svg height")).toBe(box.height);
  });

  test("the quiet zone is a real 2 mm on every side", () => {
    const dm = declarationsFor(css, ".wet-code .dm");
    const box = contentBoxMm(dm, { inheritedBoxSizing: universal["box-sizing"] });
    // §8.3: "2 mm, enforced by padding — a barcode without it will not decode."
    expect(box.padding).toBe(SPEC.quietMm);
  });

  test("the mark's column is wide enough for the grouped code it prints", () => {
    const wet = declarationsFor(css, ".wet-code");
    const cap = declarationsFor(css, ".wet-code .cap");
    const columnMm = mm(wet.width, ".wet-code width");

    // The caption is `nowrap`, so a column narrower than the string does not
    // wrap it — it CLIPS it, and a half-printed code defeats the operator
    // search §8.2 calls the feature's whole point. The original 16 mm column
    // held 21.17 mm of text.
    expect(cap["white-space"]).toBe("nowrap");

    // 18 Crockford characters grouped in threes by formatCode → 20 glyphs.
    // Monospace advance is ~0.6em, and the declared size is 5pt = 1.764mm.
    const glyphs = kit.formatPrintCode("0123456789ABCDEFGH").length;
    const ptToMm = 25.4 / 72;
    const sizeMm = Number(/^([\d.]+)pt$/.exec(cap["font-size"])[1]) * ptToMm;
    const textMm = glyphs * sizeMm * 0.6;

    expect(glyphs).toBe(20);
    expect(columnMm).toBeGreaterThanOrEqual(textMm);
    // and wide enough for the symbol plus both quiet zones
    expect(columnMm).toBeGreaterThanOrEqual(SPEC.symbolMm + 2 * SPEC.quietMm);
  });

  test("the ink is 40 percent grey in the symbol itself, not an opacity trick", async () => {
    const barcode = require("../../src/services/signatures/barcode");
    const svg = await barcode.generateSvg("0123456789ABCDEFGH");

    // §8.3 specifies #999 INK. The first implementation painted black modules
    // at `opacity: 0.4`, which looks the same on screen and is not the same
    // thing: opacity is a compositing operation that forces a transparency
    // group in the PDF, and it is not what a print shop is handed.
    expect(svg).toContain(SPEC.inkHex);
    expect(svg).not.toMatch(/#000000|#000\b/);

    const dmSvg = declarationsFor(css, ".wet-code .dm svg");
    expect(dmSvg.filter).toBeUndefined();
    expect(dmSvg.opacity).toBeUndefined();
  });

  test("the mark sits left of the verification block in the footer", () => {
    // §8.3: the reconciliation mark is bottom-LEFT and the verification QR
    // stays bottom-right, "so a reader is never in doubt which one to scan,
    // and neither is a decoder".
    const foot = kit.footer(
      { legal_name: "Praxis Test SARL" },
      { ...kit.defaults(), wet_print: { code: "0123456789ABCDEFGH", svg: "<svg/>" }, show: { qr: true } },
      { code: "ABCD1234EFGH", url: "https://t.example.cm/v/ABCD1234EFGH", qrSvg: "<svg/>" },
    );
    expect(foot.indexOf("wet-code")).toBeGreaterThan(-1);
    expect(foot.indexOf("foot-vfy")).toBeGreaterThan(-1);
    expect(foot.indexOf("wet-code")).toBeLessThan(foot.indexOf("foot-vfy"));
  });
});
