"use strict";

/**
 * Every mail submodule is mounted at the same `/mail` base path. Modules found
 * before `mail/mail` must therefore let paths they do not own fall through;
 * otherwise a catch-all auth middleware consumes Microsoft's and Google's bare
 * browser callbacks before the core router can handle them.
 *
 * Keep this test dependency-free so the middleware-order invariant remains
 * visible even when a unit test runner is used without service dependencies.
 */
const fs = require("fs");
const path = require("path");

const read = (module) => fs.readFileSync(
  path.resolve(__dirname, `../../src/modules/mail/${module}/${module}.routes.js`),
  "utf8",
);

describe("mail OAuth callback authentication scope", () => {
  test.each(["assist", "binding", "deliverability"])(
    "%s does not install catch-all authentication ahead of the callback router",
    (module) => {
      expect(read(module)).not.toMatch(/^\s*router\.use\(authMiddleware\)/m);
    },
  );

  test("the core callback routes remain before core authentication", () => {
    const source = read("mail");
    const auth = source.indexOf("router.use(authMiddleware)");
    expect(source.indexOf('router.get("/oauth/microsoft/callback"')).toBeGreaterThan(-1);
    expect(source.indexOf('router.get("/oauth/google/callback"')).toBeGreaterThan(-1);
    expect(source.indexOf('router.get("/oauth/microsoft/callback"')).toBeLessThan(auth);
    expect(source.indexOf('router.get("/oauth/google/callback"')).toBeLessThan(auth);
  });
});
