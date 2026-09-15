#!/usr/bin/env node
/**
 * The day-first gate — dates are dd/mm/yyyy, everywhere, forever.
 *
 * ── WHY THIS IS A BUILD GATE AND NOT A CODE-REVIEW HABIT ───────────────────
 *
 * Praxis serves the Cameroon / OHADA corridor, where a date is read day-first.
 * A month-first date is not a cosmetic slip: 03/07/2026 is a real date under
 * both readings, so nothing downstream ever throws, no test goes red, and the
 * screen looks perfectly fine to whoever built it. The defect surfaces four
 * months later as a licence that expired in a month nobody expected, a customs
 * deadline missed by a quarter, or a payroll run dated to the wrong period.
 *
 * That is exactly the shape of defect a gate is for — invisible to the author,
 * expensive to the operator, and re-introduced the moment attention lapses.
 *
 * ── AND WHY IT KEEPS COMING BACK WITHOUT ONE ───────────────────────────────
 *
 * Because the month-first version is what you get by DEFAULT, three times over:
 *
 *   1. `<input type="date">` renders in the operating-system locale. There is
 *      no attribute that overrides it — `lang` is ignored for the value
 *      display — so the control is month-first on a US-configured machine no
 *      matter what the app does. `DateField` exists for this, and this gate is
 *      what makes it the only option rather than the recommended one.
 *   2. `toLocaleDateString()` with no locale means "whichever locale this
 *      machine happens to have". In a container with no LANG that resolves to
 *      en-US, so SERVER-rendered dates were month-first too.
 *   3. `"en-US"` written out explicitly, usually copied from a snippet.
 *
 * ── WHAT IT FLAGS ──────────────────────────────────────────────────────────
 *
 *   native-date-input    a native `type="date"` / `type="datetime-local"`
 *                        control — BOTH render their date part in the OS
 *                        locale, and the second was missed on the first pass
 *                        purely because it carries a different `type`
 *   floating-locale      an order-sensitive date format with no locale pinned
 *   month-first-locale   an order-sensitive date format pinned to en-US / en
 *   month-first-literal  the token MM/DD/YYYY written into code
 *   iso-date-on-paper    a date rendered ISO where a PERSON reads it — a
 *                        document template, a spreadsheet number format
 *
 * "Order-sensitive" is the whole precision of this gate. A format renders a day
 * NUMBER next to a month only when its options are absent (the default is
 * numeric d/m/y) or carry `day:` / `dateStyle:`. `{ month: "long" }` is a month
 * NAME with no order to get wrong, and flagging it would be noise — and a gate
 * that cries wolf gets switched off.
 *
 * ── THE TWO WAYS OUT, BOTH OF WHICH COST A SENTENCE ────────────────────────
 *
 * Some code legitimately handles a month-first date. It is always one of two
 * things, and each needs the marker that says which:
 *
 *   `@date-format:parts`   — `Intl.DateTimeFormat` built to call
 *                            `formatToParts()` and read named fields off it, or
 *                            to probe a timezone for validity. Nothing is ever
 *                            rendered, so the locale cannot reach a reader.
 *   `@date-format:foreign` — a date format that belongs to somebody ELSE's
 *                            file. A Cameroonian bank may well send a statement
 *                            in MM/DD/YYYY; refusing to parse it does not make
 *                            the statement day-first, it makes the import fail.
 *
 * Put the marker in a comment on the offending line or the line above it, with
 * a reason after it, exactly as `@silent:` markers work in doc/ERROR_HANDLING.md.
 * Whole files that exist to deal with foreign date formats are listed in
 * ALLOW_FILES below instead, each with its reason.
 *
 * Exits 1 on any violation. Wired into .github/workflows/ci.yaml and
 * `npm run ci` (scripts/ci-local.js).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** Trees that ship or run. Docs are prose — a guide that SAYS "never mm/dd/yyyy"
 *  must not be what fails the build. */
const ROOTS = [
  "src",
  "scripts",
  "packages",
  "client/src",
  "client/scripts",
  "platform-console/src",
  "public-web/src",
  "tests",
];

const EXTS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx"]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", ".git", "__snapshots__",
]);

/**
 * Files excused from specific rules, each with the reason — the hatch
 * `eslint-disable-next-line praxis/no-native-dialogs` is to the dialog ban, and
 * `ALLOW_LOCAL_SCHEMA` is to the shared-schema gate.
 *
 * Per RULE, never blanket. The bank-import module has to know the string
 * "MM/DD/YYYY" exists; that is not permission to put a month-first CONTROL in
 * front of an operator, and an entry that excused the whole file would grant
 * exactly that the day someone adds a form to it.
 */
const ALLOW_FILES = {
  "src/modules/master/reconciliation/reconciliation.rules.js": {
    rules: ["month-first-literal"],
    why: "Bank-statement import. Banks send the format they send; this module's " +
      "job is to detect it — including month-first — and normalise it to ISO. " +
      "It is the one place that must know MM/DD/YYYY exists.",
  },
  "client/src/features/master/treasury/reconciliation-tab.tsx": {
    rules: ["month-first-literal"],
    why: "The operator's format picker for a bank file they are importing. It " +
      "names the bank's format, not ours.",
  },
  "tests/unit/reconciliation-rules.test.js": {
    rules: ["month-first-literal"],
    why: "Tests the month-first branch of the bank-statement parser above.",
  },
  "client/src/features/master/treasury/reconciliation-tab.test.tsx": {
    rules: ["month-first-literal"],
    why: "Tests the format picker above.",
  },
  "scripts/check-date-format.js": {
    rules: ["month-first-literal", "native-date-input", "month-first-locale", "floating-locale"],
    why: "This gate. It has to spell out every pattern it bans.",
  },
  "tests/unit/date-format-gate.test.js": {
    rules: ["month-first-literal", "native-date-input", "month-first-locale", "floating-locale"],
    why: "Tests this gate, and every fixture in it is a violation on purpose.",
  },
  "client/src/components/ui/date-field.tsx": {
    rules: ["native-date-input"],
    why: "The day-first control itself. Its hidden native input lends the " +
      "calendar popup and nothing else — it is never what the operator reads, " +
      "and it is what makes every other native date input unnecessary.",
  },
  "platform-console/src/components/DateField.tsx": {
    rules: ["native-date-input"],
    why: "The console's twin of the above.",
  },
  "client/src/components/ui/datetime-field.tsx": {
    rules: ["native-date-input"],
    why: "`DateField`'s sibling for a date AND a time. Same arrangement: the " +
      "hidden native control lends its picker and is never read.",
  },
  "platform-console/src/components/DateTimeField.tsx": {
    rules: ["native-date-input"],
    why: "The console's twin of the above.",
  },
};

/** The rules an allowlist entry lets through for `rel`. */
function allowedRules(rel) {
  const entry = ALLOW_FILES[rel];
  return entry ? entry.rules : [];
}

/** Locales that render a date month-first. */
const MONTH_FIRST_LOCALE = /^["'](en-US|en-PH|en|und)["']$/;

/**
 * Files that must stay byte-identical, because they are the same logic compiled
 * into two apps that cannot import from each other.
 *
 * `client/` and `platform-console/` each build in their own Docker stage, and
 * the console's stage copies ONLY `platform-console/` — deliberately: the other
 * two stages copy the whole repo because they have `file:..` dependencies, and
 * the console has none. So a relative import into `client/` resolves in a
 * checkout, passes `vite build` locally, and fails inside the image. (It did.)
 *
 * Duplication answered by a gate rather than by trust: "a second copy of a gate
 * is a gate that drifts" is the reason the ESLint rules have one copy, and the
 * same worry applies here. This makes drift impossible instead of unlikely.
 */
/**
 * Rendering paths whose output a PERSON reads: a printed document, a file they
 * open in Excel. ISO is banned here and nowhere else — see rule 4a.
 */
const PAPER_SURFACES = [
  "src/services/documents/templates/",
  "src/services/spreadsheet/",
];

const TWINS = [
  ["client/src/lib/day-first-date.ts", "platform-console/src/lib/day-first-date.ts"],
];

/* ── source scanning ─────────────────────────────────────────────────────── */

/**
 * Blank out COMMENTS, keeping line structure and length.
 *
 * Comments must not be scanned: this file's own header names every pattern it
 * bans, and so do the guides — a document that says "never mm/dd/yyyy" must not
 * be the thing that fails the build. Spaces rather than deletion so the line
 * numbers reported still point at the real source.
 *
 * String bodies deliberately SURVIVE. Every pattern worth catching lives inside
 * one: `type="date"`, the locale `"en-US"`, the literal `"MM/DD/YYYY"`. An
 * earlier draft of this gate blanked strings too and therefore reported a clean
 * tree over real violations — a gate that passes vacuously is worse than no
 * gate, because it is trusted.
 */
function blankNonCode(source) {
  const out = source.split("");
  let i = 0;
  const n = source.length;
  let state = "code";
  let quote = "";
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; out[i] = out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; out[i] = out[i + 1] = " "; i += 2; continue; }
      // A regex literal, not division. It has to be recognised or the scanner
      // DESYNCS: `/^["'](en-US)["']$/` holds two quote characters, and treating
      // them as string delimiters swallows the rest of the file — which is how
      // an earlier draft reported a clean tree over real violations.
      if (c === "/" && startsRegex(source, i)) { state = "regex"; i += 1; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; i += 1; continue; }
      i += 1; continue;
    }
    if (state === "regex") {
      if (c === "\\") { i += 2; continue; }
      if (c === "[") { state = "class"; i += 1; continue; }
      if (c === "/" || c === "\n") { state = "code"; i += 1; continue; }
      i += 1; continue;
    }
    if (state === "class") {
      if (c === "\\") { i += 2; continue; }
      if (c === "]") { state = "regex"; i += 1; continue; }
      if (c === "\n") { state = "code"; i += 1; continue; }
      i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; i += 1; continue; }
      out[i] = " "; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; out[i] = out[i + 1] = " "; i += 2; continue; }
      if (c !== "\n") out[i] = " ";
      i += 1; continue;
    }
    // state === "string": the body is KEPT (see the header). We track the string
    // only so that a `//` inside a URL does not open a comment, and so that an
    // apostrophe in a comment cannot open a string.
    if (c === "\\") { i += 2; continue; }
    if (c === quote) { state = "code"; i += 1; continue; }
    if (quote === "`" && c === "$" && next === "{") { i += 2; continue; }
    i += 1;
  }
  return out.join("");
}

/**
 * Is the `/` at `i` the start of a regex literal rather than a division?
 *
 * Decided by what precedes it, which is how every hand-written JS scanner does
 * it: division follows a VALUE (identifier, number, `)`, `]`), a regex follows
 * an operator, a bracket that opens, or a keyword.
 */
function startsRegex(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  const prev = source[j];
  if (/[)\]]/.test(prev)) return false;
  if (/[\w$]/.test(prev)) {
    const word = /[\w$]+$/.exec(source.slice(0, j + 1));
    return Boolean(word) && /^(return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(word[0]);
  }
  return true;
}

/** The balanced `(...)` argument text starting at `open`, or "" if unbalanced. */
function argsAt(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * Does this argument list render a day NUMBER beside a month — the only case
 * where the order can be wrong?
 *
 * No options at all is the dangerous default (numeric d/m/y). `day:` or
 * `dateStyle:` makes it explicit. `{ month: "long" }` alone is a month name
 * with no order in it, and `{ hour, minute }` is a time.
 */
function orderSensitive(args) {
  const opts = args.slice(args.indexOf(",") + 1);
  if (args.indexOf(",") === -1 || !/\{/.test(opts)) return true;
  return /\b(day|dateStyle)\s*:/.test(opts);
}

/** The locale argument as written, or "" when the call passes none. */
function localeArg(args) {
  const first = (args.split(",")[0] || "").trim();
  if (!first || first === "undefined" || first === "[]") return "";
  return first;
}

/**
 * Is there a `@date-format:<class>` marker on this line, or in the comment
 * block immediately above it?
 *
 * The block, not just one line: the marker has to carry a REASON, and a reason
 * worth reading rarely fits beside the code. So the search walks up through
 * contiguous comment lines and stops at the first line that is not one — which
 * keeps a waiver attached to the statement it excuses rather than drifting up
 * the file. Capped so a marker cannot silently cover a whole screenful.
 */
const WAIVER = /@date-format:(parts|foreign|filename)\b/;

function waived(lines, codeLines, index) {
  if (WAIVER.test(lines[index] || "")) return true;
  for (let i = index - 1; i >= 0 && index - i <= 8; i -= 1) {
    // "Is this line a comment?" is answered by the comment MASK, not by a
    // regex for `*` or `//`. The continuation lines of a `/* … */` block start
    // with neither, and a waiver whose reason runs to a second line is the
    // normal case, not the exception.
    if ((codeLines[i] || "").trim()) return false;
    if (WAIVER.test(lines[i] || "")) return true;
  }
  return false;
}

/**
 * Flag every month-first risk in one file. Exported so the gate's JUDGEMENT can
 * be tested directly rather than through the filesystem.
 */
function scanSource(source, rel) {
  const problems = [];
  const lines = source.split("\n");
  const code = blankNonCode(source);
  const codeLines = code.split("\n");
  const lineOf = (offset) => source.slice(0, offset).split("\n").length;
  const allowed = allowedRules(rel);
  const add = (offset, rule, hint) => {
    if (allowed.includes(rule)) return;
    const at = lineOf(offset);
    if (waived(lines, codeLines, at - 1)) return;
    problems.push({ rel, at, rule, hint, line: (lines[at - 1] || "").trim().slice(0, 160) });
  };

  // 1 — native date controls.
  for (const m of code.matchAll(/type\s*=\s*["'](date|datetime-local)["']/g)) {
    add(m.index, "native-date-input",
      m[1] === "date"
        ? "Use <DateField> — a native date input renders in the OS locale."
        : "Use <DateTimeField> — `datetime-local` renders its DATE part in the " +
          "OS locale too, which is the same defect with a different `type`.");
  }

  // 2/3 — order-sensitive date formatting with no locale, or a month-first one.
  const CALLS = [
    /\.toLocaleDateString\s*\(/g,
    /\.toLocaleString\s*\(/g,
    /new\s+Intl\.DateTimeFormat\s*\(/g,
  ];
  for (const [which, re] of CALLS.entries()) {
    for (const m of code.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const args = argsAt(code, open);

      // `.toLocaleString` is a Number method too, and money must not be flagged.
      // Only treat it as a date when it formats one: a `new Date(…)` receiver,
      // or date-shaped options.
      if (which === 1) {
        const before = code.slice(Math.max(0, m.index - 120), m.index);
        const isDate =
          /new\s+Date\s*\([^)]*\)\s*$/.test(before) ||
          /\b(day|dateStyle|weekday)\s*:/.test(args);
        if (!isDate) continue;
      }

      if (!orderSensitive(args)) continue;
      const locale = localeArg(args);
      if (!locale) {
        add(m.index, "floating-locale",
          "Pin the locale (en-GB) or build the string by hand — no locale means " +
          "whatever the machine is set to, which is month-first on a US workstation.");
      } else if (MONTH_FIRST_LOCALE.test(locale)) {
        add(m.index, "month-first-locale",
          `${locale} renders dates month-first. Use "en-GB", or the app's own locale helper.`);
      }
    }
  }

  // 4a — an ISO date rendered where a PERSON reads it.
  //
  // ISO is not wrong the way month-first is — it is unambiguous — so this rule
  // is deliberately narrow. It fires only in the rendering paths listed in
  // PAPER_SURFACES: a document template, a spreadsheet number format. Everywhere
  // else ISO is the CORRECT answer — it is the wire format the API contract, the
  // `@shared` validators and every `date` column are built on, and a gate that
  // discouraged it generally would be telling people to break the product.
  if (PAPER_SURFACES.some((dir) => rel.startsWith(dir))) {
    for (const m of code.matchAll(/["'`]y{2,4}[-/]m{1,2}[-/]d{1,2}/gi)) {
      add(m.index, "iso-date-on-paper",
        "This is read by a person. Praxis prints dates dd/mm/yyyy — the stored " +
        "value stays ISO.");
    }
    for (const m of code.matchAll(/toISOString\(\)\s*\.\s*slice\(0, *10\)/g)) {
      add(m.index, "iso-date-on-paper",
        "An ISO day where a person reads it. Print dd/mm/yyyy; keep ISO for the " +
        "wire. (A FILENAME is the exception — `/` is not legal in one — so mark " +
        "it @date-format:filename with the reason.)");
    }
  }

  // 4b — the format written out as a literal.
  for (const m of code.matchAll(/\bMM[/.-]DD[/.-](YYYY|YY)\b/gi)) {
    add(m.index, "month-first-literal",
      "Praxis writes dates dd/mm/yyyy. If this names an INCOMING third-party " +
      "format, mark it @date-format:foreign with the reason.");
  }

  return problems;
}

/* ── walking the tree ────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function main() {
  const files = ROOTS.flatMap((r) => walk(path.join(ROOT, r)));
  const problems = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    problems.push(...scanSource(fs.readFileSync(file, "utf8"), rel));
  }

  // The twins. A drift here is not a "risk" like the scans above — it is two
  // apps that have already stopped agreeing on what a date is — so it is
  // reported on its own terms, with the command that fixes it.
  const drifted = [];
  for (const [a, b] of TWINS) {
    const pa = path.join(ROOT, a);
    const pb = path.join(ROOT, b);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) { drifted.push([a, b, "one of them is missing"]); continue; }
    if (fs.readFileSync(pa, "utf8") !== fs.readFileSync(pb, "utf8")) {
      drifted.push([a, b, "they differ"]);
    }
  }

  if (drifted.length) {
    console.error(`\n${drifted.length} day-first twin(s) out of sync.\n`);
    console.error("These files are the same logic built into two apps that cannot import from");
    console.error("each other — the console's Docker stage copies only platform-console/. They");
    console.error("must be byte-identical, or the two apps disagree about what a date is.\n");
    for (const [a, b, why] of drifted) {
      console.error(`  ${a}`);
      console.error(`  ${b}`);
      console.error(`      → ${why}. Fix: cp ${a} ${b}\n`);
    }
  }

  if (!problems.length && !drifted.length) {
    console.warn(`Day-first date gate OK — ${files.length} file(s), no month-first dates.`);
    return 0;
  }
  if (!problems.length) return 1;

  console.error(`\n${problems.length} month-first date risk(s).\n`);
  console.error("Praxis serves a corridor that reads dates day-first. A month-first date");
  console.error("is still a valid date, so nothing throws and no test goes red — it is read");
  console.error("wrong, months later, by someone acting on it.\n");
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.at}  [${p.rule}]`);
    console.error(`      ${p.line}`);
    console.error(`      → ${p.hint}`);
  }
  console.error("\nLegitimately handling somebody else's format? Mark the line");
  console.error("@date-format:foreign (an incoming third-party format),");
  console.error("@date-format:parts (Intl used only for formatToParts), or");
  console.error("@date-format:filename (an ISO day in a filename), with a reason.\n");
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { TWINS, blankNonCode, orderSensitive, localeArg, waived, scanSource, allowedRules, ALLOW_FILES };
