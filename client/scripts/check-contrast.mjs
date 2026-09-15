#!/usr/bin/env node
/**
 * Design-token contrast gate (audit F13; extended in Phase 5).
 *
 * Parses the real token values out of src/index.css and asserts every
 * text-on-surface pair clears WCAG 2.1 AA. Before Phase 1 six pairs failed —
 * most visibly `.micro` at 3.01:1, which is used 198 times across 54 files.
 *
 * ── WHAT PHASE 5 ADDED, AND THE HOLE IT CLOSED ──────────────────────────────
 *
 * Until now this gate measured status text against `--card`. A status pill does
 * not sit on `--card`. It sits on a TINTED GROUND — `.st-ok` is
 * `color: rgb(var(--ok))` over `background: rgb(var(--ok-fill) / 0.13)` — and
 * the audit said so in as many words: *"these pills pair the failing colour with
 * a tinted background, which is worse than the white-background figures above,
 * not better."* (F13.) The gate was measuring a pair that does not appear on
 * screen, and passing it.
 *
 * That is the same shape as the defect Addendum 6 found in production: a pill
 * whose ground came from one token and whose text came from another, "a contrast
 * pair nobody had measured because neither half was chosen against the other."
 * Twice now. So the pairs are no longer hand-listed at all — the `.st-*` rules
 * are PARSED OUT OF THE STYLESHEET and each one is measured as it is composited:
 * translucent ground over the real surface, translucent text over that. A pill
 * added tomorrow is measured without anyone remembering to add it here.
 *
 * Each pill is checked on BOTH surfaces it can land on — `--card` inside a table
 * or panel, `--background` on bare page — and in both themes. Eight pills × two
 * surfaces × two themes is 32 measurements nobody was going to hand-maintain.
 *
 * ── AAA WHERE IT PAYS ───────────────────────────────────────────────────────
 *
 * Phase 5's scope says "7:1 for body text, status pills and money figures". Body
 * text already clears it (15.4:1). Status pills do NOT and cannot: a pill's
 * value is that it is legible AND recognisably coloured, and 7:1 on a tinted
 * ground forces the tint to near-white or the ink to near-black, at which point
 * the tone stops carrying meaning and the pill is just text. So they are held to
 * AA as a HARD gate and reported against AAA as a target — which is the honest
 * version of "where it pays", rather than moving a threshold until it passes.
 *
 *   node scripts/check-contrast.mjs [--app client|public-web]
 *
 * Exit 0 = every pair clears its floor. Exit 1 = at least one regressed.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const repoRoot = join(clientRoot, "..");

/**
 * WHICH APP THIS RUN IS CHECKING — `--app <dir>`, defaulting to `client`.
 *
 * This is D-14's pattern applied to the gate D-14's own PR could not reach:
 * one copy with an argument rather than a second file. CLAUDE.md states the
 * reasoning for the ESLint rules directory — "a second copy of a gate is a gate
 * that drifts" — and the drift would be worse here than for the palette gate,
 * because what would diverge is the CONTRAST MATHS. The source-over
 * compositing, the sRGB linearisation and the pill parser are the substance of
 * the check, and a second copy that rounded one of them differently would
 * report two different ratios for the same pair of colours on two surfaces of
 * one product.
 *
 * Only the SCAN ROOT, the stylesheet and the per-app pair list are per-app.
 */
const APP = (() => {
  const i = process.argv.indexOf("--app");
  const value = i >= 0 ? process.argv[i + 1] : "client";
  if (!/^[a-z-]+$/.test(value || "")) {
    console.error(`✗ --app "${value}" is not an app directory name.`);
    process.exit(1);
  }
  return value;
})();

const appRoot = join(repoRoot, APP);
const cssPath = join(appRoot, "src", "index.css");
if (!existsSync(cssPath)) {
  console.error(`✗ no stylesheet at ${relative(repoRoot, cssPath)}`);
  process.exit(1);
}
const css = readFileSync(cssPath, "utf8");

/**
 * ── EVERY STYLESHEET, AND EVERY MATCHING BLOCK — O-13 ──────────────────────
 *
 * Two blind spots, one shape: this gate resolved tokens out of `index.css`, and
 * out of the FIRST `:root` it found there.
 *
 *   · A sibling sheet was invisible. `main.tsx` imports three, and a token
 *     declared in any of them resolved to nothing — which is the SKIP path this
 *     file already has a long note about, and skips are how the primary CTA
 *     (F-15) got measured as "token not found" beside a tick.
 *   · A SECOND block for the same selector was invisible. `public-web` has one:
 *     tokens are re-declared for a reader whose choice differs from the base.
 *     A token safe where it is first declared and unsafe where it is overridden
 *     read as safe.
 *
 * WHAT IS DELIBERATELY NOT MERGED: a block inside `@media (prefers-color-scheme:
 * …)`. Neither app resolves its theme from that query — `index.html` writes
 * `data-theme` before first paint precisely so the OS setting does not decide,
 * and `public-web`'s one such block is written `:root:not([data-theme="light"])`
 * to stay out of the way. Folding its values into the light palette would
 * measure a combination no visitor is ever served, and report a failure nobody
 * can reproduce — which costs a gate its credibility faster than a miss does.
 */
function stylesheets(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...stylesheets(full));
    else if (e.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** index.css LAST, because later declarations win and it is the app's own final
 *  sheet — the order `main.tsx` imports them in. */
const SHEETS = stylesheets(join(appRoot, "src"))
  .sort((a, b) => (a === cssPath ? 1 : b === cssPath ? -1 : a.localeCompare(b)))
  .map((file) => readFileSync(file, "utf8"));

/** Is the block that opens at `index` nested inside a colour-scheme query? */
function inColourSchemeQuery(source, index) {
  const before = source.slice(0, index);
  const opens = [];
  for (const m of before.matchAll(/@media[^{]*\{|\{|\}/g)) {
    if (m[0] === "}") opens.pop();
    else opens.push(m[0].startsWith("@media") ? m[0] : "");
  }
  return opens.some((o) => /prefers-color-scheme/.test(o));
}

/** WCAG 2.1: 4.5:1 for normal text, 3:1 for large (>=18.66px bold / 24px). */
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;
const AAA_NORMAL = 7.0;

/* ── token extraction ─────────────────────────────────────────────────────── */

/**
 * Body of a selector's block, brace-MATCHED rather than terminated by `\n}`.
 *
 * The old form searched for the first `\n}` after the selector, which is the
 * end of the block only when the block sits at column zero and contains no
 * nested rule. `client/src/index.css` happens to satisfy that; `public-web`'s
 * does not — its tokens live inside `@layer base { :root { … } }`, so every
 * declaration is indented and the block closes on `\n  }`. Pointed at that file
 * the old parser threw "Could not find :root", which at least fails loudly. The
 * dangerous version of the same bug is a stylesheet where some `\n}` DOES occur
 * early, and the gate silently measures a fraction of the tokens and passes.
 * Counting braces makes neither possible.
 *
 * `selector` is a regex source, and it may be one of SEVERAL selectors sharing
 * a block: `public-web` writes `.dark,\n  [data-theme="dark"] { … }`, which is
 * one rule the tokens belong to under either name.
 */
function block(selector) {
  const re = new RegExp(`(?:^|[,\\s])${selector}\\s*(?:,[^{}]*?)?\\{`, "gm");
  const bodies = [];
  for (const source of SHEETS) {
    for (const m of source.matchAll(re)) {
      if (inColourSchemeQuery(source, m.index)) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < source.length && depth > 0; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
      }
      if (depth !== 0) throw new Error(`Unbalanced braces after "${selector}"`);
      bodies.push(source.slice(start, i - 1));
    }
  }
  if (!bodies.length)
    throw new Error(
      `Could not find "${selector}" block in any ${APP}/src stylesheet`,
    );
  // Joined in cascade order, so a later re-declaration is the one measured.
  return bodies.join("\n");
}

const lightBody = block(":root");
const darkBody = block("\\.dark");

/**
 * ── THE IMPORTED TOKEN LAYER ───────────────────────────────────────────────
 *
 * `public-web/src/index.css` opens with `@import "@praxis/brand/tokens.css"`
 * and then REFERENCES what that file declares: `--hero: var(--brand-carbon)`,
 * `--primary-foreground: var(--brand-on-orange)`. A resolver that reads only
 * `index.css` follows those `var()`s to nothing.
 *
 * That is not a loud failure — it is the SKIP path again. The pair this gate
 * exists to protect, the primary CTA (F-15), was the single most important
 * measurement in the run and it was being reported as "token not found" beside
 * a tick. `client` has no `@import`, which is exactly why nobody noticed the
 * resolver could not follow one.
 *
 * Imports are resolved for the app's own workspace packages only — a
 * `node_modules` path or a URL is not followed, because a gate that reads a
 * third-party stylesheet is measuring somebody else's tokens.
 */
function importedBodies() {
  const out = { light: "", dark: "" };
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith("@praxis/")) continue;
    const file = join(repoRoot, "packages", spec.slice("@praxis/".length));
    if (!existsSync(file)) continue;
    const imported = readFileSync(file, "utf8");
    const sub = (selector) => {
      const re = new RegExp(`(?:^|[,\\s])${selector}\\s*(?:,[^{}]*?)?\\{`, "m");
      const hit = imported.match(re);
      if (!hit) return "";
      let depth = 1;
      let i = hit.index + hit[0].length;
      const start = i;
      for (; i < imported.length && depth > 0; i++) {
        if (imported[i] === "{") depth++;
        else if (imported[i] === "}") depth--;
      }
      return depth === 0 ? imported.slice(start, i - 1) : "";
    };
    out.light += sub(":root");
    out.dark += sub("\\.dark");
  }
  return out;
}

const imported = importedBodies();

/**
 * Raw declared text of a custom property, or null.
 *
 * The LAST declaration, not the first — `block()` now joins every matching rule
 * in cascade order, and the cascade's rule for two declarations of equal
 * specificity is that the later one wins. Reading the first was correct only
 * while exactly one rule could exist, and it is the half of O-13 that would
 * have made the widening useless: a bad override would have been collected and
 * then ignored, which is worse than not collecting it, because the gate would
 * report a measurement of a value nobody is served.
 */
function rawToken(body, name) {
  const all = [...body.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))];
  return all.length ? all[all.length - 1][1].trim() : null;
}

/**
 * Resolve a colour expression to `{ rgb: [r,g,b], a }`.
 *
 * Handles every shape index.css actually uses, and follows `var()` through as
 * many hops as the file has (`--primary-ink` → `--primary-ink-light` →
 * `rgb(190 86 14)`), because a gate that cannot see through an indirection is a
 * gate that silently stops checking the token someone refactored.
 *
 *   rgb(255 255 255)              → opaque
 *   rgb(16 30 52 / 0.09)          → translucent
 *   90 108 133                    → bare triplet (consumed as rgb(var(--x) / a))
 *   var(--card)                   → follow
 *   rgb(var(--ok-fill) / 0.13)    → follow, then apply the alpha
 */
function resolve(expr, body, depth = 0) {
  if (expr == null || depth > 6) return null;
  const s = String(expr).trim();

  // rgb(var(--x) / a)  |  rgb(var(--x))
  const wrapped = s.match(
    /^rgba?\(\s*var\(\s*(--[\w-]+)\s*\)\s*(?:\/\s*([\d.]+%?))?\s*\)$/,
  );
  if (wrapped) {
    const inner = resolve(lookup(wrapped[1].slice(2), body), body, depth + 1);
    if (!inner) return null;
    return { rgb: inner.rgb, a: inner.a * alpha(wrapped[2]) };
  }

  // var(--x)
  const bare = s.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (bare) return resolve(lookup(bare[1].slice(2), body), body, depth + 1);

  /*
   * #rgb | #rrggbb | #rrggbbaa
   *
   * `client/src/index.css` writes every token as `rgb(r g b)`, so this branch
   * was never needed and was never written. `public-web/src/index.css` writes
   * them as hex — `--background: #ffffff` — and without this the resolver
   * returns null for EVERY token in that file. That does not fail the run: it
   * takes the SKIP path, which prints "token not found" and passes. Twenty-eight
   * skips and a tick is what the first port of this gate produced, which is the
   * same failure shape as F-12 (a gate that passes by not looking) arriving
   * through a different door.
   *
   * So the branch is here, and `check-contrast.test.mjs` pins both notations
   * resolving to the same colour.
   */
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4)
      h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  // rgb(r g b [/ a])  |  rgb(r, g, b)  |  a bare "r g b" triplet
  const nums = s.match(
    /(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/,
  );
  if (!nums) return null;
  const slash = s.match(/\/\s*([\d.]+%?)\s*\)?$/);
  return {
    rgb: [Number(nums[1]), Number(nums[2]), Number(nums[3])],
    a: alpha(slash?.[1]),
  };
}

function alpha(v) {
  if (v == null) return 1;
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
}

/** A token's value in this theme, falling back to :root — which is how the
 *  file is written: `.dark` overrides only what changes. */
function lookup(name, body) {
  const inherited = body === darkBody ? imported.dark : "";
  return (
    rawToken(body, name) ??
    rawToken(lightBody, name) ??
    rawToken(inherited, name) ??
    rawToken(imported.light, name)
  );
}

const token = (body, name) => resolve(lookup(name, body), body);

/* ── compositing + contrast maths ─────────────────────────────────────────── */

/** Source-over: `layer` (with alpha) painted onto opaque `base`. */
function over(layer, base) {
  if (!layer) return base;
  const a = layer.a;
  return layer.rgb.map((c, i) => Math.round(c * a + base[i] * (1 - a)));
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/* ── the status pills, read from the stylesheet rather than hand-listed ───── */

/**
 * Every `.st-* { color: …; background: …; }` rule in index.css.
 *
 * Parsed rather than enumerated so a pill added tomorrow is measured without
 * anyone remembering this file exists. `.st-info` was itself an audit finding
 * (F12: referenced by the read-only scaffold and never defined), which is
 * precisely the kind of thing a hand-maintained list does not notice.
 */
function pillRules() {
  const out = [];
  const re = /\.(st-[\w-]+)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const body = m[2];
    const color = body.match(/(?:^|[\s;])color:\s*([^;]+);/)?.[1];
    const background = body.match(/(?:^|[\s;])background:\s*([^;]+);/)?.[1];
    if (color && background)
      out.push({
        name: m[1],
        color: color.trim(),
        background: background.trim(),
      });
  }
  return out;
}

/* ── the matrix ───────────────────────────────────────────────────────────── */

/** Plain text-on-opaque-surface pairs.
 *  [label, fg token, bg token, theme, min, optional fg opacity] */
const TEXT_PAIRS = [
  // The .micro caption — the audit's worst offender at 3.01:1 / 2.78:1.
  [".micro on --card (light)", "ink-3", "card", lightBody, AA_NORMAL],
  [
    ".micro on --background (light)",
    "ink-3",
    "background",
    lightBody,
    AA_NORMAL,
  ],
  [".micro on --card (dark)", "ink-3", "card", darkBody, AA_NORMAL],
  [".micro on --background (dark)", "ink-3", "background", darkBody, AA_NORMAL],
  // Secondary body text.
  [
    "--muted-foreground on --card (light)",
    "muted-foreground",
    "card",
    lightBody,
    AA_NORMAL,
  ],
  [
    "--muted-foreground on --card (dark)",
    "muted-foreground",
    "card",
    darkBody,
    AA_NORMAL,
  ],
  // Table column headings sit on --secondary.
  [
    "TH label on --secondary (light)",
    "muted-foreground",
    "secondary",
    lightBody,
    AA_NORMAL,
  ],
  [
    "TH label on --secondary (dark)",
    "muted-foreground",
    "secondary",
    darkBody,
    AA_NORMAL,
  ],
  // Status text on a PLAIN surface — a ledger figure or a metric, not a pill.
  /*
   * ── THE PRIMARY CTA, IN BOTH APPS ────────────────────────────────────────
   *
   * The most-clicked colour pair in the product, and it was measured in
   * `public-web` only. `client/src/index.css` declared
   * `--primary-foreground: rgb(255 255 255)` over `--primary: rgb(245 130 31)`
   * — **2.59:1**, the very number this file's own section-3 comment quotes as
   * the reason the ink tokens exist, and worse than the 3.13:1 F-15 removed
   * from `public-web`. Being the PRE-THEME default made it what every tenant
   * who never set `primary_foreground` actually rendered, on every primary
   * button in the ERP.
   *
   * F-20 recorded it and declined it: the fix changes the appearance of every
   * primary button, which is an ERP-wide restyle and did not belong in a
   * `public-web` PR. It is fixed now — carbon, 7.63:1, which `@praxis/brand`,
   * `packages/shared/design/palette.js` and CLAUDE.md all already said.
   *
   * The pair moved from `public-web`'s own list to this shared one in the same
   * change, which is the part that lasts: the reason it shipped at all is that
   * nothing measured it in the app where it was wrong.
   */
  ["--primary-foreground on --primary (light)", "primary-foreground", "primary", lightBody, AA_NORMAL],
  ["--primary-foreground on --primary (dark)", "primary-foreground", "primary", darkBody, AA_NORMAL],
  ["--ok text on --card (light)", "ok", "card", lightBody, AA_NORMAL],
  ["--warn text on --card (light)", "warn", "card", lightBody, AA_NORMAL],
  ["--bad text on --card (light)", "bad", "card", lightBody, AA_NORMAL],
  ["--ok text on --card (dark)", "ok", "card", darkBody, AA_NORMAL],
  ["--warn text on --card (dark)", "warn", "card", darkBody, AA_NORMAL],
  ["--bad text on --card (dark)", "bad", "card", darkBody, AA_NORMAL],
  // Accent as TEXT must use --primary-ink, never --primary.
  [
    "--primary-ink on --card (light)",
    "primary-ink",
    "card",
    lightBody,
    AA_NORMAL,
  ],
  [
    "--primary-ink on --card (dark)",
    "primary-ink",
    "card",
    darkBody,
    AA_NORMAL,
  ],
  /*
   * MONEY FIGURES, held to AAA (Phase 5). `.num` money is `--foreground` on
   * --card or --background, and it is the text in this product where a misread
   * has a cost measured in currency. It already clears 7:1, so this locks in a
   * property rather than requesting one.
   */
  [
    "money/body --foreground on --card (light)",
    "foreground",
    "card",
    lightBody,
    AAA_NORMAL,
  ],
  [
    "money/body --foreground on --card (dark)",
    "foreground",
    "card",
    darkBody,
    AAA_NORMAL,
  ],
  [
    "--foreground on --background (light)",
    "foreground",
    "background",
    lightBody,
    AAA_NORMAL,
  ],
  [
    "--foreground on --background (dark)",
    "foreground",
    "background",
    darkBody,
    AAA_NORMAL,
  ],
];

/**
 * ── PAIRS THAT EXIST ON ONE SURFACE ONLY ──────────────────────────────────
 *
 * The list above is every pair both apps draw. These are the ones an app has
 * of its own, and they are declared per app rather than left to the SKIP path,
 * because a skip is a silent pass: `public-web`'s whole hero band would have
 * been "token not found" four times over and the run would still have printed
 * a tick.
 *
 * `public-web`'s entries are the dark marketing plate — the band every page in
 * that app now opens with (guide §8), which is the reason this gate was
 * finally ported. F-15 is what an unmeasured band costs: white on
 * `#FF5A00` at 3.13:1 shipped on the LCP path of every page for months, with
 * three separate places in the tree already saying it should be carbon.
 */
const APP_PAIRS = {
  client: [
    /*
     * ── THE CHAT BUBBLE, WHICH IS A GROUND ONE COMPONENT PAINTS AND ANOTHER
     *    WRITES ON ────────────────────────────────────────────────────────────
     *
     * `message-bubble.tsx` draws the sender's own messages `bg-primary`, and
     * everything rendered inside inherits that ground: the timestamp and
     * delivery ticks it draws itself, and — through `<Attachments>` — a voice
     * note's status lines, its transcript controls and "Saved to the vault".
     *
     * Those were `--muted-foreground`, the token for secondary text on a
     * SURFACE. On the brand fill it is 2.39:1 in light and **1.01:1 in dark**:
     * not low contrast, invisible, and it shipped past a green run of this file
     * because the ground came from one component and the ink from another and
     * nothing paired them. Section 4 below derives pairs from class lists and
     * still cannot see this one, because the two halves are in two files. So it
     * is written down, which is what the hand-listed matrix is for.
     *
     * The two steps are the two the bubble actually uses: /80 for a status
     * sentence, /70 for the timestamp row.
     */
    ["bubble status: --primary-foreground/80 on --primary (light)", "primary-foreground", "primary", lightBody, AA_NORMAL, 0.8],
    ["bubble status: --primary-foreground/80 on --primary (dark)", "primary-foreground", "primary", darkBody, AA_NORMAL, 0.8],
    ["bubble meta: --primary-foreground/70 on --primary (light)", "primary-foreground", "primary", lightBody, AA_NORMAL, 0.7],
    ["bubble meta: --primary-foreground/70 on --primary (dark)", "primary-foreground", "primary", darkBody, AA_NORMAL, 0.7],
  ],
  "public-web": [
    // The hero plate. `--hero` is its own ground token, not `--card`.
    ["--hero-foreground on --hero (light)", "hero-foreground", "hero", lightBody, AA_NORMAL],
    ["--hero-foreground on --hero (dark)", "hero-foreground", "hero", darkBody, AA_NORMAL],
    ["--hero-muted on --hero (light)", "hero-muted", "hero", lightBody, AA_NORMAL],
    ["--hero-muted on --hero (dark)", "hero-muted", "hero", darkBody, AA_NORMAL],
    /*
     * THE EYEBROW, WHICH IS THE ONE THAT INVERTS.
     *
     * On a light ground accent-as-text must be `--primary-ink` (the whole point
     * of the ink step-down). On the hero's carbon it is the opposite way round:
     * `--primary-ink` is ~3.4:1 there and the brand fill itself is 6.33:1. That
     * asymmetry is a property of the colour, and `hero.tsx` documents it — so it
     * is measured here rather than trusted, because it is the one place in
     * either app where naming the FILL token in a text position is correct.
     */
    ["--brand-orange as eyebrow on --hero (light)", "brand-orange", "hero", lightBody, AA_NORMAL],
    ["--brand-orange as eyebrow on --hero (dark)", "brand-orange", "hero", darkBody, AA_NORMAL],
    /*
     * ── THE FOUR MODES ON THE HERO PLATE, AT THE NON-TEXT FLOOR ───────────
     *
     * §8.2 lights each service's entrance with its own mode. These pin that the
     * light is legible as a NON-TEXT affordance — WCAG 1.4.11's 3:1 — and they
     * are held to 3:1 rather than 4.5:1 because that is what they are: the wash
     * in `.band-service`'s gradient and the rule under it, never type.
     *
     * The distinction is load-bearing and it was nearly got wrong. The first
     * draft of that band painted the service's identity CODE in its mode
     * colour, 11px on carbon, which is type and is held to 4.5:1. Measured:
     * sea 5.17, air 6.33, road 6.57 — and **rail 3.68**, a live AA failure on
     * exactly one of the four service kinds. Three of the four screenshots
     * would have looked right. The code is `--hero-foreground` now (17:1) and
     * these four stay at the floor they actually have to clear.
     */
    ["--mode-sea on --hero, non-text (light)", "mode-sea", "hero", lightBody, AA_LARGE],
    ["--mode-air on --hero, non-text (light)", "mode-air", "hero", lightBody, AA_LARGE],
    ["--mode-road on --hero, non-text (light)", "mode-road", "hero", lightBody, AA_LARGE],
    ["--mode-rail on --hero, non-text (light)", "mode-rail", "hero", lightBody, AA_LARGE],
    ["--mode-sea on --hero, non-text (dark)", "mode-sea", "hero", darkBody, AA_LARGE],
    ["--mode-air on --hero, non-text (dark)", "mode-air", "hero", darkBody, AA_LARGE],
    ["--mode-road on --hero, non-text (dark)", "mode-road", "hero", darkBody, AA_LARGE],
    ["--mode-rail on --hero, non-text (dark)", "mode-rail", "hero", darkBody, AA_LARGE],
  ],
};

for (const pair of APP_PAIRS[APP] || []) TEXT_PAIRS.push(pair);

const THEMES = [
  ["light", lightBody],
  ["dark", darkBody],
];
const SURFACES = ["card", "background"];

let failed = 0;
let skipped = 0;
const aaaMisses = [];

console.warn(
  "\nDesign-token contrast — WCAG 2.1 AA floor, AAA where it pays\n",
);

/* 1. plain text on opaque surfaces */
console.warn("  Text on surface");
for (const [label, fgName, bgName, body, min, fgOpacity] of TEXT_PAIRS) {
  const declared = token(body, fgName);
  const bg = token(body, bgName);
  if (!declared || !bg) {
    console.warn(
      `    SKIP  ${label} — token not found (${!declared ? fgName : bgName})`,
    );
    skipped++;
    continue;
  }
  // The opacity a CALL SITE applies (`text-primary-foreground/80`) multiplies
  // the token's own alpha. Measuring the pair without it measures a colour the
  // screen never shows — and the /80 and /70 steps are where a pair that
  // passes at full strength stops passing.
  const fg = fgOpacity == null ? declared : { rgb: declared.rgb, a: declared.a * fgOpacity };
  // A translucent foreground (e.g. rgb(var(--ink) / 0.72)) is what the eye sees
  // composited, not what the declaration says.
  const ratio = contrast(over(fg, bg.rgb), bg.rgb);
  const ok = ratio >= min;
  if (!ok) failed++;
  console.warn(
    `    ${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`,
  );
}

/*
 * 2. status pills, composited.
 *
 * The pill's ground is a translucent tint over the surface; its text is then
 * measured against THAT, not against the surface. This is the pairing the audit
 * flagged as "worse than the white-background figures" and which nothing was
 * measuring.
 */
const pills = pillRules();
console.warn(
  `\n  Status pills — text on its own tinted ground (${pills.length} rules, parsed from index.css)`,
);
if (pills.length === 0) {
  console.error(
    "    FAIL  no .st-* rules found — the parser or the stylesheet changed shape.",
  );
  failed++;
}
for (const [themeName, body] of THEMES) {
  for (const surfaceName of SURFACES) {
    const surface = token(body, surfaceName);
    if (!surface) continue;
    for (const p of pills) {
      const ink = resolve(p.color, body);
      const tint = resolve(p.background, body);
      if (!ink || !tint) {
        console.warn(
          `    SKIP  .${p.name} (${themeName}/${surfaceName}) — could not resolve`,
        );
        skipped++;
        continue;
      }
      const ground = over(tint, surface.rgb);
      const ratio = contrast(over(ink, ground), ground);
      const ok = ratio >= AA_NORMAL;
      if (!ok) failed++;
      else if (ratio < AAA_NORMAL)
        aaaMisses.push(
          `.${p.name} on --${surfaceName} (${themeName}) ${ratio.toFixed(2)}:1`,
        );
      console.warn(
        `    ${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${AA_NORMAL})  .${p.name} on --${surfaceName} (${themeName})`,
      );
    }
  }
}

/*
 * 3. FILL TOKENS USED AS TYPE.
 *
 * The token layer already splits ink from fill — `--primary` vs `--primary-ink`,
 * `--ok` vs `--ok-fill` — because the audit measured `--primary` as text at
 * 2.59:1 and Phase 1 created the type-safe value to replace it. What nothing
 * checked was whether the CALL SITES actually used it, and 38 files did not:
 * `text-primary` is what Tailwind's `primary.DEFAULT` makes the natural
 * spelling, it is shorter than `text-primary-ink`, and it renders a colour that
 * looks brand-correct. Exactly Addendum 7's lesson about the raw palette — the
 * wrong thing was easier to type than the right one.
 *
 * A ratio check over tokens could never have caught this: every token in the
 * matrix above was passing. The defect was which token the JSX reached for.
 * Regex over the source is the right instrument, for the same reason the palette
 * gate is a script rather than a lint rule.
 */
const INK_FOR = {
  primary: "text-primary-ink",
  "brand-blue": "text-brand-blue-ink",
  "brand-orange": "text-primary-ink",
  "ok-fill": "text-ok",
  "warn-fill": "text-warn",
  "bad-fill": "text-bad",
};

/**
 * ── THE ONE GROUND WHERE THIS RULE INVERTS, AND HOW IT IS DECLARED ─────────
 *
 * On `public-web`'s dark marketing plate `--brand-orange` is the CORRECT text
 * colour: 6.44:1 there, against `--primary-ink`'s ~3.4:1. On every light ground
 * the ordinary rule still holds and the fill is 3.13:1. So the exception is
 * real, it is narrow, and it is per-LINE — `SectionHead` and `BadgePill` each
 * carry both branches of one ternary, and the light branch is precisely where a
 * defect would live.
 *
 * A file-level allowance cannot express that, and NOR CAN A CONTEXT WINDOW.
 * The first version of this looked for `onDark` on the violating line or the
 * four above it, which reads sensibly and is wrong: in
 *
 *     onDark
 *       ? "… text-[rgb(var(--brand-orange))]"     ← correct, 6.44:1
 *       : "… text-[var(--primary-ink)]"           ← the light branch
 *
 * the window sees `onDark` from BOTH branches, so swapping the light branch to
 * the fill was excused. That was proved rather than reasoned: the deliberate
 * violation exited 0 when it had to exit 1.
 *
 * So the exception is an EXPLICIT MARKER on the violating line, with a reason —
 * the same shape as the `praxis/no-native-dialogs` escape hatch CLAUDE.md
 * describes, and for the same reason: an exception a reviewer can see beats one
 * a heuristic infers. It is read from the RAW line, before comments are
 * stripped, and an empty reason does not count.
 *
 *     cn(onDark && "text-[rgb(var(--brand-orange))]") // ink-on-dark: 6.44:1 on --hero
 */
const ON_DARK_MARKER = /ink-on-dark:\s*\S[^\n]{7,}/;

/** Whole files exempt, which is only ever this gate's own tables. */
const INK_ALLOW = {
  client: ["scripts/check-contrast.mjs"],
  "public-web": ["scripts/check-contrast.mjs"],
};

function stripComments(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return blanked
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line))
    .join("\n");
}

/** Tracked AND new-but-not-ignored — a brand-new component is the likeliest
 *  place for a fresh violation, and `git ls-files` alone would not see it. */
function sources() {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      `${APP}/src`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .filter((f) => existsSync(join(repoRoot, f)));
}

const names = Object.keys(INK_FOR).join("|");
const INK_RE = new RegExp(
  // text-primary / hover:text-brand-blue — but never text-primary-ink or
  // text-primary-foreground, which are different tokens entirely.
  String.raw`(?:^|[\s"'\`:])(?:[a-z-]+:)?text-(${names})\b(?!-(?:ink|foreground|fill))` +
    // …or the arbitrary form: text-[rgb(var(--primary))], text-[var(--primary)]
    String.raw`|text-\[[^\]]*var\(--(${names})\)[^\]]*\]`,
  "g",
);

const inkViolations = [];
for (const file of sources()) {
  const rel = relative(APP, file).replace(/\\/g, "/");
  if ((INK_ALLOW[APP] || []).includes(rel)) continue;
  const source = readFileSync(join(repoRoot, file), "utf8");
  /* Markers are read from the RAW text and violations from the stripped text,
     because `stripComments` would otherwise erase the very marker that excuses
     the line it is on. */
  const raw = source.split("\n");
  const text = stripComments(source);
  const lines = text.split("\n");
  /*
   * The allowance is matched against the violating line AND the four above it.
   *
   * Every dark-ground use in this app is the true branch of a JSX conditional,
   * and the condition is written on its own line above the string:
   *
   *     onDark
   *       ? "… text-[rgb(var(--brand-orange))]"
   *       : "… text-[var(--primary-ink)]"
   *
   * so a matcher that only saw the violating line would never see `onDark`.
   * Four lines is the widest such expression in the tree (the portal band's
   * `<Link>`, whose ground token is set on the wrapping `<p>`), and keeping the
   * window small is what stops an allowance drifting onto an unrelated line
   * further down the same file.
   */
  lines.forEach((line, i) => {
    if (ON_DARK_MARKER.test(raw[i] || "")) return;
    for (const hit of line.matchAll(INK_RE)) {
      const tokenName = hit[1] ?? hit[2];
      inkViolations.push({
        file: rel,
        line: i + 1,
        token: tokenName,
        src: line.trim().slice(0, 110),
      });
    }
  });
}

console.warn(`\n  Fill tokens used as type — ${inkViolations.length} site(s)`);
if (inkViolations.length) {
  failed += inkViolations.length;
  console.error("");
  for (const v of inkViolations) {
    console.error(
      `    ${v.file}:${v.line}  text-${v.token}  →  use ${INK_FOR[v.token]}`,
    );
    console.error(`      ${v.src}`);
  }
  console.error(
    "\n    These are FILL colours. As type they are the audit's F13 failure:\n" +
      "    --primary measures 2.59:1 on --card. The -ink variants exist for\n" +
      "    exactly this and are token-for-token brand-identical.\n",
  );
} else {
  console.warn("    none — every foreground uses an ink token.");
}

/*
 * 4. THE PAIRS THE JSX ACTUALLY DRAWS — derived, not listed.
 *
 * ── THE HOLE THIS CLOSES, AND THE HALF IT CANNOT ──────────────────────────
 *
 * A voice note drawn on the sender's own bubble printed its status lines in
 * `--muted-foreground`. That bubble is `bg-primary`. The pair measures 2.39:1
 * in light and **1.01:1 in dark** — not "low contrast", invisible — and it
 * shipped past a green run of this file, because every pair above is a pair
 * somebody thought to write down, and nobody writes down a combination they do
 * not know exists.
 *
 * That is the third time in this file's history (F13's pills, Addendum 6's
 * badge, now this): "a contrast pair nobody had measured because neither half
 * was chosen against the other." Section 2 answered it for the status pills by
 * PARSING them out of the stylesheet instead of enumerating them. This is the
 * same answer for the class lists: every string literal in the app that looks
 * like a Tailwind class list and names both a ground and an ink is measured as
 * the pair it paints, in both themes, whether or not anyone remembered it.
 *
 * WHAT IT CANNOT SEE, stated plainly rather than implied by silence: the
 * defect above was CROSS-COMPONENT. `message-bubble.tsx` painted the ground
 * and `voice-note.tsx` chose the ink, and no regex over one file can pair
 * them. The structural fix for that is the `tone` prop those two now pass, and
 * it is pinned where a rendered tree can be inspected — see "does not draw
 * surface-ink text on the brand fill" in `features/comms/chat/chat.test.tsx`.
 * This section catches the same mistake made in ONE class list, which is the
 * form it takes the rest of the time.
 *
 * ── WHY ONLY QUOTED, SINGLE-LINE LITERALS ─────────────────────────────────
 *
 * A class list is a quoted string on one line: `cn("rounded bg-primary …")`,
 * and each branch of a `cond ? "…" : "…"` is its own literal, which is exactly
 * the granularity wanted — the false branch's `bg-muted text-muted-foreground`
 * must not be measured against the true branch's `bg-primary`. Template
 * literals are deliberately skipped: their static segments carry no `bg-`
 * worth pairing in this tree, and their interpolations ARE the quoted branches,
 * already measured. The `CLASS_LIST` shape test is what keeps prose out — a
 * sentence in a comment or a user-facing string can contain "bg-" and means
 * nothing.
 */
const CLASS_LIST = /^[\w\s:/[\]().,%#+&>-]*$/;

/**
 * ── THE ONE EXEMPTION, AND WHY IT IS A WRITTEN MARKER ─────────────────────
 *
 * WCAG 2.1 §1.4.3 exempts "text that is part of an inactive user interface
 * component" outright — a disabled control is SUPPOSED to be quieter than a
 * live one, and holding its label to 4.5:1 would force the disabled state to
 * look enabled, which is a worse outcome for the same user.
 *
 * It is a marker on the line rather than an allow-list of files, for the
 * reason `ON_DARK_MARKER` above states at length: an exception a reviewer can
 * see beats one a heuristic infers, and a file-level allowance cannot say
 * WHICH branch of a ternary it excuses when the enabled branch is the line
 * above. The reason is required and an empty one does not count.
 *
 *     : "bg-muted text-muted-foreground/60", // contrast-exempt: disabled control
 */
const CONTRAST_EXEMPT = /contrast-exempt:\s*\S[^\n]{5,}/;
/**
 * Unprefixed only. `hover:bg-x` changes the ground for a state whose ink is a
 * separate question, and pairing the two is how a gate starts reporting
 * combinations nobody paints.
 *
 * BOTH opacity notations are captured — `/70` and the arbitrary `/[0.06]` —
 * and missing the second is not a detail: a regex that reads
 * `bg-white/[0.04] … text-white` as OPAQUE white under white reports 1.00:1
 * on a glass panel that is perfectly legible. Six of this section's first
 * fourteen "failures" were that, which is how a gate loses its reader.
 */
const OPACITY = String.raw`(?:\/(?:(\d{1,3})|\[([\d.]+)\]))?`;
const GROUND_RE = new RegExp(String.raw`(?<![\w:/-])bg-([a-z][a-z0-9-]*)${OPACITY}(?![\w-])`, "g");
const INK_TEXT_RE = new RegExp(String.raw`(?<![\w:/-])text-([a-z][a-z0-9-]*)${OPACITY}(?![\w-])`, "g");

/** `/70` → 0.7, `/[0.06]` → 0.06, absent → null (leave the token's own alpha). */
function modifier(percent, fraction) {
  if (percent != null) return Number(percent) / 100;
  if (fraction != null) return Number(fraction);
  return null;
}

/** The two raw colours Tailwind ships that are not tokens and are still real
 *  ink. Everything else must resolve to a token or it is not a colour at all
 *  (`text-sm`, `text-right`, `bg-transparent`). */
const RAW = { white: [255, 255, 255], black: [0, 0, 0] };

/** A class's colour in this theme, with its opacity modifier applied. */
function classColour(name, opacity, body) {
  const base = RAW[name] ? { rgb: RAW[name], a: 1 } : token(body, name);
  if (!base) return null;
  return { rgb: base.rgb, a: opacity == null ? base.a : base.a * opacity };
}

/** Every (ground, ink) pair a class-list literal paints, with where it is. */
function drawnPairs() {
  const out = [];
  for (const file of sources()) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = readFileSync(join(repoRoot, file), "utf8");
    const rawLines = source.split("\n");
    for (const m of source.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
      const lit = m[1] ?? m[2] ?? "";
      if (!lit.includes("bg-") || !CLASS_LIST.test(lit)) continue;
      const grounds = [...lit.matchAll(GROUND_RE)];
      const inks = [...lit.matchAll(INK_TEXT_RE)];
      if (!grounds.length || !inks.length) continue;
      const line = source.slice(0, m.index).split("\n").length;
      /*
       * Read from the RAW text — the marker IS a comment, so stripping first
       * would erase the very thing being looked for — and matched against the
       * class list's line AND the four above it, because a reason worth giving
       * rarely fits after a string in a `cn()` call. Four is the same window
       * `ON_DARK_MARKER` uses, and keeping it small is what stops a marker
       * drifting onto an unrelated line further down.
       */
      const window = rawLines.slice(Math.max(0, line - 5), line).join("\n");
      if (CONTRAST_EXEMPT.test(window)) continue;
      for (const g of grounds) {
        for (const i of inks) {
          out.push({
            file: relative(APP, file).replace(/\\/g, "/"),
            line,
            ground: g[1],
            groundAlpha: modifier(g[2], g[3]),
            ink: i[1],
            inkAlpha: modifier(i[2], i[3]),
          });
        }
      }
    }
  }
  return out;
}

const drawn = drawnPairs();
/** Deduplicated by what is painted, so one pair used in ninety files is one
 *  measurement and one line of output. The sites are kept for the report. */
const drawnByPair = new Map();
for (const d of drawn) {
  const key = `bg-${d.ground}${d.groundAlpha == null ? "" : `/${d.groundAlpha}`} + text-${d.ink}${d.inkAlpha == null ? "" : `/${d.inkAlpha}`}`;
  if (!drawnByPair.has(key)) drawnByPair.set(key, { ...d, sites: [] });
  drawnByPair.get(key).sites.push(`${d.file}:${d.line}`);
}

let drawnMeasured = 0;
const drawnFailures = [];
for (const [key, d] of drawnByPair) {
  for (const [themeName, body] of THEMES) {
    const ink = classColour(d.ink, d.inkAlpha, body);
    const groundColour = classColour(d.ground, d.groundAlpha, body);
    // Not a colour pair at all (`text-sm`, `bg-transparent`, an arbitrary
    // value). Silently skipped and NOT counted as a skip: unlike the hand-
    // listed matrix, where an unresolvable token means the list is stale, here
    // it means the regex matched a utility that was never a colour.
    if (!ink || !groundColour) continue;
    /*
     * ── ONLY AN OPAQUE GROUND IS MEASURED, AND THAT IS NOT LAZINESS ────────
     *
     * A translucent ground is a tint over a surface this line does not name.
     * `pin-input.tsx` paints `bg-white/[0.04]` — over `--card` that is white on
     * white and over the auth screen's photographic plate, where it actually
     * lives, it is a glass chip that reads perfectly. Assuming `--card` would
     * report a failure nobody can reproduce, which costs a gate its credibility
     * faster than a miss does (this file's own words, about the deliberately
     * unmerged `prefers-color-scheme` block).
     *
     * The tinted case is not unmeasured everywhere: section 2 composites every
     * `.st-*` pill over BOTH surfaces, because a pill's ground IS declared in
     * the stylesheet. What cannot be read off a class list is left alone.
     */
    if (groundColour.a < 1) continue;
    const ground = groundColour.rgb;
    const ratio = contrast(over(ink, ground), ground);
    drawnMeasured++;
    if (ratio < AA_NORMAL) {
      drawnFailures.push({ key, themeName, ratio, sites: d.sites });
    }
  }
}

console.warn(
  `\n  Pairs the JSX draws — ${drawnByPair.size} distinct class pairing(s), ${drawnMeasured} measurement(s)`,
);
if (drawnFailures.length) {
  failed += drawnFailures.length;
  console.error("");
  for (const f of drawnFailures) {
    console.error(`    FAIL  ${f.ratio.toFixed(2).padStart(5)}:1  (min ${AA_NORMAL})  ${f.key} (${f.themeName})`);
    for (const site of f.sites.slice(0, 6)) console.error(`      ${site}`);
    if (f.sites.length > 6) console.error(`      …and ${f.sites.length - 6} more`);
  }
  console.error(
    "\n    An ink token chosen for one ground and painted on another. The ground\n" +
      "    is in the same class list as the ink, so this is readable from the\n" +
      "    line itself — pick the ink that belongs to the ground, or move the\n" +
      "    text off the fill.\n",
  );
} else {
  console.warn("    none — every ground/ink pairing in a class list clears AA.");
}

/* ── report ───────────────────────────────────────────────────────────────── */

if (aaaMisses.length) {
  console.warn(
    `\n  AAA target (7:1) not met by ${aaaMisses.length} pill measurement(s). Not a failure:\n` +
      "  a pill's value is being legible AND recognisably coloured, and 7:1 on a\n" +
      "  tinted ground drives the tint to near-white or the ink to near-black,\n" +
      "  at which point the tone stops carrying meaning. AA is the gate here.",
  );
}

/*
 * ── A SKIP IS A FAILURE, NOT A FOOTNOTE ───────────────────────────────────
 *
 * This used to print `✓ All pairs clear their floor, 28 skipped` and exit 0.
 * Twenty-eight was every pair in the matrix: the resolver could not read
 * `public-web`'s hex tokens, so it measured NOTHING and said so in a tick. That
 * is F-12's failure with a different cause — a gate that passes by not looking —
 * and it is the reason this exit path changed rather than only the resolver.
 *
 * A skip means a token in the pair list did not resolve. There is no benign
 * version of that: either the token was renamed (the pair list is stale) or the
 * resolver cannot read the notation (the gate is broken). Both need a human,
 * and neither is "all pairs clear their floor".
 */
if (skipped) {
  console.error(
    `\n✗ ${skipped} pair(s) could not be measured.\n` +
      "  A pair that cannot be resolved is not a pair that passed. Either the\n" +
      "  token was renamed — fix the list — or the resolver cannot read how it\n" +
      "  is written, which is a hole in this gate and not in the design.\n",
  );
  process.exit(1);
}
if (failed) {
  console.error(`\n✗ ${failed} contrast pair(s) below threshold.\n`);
  process.exit(1);
}
console.warn("\n✓ All pairs clear their floor.\n");
