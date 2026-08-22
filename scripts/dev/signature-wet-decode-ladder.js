#!/usr/bin/env node
/**
 * Wet-signature decode spike (SIGNATURE_ENGINEERING_GUIDE §8.4).
 *
 * Synthetic degradation ladder for the exact DataMatrix payload and decoder used
 * in PR-5. Real device samples should be dropped into this script as they are
 * collected; the committed ladder is the reproducible floor reviewers can run.
 */
"use strict";

const sharp = require("sharp");
const bwipjs = require("bwip-js");
const barcode = require("../../src/services/signatures/barcode");

const CODE = "0123456789ABCDEFGH";

async function symbolPng() {
  return bwipjs.toBuffer({
    bcid: "datamatrix",
    text: CODE,
    scale: 10,
    paddingwidth: 40,
    paddingheight: 40,
    backgroundcolor: "FFFFFF",
  });
}

async function degrade(base, step) {
  let img = sharp(base).resize({ width: step.px, height: step.px, fit: "fill" });
  if (step.rotate) img = img.rotate(step.rotate, { background: "white" });
  if (step.blur) img = img.blur(step.blur);
  if (step.jpeg) return img.jpeg({ quality: step.jpeg }).toBuffer();
  return img.png().toBuffer();
}

(async () => {
  const base = await symbolPng();
  const steps = [
    { name: "pristine 300 dpi", px: 142 },
    { name: "office scan 200 dpi", px: 95, jpeg: 85 },
    { name: "phone 200 dpi at 3 degrees", px: 95, rotate: 3, jpeg: 80 },
    { name: "phone 150 dpi at 5 degrees", px: 71, rotate: 5, jpeg: 75 },
    { name: "fax-grade 150 dpi", px: 71, blur: 0.6, jpeg: 60 },
  ];

  console.log("| Step | Result | Code |");
  console.log("| --- | --- | --- |");
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop -- deterministic report ordering.
    const out = await barcode.decode(await degrade(base, step));
    console.log(`| ${step.name} | ${out.status} | ${out.code || "—"} |`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
