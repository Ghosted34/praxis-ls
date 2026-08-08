#!/usr/bin/env node
/**
 * Raw-palette gate (audit F14, Phase 4 deliverable "Zero raw-palette colours").
 *
 * `doc/FE_DESIGN_RULES.md` rule #1 is "Never hardcode colours", and the audit
 * measured 122 violations against it. Every one breaks tenant white-labelling:
 * a `text-emerald-600` stays emerald when the tenant's brand is teal, and the
 * Phase 3 white-label smoke test showed exactly what that looks like in
 * production (Addendum 6 — a tenant-tinted pill ground with SmartLS-brown text
 * on it, a contrast pair nobody had ever measured because neither half was
 * chosen against the other).
 *
 * The count went 122 → 56 (Phase 2, deleting the shadow `Badge` map) → 46
 * (Phase 3) → 0 here. This script is what stops it going back up: a rule
 * enforced by a document is a rule nobody enforces.
 *
 *   node scripts/check-palette.mjs
 *
 * Exit 0 = no raw palette utilities. Exit 1 = at least one, listed with its
 * semantic replacement.
 *
 * WHY NOT ESLINT. The violation is a substring of a `className` string literal,
 * often built by `cn()` or a lookup table, and often split across a template
 * literal. A lint rule that reads JSX attributes misses the table form — which
 * is precisely where the largest single source lived (the 27-entry `Badge` map).
 * Scanning text catches every shape.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const repoRoot = join(clientRoot, "..");

/** Tailwind's default palette. `white`/`black`/`transparent`/`current` are fine. */
const PALETTE = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

/** Utilities that take a colour. */
const UTILITIES = [
  "bg", "text", "border", "ring", "ring-offset", "outline", "divide", "accent",
  "caret", "decoration", "shadow", "fill", "stroke", "from", "to", "via",
];

const RE = new RegExp(
  `\\b(?:${UTILITIES.join("|")})-(?:${PALETTE.join("|")})-(?:50|[1-9]00|950)\\b`,
  "g",
);

/**
 * What to use instead. Keyed by the palette family, because the correct
 * replacement is a function of MEANING, not of hue — the point of the token
 * layer is that "this is a success state" and "this is green" stop being the
 * same statement.
 */
const GUIDANCE = {
  emerald: "--ok / <Pill tone=\"ok\"> / text-ok",
  green: "--ok / <Pill tone=\"ok\"> / text-ok",
  lime: "--ok / <Pill tone=\"ok\">",
  teal: "--ok, or --primary if it is the brand accent",
  amber: "--warn / <Pill tone=\"warn\"> / text-warn",
  yellow: "--warn / <Pill tone=\"warn\">",
  orange: "--primary / --brand-orange (NEVER a literal — this is the tenant's brand)",
  red: "--bad / <Pill tone=\"bad\"> / text-destructive",
  rose: "--bad / <Pill tone=\"bad\"> / text-destructive",
  pink: "--bad, or a brand token",
  sky: "--brand-blue / <Pill tone=\"blue\">",
  blue: "--brand-blue / <Pill tone=\"blue\">",
  cyan: "--brand-blue / <Pill tone=\"blue\">",
  indigo: "--brand-blue, or --primary",
  violet: "--brand-violet / <Pill tone=\"violet\">",
  purple: "--brand-violet / <Pill tone=\"violet\">",
  fuchsia: "--brand-violet",
  slate: "--muted-foreground / --border / --card (surface + ink tokens)",
  gray: "--muted-foreground / --border / --card",
  zinc: "--muted-foreground / --border / --card",
  neutral: "--muted-foreground / --border / --card",
  stone: "--muted-foreground / --border / --card",
};

/**
 * Files allowed to name a palette colour, each with the reason.
 *
 * Deliberately near-empty. An allowlist is where a gate goes to die, so every
 * entry has to justify why the tenant's brand must NOT reach this pixel.
 */
const ALLOW = [
  // This script's own guidance table names every family by design.
  "scripts/check-palette.mjs",
  /*
   * The gate-proof harness holds one example of every defect the gates catch —
   * a raw palette colour among them — because that is what it exists to inject.
   *
   * Worth recording rather than just fixing: this is the SECOND time this gate
   * has flagged its own evidence. Addendum 7 documents the first, in
   * `ui/pill.tsx`, and the fix was to blank comments before matching. That
   * addressed the instance; the class is broader. A checker whose subject is
   * "strings that look like violations" will always fire on files ABOUT
   * violations, and here the string is in executable code, not a comment, so
   * comment-blanking could never have covered it. Two entries is still a short
   * allowlist, and both are files whose job is to name the thing.
   */
  "scripts/prove-gates.mjs",
];

/**
 * Blank out comments before matching, preserving line numbers.
 *
 * Not fussiness — without it the gate fails on its own evidence. `ui/pill.tsx`
 * and `ui/pill.test.tsx` both QUOTE the deleted shadow `Badge` map
 * (`bg-sky-500/10 text-sky-600 …`) in their header comments, as the record of
 * what they replaced. Flagging the documentation of a fix as an instance of the
 * bug is how a gate teaches people to disable it, and the audit already has one
 * finding about warnings nobody reads.
 *
 * Deliberately conservative: only block comments and lines that BEGIN with `//`
 * or a JSDoc `*`. An end-of-line `//` is left alone, because deciding whether
 * one is inside a string literal needs a parser, and a false negative on a
 * trailing comment is much cheaper than a false positive on a className.
 */
function stripComments(text) {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return blanked
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line))
    .join("\n");
}

/**
 * Files to scan: tracked AND new-but-not-ignored.
 *
 * `--others --exclude-standard` is load-bearing, not defensive. `git ls-files`
 * alone lists only what is already committed — so a BRAND-NEW component, which
 * is the single likeliest place for a fresh violation, would sail through the
 * gate and only start being checked one commit after it could have caught
 * anything. This was found by running the gate against its own new file.
 *
 * `-z`/NUL separation because a filename may contain a space.
 *
 * `existsSync` because `--cached` also lists files that have been DELETED in the
 * working tree but not yet staged — which is the normal state of a directory
 * mid-refactor. Without it the gate throws ENOENT and reports nothing at all,
 * which is the worst possible failure mode for a checker: it looks like a
 * broken tool rather than a clean tree, and the next person disables it.
 */
function sources() {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "client"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(tsx?|mjs|css)$/.test(f))
    .filter((f) => existsSync(join(repoRoot, f)));
}

const violations = [];
for (const file of sources()) {
  const rel = relative("client", file).replace(/\\/g, "/");
  if (ALLOW.includes(rel)) continue;

  const text = stripComments(readFileSync(join(repoRoot, file), "utf8"));
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const hit of line.matchAll(RE)) {
      const family = PALETTE.find((p) => hit[0].includes(`-${p}-`));
      violations.push({ file: rel, line: i + 1, token: hit[0], family, src: line.trim() });
    }
  });
}

if (violations.length === 0) {
  console.warn("Raw-palette gate: clean — every colour comes from a semantic token.");
  process.exit(0);
}

console.error(`\nRaw Tailwind palette colours found: ${violations.length}\n`);
console.error("Each one breaks tenant white-labelling: it stays that hue when the");
console.error("tenant's brand is something else. Use the semantic token instead.\n");

let lastFile = "";
for (const v of violations) {
  if (v.file !== lastFile) {
    console.error(`  ${v.file}`);
    lastFile = v.file;
  }
  const fix = GUIDANCE[v.family] ?? "a semantic token from src/index.css";
  console.error(`    ${String(v.line).padStart(5)}  ${v.token.padEnd(24)} → ${fix}`);
  console.error(`           ${v.src.slice(0, 110)}`);
}
console.error("\nTokens live in client/src/index.css. Pills: <Pill tone=…>.\n");
process.exit(1);
