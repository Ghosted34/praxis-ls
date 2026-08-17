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

const DEFAULT_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

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

async function main() {
  const result = await checkPuppeteer();
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
};
