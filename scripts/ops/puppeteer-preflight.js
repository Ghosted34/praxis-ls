#!/usr/bin/env node
/**
 * Deployment preflight for Puppeteer + Chromium.
 *
 * The Docker image owns installation: package.json installs Puppeteer and the
 * Dockerfile installs Alpine's system Chromium at /usr/bin/chromium. This check
 * proves the resulting image can do the real job before migrations or a rollout:
 * require Puppeteer, launch Chromium, render HTML, and receive PDF bytes.
 *
 * It deliberately does not install packages at container startup. Runtime
 * containers run as the unprivileged `node` user and are immutable; installing
 * there would require root, a package-network dependency on every restart, and
 * would disappear with the container. scripts/deploy.sh retries a failed check
 * by rebuilding the affected images once without cache, which reruns both npm
 * and apk installation, then aborts if the rebuilt image still cannot render.
 */
"use strict";

const fs = require("fs");

/*
 * ONE LIST, NOT A FOURTH COPY.
 *
 * This file used to carry its own array of Chromium locations. `pdf.service`
 * carried another, and the signature renderer carried a third that did not
 * probe at all — which is how the card renderer came to be launching with
 * `undefined` while this preflight reported ok:true on the very same image.
 *
 * A gate that resolves the browser differently from the code it is gating is
 * not a gate. The list now comes from the module both callers use.
 */
const { KNOWN_CHROMIUM_PATHS } = require("../../src/services/chromium");

const DEFAULT_PATHS = KNOWN_CHROMIUM_PATHS;

function resolveExecutablePath({
  env = process.env,
  existsSync = fs.existsSync,
  candidates = DEFAULT_PATHS,
} = {}) {
  const configured = String(env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  const paths = configured
    ? [configured, ...candidates.filter((path) => path !== configured)]
    : candidates;
  return paths.find((path) => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  }) || null;
}

async function checkPuppeteer({
  puppeteer = null,
  executablePath = null,
  existsSync = fs.existsSync,
  env = process.env,
} = {}) {
  const browserPath = executablePath || resolveExecutablePath({ env, existsSync });
  if (!browserPath) {
    throw new Error(
      "Chromium executable not found. Expected PUPPETEER_EXECUTABLE_PATH or /usr/bin/chromium; rebuild the image so Dockerfile's apk install runs.",
    );
  }

  // Kept inside the function so a missing npm package produces a preflight
  // failure, while unit tests can inject a lightweight fake browser.
  const engine = puppeteer || require("puppeteer");
  let browser = null;
  try {
    browser = await engine.launch({
      executablePath: browserPath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(
      "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><h1>Praxis PDF preflight</h1></body></html>",
      { waitUntil: "networkidle0" },
    );
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Chromium launched but did not return a valid PDF document");
    }
    const browserVersion = typeof browser.version === "function"
      ? await browser.version()
      : "unknown";
    return {
      ok: true,
      executable_path: browserPath,
      browser_version: browserVersion,
      pdf_bytes: pdf.length,
    };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * RENDER AN ACTUAL SIGNATURE CARD.
 *
 * WHY A PDF CHECK WAS NOT ENOUGH. The check above proved Chromium could launch
 * and produce a PDF, and it passed on every deploy while no signature card had
 * ever rendered in production. Three reasons it could not have caught that, all
 * of them still live if this is the only check:
 *
 *   1. It resolved the browser ITSELF, so it never exercised the expression the
 *      card renderer actually used (`config.PUPPETEER_EXECUTABLE_PATH ||
 *      undefined`, which was `undefined`).
 *   2. It calls `page.pdf()`. The card calls `page.screenshot()`, which returns
 *      a Uint8Array where pdf() returns something the old code also had to
 *      coerce — a different function with a different return contract.
 *   3. It renders inline HTML with no fonts. The card embeds two @font-face
 *      families; a missing font file degrades the card silently and this would
 *      not notice.
 *
 * So this renders the real card, through the real renderer, with the real
 * fonts, and checks the bytes are a PNG. Required lazily so a broken import
 * fails the preflight with a readable message instead of at module load.
 */
async function checkSignatureCard() {
  // eslint-disable-next-line global-require
  const png = require("../../src/modules/mail/signature/signature.png");
  // eslint-disable-next-line global-require
  const palette = require("../../src/modules/mail/signature/signature.palette");
  // eslint-disable-next-line global-require
  const fontsMod = require("../../src/modules/mail/signature/signature.fonts");

  const families = fontsMod.loadedFamilies();
  const model = {
    kind: "card",
    person: { full_name: "Preflight Check", job_title: "Deployment gate" },
    contact: { email: "preflight@example.invalid", phone_desk: "+000000000" },
    company: { legal_name: "PRAXIS", website: "example.invalid" },
    palette: palette.resolve({}, {}),
    fonts: palette.fonts({}),
  };

  try {
    const out = await png.render(model, 2);
    const b = out.buffer;
    // The PNG magic number. A truthy buffer is not proof: sharp's catch returns
    // whatever it was handed, so the bytes are the only honest assertion.
    const isPng = Buffer.isBuffer(b)
      && b.length > 8
      && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    if (!isPng) {
      throw new Error(
        `Signature card render returned ${b && b.length} bytes that are not a PNG`,
      );
    }
    return {
      ok: true,
      png_bytes: b.length,
      dimensions: `${out.width}x${out.height}`,
      // Not fatal — a substituted face is a degraded card, not a broken one —
      // but it belongs in the deploy log rather than in nobody's awareness.
      fonts_loaded: families,
    };
  } finally {
    await png.closeBrowser();
  }
}

async function main() {
  const result = await checkPuppeteer();
  const card = await checkSignatureCard();
  process.stdout.write(`${JSON.stringify({ ...result, card })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `[puppeteer-preflight] ${err && err.stack ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_PATHS,
  resolveExecutablePath,
  checkPuppeteer,
  checkSignatureCard,
};
