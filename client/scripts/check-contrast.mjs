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
 *   node scripts/check-contrast.mjs
 *
 * Exit 0 = every pair clears its floor. Exit 1 = at least one regressed.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const css = readFileSync(join(here, "..", "src", "index.css"), "utf8");

/** WCAG 2.1: 4.5:1 for normal text, 3:1 for large (>=18.66px bold / 24px). */
const AA_NORMAL = 4.5;
const AAA_NORMAL = 7.0;

/* ── token extraction ─────────────────────────────────────────────────────── */

/** Body of a top-level selector block (`:root` / `.dark`). */
function block(selector) {
  const m = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`Could not find "${selector}" block in index.css`);
  return m[1];
}

const lightBody = block(":root");
const darkBody = block("\\.dark");

/** Raw declared text of a custom property, or null. */
function rawToken(body, name) {
  const m = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
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
  const wrapped = s.match(/^rgba?\(\s*var\(\s*(--[\w-]+)\s*\)\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
  if (wrapped) {
    const inner = resolve(lookup(wrapped[1].slice(2), body), body, depth + 1);
    if (!inner) return null;
    return { rgb: inner.rgb, a: inner.a * alpha(wrapped[2]) };
  }

  // var(--x)
  const bare = s.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (bare) return resolve(lookup(bare[1].slice(2), body), body, depth + 1);

  // rgb(r g b [/ a])  |  rgb(r, g, b)  |  a bare "r g b" triplet
  const nums = s.match(/(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/);
  if (!nums) return null;
  const slash = s.match(/\/\s*([\d.]+%?)\s*\)?$/);
  return { rgb: [Number(nums[1]), Number(nums[2]), Number(nums[3])], a: alpha(slash?.[1]) };
}

function alpha(v) {
  if (v == null) return 1;
  return v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
}

/** A token's value in this theme, falling back to :root — which is how the
 *  file is written: `.dark` overrides only what changes. */
function lookup(name, body) {
  return rawToken(body, name) ?? rawToken(lightBody, name);
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
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
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
    if (color && background) out.push({ name: m[1], color: color.trim(), background: background.trim() });
  }
  return out;
}

/* ── the matrix ───────────────────────────────────────────────────────────── */

/** Plain text-on-opaque-surface pairs. [label, fg token, bg token, theme, min] */
const TEXT_PAIRS = [
  // The .micro caption — the audit's worst offender at 3.01:1 / 2.78:1.
  [".micro on --card (light)", "ink-3", "card", lightBody, AA_NORMAL],
  [".micro on --background (light)", "ink-3", "background", lightBody, AA_NORMAL],
  [".micro on --card (dark)", "ink-3", "card", darkBody, AA_NORMAL],
  [".micro on --background (dark)", "ink-3", "background", darkBody, AA_NORMAL],
  // Secondary body text.
  ["--muted-foreground on --card (light)", "muted-foreground", "card", lightBody, AA_NORMAL],
  ["--muted-foreground on --card (dark)", "muted-foreground", "card", darkBody, AA_NORMAL],
  // Table column headings sit on --secondary.
  ["TH label on --secondary (light)", "muted-foreground", "secondary", lightBody, AA_NORMAL],
  ["TH label on --secondary (dark)", "muted-foreground", "secondary", darkBody, AA_NORMAL],
  // Status text on a PLAIN surface — a ledger figure or a metric, not a pill.
  ["--ok text on --card (light)", "ok", "card", lightBody, AA_NORMAL],
  ["--warn text on --card (light)", "warn", "card", lightBody, AA_NORMAL],
  ["--bad text on --card (light)", "bad", "card", lightBody, AA_NORMAL],
  ["--ok text on --card (dark)", "ok", "card", darkBody, AA_NORMAL],
  ["--warn text on --card (dark)", "warn", "card", darkBody, AA_NORMAL],
  ["--bad text on --card (dark)", "bad", "card", darkBody, AA_NORMAL],
  // Accent as TEXT must use --primary-ink, never --primary.
  ["--primary-ink on --card (light)", "primary-ink", "card", lightBody, AA_NORMAL],
  ["--primary-ink on --card (dark)", "primary-ink", "card", darkBody, AA_NORMAL],
  /*
   * MONEY FIGURES, held to AAA (Phase 5). `.num` money is `--foreground` on
   * --card or --background, and it is the text in this product where a misread
   * has a cost measured in currency. It already clears 7:1, so this locks in a
   * property rather than requesting one.
   */
  ["money/body --foreground on --card (light)", "foreground", "card", lightBody, AAA_NORMAL],
  ["money/body --foreground on --card (dark)", "foreground", "card", darkBody, AAA_NORMAL],
  ["--foreground on --background (light)", "foreground", "background", lightBody, AAA_NORMAL],
  ["--foreground on --background (dark)", "foreground", "background", darkBody, AAA_NORMAL],
];

const THEMES = [
  ["light", lightBody],
  ["dark", darkBody],
];
const SURFACES = ["card", "background"];

let failed = 0;
let skipped = 0;
const aaaMisses = [];

console.warn("\nDesign-token contrast — WCAG 2.1 AA floor, AAA where it pays\n");

/* 1. plain text on opaque surfaces */
console.warn("  Text on surface");
for (const [label, fgName, bgName, body, min] of TEXT_PAIRS) {
  const fg = token(body, fgName);
  const bg = token(body, bgName);
  if (!fg || !bg) {
    console.warn(`    SKIP  ${label} — token not found (${!fg ? fgName : bgName})`);
    skipped++;
    continue;
  }
  // A translucent foreground (e.g. rgb(var(--ink) / 0.72)) is what the eye sees
  // composited, not what the declaration says.
  const ratio = contrast(over(fg, bg.rgb), bg.rgb);
  const ok = ratio >= min;
  if (!ok) failed++;
  console.warn(`    ${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
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
console.warn(`\n  Status pills — text on its own tinted ground (${pills.length} rules, parsed from index.css)`);
if (pills.length === 0) {
  console.error("    FAIL  no .st-* rules found — the parser or the stylesheet changed shape.");
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
        console.warn(`    SKIP  .${p.name} (${themeName}/${surfaceName}) — could not resolve`);
        skipped++;
        continue;
      }
      const ground = over(tint, surface.rgb);
      const ratio = contrast(over(ink, ground), ground);
      const ok = ratio >= AA_NORMAL;
      if (!ok) failed++;
      else if (ratio < AAA_NORMAL) aaaMisses.push(`.${p.name} on --${surfaceName} (${themeName}) ${ratio.toFixed(2)}:1`);
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

/** Files allowed to name a fill token in a text position, each with a reason. */
const INK_ALLOW = [
  "scripts/check-contrast.mjs", // this table
];

function stripComments(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
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
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "client/src"],
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
  const rel = relative("client", file).replace(/\\/g, "/");
  if (INK_ALLOW.includes(rel)) continue;
  const text = stripComments(readFileSync(join(repoRoot, file), "utf8"));
  text.split("\n").forEach((line, i) => {
    for (const hit of line.matchAll(INK_RE)) {
      const tokenName = hit[1] ?? hit[2];
      inkViolations.push({ file: rel, line: i + 1, token: tokenName, src: line.trim().slice(0, 110) });
    }
  });
}

console.warn(`\n  Fill tokens used as type — ${inkViolations.length} site(s)`);
if (inkViolations.length) {
  failed += inkViolations.length;
  console.error("");
  for (const v of inkViolations) {
    console.error(`    ${v.file}:${v.line}  text-${v.token}  →  use ${INK_FOR[v.token]}`);
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

/* ── report ───────────────────────────────────────────────────────────────── */

if (aaaMisses.length) {
  console.warn(
    `\n  AAA target (7:1) not met by ${aaaMisses.length} pill measurement(s). Not a failure:\n` +
      "  a pill's value is being legible AND recognisably coloured, and 7:1 on a\n" +
      "  tinted ground drives the tint to near-white or the ink to near-black,\n" +
      "  at which point the tone stops carrying meaning. AA is the gate here.",
  );
}

const note = skipped ? `, ${skipped} skipped` : "";
if (failed) {
  console.error(`\n✗ ${failed} contrast pair(s) below threshold${note}.\n`);
  process.exit(1);
}
console.warn(`\n✓ All pairs clear their floor${note}.\n`);
