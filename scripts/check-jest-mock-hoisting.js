#!/usr/bin/env node
/**
 * Fail the build on a `jest.mock()` factory that closes over an out-of-scope
 * variable whose name does not begin with `mock`.
 *
 * WHY THIS EXISTS
 *
 * Jest's babel transform HOISTS `jest.mock(...)` above the imports, so a
 * factory referencing a module-scope variable would run before that variable is
 * initialised. Babel therefore rejects it outright:
 *
 *     The module factory of `jest.mock()` is not allowed to reference any
 *     out-of-scope variables.  Invalid variable access: fakeClient
 *
 * The escape hatch is the name: anything matching /^mock/i is permitted,
 * because the convention signals that the author knows it is lazily required.
 *
 * The failure this guards against is not the rule itself — it is that the rule
 * is invisible until someone actually runs Jest. Eleven suites in this repo
 * violated it simultaneously, six of them written across earlier sessions, and
 * every one had been "verified" under a substitute runner that does not use
 * babel and therefore never enforced it. The suites did not fail slowly; they
 * failed the first time `npm test` ran, all at once.
 *
 * A cheap static check turns that into a build error at the moment the file is
 * written, whatever anyone is using to run the tests locally.
 *
 * SCOPE OF THE CHECK: source text, not a full AST. It resolves declarations and
 * parameters inside the factory, skips string/comment content and property
 * keys, and only flags a name that is declared at the top level of the same
 * test file — which is exactly the shape babel rejects. A false positive costs
 * a rename; a false negative costs a green run that means nothing.
 *
 * Exits 1 on any violation.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TESTS = path.join(ROOT, "tests");

/** Globals babel's check permits inside a factory. */
const ALLOWED = new Set(
  ("Array Object JSON Math Date Promise Set Map Symbol Error String Number Boolean RegExp "
    + "console process require module exports jest expect global globalThis undefined null "
    + "true false Buffer URL URLSearchParams TextEncoder TextDecoder structuredClone crypto "
    + "fetch setTimeout clearTimeout setInterval clearInterval setImmediate parseInt parseFloat "
    + "isNaN Infinity NaN __dirname __filename arguments WeakMap WeakSet Proxy Reflect BigInt "
    + "AbortController Response Request Headers Blob File FormData Intl Number Symbol "
    + "return if else for while of in new typeof void delete instanceof await async function "
    + "const let var class throw try catch finally do switch case break continue default "
    + "this super yield export import extends null true false").split(" "),
);

/**
 * Blank out string/comment content before scanning for identifiers.
 *
 * PER LINE, deliberately. A first version matched strings across the whole
 * file, and test files here contain REGEX LITERALS with quote characters in
 * them — `/WHERE "?inventory_item_id"? = \$1/`. Those quotes paired up with
 * unrelated ones elsewhere, so the mask swallowed whole regions of real code
 * and the checker reported a file CLEAN that Jest then rejected.
 *
 * That is the same defect this script exists to prevent, committed by the
 * script itself: a check that cannot fail is worse than no check, because it is
 * counted. Confining the mask to one line bounds the damage of an unbalanced
 * quote to that line, and a stray identifier surviving into the scan is only a
 * false positive — which costs a rename, not a green run that means nothing.
 *
 * Block comments are handled separately, since those genuinely do span lines.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_MASK = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$/g;

function maskLiterals(src) {
  const noBlocks = src.replace(BLOCK_COMMENT, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => line.replace(LINE_MASK, (m) => " ".repeat(m.length)))
    .join("\n");
}

/** Walk from `start` to the matching close bracket. */
function matchingEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

function localNames(body) {
  const names = new Set();
  // declarations
  for (const m of body.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  // destructured declarations
  for (const m of body.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const tok of m[1].split(/[,\s:]+/)) if (/^[A-Za-z_$][\w$]*$/.test(tok)) names.add(tok);
  }
  // arrow and function parameters — `(a, b) =>`, `a =>`, `function (a, b)`
  for (const m of body.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const tok of m[1].split(/[,\s{}[\]:=]+/)) if (/^[A-Za-z_$][\w$]*$/.test(tok)) names.add(tok);
  }
  for (const m of body.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of body.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)) {
    for (const tok of m[1].split(/[,\s{}[\]:=]+/)) if (/^[A-Za-z_$][\w$]*$/.test(tok)) names.add(tok);
  }
  // object METHOD shorthand params: `foo(a, b) {`
  for (const m of body.matchAll(/(?:^|[,{])\s*\w+\s*\(([^)]*)\)\s*\{/g)) {
    for (const tok of m[1].split(/[,\s{}[\]:=]+/)) if (/^[A-Za-z_$][\w$]*$/.test(tok)) names.add(tok);
  }
  return names;
}

/** Names declared at the TOP LEVEL of the test file — the ones babel objects to. */
function topLevelNames(masked) {
  const names = new Set();
  for (const m of masked.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  for (const m of masked.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}/gm)) {
    for (const tok of m[1].split(/[,\s:]+/)) if (/^[A-Za-z_$][\w$]*$/.test(tok)) names.add(tok);
  }
  return names;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function main() {
  const violations = [];

  for (const file of walk(TESTS)) {
    const raw = fs.readFileSync(file, "utf8");
    const masked = maskLiterals(raw);
    const declaredTop = topLevelNames(masked);

    // jest.doMock is deliberately NOT checked: it is the UN-HOISTED form, so a
      // factory may legally close over anything already initialised. Treating the
      // two alike produced a false positive on asset-depreciation-gl.test.js,
      // which passes under real Jest precisely because it uses doMock.
      for (const m of masked.matchAll(/jest\.mock\s*\(/g)) {
      const open = masked.indexOf("(", m.index);
      const close = matchingEnd(masked, open);
      const call = masked.slice(open, close + 1);
      const comma = call.indexOf(",");
      if (comma === -1) continue; // auto-mock, no factory
      const body = call.slice(comma + 1);
      const local = localNames(body);

      const seen = new Set();
      for (const im of body.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)(?!\s*:)/g)) {
        const name = im[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (/^mock/i.test(name)) continue;
        if (ALLOWED.has(name)) continue;
        if (local.has(name)) continue;
        if (!declaredTop.has(name)) continue;

        const line = raw.slice(0, open + comma + 1 + im.index).split("\n").length;
        violations.push({
          file: path.relative(ROOT, file),
          line,
          name,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.warn("jest.mock factories OK — no out-of-scope references.");
    return 0;
  }

  console.error(
    `\n${violations.length} jest.mock factory reference(s) that real Jest REJECTS.\n\n`
      + "Jest hoists jest.mock above the imports, so a factory that closes over a\n"
      + "module-scope variable runs before that variable exists. Babel refuses it:\n\n"
      + "    The module factory of `jest.mock()` is not allowed to reference any\n"
      + "    out-of-scope variables.\n\n"
      + "Fix: rename the variable so it starts with `mock` (the name Jest permits),\n"
      + "or move it inside the factory.\n",
  );
  for (const v of violations) {
    const suggested = `mock${v.name[0].toUpperCase()}${v.name.slice(1)}`;
    console.error(`  ${v.file}:${v.line}  "${v.name}"  ->  "${suggested}"`);
  }
  console.error("");
  return 1;
}

process.exit(main());
