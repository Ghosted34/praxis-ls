#!/usr/bin/env node
/** Render the wet-signature footer fragment for visual review. */
"use strict";

const fs = require("fs/promises");
const path = require("path");
const kit = require("../../src/services/documents/templates/kit");
const barcode = require("../../src/services/signatures/barcode");

(async () => {
  const code = "0123456789ABCDEFGH";
  const cfg = kit.defaults();
  cfg.show.qr = true;
  cfg.wet_print = { code, svg: await barcode.generateSvg(code), reprintNo: 1 };
  const html = kit.shell("Wet signature footer", kit.footer({
    legal_name: "Smart Logistics SA", rccm: "RC/DLA/2024/B/0123", niu: "M012345678901Z", address: "Douala",
  }, cfg, { code: "A4B7K92MXQ1P", qrSvg: "", url: "https://smartls.praxisls.com/v/A4B7K92MXQ1P" }), cfg);
  const out = path.join(process.cwd(), "tmp", "wet-signature-footer.html");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, html);
  console.log(out);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
