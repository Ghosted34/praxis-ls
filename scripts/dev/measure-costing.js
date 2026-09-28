/**
 * Dev tool: render the costing sheet for a sweep of line counts and check the
 * PDF's page count against the rule in `costing-pages.paginate`.
 *
 * The rule is a promise to a tenant ("up to 17 lines on one page"), and the
 * only honest test of a page count is a real PDF from real Chromium. CI has no
 * Chromium (see transit-order-document.test.js), so run this after ANY change
 * to costing-document.js, the kit stylesheet or the letterhead blocks:
 *
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/dev/measure-costing.js
 *   CASES=17,18,34,35 LANG_DOC=fr OUT=/tmp/cst node scripts/dev/measure-costing.js
 *
 * Options: CASES · LANG_DOC (en) · OUT (a directory: writes one PDF per case) ·
 * NO_SEAL · NO_LOGO · LONG (the worst case: longest real descriptions, a
 * two-line pricer remark, every shipment facet, a four-line client block).
 *
 * Exits 1 if any case lands on a different number of pages than the rule.
 */
"use strict";

/* eslint-disable no-console -- stdout is this tool's entire output */

const path = require("node:path");
const fs = require("node:fs");

const SRC = path.join(__dirname, "..", "..", "src");
const registry = require(path.join(SRC, "services/documents/templates/registry.js"));
const kit = require(path.join(SRC, "services/documents/templates/kit.js"));
const pages = require(path.join(SRC, "services/documents/templates/costing-pages.js"));
const qr = require(path.join(SRC, "services/signatures/qr.js"));
const fixture = require(path.join(__dirname, "..", "..", "tests", "fixtures", "costing-sheet.fixture.js"));

const b64 = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const LOGO = b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><rect width="300" height="120" fill="#1B57A6"/></svg>');

function chromium() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env) return env;
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/opt/pw-browsers/chromium"]) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Pages in a PDF, without a parser: every page object carries `/Type /Page`. */
const pageCount = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

async function main() {
  const puppeteer = require("puppeteer");
  const tpl = registry.get("COSTING");
  const language = process.env.LANG_DOC || "en";
  const cases = (process.env.CASES || "1,5,12,15,16,17,18,22,30,34,35,40,52,60").split(",").map(Number);
  const out = process.env.OUT || null;
  if (out) fs.mkdirSync(out, { recursive: true });

  const url = "https://smartlogistics.example/v/TFQB5KV05XY2";
  const qrSvg = await qr.svg(url, { sizeMm: 22 });
  const browser = await puppeteer.launch({ executablePath: chromium(), args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  let bad = 0;
  try {
    for (const n of cases) {
      const cfg = kit.mergeCfg({ logo_url: process.env.NO_LOGO ? "" : LOGO }, { language });
      cfg.watermark = "TEST SANDBOX";
      const data = fixture.costing(n, { long: Boolean(process.env.LONG), seals: !process.env.NO_SEAL, qrSvg, language });
      await page.setContent(tpl.build(data, cfg, fixture.ENTITY, null), { waitUntil: "load" });
      const buf = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
      const got = pageCount(buf);
      const want = pages.paginate(n).length;
      if (got !== want) bad += 1;
      if (out) fs.writeFileSync(path.join(out, `costing-${language}-${n}.pdf`), buf);
      console.log(`lines=${String(n).padStart(3)}  split=${JSON.stringify(pages.paginate(n)).padEnd(16)} pages=${got}  ${got === want ? "ok" : `*** EXPECTED ${want}`}`);
    }
  } finally {
    await browser.close();
  }
  if (bad) {
    console.log(`\n${bad} case(s) broke the page rule.`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
