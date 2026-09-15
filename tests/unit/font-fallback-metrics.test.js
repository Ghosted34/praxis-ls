/**
 * The metric-matched fallback faces (guide O-12 / F-33).
 *
 * ── WHAT MAKES A HARDCODED METRIC HONEST ─────────────────────────────────
 *
 * F-33 declined to fix the font reflow because the number it could measure came
 * from one container's `sans-serif`, and a visitor's fallback is Arial on
 * Windows, Helvetica on macOS and Roboto on Android. That objection is right
 * about a MEASURED constant and wrong about the fix: what a fallback face needs
 * is the metrics of a specific named font, and those are properties of that
 * font rather than of the machine measuring it.
 *
 * So `gen-font-fallbacks.mjs` carries a small table, and this file is what stops
 * the table being remembered numbers:
 *
 *   · OUR faces are read from the real `.woff2` in `node_modules`, so nothing
 *     about them is typed at all.
 *   · The FALLBACK metrics are verified against a real font file wherever the
 *     machine running this has one. Liberation Sans is metric-compatible with
 *     Arial BY DESIGN — Red Hat built it as a drop-in with identical advance
 *     widths and identical vertical metrics — and Arial is metric-compatible
 *     with Helvetica. One file therefore pins the numbers for the whole family.
 *
 * On a machine without those files the verification SKIPS rather than passes:
 * see the note on `describeIfFonts`.
 */
"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

/** The generator is ESM and jest here is CJS, so the part worth testing lives
 *  in a CommonJS sibling both can load — see that file's header. */
const mod = require("../../public-web/scripts/font-metrics.cjs");

describe("the override arithmetic", () => {
  test("size-adjust is the ratio of average advance widths, per em", () => {
    // A face whose glyphs are 10% wider than the fallback's, at the same em,
    // needs the fallback drawn at 110%.
    const face = { upm: 1000, ascent: 800, descent: -200, lineGap: 0, xAvgCharWidth: 550 };
    const fallback = { upm: 1000, ascent: 800, descent: -200, lineGap: 0, xAvgCharWidth: 500 };
    expect(mod.overrides(face, fallback).sizeAdjust).toBe("110.00%");
  });

  test("the vertical overrides are stated against the ADJUSTED em", () => {
    // This is the half that is easy to get wrong. The overrides are fractions
    // of the fallback's em AFTER size-adjust has scaled it, so each is the
    // face's own fraction DIVIDED by the adjustment. Stating the raw fraction
    // would leave the line box wrong by exactly the size-adjust.
    const face = { upm: 1000, ascent: 800, descent: -200, lineGap: 100, xAvgCharWidth: 550 };
    const fallback = { upm: 1000, ascent: 900, descent: -100, lineGap: 0, xAvgCharWidth: 500 };
    const o = mod.overrides(face, fallback);
    expect(o.sizeAdjust).toBe("110.00%");
    expect(o.ascentOverride).toBe("72.73%"); // 0.80 / 1.10
    expect(o.descentOverride).toBe("18.18%"); // 0.20 / 1.10
    expect(o.lineGapOverride).toBe("9.09%"); // 0.10 / 1.10
  });

  test("an identical font needs no adjustment at all", () => {
    // The degenerate case, and the one that proves the formula is not inverted:
    // measuring a font against itself must produce 100% and its own fractions.
    const face = { upm: 2048, ascent: 1854, descent: -434, lineGap: 67, xAvgCharWidth: 1187 };
    const o = mod.overrides(face, face);
    expect(o.sizeAdjust).toBe("100.00%");
    expect(o.ascentOverride).toBe("90.53%"); // 1854 / 2048
    expect(o.descentOverride).toBe("21.19%"); // 434 / 2048
  });
});

/**
 * ── WHY THIS BLOCK IS CONDITIONAL, AND WHY THAT IS NOT A HOLE ─────────────
 *
 * These read the real `.woff2` out of `@fontsource-variable/*`, which are
 * `public-web`'s dependencies and nobody else's. This suite runs under jest at
 * the repo ROOT, and CI's `build-test` job installs the root workspace only —
 * there is no `public-web/node_modules` in it at all. So the block passed
 * locally, where both trees happen to be installed, and failed in CI with four
 * "Cannot resolve module" errors.
 *
 * That is F-44's asymmetry again, pointing the other way: F-44 was public-web
 * reaching for a root package, this is a root test reaching for public-web's.
 * Neither is visible to a local `npm run ci`, which installs everything.
 *
 * The guard is NOT the F-27 failure this file warns about two blocks down. What
 * makes a skip dishonest is that nothing else checks the thing; here something
 * does, and it is stricter. `check:fonts-fallback` — gate 37, in the public-web
 * job — runs `gen-font-fallbacks.mjs --check`, which REGENERATES the stylesheet
 * from these same files through this same `readFaceMetrics` and fails on any
 * difference. It cannot pass without reading them, so "were the metrics actually
 * read" is enforced there whether this block runs or not.
 *
 * That sentence was written before it was true, which is worth leaving on the
 * record. The gate needs `fontkit` as well as the font files, and it had neither
 * job that could supply both: the public-web job has the files and no fontkit,
 * `build-test` has fontkit (transitively, via pdfkit) and no files. It had never
 * passed in CI. `fontkit` is a devDependency of `public-web` now — F-46 — which
 * is what makes the division of labour above real rather than assumed.
 *
 * What is genuinely conditional is the Inter-versus-Arial assertion below: it
 * runs on a developer's machine and in any job that installs public-web, and it
 * does not run in `build-test`. It is a statement about why the fix exists
 * rather than about whether it works, so that placement is acceptable — the
 * behaviour it explains is pinned by the generator.
 */
const facesInstalled = (() => {
  try {
    mod.readFaceMetrics("inter");
    return true;
  } catch {
    return false;
  }
})();

const describeIfFaces = facesInstalled ? describe : describe.skip;

describeIfFaces("our own faces are read from the shipped files", () => {
  test.each(["archivo", "ibm-plex-sans", "inter", "jetbrains-mono"])(
    "%s reports real metrics",
    (id) => {
      const m = mod.readFaceMetrics(id);
      // Not asserting exact values: they are the vendor's and move with a
      // @fontsource bump, which is the whole reason they are read rather than
      // typed. What must hold is that they were actually read.
      expect(m.upm).toBeGreaterThan(0);
      expect(m.ascent).toBeGreaterThan(0);
      expect(m.descent).toBeLessThan(0);
      expect(m.xAvgCharWidth).toBeGreaterThan(0);
    },
  );

  test("Inter really is wider than Arial, which is the defect's cause", () => {
    // The whole bug in one assertion: Inter's average advance is meaningfully
    // wider than the substitute's, so text set in the fallback rewraps when
    // Inter lands. If this ever stops being true the fallback is unnecessary.
    const inter = mod.readFaceMetrics("inter");
    const arial = mod.FALLBACK_METRICS.sans;
    const ratio = (inter.xAvgCharWidth / inter.upm) / (arial.xAvgCharWidth / arial.upm);
    expect(ratio).toBeGreaterThan(1.02);
  });
});

/**
 * The verification, when the machine has a metric-compatible file.
 *
 * SKIPPED rather than passed when it does not: a check that silently succeeds
 * because its input is missing is F-27's "✓ all pairs clear their floor, 28
 * skipped" in another shape, and this suite would rather say nothing than say
 * the wrong thing. CI's container has the Liberation family.
 */
const targets = Object.entries(
  // Read lazily inside the block below; this is just the paths.
  {
    sans: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    mono: "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
  },
).filter(([, path]) => existsSync(path));

const describeIfFonts = targets.length ? describe : describe.skip;

describeIfFonts("the fallback table is pinned to a real font file", () => {
  test.each(targets)("%s matches %s", (key, path) => {
    const fontkit = require("fontkit");
    const f = fontkit.openSync(path);
    const table = mod.FALLBACK_METRICS[key];
    // Every number the generator divides by, checked against the file.
    expect({
      upm: table.upm,
      ascent: table.ascent,
      descent: table.descent,
      lineGap: table.lineGap,
      xAvgCharWidth: table.xAvgCharWidth,
    }).toEqual({
      upm: f.unitsPerEm,
      ascent: f.ascent,
      descent: f.descent,
      lineGap: f.lineGap,
      xAvgCharWidth: f["OS/2"].xAvgCharWidth,
    });
  });

  test("the first local() named is the family those metrics belong to", () => {
    // Liberation Sans is the metric-compatible substitute; Arial is the name a
    // visitor's machine actually has. Listing Arial first and measuring
    // Liberation Sans is only correct because the two are one metric family —
    // if that pairing is ever broken, this is the line to revisit.
    expect(mod.FALLBACK_METRICS.sans.locals[0]).toBe("Arial");
    expect(mod.FALLBACK_METRICS.sans.locals).toContain("Liberation Sans");
    expect(mod.FALLBACK_METRICS.mono.locals[0]).toBe("Courier New");
    expect(mod.FALLBACK_METRICS.mono.locals).toContain("Liberation Mono");
  });
});

/**
 * ── THE COPY IN public-web, PINNED TO THE REGISTRY THAT OWNS IT ───────────
 *
 * `public-web/src/lib/site-theme.ts` hardcodes the four `font-family` stacks
 * rather than calling `siteFontStack()`, because `public-web` does not depend on
 * `@praxis/shared` and D-1 spent real effort keeping it that way. A copy with no
 * check is a copy that drifts, and the drift is invisible: a stack naming a
 * family no `@font-face` declares falls silently through to the generic and
 * looks fine to anybody who has that font installed (F-11).
 *
 * The check lives HERE rather than in that app's own suite, and that placement
 * is the finding. The vitest version imported `@praxis/shared/design/site-fonts`
 * directly, which passed locally — the root workspace hoists the package into a
 * `node_modules` public-web can see — and failed in CI, where that app's job
 * installs only its own declared dependencies. Green by accident is worse than
 * red: it is a test asserting against a module the app does not have.
 *
 * At the repo root the package genuinely resolves, so this compares the real
 * `siteFontStack()` against the TEXT of the file holding the copy. Reading it as
 * text rather than importing it is what keeps a TypeScript module out of a jest
 * run, and it is enough: the thing being protected is a string literal.
 */
describe("the public site's font stacks match the shared registry", () => {
  const fonts = require("../../packages/shared/design/site-fonts");
  const source = readFileSync(
    join(__dirname, "..", "..", "public-web", "src", "lib", "site-theme.ts"),
    "utf8",
  );

  /** The `FONT_STACKS` object literal, as { id: stack }. */
  const copied = (() => {
    const block = source.match(/const FONT_STACKS: Record<string, string> = \{([\s\S]*?)\n\};/);
    if (!block) throw new Error("FONT_STACKS literal not found in site-theme.ts");
    const out = {};
    for (const m of block[1].matchAll(/"?([\w-]+)"?:\s*\n?\s*'([^']+)'/g)) out[m[1]] = m[2];
    return out;
  })();

  test("covers every id the registry names, and no other", () => {
    expect(Object.keys(copied).sort()).toEqual(
      Object.keys(fonts.SITE_FONT_FAMILIES).sort(),
    );
  });

  test("every copied stack is exactly what siteFontStack() produces", () => {
    for (const id of Object.keys(copied)) {
      const generic = id === "jetbrains-mono" ? "monospace" : "sans-serif";
      // Keyed by id in the assertion so a failure names the font rather than
      // reporting two long strings that differ somewhere.
      expect({ [id]: copied[id] }).toEqual({ [id]: fonts.siteFontStack(id, generic) });
    }
  });

  test("each stack names the metric-matched fallback between face and generic", () => {
    // The middle entry is the whole of O-12: a stack that goes straight to
    // `sans-serif` reflows on swap, which is the 0.184 CLS this closed.
    for (const [id, stack] of Object.entries(copied)) {
      expect({ [id]: stack }).toEqual({
        [id]: expect.stringContaining(`"${fonts.SITE_FONT_FAMILIES[id]} Fallback"`),
      });
    }
  });
});
