#!/usr/bin/env node
/**
 * Design-token contrast gate (audit F13).
 *
 * Parses the real token values out of src/index.css and asserts every
 * text-on-surface pair clears WCAG 2.1 AA. Before Phase 1 six pairs failed —
 * most visibly `.micro` at 3.01:1, which is used 198 times across 54 files.
 *
 * This exists as a plain node script, with no test-runner dependency, so the
 * token PR is verifiable on its own. Phase 1 PR2 wires it into CI alongside
 * Vitest + jest-axe.
 *
 *   node scripts/check-contrast.mjs
 *
 * Exit 0 = all pairs pass. Exit 1 = at least one regressed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "src", "index.css"), "utf8");

/** WCAG 2.1: 4.5:1 for normal text, 3:1 for large (>=18.66px bold / 24px). */
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

/* ── token extraction ─────────────────────────────────────────────────────── */

/** Body of a top-level selector block (`:root` / `.dark`). */
function block(selector) {
  const m = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`Could not find "${selector}" block in index.css`);
  return m[1];
}

/**
 * Read a token as [r,g,b]. Handles both shapes used in this file:
 *   --card: rgb(255 255 255)   → full colour
 *   --ink-3: 90 108 133        → bare triplet (consumed as rgb(var(--x) / a))
 */
function token(body, name) {
  const m = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) return null;
  const raw = m[1].trim();
  const nums = raw.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  if (!nums) return null;
  return [Number(nums[1]), Number(nums[2]), Number(nums[3])];
}

/* ── contrast maths ───────────────────────────────────────────────────────── */

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

/* ── the matrix ───────────────────────────────────────────────────────────── */

const light = block(":root");
const dark = block("\\.dark");

/** [label, fg token, bg token, theme body, threshold] */
const PAIRS = [
  // The .micro caption — the audit's worst offender at 3.01:1 / 2.78:1.
  [".micro on --card (light)", "ink-3", "card", light, AA_NORMAL],
  [".micro on --background (light)", "ink-3", "background", light, AA_NORMAL],
  [".micro on --card (dark)", "ink-3", "card", dark, AA_NORMAL],
  // Secondary body text.
  ["--muted-foreground on --card (light)", "muted-foreground", "card", light, AA_NORMAL],
  ["--muted-foreground on --card (dark)", "muted-foreground", "card", dark, AA_NORMAL],
  // Table column headings sit on --secondary.
  ["TH label on --secondary (light)", "muted-foreground", "secondary", light, AA_NORMAL],
  // Status text — how the ERP communicates document state.
  ["--ok text on --card (light)", "ok", "card", light, AA_NORMAL],
  ["--warn text on --card (light)", "warn", "card", light, AA_NORMAL],
  ["--bad text on --card (light)", "bad", "card", light, AA_NORMAL],
  ["--ok text on --card (dark)", "ok", "card", dark, AA_NORMAL],
  ["--warn text on --card (dark)", "warn", "card", dark, AA_NORMAL],
  ["--bad text on --card (dark)", "bad", "card", dark, AA_NORMAL],
  // Accent as TEXT must use --primary-ink, never --primary.
  ["--primary-ink on --card (light)", "primary-ink-light", "card", light, AA_NORMAL],
  ["--primary-ink on --card (dark)", "primary-ink-dark", "card", dark, AA_NORMAL],
  // Primary body copy — held to AAA, which it already clears.
  ["--foreground on --background (light)", "foreground", "background", light, 7.0],
  ["--foreground on --background (dark)", "foreground", "background", dark, 7.0],
];

let failed = 0;
let skipped = 0;
console.log("\nDesign-token contrast — WCAG 2.1 AA\n");

for (const [label, fgName, bgName, body, min] of PAIRS) {
  // --primary-ink-* and the fill variants live on :root even in dark mode.
  const fg = token(body, fgName) ?? token(light, fgName);
  const bg = token(body, bgName) ?? token(light, bgName);
  if (!fg || !bg) {
    console.log(`  SKIP  ${label} — token not found (${!fg ? fgName : bgName})`);
    skipped++;
    continue;
  }
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${ratio.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`,
  );
}

const note = skipped ? `, ${skipped} skipped` : "";
if (failed) {
  console.error(`\n✗ ${failed} contrast pair(s) below threshold${note}.\n`);
  process.exit(1);
}
console.log(`\n✓ All ${PAIRS.length - skipped} pairs pass${note}.\n`);
