#!/usr/bin/env node
/**
 * The backend R1 — every `catch` block whose body is empty or comment-only
 * must carry a `@silent:storage`, `@silent:parse`, or `@silent:teardown`
 * marker (in a block comment inside the catch body) to identify which class
 * from doc/ERROR_HANDLING.md sanctions the swallow.
 *
 * WHAT THIS IS AND ISN'T
 *
 * It is a scanner, not a parser. The vast majority of swallow sites are one
 * of two shapes:
 *
 *   try { ... } catch { }                        // silent, body empty
 *   try { ... } catch (e) { <block comment> }    // silent, body a comment
 *
 * The scanner requires the body's block comment to contain the marker —
 * `@silent:teardown` inside `catch (e) { ... }`, or `@silent:parse -- bad
 * cache entry` inside `catch { ... }`. See doc/ERROR_HANDLING.md for the
 * fully-worked syntax; embedding a literal `/* ... *&#47;` in this docstring
 * would either close the outer comment or need zero-width-space escapes that
 * `no-irregular-whitespace` correctly rejects, so it's described rather than
 * quoted here.
 *
 * It doesn't try to understand richer swallow shapes ("logs to a NEVER-checked
 * variable then throws away", etc.). Those are R2/R3's territory.
 *
 * BASELINE. Ships with `doc/silent-catch-baseline.json`. Adding a new silent
 * catch requires either fixing it — the whole programme's point — or adding a
 * marker with the taxonomy class in the same commit. Existing violations are
 * grandfathered by the baseline so the ratchet works.
 *
 *   node scripts/check-silent-catch.js
 *   node scripts/check-silent-catch.js --update
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "doc", "silent-catch-baseline.json");
const UPDATE = process.argv.includes("--update");

const MARKER_RE = /@silent:(storage|parse|teardown)\b/;

/**
 * Scan the file for `catch(...) { <body> }` blocks and return the ones whose
 * body is empty, whitespace, or only a comment WITHOUT a taxonomy marker.
 * Returns `[{ file, line, snippet }]`.
 */
function scanSilentCatches(file) {
  const src = fs.readFileSync(file, "utf8");
  const violations = [];

  // catch (…)? followed by an opening brace. Use a manual brace-balance walk
  // rather than a regex so nested braces inside the body don't fool us.
  const catchRe = /\bcatch\s*(?:\(\s*[^)]*\s*\))?\s*\{/g;
  let m;
  while ((m = catchRe.exec(src)) !== null) {
    const start = m.index + m[0].length; // position just past the opening `{`
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      // Track through strings so a `}` inside a template literal doesn't
      // close the block. Backslash-escaped chars are just skipped.
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i += 1;
        while (i < src.length) {
          if (src[i] === "\\") { i += 2; continue; }
          if (src[i] === quote) { i += 1; break; }
          i += 1;
        }
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") { depth -= 1; if (depth === 0) break; }
      i += 1;
    }
    if (depth !== 0) continue; // malformed source; nothing sensible to say
    const body = src.slice(start, i);

    // Strip comments: whatever remains is what the runtime would execute.
    // A body containing only whitespace after this strip is a silent catch.
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .trim();

    if (stripped.length > 0) continue; // has real code — not silent
    if (MARKER_RE.test(body)) continue; // explicitly classified

    const line = src.slice(0, m.index).split("\n").length;
    const snippet = src.slice(m.index, i + 1).replace(/\s+/g, " ").slice(0, 120);
    /*
     * POSIX separators, ALWAYS — the baseline key is `file:line`.
     *
     * `path.relative` is platform-native, so this yielded
     * `src\jobs\mail-idle.js` on Windows while the committed baseline (written
     * on a Linux runner) holds `src/jobs/mail-idle.js`. Every one of the 45
     * grandfathered sites therefore missed its key and was reported as NEW —
     * the ratchet appearing to have slipped by 45 notches, on a checkout where
     * nothing had changed.
     *
     * That failure is the wrong way round for a guard: it is green where the
     * baseline was written and red everywhere else, so the platform that sees
     * the false alarm is the one that cannot tell it is false. Normalising here
     * also keeps `--update` from rewriting the whole baseline into backslashes
     * the moment somebody re-blesses it from Windows.
     */
    violations.push({ file: path.relative(ROOT, file).split(path.sep).join("/"), line, snippet });
  }
  return violations;
}

function walkFiles(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "coverage") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, fn);
    else fn(full);
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { entries: [] };
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); }
  catch { return { entries: [] }; }
}

function saveBaseline(baseline) {
  const dir = path.dirname(BASELINE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sorted = {
    _note: baseline._note || "Committed allow-list for scripts/check-silent-catch.js. Each entry is a file+line of a silent backend catch grandfathered when the scanner was introduced; PR2's work is to burn this list down by classifying each site with a @silent:storage|parse|teardown marker or replacing the catch with real handling.",
    entries: [...baseline.entries]
      .map((e) => ({ file: e.file, line: e.line }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function main() {
  const violations = [];
  walkFiles(path.join(ROOT, "src"), (f) => {
    if (!/\.(js|ts)$/.test(f)) return;
    if (/\.(test|spec)\.(js|ts)$/.test(f)) return;
    for (const v of scanSilentCatches(f)) violations.push(v);
  });

  const baseline = loadBaseline();
  const grand = new Set(baseline.entries.map((e) => `${e.file}:${e.line}`));
  const fresh = violations.filter((v) => !grand.has(`${v.file}:${v.line}`));

  if (UPDATE) {
    saveBaseline({ ...baseline, entries: violations.map((v) => ({ file: v.file, line: v.line })) });
    console.warn(`Baseline updated. ${violations.length} silent catch(es) grandfathered.`);
    process.exit(0);
  }

  if (fresh.length === 0) {
    console.warn(
      `Silent-catch scan: ${violations.length} total silent catch(es); ` +
        `${baseline.entries.length} in baseline; 0 new.`,
    );
    process.exit(0);
  }

  console.warn(`\n${fresh.length} NEW silent catch(es) — each must carry a taxonomy marker (see doc/ERROR_HANDLING.md):\n`);
  for (const v of fresh) {
    console.warn(`  ${v.file}:${v.line}   ${v.snippet}`);
  }
  console.warn(
    "\nFix by one of:\n" +
      "  · convert to real handling (log, throw, or route through the reporter)\n" +
      "  · add /* @silent:storage|parse|teardown */ inside the catch body, with a\n" +
      "    one-line reason why the failure is safe to drop.\n",
  );
  process.exit(1);
}

main();
