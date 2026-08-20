#!/usr/bin/env node
/**
 * SS4 — prevention, not just repair.
 *
 * The extra-charge simulator shipped the legacy Rate Configuration screenshot
 * frozen into JavaScript:
 *
 *     fx: { XAF: 1, USD: 615, EUR: 655.957 }
 *
 * A finished currency module (master/currency — GET /currencies, /rates,
 * /rate, /convert, rateFor, rateMap) already serves live FX from
 * fx_rate_daily; the literal was a second copy that never moved when the
 * treasurer changed a rate. The margin simulator made it worse by accepting a
 * free-text 3-char currency that is a char(3) FK to currency(code), so typing
 * an unlisted code raised a raw 23503 instead of a useful message.
 *
 * This guard fails the build if a hardcoded FX rate literal — a currency code
 * mapped to a positive numeric rate — appears in the costing or commercial
 * modules. The base anchor `XAF: 1` is allowed (it is not a rate, it is the
 * identity); everything else must come from the currency module.
 *
 * It deliberately does NOT ban the string "XAF" (that is a legitimate default
 * currency in schema, tests and labels), only code-shaped rate literals that
 * look like a hand-typed FX table.
 *
 * Exits 1 on any violation. Wired into .github/workflows/ci.yaml alongside
 * check-actor-fk-guard.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOTS = [
  path.join(__dirname, "..", "src", "modules", "costing"),
  path.join(__dirname, "..", "src", "modules", "commercial"),
];

/**
 * An FX rate literal: an ISO 4217 alpha code as an object key with a positive
 * numeric value. Matches `USD: 615`, `EUR: 655.957`, `"USD":615`, `'EUR': 2`.
 * The identity anchor XAF→1 is explicitly allowed (it converts base to itself).
 */
const RATE_LITERAL = /\b([A-Z]{3})\s*:\s*([0-9]+(?:\.[0-9]+)?)\b/;
const IDENTITY = /\bXAF\s*:\s*1\b/;

/** Comment lines are not code — strip them before scanning. */
const stripComments = (line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function main() {
  const violations = [];
  const files = ROOTS.flatMap((r) => walk(r));

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, i) => {
      const line = stripComments(raw);
      const m = RATE_LITERAL.exec(line);
      if (!m) return;
      const [, code, value] = m;
      if (code === "XAF" && Number(value) === 1) return; // base identity anchor
      // Only flag things that are plausibly an FX map (currency-ish codes next
      // to a rate), not every UPPERCASE: number (e.g. HTTP status maps).
      if (/^(XAF|XOF|EUR|USD|GBP|NGN|CNY|CHF|JPY|CAD|GHS|ZAR|KES|MAD|EGP)$/.test(code)) {
        violations.push({
          file: path.relative(path.join(__dirname, ".."), file),
          line: i + 1,
          code,
          value,
          text: raw.trim().slice(0, 120),
        });
      }
    });
  }

  if (violations.length === 0) {
    console.warn("Currency-literal guard OK — no hardcoded FX rates in costing/commercial.");
    return 0;
  }

  console.error(
    `\n${violations.length} hardcoded FX rate literal(s) in costing/commercial (SS4).\n\n` +
      "Currency conversion must use the currency module (rateFor/rateMap in\n" +
      "src/modules/master/currency, GET /currencies/rate). A frozen literal like\n" +
      "{ USD: 615 } keeps quoting yesterday's rate after the treasurer edits today's.\n\n" +
      "The only allowed constant is the base identity `XAF: 1`.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.code} -> ${v.value}\n      ${v.text}`);
  }
  console.error("");
  return 1;
}

process.exit(main());
