/**
 * FINDING CHROMIUM — the bug that broke every signature card in production
 * while every PDF kept rendering.
 *
 * `signature.png.js` launched with:
 *
 *     executablePath: config.PUPPETEER_EXECUTABLE_PATH || undefined
 *
 * The env schema defaults that key to `""`. On any deployment that does not set
 * it the expression is `undefined`, Puppeteer looks for the Chromium it
 * downloads at install time, and the Dockerfile sets PUPPETEER_SKIP_DOWNLOAD
 * because the image installs Alpine's package instead. Launch threw on every
 * send; the catch in signature.service swallowed it; recipients got the text
 * fallback with no card. Chromium was at /usr/bin/chromium the whole time, and
 * pdf.service — which probes — was using it.
 *
 * These pin the two properties that would have caught it: an empty configured
 * value falls through to the probe, and a configured path that does not exist
 * is not trusted just because someone set it.
 */
"use strict";

const fs = require("fs");

const MODULE = "../../src/services/chromium";
const ENV = "../../src/config/env";

/** Reload the module with a given config + a controlled filesystem. */
function withEnv({ configured = "", fromEnv = undefined, present = [] }) {
  jest.resetModules();
  jest.doMock(ENV, () => ({ config: { PUPPETEER_EXECUTABLE_PATH: configured } }));
  const spy = jest.spyOn(fs, "existsSync").mockImplementation((p) => present.includes(p));
  const prev = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
  else process.env.PUPPETEER_EXECUTABLE_PATH = fromEnv;
  // eslint-disable-next-line global-require
  const mod = require(MODULE);
  return {
    mod,
    restore: () => {
      spy.mockRestore();
      if (prev === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
      else process.env.PUPPETEER_EXECUTABLE_PATH = prev;
    },
  };
}

describe("resolveChromiumPath", () => {
  /** THE BUG. An unset variable must fall through to the probe, not to undefined. */
  test("an empty configured path still finds the installed browser", () => {
    const { mod, restore } = withEnv({ configured: "", present: ["/usr/bin/chromium"] });
    try {
      expect(mod.resolveChromiumPath()).toBe("/usr/bin/chromium");
    } finally { restore(); }
  });

  test("a configured path that exists wins", () => {
    const { mod, restore } = withEnv({
      configured: "/opt/custom/chrome",
      present: ["/opt/custom/chrome", "/usr/bin/chromium"],
    });
    try {
      expect(mod.resolveChromiumPath()).toBe("/opt/custom/chrome");
    } finally { restore(); }
  });

  /**
   * A stale path is worse than none: Puppeteer reports it as a spawn failure
   * rather than as a missing browser, which is a much harder error to read.
   */
  test("a configured path that does NOT exist is not trusted", () => {
    const { mod, restore } = withEnv({
      configured: "/gone/chrome",
      present: ["/usr/bin/chromium"],
    });
    try {
      expect(mod.resolveChromiumPath()).toBe("/usr/bin/chromium");
    } finally { restore(); }
  });

  test("the raw environment variable is honoured when config is empty", () => {
    const { mod, restore } = withEnv({
      configured: "",
      fromEnv: "/env/chrome",
      present: ["/env/chrome", "/usr/bin/chromium"],
    });
    try {
      expect(mod.resolveChromiumPath()).toBe("/env/chrome");
    } finally { restore(); }
  });

  test("every standard install location is probed", () => {
    const { mod, restore } = withEnv({ configured: "", present: ["/usr/bin/google-chrome"] });
    try {
      expect(mod.resolveChromiumPath()).toBe("/usr/bin/google-chrome");
    } finally { restore(); }
  });

  /** Undefined lets Puppeteer try its own download — correct in dev. */
  test("nothing anywhere resolves to undefined, not to a guess", () => {
    const { mod, restore } = withEnv({ configured: "", present: [] });
    try {
      expect(mod.resolveChromiumPath()).toBeUndefined();
    } finally { restore(); }
  });

  test("the report names what was searched, for a diagnosis without a redeploy", () => {
    const { mod, restore } = withEnv({ configured: "", present: ["/usr/bin/chromium"] });
    try {
      const r = mod.chromiumReport();
      expect(r.resolved).toBe("/usr/bin/chromium");
      expect(r.candidates.find((c) => c.path === "/usr/bin/chromium").exists).toBe(true);
      expect(r.candidates.length).toBeGreaterThan(3);
    } finally { restore(); }
  });
});

describe("the renderer and the PDF service agree", () => {
  /**
   * They diverged once and it cost three rounds of debugging: PDFs probed, the
   * signature renderer did not, so Chromium was demonstrably present and cards
   * still failed. Neither may resolve the browser its own way again.
   */
  test("neither reads PUPPETEER_EXECUTABLE_PATH directly at its launch site", () => {
    for (const f of [
      "src/services/pdf.service.js",
      "src/modules/mail/signature/signature.png.js",
    ]) {
      const src = fs.readFileSync(require("path").join(__dirname, "../../", f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      expect({ file: f, direct: /executablePath:\s*(config|process\.env)\./.test(code) })
        .toEqual({ file: f, direct: false });
      expect({ file: f, shared: code.includes("resolveChromiumPath") })
        .toEqual({ file: f, shared: true });
    }
  });
});
