#!/usr/bin/env node
/**
 * THE GATE: no font from outside the shipped library is named anywhere.
 *
 * The rule is easy to state and was violated in nine places before it was
 * written down — Playfair Display in Excel exports, 'Segoe UI' in three email
 * shells and the document kit, 'Noto Sans Mono' in the PDF templates, Menlo /
 * Consolas / Courier New arriving via Tailwind's default `font-mono`, and
 * Montserrat named in the platform console by an app that bundled no fonts at
 * all. Every one of them rendered as something else, silently, because a font
 * name that resolves to nothing does not error — it substitutes.
 *
 * A grep is the only thing that catches that class of bug, so this runs in CI.
 *
 * WHAT IS ALLOWED
 *   - the fifteen families in client/src/lib/fonts.ts (parsed from source, so
 *     this file can never drift from the library)
 *   - CSS generic keywords: sans-serif, serif, monospace, cursive, fantasy,
 *     system-ui, ui-monospace, inherit, initial, unset
 *   - anything inside a comment, so the reasoning above stays writable
 *
 * WHAT IS NOT
 *   - any other quoted or bare family name in a font stack
 *
 * Adding a family means adding it to lib/fonts.ts. That is the point: the
 * library is the single list, and this proves it.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── The library, read from source ──
const libSrc = readFileSync(path.join(ROOT, "client/src/lib/fonts.ts"), "utf8");
const LIBRARY = [...libSrc.matchAll(/^\s*name:\s*"([^"]+)",/gm)].map((m) => m[1]);
if (LIBRARY.length === 0) {
  console.error("check:fonts — could not parse any family from client/src/lib/fonts.ts");
  process.exit(1);
}

const GENERIC = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
  "",
]);

/** A library family, with or without the @fontsource "Variable" suffix. */
const allowed = new Set([...GENERIC]);
for (const name of LIBRARY) {
  allowed.add(name.toLowerCase());
  allowed.add(`${name.toLowerCase()} variable`);
}

/**
 * ── METRIC-MATCHED FALLBACK FACES ARE NOT NEW FONTS ───────────────────────
 *
 * `public-web/src/fonts-fallback.css` declares families like "Inter Variable
 * Fallback". This gate flagged all four, and on its own terms it was right:
 * they are not in the library.
 *
 * They are also not fonts. Each one re-declares a face the visitor's machine
 * ALREADY HAS — `src: local("Arial"), local("Helvetica"), …` — with
 * `size-adjust` and vertical overrides so it occupies the space the real
 * webfont will, and `font-display: swap` therefore costs no layout shift
 * (guide O-12). Nothing is downloaded, nothing is licensed, nothing is
 * shipped.
 *
 * So the rule this gate enforces — "no font from outside the shipped library is
 * named anywhere" — is not what a fallback violates. What would violate it is a
 * fallback face that quietly pulls a `url()`, and that is exactly what the test
 * below refuses: a family is admitted only if the `@font-face` declaring it
 * sources EVERY reference from `local()`.
 *
 * Derived from the stylesheet rather than allow-listed by name, so a fifth face
 * added by the generator is covered and a hand-written one that fetches
 * something is not.
 */
const FALLBACK_SHEET = "public-web/src/fonts-fallback.css";

function localOnlyFallbackFamilies() {
  const found = new Set();
  const full = path.join(ROOT, FALLBACK_SHEET);
  if (!existsSync(full)) return found;
  const css = readFileSync(full, "utf8");
  // Each @font-face block, whole, so `src` and `font-family` are read together.
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const family = /font-family:\s*["']([^"']+)["']/.exec(block)?.[1];
    const src = /src:\s*([^;]+);/.exec(block)?.[1];
    if (!family || !src) continue;
    // Every reference must be a local(). One url() and the block is a real
    // webfont wearing a fallback's name.
    const refs = src.match(/\b(local|url)\s*\(/g) || [];
    if (!refs.length || refs.some((r) => r.trim().startsWith("url"))) continue;
    found.add(family.toLowerCase());
  }
  return found;
}

for (const family of localOnlyFallbackFamilies()) allowed.add(family);

// Surfaces we control. doc/reference is vendored third-party sample code and
// node_modules is not ours; the legacy PHP codebase under doc/ is dead.
//
// `packages` joined the list when @praxis/brand landed. That package DECLARES
// the three font stacks every Praxis-owned surface renders with, which made it
// the one place a family could be named entirely outside this gate — the exact
// blind spot the gate exists to close, reopened one directory over.
// public-web joined when the stranger-facing app landed: it writes its OWN type
// ramp (maersk-scale) instead of importing the ERP's, so it is precisely the kind
// of surface a family can be named inside without this gate ever seeing it.
const SEARCH_DIRS = ["client/src", "src", "platform-console/src", "public-web/src", "packages", "scripts", "migrations"];

const files = execSync(
  // `--cached --others --exclude-standard`, not a bare `git ls-files`.
  //
  // A bare `ls-files` lists only TRACKED files, so every NEW file on a branch is
  // invisible to this gate — and a new file is exactly what a new font name
  // arrives in. `npm run ci` therefore reported "Font gate … ok" on a working
  // tree whose uncommitted service named a family outside the library, and CI
  // caught it one commit later. A gate that passes by not looking is worse than
  // no gate: it is quoted as evidence.
  //
  // `check-schemas.mjs` already enumerates this way. This is that fix, here.
  `git ls-files --cached --others --exclude-standard ${SEARCH_DIRS.join(" ")} | grep -E '\\.(css|ts|tsx|js|jsx|mjs|html|json|sql)$'`,
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  // This file lists font names on purpose, and the library test asserts on the
  // proprietary names it must NOT contain.
  .filter((f) => !f.endsWith("scripts/check-fonts.mjs") && !f.endsWith("client/src/lib/fonts.test.ts"));

/** Strip comments so prose about fonts is not scanned as code. */
function stripComments(text, file) {
  if (file.endsWith(".sql")) return text.replace(/--[^\n]*/g, "");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// `font-family: <stack>` in CSS/inline styles, `fontFamily: "<stack>"` in JS/TS,
// and exceljs's `font: { name: "<family>" }`.
const STACK_RE = /font-family\s*[:=]\s*["'`]?([^;"'`}\n]+)/gi;
const JS_STACK_RE = /fontFamily\s*:\s*["'`]([^"'`]+)["'`]/g;
const EXCEL_RE = /\bfont\s*=\s*\{[^}]*?\bname:\s*["']([^"']+)["']/g;
/**
 * CSS custom properties that HOLD a stack — `--font-display`, `--sans`,
 * `--mono`. Scanning only `font-family:` missed every one of them, which in a
 * token-driven design system is the blind spot that matters: the declarations
 * all read `font-family: var(--font-body)`, and the actual family names live
 * exclusively in the token definitions this pattern covers.
 */
const CSS_TOKEN_RE = /--(?:font[\w-]*|sans|serif|mono)\s*:\s*([^;{}\n]+)/gi;
/** The persisted branding keys — seeds, fixtures and migrations set these. */
const SETTING_RE = /\bfont_(?:display|body|mono)\s*[:=]\s*["'`]([^"'`]+)["'`]/g;

const violations = [];

for (const file of files) {
  const raw = readFileSync(path.join(ROOT, file), "utf8");
  const text = stripComments(raw, file);

  for (const re of [STACK_RE, JS_STACK_RE, EXCEL_RE, CSS_TOKEN_RE, SETTING_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const stack = m[1];
      // Skip anything that is an EXPRESSION rather than a literal stack: a CSS
      // token (`var(--font-body)`), a template placeholder, a concatenated
      // constant (`" + PDF_FONT_BODY + "`), or a property read. Those resolve
      // from the library at runtime — following them here would mean writing an
      // evaluator, and the constants they point at are literals declared in
      // files this gate already scans.
      if (/var\(|\$\{|[+]|\bc\.\w|\bfont\.stack\b|\bvalue\b/.test(stack)) continue;

      for (const part of stack.split(",")) {
        const family = part.trim().replace(/^["']|["']$/g, "").toLowerCase();
        if (!family || allowed.has(family)) continue;
        const line = text.slice(0, m.index).split("\n").length;
        violations.push({ file, line, family, stack: stack.trim() });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("✗ Fonts outside the shipped library are named in the codebase:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  "${v.family}"`);
    console.error(`      in: ${v.stack}`);
  }
  console.error(
    `\nA font name that resolves to nothing does not error — it substitutes, silently.\n` +
      `Use a family from client/src/lib/fonts.ts (${LIBRARY.length} available) or a generic keyword.\n` +
      `To add a family, see doc/TYPOGRAPHY.md.`,
  );
  process.exit(1);
}

console.warn(`✓ Font gate: clean — every named family is one of the ${LIBRARY.length} in the library.`);
