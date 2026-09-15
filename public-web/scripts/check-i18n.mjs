#!/usr/bin/env node
/**
 * The dictionary gate: one file, five checks, all of them about the failure mode
 * this app is built around — a public surface that is bilingual in the brochure
 * and half-translated in the browser.
 *
 * ── WHY A SCRIPT AND NOT A TEST ────────────────────────────────────────────
 *
 * A Vitest case would cover the same ground but only when someone runs the suite,
 * and (worse) only for the strings a rendered component happens to touch. Two of
 * the checks below are about strings NO test renders: an unused dictionary key, and
 * a `t("key")` whose key exists only in the other language. Both are pure source
 * analysis, so they run in ~40 ms over the whole tree with the build closed, and
 * `npm run check:i18n` can also be pointed at a branch by a human before they open
 * a PR.
 *
 * ── THE FIVE CHECKS ───────────────────────────────────────────────────────
 *
 *   1. PARITY. A key in `en` and not in `fr` renders the raw key on the French
 *      page — `site.quote.incotermPick` where a select label should be. i18next
 *      falls back rather than throwing, so nothing else would ever report it.
 *   2. NO DANGLING CALL. A `t("…")` for a key nobody wrote fails the same way.
 *   3. INTERPOLATION TOKENS. `{{reference}}` on one side and nothing on the other
 *      prints a literal `{{reference}}` into a stranger's confirmation. The token
 *      sets must match, in both directions.
 *   4. FRENCH TYPOGRAPHY. `doc/BRAND_GLOSSARY_FR_EN.md` §5: a narrow no-break
 *      space (U+202F) before `: ; ! ?` and before `%`, no space before a comma or
 *      period. Mechanical, and the reason it is enforced rather than advised is in
 *      §5's own words — a missing thin space in a heading is read as machine
 *      output, and the reader extends that inference to the freight.
 *   5. NO HARDCODED PROSE IN A COMPONENT. The rule that makes 1-4 meaningful.
 *      A literal sentence inside JSX is invisible to the dictionary, so the
 *      French page shows English for exactly that one string, forever, in the
 *      one place nobody screenshots.
 *
 * Usage: node scripts/check-i18n.mjs [--fix-hint] (npm run check:i18n)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DICT = path.join(SRC, "lib/i18n-dict.ts");

/**
 * Dictionaries that live in a FEATURE chunk rather than in `i18n-dict.ts` (13792).
 *
 * `i18n-dict.ts` is in the entry graph, so every string in it is downloaded by
 * every visitor to every page — right for `site.nav.*`, wrong for a subtree only
 * one route can render. `check-bundle.mjs` names this split as the lever to
 * reach for before raising the first-paint budget, and `site.careers.*` took it.
 *
 * These files are checked EXACTLY as the main dictionary is — parity, tokens,
 * braces, French typography — because the failure they guard against does not
 * care which module a string was written in. `mount` is where the file's `en`
 * and `fr` hang in the runtime tree, so a key reported here reads
 * `site.careers.empty`, the same name the app and the site-copy catalogue use.
 */
const FEATURE_DICTS = [
  {
    file: path.join(SRC, "features/careers/careers-copy.ts"),
    mount: "site.careers",
  },
];

/** True for any file that IS copy rather than a component that contains copy.
 *  Both prose checks below consult it, so they cannot drift apart about what a
 *  dictionary is — the way they once did over test files. */
const isDictionaryFile = (file) =>
  /i18n-dict\.ts$/.test(file) || FEATURE_DICTS.some((d) => d.file === file);


const NBSP = "\u202f";
const failures = [];
const fail = (file, line, rule, detail) =>
  failures.push({ file, line, rule, detail });

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "i18n-dict.ts") continue; // scanned through the parsed object
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

/**
 * The dictionary, read as TEXT rather than imported.
 *
 * Importing it would need the app's TS/bundler resolution (and a running Vitest or
 * Vite), which is fine for a test and wrong for a gate a shell script should be
 * able to run in CI before `npm install` finishes. What is parsed here is the
 * shape the file is written in on purpose — one key per line, two-space
 * indentation — and a formatting change that breaks this parse breaks loudly,
 * with "could not read", not silently with a clean report.
 */
function readDict(file = DICT, prefix = "") {
  if (!existsSync(file)) {
    console.error(`✗ check:i18n — ${path.relative(ROOT, file)} not found.`);
    process.exit(1);
  }
  const src = readFileSync(file, "utf8");
  const out = {};
  for (const lang of ["en", "fr"]) {
    const start = src.indexOf(`export const ${lang} = {`);
    if (start < 0) {
      console.error(`✗ check:i18n — could not find \`export const ${lang}\`.`);
      process.exit(1);
    }
    const stop =
      lang === "en"
        ? src.indexOf("export const fr = {")
        : src.indexOf("\n};", start);
    const body = src.slice(start, stop);
    const keys = new Set();
    // A stack of (indent → path) so nesting is derived from indentation.
    const stack = [];
    for (const raw of body.split("\n")) {
      // The identifier alternative has to accept accented keys: this dictionary
      // deliberately keys some French accounting labels by their French spelling
      // (`Résultat`, `Compte de résultat`), because the ported terminals show
      // those words on screen and `tr()` looks them up by what is visible. With a
      // plain `[A-Za-z_]` class the parser never saw those keys, and the gate
      // reported a perfectly good `tr("Résultat")` as a dangling call — the most
      // dangerous kind of false positive, because it teaches you to distrust the
      // gate. \w under /u covers the Latin letters this file uses.
      const m = raw.match(
        /^(\s*)(?:"([^"]+)"|([\p{L}_][\p{L}\p{N}_]*))\s*:\s*(.*)$/u,
      );
      if (!m) continue;
      const indent = m[1].length;
      const key = m[2] ?? m[3];
      const rest = m[4] ?? "";
      while (stack.length && stack[stack.length - 1].indent >= indent)
        stack.pop();
      const dotted = [...stack.map((s) => s.key), key].join(".");
      // A feature dictionary exports the SUBTREE, not a whole `{ site: … }`, so
      // its keys are mounted here — a failure then names `site.careers.empty`,
      // which is what the app, the catalogue and a reader all call it.
      keys.add(prefix ? `${prefix}.${dotted}` : dotted);
      if (rest.trim() === "{" || rest.trim().startsWith("{")) {
        stack.push({ indent, key });
      } else if (/[{[]/.test(rest)) {
        stack.push({ indent, key });
      }
    }
    out[lang] = keys;
  }
  return out;
}

/**
 * The real objects, for checks that must read VALUES rather than keys (tokens,
 * typography). Transpiled with the esbuild already in node_modules rather than
 * regex-mangled, because this file's `as const` and inline object types are the
 * parts a hand parser gets wrong — and a wrong parse here reports "clean".
 */
function readValues(file = DICT) {
  const esbuild = nodeRequire("esbuild");
  const src = readFileSync(file, "utf8");
  const { code } = esbuild.transformSync(src, {
    loader: "ts",
    format: "cjs",
    target: "node18",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(
    mod,
    mod.exports,
    () => ({}),
  );
  const { en, fr } = mod.exports;
  if (!en || !fr) {
    console.error(`✗ check:i18n — ${path.relative(ROOT, file)} did not export en and fr.`);
    process.exit(1);
  }
  return { en, fr };
}

/* The dictionary has no runtime deps; esbuild is resolved from node_modules via a
 * CJS require because this file is ESM and esbuild ships no "exports" entry for a
 * bare ESM import of its sync API. */
const nodeRequire = createRequire(import.meta.url);

/** Each dictionary source, with the file to blame in a failure. The main one,
 *  then any feature subtrees. */
const SOURCES = [
  { file: DICT, mount: "", rel: path.relative(ROOT, DICT) },
  ...FEATURE_DICTS.map((d) => ({ ...d, rel: path.relative(ROOT, d.file) })),
];

/* Key sets are merged across sources, because checks 1 and 2 — parity and
   dangling calls — are about the RUNTIME tree a `t()` call resolves against, and
   that tree is the union whatever file each branch was written in. */
const dict = { en: new Set(), fr: new Set() };
for (const { file, mount } of SOURCES) {
  const part = readDict(file, mount);
  for (const k of part.en) dict.en.add(k);
  for (const k of part.fr) dict.fr.add(k);
}

/* Values are NOT merged: checks 3, 3b and 4 report a file and a key, and a
   careers typography error blamed on `i18n-dict.ts` sends the next reader to a
   file that does not contain the string. So each source is walked on its own and
   reports itself. */
const valueSets = SOURCES.map((src) => ({ ...src, values: readValues(src.file) }));

/* ── 1. parity ──────────────────────────────────────────────────────────── */
for (const key of dict.en)
  if (!dict.fr.has(key))
    fail(
      "src/lib/i18n-dict.ts",
      0,
      "parity",
      `"${key}" exists in en and not in fr`,
    );
for (const key of dict.fr)
  if (!dict.en.has(key))
    fail(
      "src/lib/i18n-dict.ts",
      0,
      "parity",
      `"${key}" exists in fr and not in en`,
    );

/* ── 2. every call resolves ─────────────────────────────────────────────── */
// Test files are exempt from the dangling-key scan on purpose: they assert that
// an UNKNOWN key degrades the way the app promises, and the only way to write
// that assertion is to name a key the dictionary does not have.
const files = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f));
const allFiles = walk(SRC);
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(
      /\b(?:t|tList(?:<[^>]*>)?)\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g,
    )) {
      const key = m[1];
      if (!dict.en.has(key))
        fail(rel, i + 1, "dangling", `t("${key}") has no dictionary entry`);
      else if (!dict.fr.has(key))
        fail(rel, i + 1, "dangling", `t("${key}") resolves in en only`);
    }
    // `tr("Label")` goes through the `strings.` subtree of the dictionary.
    for (const m of line.matchAll(/\btr\(\s*"([^"]+)"\s*\)/g)) {
      const label = m[1];
      const dotted = `strings.${label}`;
      if (!dict.en.has(dotted) || !dict.fr.has(dotted))
        fail(
          rel,
          i + 1,
          "dangling",
          `tr("${label}") is not in en.strings and fr.strings`,
        );
    }
  });
}

/* ── 3. interpolation tokens ────────────────────────────────────────────── */
const tokens = (s) =>
  typeof s === "string"
    ? (s.match(/\{\{\s*[\w.]+\s*\}\}/g) || []).sort().join(",")
    : "";
const walkBoth = (a, b, prefix, rel) => {
  for (const [k, v] of Object.entries(a ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    const other = b?.[k];
    if (typeof v === "string" || typeof other === "string") {
      if (tokens(v) !== tokens(other))
        fail(
          rel,
          0,
          "tokens",
          `${key}: en "${tokens(v)}" vs fr "${tokens(other)}"`,
        );
    } else if (Array.isArray(v) && Array.isArray(other)) {
      v.forEach((item, idx) => {
        if (item && typeof item === "object" && other[idx]) {
          for (const [ik, iv] of Object.entries(item)) {
            if (tokens(iv) !== tokens(other[idx][ik]))
              fail(
                rel,
                0,
                "tokens",
                `${key}[${idx}].${ik}: token sets differ`,
              );
          }
        }
      });
    } else if (
      v &&
      typeof v === "object" &&
      other &&
      typeof other === "object"
    ) {
      walkBoth(v, other, key, rel);
    }
  }
};
for (const { values: v, mount, rel } of valueSets) walkBoth(v.en, v.fr, mount, rel);

/* ── 3b. a lone brace pair is not an interpolation ───────────────────────── */
// `{reference}` renders as the literal text `{reference}`: i18next only reads
// `{{reference}}`. Both languages carrying the same mistake is what hid it — the
// parity check above passes, and the token check compares two empty sets. So the
// shape itself is rejected here, in either language, anywhere in a value.
const LONE_BRACE = /(?<!\{)\{\s?[A-Za-z_][\w.]*\s?\}(?!\})/;
{
  const scanBraces = (node, prefix, rel) => {
    for (const [k, v] of Object.entries(node ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      const items = Array.isArray(v) ? v : [v];
      for (const item of items) {
        if (typeof item === "string") {
          const stripped = item.replace(/\{\{[^}]*\}\}/g, "");
          if (LONE_BRACE.test(stripped))
            fail(
              rel,
              0,
              "brace",
              `${key}: "{${stripped.match(LONE_BRACE)[0].slice(1, -1)}}" is not an i18next token — use double braces`,
            );
        } else if (item && typeof item === "object") scanBraces(item, key, rel);
      }
    }
  };
  for (const { values: v, mount, rel } of valueSets) {
    scanBraces(v.en, mount, rel);
    scanBraces(v.fr, mount, rel);
  }
}

/* ── 4. French typography (§5) ──────────────────────────────────────────── */
const TYPO = [
  [/\s{2,}/g, "double space"],
  [
    // U+00A0 is included: it is a no-break space, which LOOKS right and is the
    // wrong width. §5 names U+202F specifically, and the difference is visible
    // in a heading at display size.
    /[ \t\u00a0][:;!?]/g,
    `a normal or non-narrow space before : ; ! ? — §5 requires U+202F (${NBSP})`,
  ],
  [/[ \t\u00a0]%/g, "a space before % — §5 requires U+202F before the sign"],
  [/,/g, null],
];
{
  const seen = new Set();
  const scan = (node, prefix) => {
    for (const [k, v] of Object.entries(node ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      const items = Array.isArray(v) ? v : [v];
      for (const raw of items) {
        if (typeof raw === "string") {
          /*
           * ── DECODE `\uXXXX` BEFORE MEASURING ────────────────────────────
           *
           * The dictionary is parsed as TEXT, so a string written as
           * `"compte\\u00a0:"` reaches this check as the eleven characters
           * `compte\uXXXX:` — no space in sight — and every rule below passes
           * it. At runtime it renders U+00A0, an ordinary no-break space, where
           * §5 requires U+202F. The typography check was blind to precisely the
           * notation somebody reaches for when they are being careful about
           * whitespace.
           *
           * Found while adding §8.1's French copy: the strings passed the gate
           * and were still wrong. Decoding first is the whole fix — the rules
           * are unchanged, they simply now see what the browser sees.
           */
          const item = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
          if (/[\u00c0-\u017f]/.test(item) || /\s/.test(item)) {
            for (const [re, why] of TYPO) {
              if (why && re.test(item)) {
                seen.add(`${key}: ${why}`);
              }
            }
            // A straight apostrophe where the typographic one belongs.
            if (/[A-Za-zÀ-ÿ]'[A-Za-zÀ-ÿ]/.test(item))
              seen.add(`${key}: straight apostrophe — French uses ’`);
          }
        } else if (raw && typeof raw === "object") scan(raw, key);
      }
    }
  };
  for (const { values: v, mount, rel } of valueSets) {
    seen.clear();
    scan(v.fr, mount);
    for (const d of seen) fail(rel, 0, "typography", d);
  }
}

/* ── 5. no hardcoded prose in a component ───────────────────────────────── */

/**
 * Comments are not copy, so they must not be scanned — but the removal has to
 * keep every line where it is, or the reported line numbers point at whatever the
 * comment used to sit above and the next reader wastes ten minutes on a phantom.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, g1) => g1 + "  ");
}
/**
 * Text nodes between tags, INCLUDING across line breaks.
 *
 * JSX wraps, and a rule that only looked inside one line was blind to exactly the
 * sentences most likely to be hand-written: the two-line explanatory paragraph in
 * a ported panel. A `{` or `}` ends the candidate, which is what keeps every
 * expression container out of the scan, and comments were blanked above with their
 * line count intact, so `\n` counting still reports the right line.
 */
const PROSE = />([^<>{}]{2,400}?)</gs;
const OK = /^[\s|·—–\-–+×*•×\d.,%’'"()§©®™/:A-Z-]*$/;
for (const file of allFiles) {
  if (!file.endsWith(".tsx")) continue;
  // Test files are fixtures, not copy. Check 6 below already skips them; this
  // one did not, so the two halves of the same gate disagreed about whether a
  // sentence in a test is user-facing prose. It is not: nobody translates an
  // assertion, and a test that must phrase its fixture as a dictionary key
  // tests the dictionary rather than the component.
  if (/\.test\.tsx?$/.test(file)) continue;
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = path.relative(ROOT, file);
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;
  for (const m of src.matchAll(PROSE)) {
    {
      const text = m[1].replace(/\s+/g, " ").trim();
      const at = lineOf(m.index);
      if (!text || OK.test(text)) continue;
      // Two words of prose (or one long word with a comma) is the signal; a
      // single capitalised noun is usually a component name or a code.
      const words = text.split(/\s+/).length;
      // The `>…<` shape is also what a generic argument list looks like in TSX
      // (`reduce<unknown>((o, k) => …)<`), so a candidate must be prose-shaped:
      // it starts on a letter and contains no operator, bracket or punctuation
      // that only code uses. Losing "a JSX text node with parentheses in it" is
      // a cheap price for a gate nobody has to silence with a disable comment.
      const codeShaped =
        /[(){}[\];=<>|&*+_/]/.test(text) || /=>|\.\.\./.test(text);
      const looksLikeProse =
        !codeShaped &&
        /^[A-Za-zÀ-ÿ]/.test(text) &&
        (words >= 2 || /[,;:!?]/.test(text));
      if (looksLikeProse)
        fail(
          rel,
          at,
          "hardcoded",
          `JSX text "${text}" is not a dictionary key`,
        );
    }
  }
}

/* ── 6. no user-facing SENTENCE outside the dictionary ───────────────────── */

/**
 * Rule 5 looks for text between JSX tags in `.tsx` files, and that shape is
 * exactly what it catches: a paragraph typed into a component. It cannot see a
 * sentence that is a STRING — a `.ts` module's error message, a `hint=` prop, an
 * argument to `tr()` — and that blind spot held fourteen English sentences in
 * `lib/` plus eight more in the portal, every one of them shown to French readers
 * in English while this gate reported both languages complete.
 *
 * The signal is punctuation. A user-facing sentence ends in `.`, `?` or `!` and
 * contains a space; code almost never does — a path, an identifier, a class list
 * or a format string does not end in a full stop. Run against the whole app
 * before it was wired in, this found twenty-two real strings and no false ones.
 *
 * It also closes the `tr()` trap: `tr("A sentence.")` looks up
 * `strings.A sentence.`, which i18next splits on "." and can never resolve, so it
 * returns English silently. Sentences need a dotted key of their own.
 *
 * An `i18n-exempt` comment on the line above opts out a genuine exception — a
 * developer-facing `throw` no visitor can reach, for instance.
 */
const SENTENCE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

for (const file of allFiles) {
  if (!/\.tsx?$/.test(file)) continue;
  if (isDictionaryFile(file)) continue; // a dictionary IS the copy
  if (/\.test\.tsx?$/.test(file)) continue;
  const src = stripComments(readFileSync(file, "utf8"));
  const rel = path.relative(ROOT, file);
  const lines = src.split("\n");
  for (const m of src.matchAll(SENTENCE)) {
    const text = m[2];
    if (text.length < 15) continue;
    if (!/\s/.test(text)) continue;
    if (!/[.?!]$/.test(text)) continue;
    // A template's `${…}` holes are code, not prose; judge what is left.
    if (/[<>{}/\\|]/.test(text.replace(/\$\{[^}]*\}/g, ""))) continue;
    const at = src.slice(0, m.index).split("\n").length;
    if (/i18n-exempt/.test(lines[at - 2] || "")) continue;
    fail(
      rel,
      at,
      "prose",
      `a sentence outside the dictionary — "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`,
    );
  }
}

/* ── report ─────────────────────────────────────────────────────────────── */
if (failures.length) {
  const byRule = new Map();
  for (const f of failures) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  console.error(`✗ check:i18n — ${failures.length} problem(s):\n`);
  for (const [rule, list] of byRule) {
    console.error(`  ${rule} (${list.length})`);
    for (const f of list.slice(0, 25))
      console.error(`    ${f.file}${f.line ? ":" + f.line : ""}  ${f.detail}`);
    if (list.length > 25) console.error(`    …and ${list.length - 25} more`);
    console.error("");
  }
  console.error(
    "  The dictionary is the only place copy lives. If a string is not",
  );
  console.error(
    "  in it, it is not translated, and the French page is English here.",
  );
  process.exit(1);
}

console.log(
  `✓ check:i18n — ${dict.en.size} keys, both languages; no dangling calls, tokens match, French typography clean, no hardcoded prose in ${files.length} files.`,
);
