/**
 * Dev tool: render the electronic seal at print scale, in both variants and
 * both languages, plus a greyscale pass that stands in for a photocopy.
 *
 * This exists because the two worst bugs in the seal were invisible in the HTML
 * and obvious in the render: content overflowing the 34mm border, and an
 * evidence line wrapping to orphan its last word. Run it after ANY change to
 * kit.sealBlock or its CSS.
 *
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium OUT=/tmp node scripts/dev/render-seal.js
 */
const path = require("node:path").join(__dirname, "..", "..", "src");
const k = require(path + "/services/documents/templates/kit.js");
const qr = require(path + "/services/signatures/qr.js");
const fs = require("fs");

(async () => {
  const url = "https://smartlogistics.cm/v/A4B7K92MXQ1P";
  const qrSvg = await qr.svg(url, { sizeMm: 22 });

  const base = {
    forParty: "SMART LOGISTICS SARL", signedAt: "2026-08-20 14:35 WAT",
    docRef: "WAYBILL-8842-A",
    contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    code: "A4B7K92MXQ1P", qrSvg,
  };

  const seals = [
    ["Tier 1 — Digital stamp (internal, session identity)", k.sealBlock({ ...base,
      position: { n: 1, of: 2 }, reason: "Approved for dispatch",
      signerName: "Jean Mbarga", signerRole: "Commercial Director",
      method: "Verified by email code" }, { language: "en" })],
    ["Tier 2 — Drawn (external counterparty, declared name)", k.sealBlock({ ...base,
      forParty: "CIMENCAM SA", position: { n: 2, of: 2 }, reason: "Goods received",
      signerName: "Aïssatou Njoya", signerRole: "Procurement Manager",
      method: "Verified by email code",
      markImageB64: "data:image/svg+xml;base64," + Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><path d="M8 44 C28 8 40 52 56 26 C70 4 78 50 96 30 C112 12 120 46 140 24 C152 10 164 40 192 18" fill="none" stroke="#111" stroke-width="3.2" stroke-linecap="round"/></svg>'
      ).toString("base64") }, { language: "en" })],
    ["Français — cachet seul, sans chaîne", k.sealBlock({ ...base,
      position: null, reason: "Approuvé pour paiement",
      signerName: "Paul-Émile Fotso", signerRole: "Directeur Financier",
      method: "Vérifié par code e-mail" }, { language: "fr" })],
  ];

  const css = k.shell("x", "", {}).match(/<style>([\s\S]*?)<\/style>/)[1];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${css}
    body { background:#fff; margin:0; padding:8mm; font-family: sans-serif; }
    .cap { font-size: 7.5pt; color:#6b7280; margin: 0 0 2mm; letter-spacing:.04em; text-transform:uppercase; }
    .row { margin-bottom: 9mm; }
    .ruler { width:88mm; border-top:0.2mm dashed #c00; margin-top:1mm; font-size:6pt; color:#c00; }
    .mono { filter: grayscale(1) contrast(1.35); }
    .mononote { font-size:7pt; color:#6b7280; margin-top:1.5mm; }
  </style></head><body>
  ${seals.map(([cap, s]) => `<div class="row"><p class="cap">${cap}</p>${s}<div class="ruler">88 mm</div></div>`).join("")}
  <div class="row"><p class="cap">Photocopy simulation — greyscale + contrast</p><div class="mono">${seals[0][1]}</div>
  <p class="mononote">Nothing depends on colour: the accent rule is the only coloured element, and it is decoration.</p></div>
  </body></html>`;

  const out = process.env.OUT || process.cwd();
  fs.writeFileSync(out + "/seal-preview.html", html);

  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 3 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  const el = await page.$("body");
  await el.screenshot({ path: out + "/seal-preview.png" });
  await browser.close();
  // eslint-disable-next-line no-console -- stdout is this tool's entire output
  console.log("wrote " + out + "/seal-preview.png");
})();
