/**
 * Dev tool: render the public verification portal at real width, in every state
 * it has to get right, and photograph it.
 *
 * WHY THIS EXISTS. The seal had two defects that were invisible in the HTML and
 * obvious the moment it was rendered — content overflowing its 34mm border, and
 * an evidence line wrapping to orphan its last word — which is why
 * `scripts/dev/render-seal.js` was written. The portal is the same class of
 * artefact: a page whose whole job is to be READ, by a stranger, under
 * pressure, deciding whether to trust a document. Reading its JSX tells you the
 * fields are present. It does not tell you whether the two verdicts read as one
 * badge, whether a revoked signature still looks authoritative, or whether the
 * "no summary" case reads as a broken page rather than a deliberate silence.
 *
 * Run it after ANY change to features/public/verify-page.tsx or to the shape
 * the portal service returns.
 *
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium OUT=/tmp node scripts/dev/render-portal.js
 *
 * Optional: OUT (default cwd), WIDTH (820), DPR (2).
 */
/*
 * `document` below appears inside `page.evaluate` callbacks, which are
 * serialised and run in the BROWSER, not in Node. Declared here so lint reads
 * them the way Chromium will.
 */
/* global document */
"use strict";

const { execFileSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const CLIENT = path.join(ROOT, "client");
const PREVIEW = path.join(CLIENT, "scripts", "portal-preview");
const DIST = path.join(PREVIEW, "dist");

const out = process.env.OUT || process.cwd();
const width = Number(process.env.WIDTH || 820);
const dpr = Number(process.env.DPR || 2);

/* eslint-disable no-console -- stdout is this tool's entire output */

function build() {
  console.log("building the preview bundle…");
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "build", "--config", path.join("scripts", "portal-preview", "vite.config.ts")],
    { cwd: CLIENT, stdio: "inherit" },
  );
}

/**
 * A one-file static server on an ephemeral port.
 *
 * The bundle is an ES module, and Chromium refuses to load one over `file://`
 * — "Cross origin requests are only supported for protocol schemes: … http,
 * https". So the preview is served rather than opened, which costs ten lines
 * and removes a failure that looks exactly like a broken page.
 */
const MIME = new Map(Object.entries({
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
}));

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(dir, rel);
    // Never serve outside the built directory, even from a dev tool.
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function shoot() {
  const puppeteer = require("puppeteer");
  const { server, port } = await serve(DIST);
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 1200, deviceScaleFactor: dpr });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
    // The page fetches through a stubbed client, so "networkidle" says nothing
    // about whether React has painted the resolved states. Wait for the thing
    // that only exists once the scenes have rendered their verdicts.
    await page.waitForFunction(() => document.querySelectorAll("dl").length >= 4, { timeout: 15000 });

    /*
     * ONE FILE PER SCENE, not one tall strip.
     *
     * Two reasons, both learned by running it. Each scene is a `min-h-screen`
     * page, so resizing the viewport to the total height makes every scene grow
     * to that total — the first attempt produced a 100,000-pixel image. And a
     * reviewer wants to look at the revoked state, not to scroll past five
     * others to reach it.
     */
    const scenes = await page.$$("[data-scene]");
    for (const el of scenes) {
      const id = await el.evaluate((n) => n.getAttribute("data-scene"));
      const file = path.join(out, `portal-${id}.png`);
      await el.screenshot({ path: file });
      console.log("wrote " + file);
    }

    // The dark theme is not decoration: the viewer's OS decides it, and a page
    // that reads as authoritative in light and washed out in dark has failed
    // for half its readers. One representative scene is enough to see that.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await page.$("[data-scene='valid']");
    if (dark) {
      const darkFile = path.join(out, "portal-valid-dark.png");
      await dark.screenshot({ path: darkFile });
      console.log("wrote " + darkFile);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  if (!fs.existsSync(path.join(PREVIEW, "index.html"))) {
    throw new Error("preview harness missing at " + PREVIEW);
  }
  build();
  await shoot();
})();
