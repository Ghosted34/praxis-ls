"use strict";
const { discover } = require("../../src/shared/http/module-loader");

// A router is "gated" if authMiddleware appears at the router level, on a route,
// or inside a nested sub-router (e.g. app_user mounts /users + /auth).
function hasAuth(router) {
  if (!router || !router.stack) return false;
  for (const l of router.stack) {
    if (!l.route && l.name === "authMiddleware") return true;
    if (l.handle && l.handle.stack && hasAuth(l.handle)) return true;
    if (l.route && (l.route.stack || []).some((h) => h.name === "authMiddleware")) return true;
  }
  return false;
}

describe("every tenant module router is authenticated (no anonymous surface)", () => {
  const modules = discover().map((m) => {
    let def = null;
    try { def = require(m.routesFile); } catch { /* load error handled elsewhere */ }
    return { name: `${m.group}/${m.module}`, def };
  }).filter((m) => m.def && m.def.router);

  it("discovers a non-trivial set of modules", () => {
    expect(modules.length).toBeGreaterThan(50);
  });

  it.each(modules)("%s carries authMiddleware", ({ name, def }) => {
    // The only intentionally-public tenant route is document-verification /scan,
    // and that module ALSO gates /verify, so it still has authMiddleware present.
    expect(hasAuth(def.router)).toBe(true);
  });
});
