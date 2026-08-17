"use strict";

const {
  resolveExecutablePath,
  checkPuppeteer,
} = require("../../scripts/ops/puppeteer-preflight");

function fakePuppeteer({
  pdf = Buffer.from("%PDF-1.7 test"),
  fail = null,
} = {}) {
  const page = {
    setContent: jest.fn(async () => {
      if (fail === "content") throw new Error("content failed");
    }),
    pdf: jest.fn(async () => {
      if (fail === "pdf") throw new Error("pdf failed");
      return pdf;
    }),
  };
  const browser = {
    newPage: jest.fn(async () => page),
    version: jest.fn(async () => "HeadlessChrome/1"),
    close: jest.fn(async () => undefined),
  };
  return {
    launch: jest.fn(async () => {
      if (fail === "launch") throw new Error("launch failed");
      return browser;
    }),
    browser,
    page,
  };
}

describe("Puppeteer deployment preflight", () => {
  test("prefers the configured executable when it exists", () => {
    const found = resolveExecutablePath({
      env: { PUPPETEER_EXECUTABLE_PATH: "/custom/chrome" },
      existsSync: (path) => path === "/custom/chrome",
    });
    expect(found).toBe("/custom/chrome");
  });

  test("falls back to Alpine's system Chromium", () => {
    const found = resolveExecutablePath({
      env: { PUPPETEER_EXECUTABLE_PATH: "/missing/chrome" },
      existsSync: (path) => path === "/usr/bin/chromium",
    });
    expect(found).toBe("/usr/bin/chromium");
  });

  test("launches Chromium and proves the rendered bytes are a PDF", async () => {
    const engine = fakePuppeteer();
    const result = await checkPuppeteer({
      puppeteer: engine,
      executablePath: "/usr/bin/chromium",
    });

    expect(engine.launch).toHaveBeenCalledWith({
      executablePath: "/usr/bin/chromium",
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    expect(engine.page.setContent).toHaveBeenCalledWith(
      expect.stringContaining("Praxis PDF preflight"),
      { waitUntil: "networkidle0" },
    );
    expect(engine.page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
    });
    expect(result).toMatchObject({
      ok: true,
      executable_path: "/usr/bin/chromium",
      browser_version: "HeadlessChrome/1",
    });
    expect(result.pdf_bytes).toBeGreaterThan(5);
    expect(engine.browser.close).toHaveBeenCalledTimes(1);
  });

  test("fails clearly before launch when no browser executable exists", async () => {
    await expect(
      checkPuppeteer({
        puppeteer: fakePuppeteer(),
        existsSync: () => false,
        env: {},
      }),
    ).rejects.toThrow(/Chromium executable not found/);
  });

  test("rejects non-PDF output and still closes the browser", async () => {
    const engine = fakePuppeteer({ pdf: Buffer.from("not a pdf") });
    await expect(
      checkPuppeteer({
        puppeteer: engine,
        executablePath: "/usr/bin/chromium",
      }),
    ).rejects.toThrow(/valid PDF/);
    expect(engine.browser.close).toHaveBeenCalledTimes(1);
  });

  test("closes Chromium when rendering fails", async () => {
    const engine = fakePuppeteer({ fail: "pdf" });
    await expect(
      checkPuppeteer({
        puppeteer: engine,
        executablePath: "/usr/bin/chromium",
      }),
    ).rejects.toThrow(/pdf failed/);
    expect(engine.browser.close).toHaveBeenCalledTimes(1);
  });
});
