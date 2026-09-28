/**
 * Cache headers on the built staff PWA.
 *
 * The files that decide which build a device runs — the service worker, the
 * push handler it imports, the shell — must never be answered from a cache
 * without asking us first, or a CDN in front of the app hands every phone's
 * update check the previous build for an hour and the "New version available"
 * toast never gets a build to announce.
 *
 * Exercised through a real express.static mount rather than by calling the
 * helper with a fake response: the whole point is that `setHeaders` wins over
 * the `maxAge` express.static writes itself, and only the real middleware can
 * show that ordering.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const request = require("supertest");

const { setSpaCacheHeaders, REVALIDATE_ALWAYS } = require("../../src/shared/http/spa-cache");

let dir;
let app;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spa-cache-"));
  fs.mkdirSync(path.join(dir, "assets"));
  for (const f of ["sw.js", "push-handler.js", "index.html"]) {
    fs.writeFileSync(path.join(dir, f), "x");
  }
  fs.writeFileSync(path.join(dir, "assets", "index-4e9e9954.js"), "x");
  fs.writeFileSync(path.join(dir, "workbox-4e9e9954.js"), "x");

  app = express();
  // The same options server.js mounts client/dist with.
  app.use(express.static(dir, { index: false, maxAge: "1h", setHeaders: setSpaCacheHeaders }));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("setSpaCacheHeaders", () => {
  it.each(["/sw.js", "/push-handler.js", "/index.html"])(
    "%s is revalidated on every request",
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-cache");
    },
  );

  it.each(["/assets/index-4e9e9954.js", "/workbox-4e9e9954.js"])(
    "%s — content-hashed — keeps its hour",
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    },
  );

  it("names exactly the three files that decide the build", () => {
    expect([...REVALIDATE_ALWAYS].sort()).toEqual(["index.html", "push-handler.js", "sw.js"]);
  });
});
