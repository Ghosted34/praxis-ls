/**
 * Dev tool: measure a one-page instrument sheet, block by block, in millimetres.
 *
 * THIS EXISTS BECAUSE THE HEIGHT MODEL CANNOT BE GUESSED. The transit order's
 * `HEIGHT_MM` is what decides whether the page fits, and the first version of it
 * was written from the CSS — it was wrong by 12mm on the facts grid and 15mm on
 * the foot, which is a second sheet. Every constant in it now comes from this
 * script.
 *
 * Run it after ANY change to the sheet stylesheet, to `HEIGHT_MM`, or to which
 * blocks the template renders. It reports the rendered height of each direct
 * child of `.sheet`, the fit scale the template chose, and whether the page
 * still lands on one sheet across a sweep of cargo-line counts.
 *
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/dev/measure-instrument.js
 *   CASES=1,8,20,60 DETAIL=1 node scripts/dev/measure-instrument.js
 *
 * Options: DOC (default TRANSIT_ORDER) · LANG_DOC (fr) · CASES · DETAIL ·
 * NO_SEAL · NO_STAMP · NO_LOGO.
 */
/*
 * `document` and `getComputedStyle` below appear inside `page.evaluate`
 * callbacks, which are serialised and run in the BROWSER, not in Node.
 * Declared here so lint reads them the way Chromium will — same convention as
 * scripts/dev/render-portal.js.
 */
/* global document, getComputedStyle */
"use strict";

/* eslint-disable no-console -- stdout is this tool's entire output */

const path = require("node:path");

const SRC = path.join(__dirname, "..", "..", "src");
const registry = require(path.join(SRC, "services/documents/templates/registry.js"));
const kit = require(path.join(SRC, "services/documents/templates/kit.js"));
const qr = require(path.join(SRC, "services/signatures/qr.js"));

const b64 = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
// Stand-ins, at the proportions a real one has: a wide wordmark and a round
// cachet. The point is their BOX, not their artwork.
const LOGO = b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 96"><rect width="300" height="96" fill="#1B57A6"/></svg>');
const STAMP = b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 150"><circle cx="120" cy="75" r="70" fill="none" stroke="#1B4FA0" stroke-width="4"/></svg>');

const ENTITY = {
  legal_name: "SMART LOGISTICS AND SERVICES LTD",
  address: "1030, Avenue Douala Manga Bell, Bali — PO Box 5120, Douala, Cameroun",
  city: "Douala",
  rccm: "RC/DLA/2021/B/2060",
  niu: "M042116033580Q",
  email: "invoicing@smartls.cm",
  phone: "+237 233 420 281",
  bank_block: { bank: "AFRILAND FIRST BANK", account: "10005-0006-107018411001-93" },
};

function chromium() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env) return env;
  const fs = require("node:fs");
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function main() {
  const puppeteer = require("puppeteer");
  const docType = process.env.DOC || "TRANSIT_ORDER";
  const tpl = registry.get(docType);
  if (!tpl) throw new Error(`no template '${docType}'`);
  const language = process.env.LANG_DOC || "fr";

  const url = "https://smartls.cm/v/A4B7K92MXQ1P";
  const verify = { url, code: "A4B7K92MXQ1P", qrSvg: await qr.svg(url, { sizeMm: 20 }) };
  const sealQr = await qr.svg(url, { sizeMm: 22 });

  const browser = await puppeteer.launch({ executablePath: chromium(), args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage();
  // print, not screen: the sheet's own media rules and the page box only apply
  // in print, and measuring the screen render is measuring a different document.
  await page.emulateMediaType("print");

  const cases = (process.env.CASES || "1,2,3,5,8,12,20,30,40,60").split(",").map(Number).sort((a, b) => a - b);
  // The FIRST case that spills, not the last — the ceiling is where it starts.
  let firstSpill = 0;
  for (const n of cases) {
    const cfg = kit.mergeCfg(
      { logo_url: process.env.NO_LOGO ? "" : LOGO },
      { language, signature: { image_url: process.env.NO_STAMP ? "" : STAMP } },
    );
    // The letterhead mark's height is a real variable — it comes from the
    // tenant's Studio config and it is the one head dimension that does NOT
    // scale with the fit. Measure at the height being asked about.
    cfg.logo.height_mm = Number(process.env.LOGO_MM || cfg.logo.height_mm || 15);
    const data = JSON.parse(JSON.stringify(tpl.sampleData));
    const base = data.lines && data.lines[0];
    if (base) {
      data.lines = Array.from({ length: n }, (_, i) => ({
        ...base,
        marks: `SCC/2026/${40 + i}`,
        packages: String(10 + i),
        label: "Sacs de ciment CIMENCAM 50kg palettisés, film étirable",
        weight: `${2 + i} t`,
        value: `${(1000000 * (i + 1)).toLocaleString("fr-FR")} XAF`,
      }));
    }
    data.seals = process.env.NO_SEAL ? [] : [{
      forParty: ENTITY.legal_name, position: { n: 1, of: 1 },
      reason: "Approuvé pour expédition",
      signerName: "Jean Mbarga", signerRole: "Directeur Commercial",
      signedAt: "27 juil. 2026, 14:35 WAT", method: "Vérifié par code e-mail",
      docRef: data.number,
      contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      code: "A4B7K92MXQ1P", qrSvg: sealQr,
    }];

    await page.setContent(tpl.build(data, cfg, ENTITY, verify), { waitUntil: "load" });
    const out = await page.evaluate(() => {
      const mm = (px) => Math.round((px / (96 / 25.4)) * 10) / 10;
      const sheet = document.querySelector(".sheet");
      if (!sheet) return null;
      return {
        sheet: mm(sheet.getBoundingClientRect().height),
        scroll: mm(document.documentElement.scrollHeight),
        k: getComputedStyle(document.querySelector(".doc")).getPropertyValue("--k").trim(),
        kids: [...sheet.children].map((el) => ({
          cls: el.className || el.tagName.toLowerCase(),
          mm: mm(el.getBoundingClientRect().height),
        })),
      };
    });
    if (!out) { console.log(`lines=${n}: this template has no .sheet — nothing to measure`); continue; }

    const budget = kit.fitBudgetMm(kit.mergeCfg({}, {}));
    const over = out.scroll > budget + 0.5;
    if (over && !firstSpill) firstSpill = n;
    console.log(
      `lines=${String(n).padStart(3)}  k=${String(out.k).padEnd(5)}  sheet=${out.sheet}mm  `
      + `content=${out.scroll}mm  budget=${budget}mm  ${over ? "*** SPILLS TO A SECOND PAGE" : "one page"}`,
    );
    if (process.env.DETAIL) {
      for (const kid of out.kids) console.log(`          ${String(kid.mm).padStart(6)}mm  ${kid.cls}`);
    }
  }
  await browser.close();
  if (firstSpill) {
    console.log(`\nFirst spill at ${firstSpill} cargo lines. That is the ceiling to quote — and to`);
    console.log("re-measure after any change to the sheet, because it is where the blocks that");
    console.log("cannot shrink (the QR, the seal's evidence rows) start to dominate the page.");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
