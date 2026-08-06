"use strict";

/**
 * Structural guard for the platform (Praxis-staff) API surface.
 *
 * Audit SEC-H2 / API F-20 (2026-08-04): eight routes under /api/platform —
 * the `/settings/*` and `/ai-vendors/*` credential store — carried
 * `platformAuth` but no `requireCap`. Any authenticated platform user of any
 * role could therefore read and rotate the deployment's S3, Geoapify, VAPID and
 * AI-vendor credentials. The other 35 routes in the same file were gated
 * correctly, which is precisely why it went unnoticed: nothing checked the set.
 *
 * This test asserts the property rather than the fix. Adding an ungated route
 * to platform.routes.js fails here, whether or not anyone remembers this
 * finding — which is the whole point. A control nobody tests is how the last
 * one stopped working.
 *
 * Deliberately introspects the real Express router stack instead of grepping
 * the source, because a `requireCap(...)` sitting in the file but never applied
 * to a route would pass a grep and fail a request.
 */

const router = require("../../src/modules/platform/platform.routes");
const { CAP_CATALOGUE } = require("../../src/middleware/platform-auth");

/**
 * The only routes allowed to carry no capability check: obtaining a token in
 * the first place. Both are mounted BEFORE `router.use(platformAuth)`, so they
 * are also the only two that are genuinely anonymous.
 *
 * Adding to this list should be hard. Each entry is an unauthenticated,
 * unauthorised entry point into the Praxis-staff API.
 */
const PUBLIC = new Set(["post /auth/login", "post /auth/refresh"]);

/** Flatten an Express router into [{ method, path, handlerNames }]. */
function routesOf(r, prefix = "") {
  const out = [];
  for (const layer of r.stack || []) {
    if (layer.route) {
      const path = prefix + layer.route.path;
      const names = (layer.route.stack || []).map((h) => h.name);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method, path, key: `${method} ${path}`, names });
      }
    } else if (layer.handle && layer.handle.stack) {
      out.push(...routesOf(layer.handle, prefix));
    }
  }
  return out;
}

const routes = routesOf(router);
const gated = routes.filter((r) => !PUBLIC.has(r.key));

describe("platform API — every authenticated route carries a capability gate", () => {
  it("introspects a non-trivial route table", () => {
    // Guards against the test silently passing because routesOf() returned [].
    expect(routes.length).toBeGreaterThan(40);
    expect(gated.length).toBeGreaterThan(40);
  });

  it("mounts platformAuth for the whole router", () => {
    const names = (router.stack || []).map((l) => l.name || (l.handle && l.handle.name));
    expect(names).toContain("platformAuth");
  });

/**
 * The names an authorisation gate can have on this router.
 *
 * BOTH were called `check` until API-F23. `requireCap` and `requirePlatformRole`
 * each returned `function check(...)`, which is generic enough that nothing
 * reading the mounted routers could tell an authorisation step from any other
 * middleware — so the contract snapshot classified every platform route,
 * including `DELETE /tenants/:slug`, as "authenticated with no permission
 * check". They are now `platformCapCheck` and `platformRoleCheck`.
 *
 * THIS TEST BREAKING IS THE POINT, AND ALSO THE WARNING. Renaming a function
 * turned 53 assertions red, which is precisely the fragility TC-Q6 describes:
 * a guard that identifies middleware BY NAME stops guarding the moment someone
 * renames or wraps it, and here it failed loudly only because the rename was
 * deliberate. A wrapper — `asyncHandler(requireCap('x'))` — would have made it
 * fail silently instead, reporting every route ungated.
 *
 * Kept name-based rather than converted to identity matching because these are
 * FACTORY-produced closures: `requireCap('a')` and `requireCap('b')` are
 * different function objects, so there is no single reference to compare
 * against. The honest fix is a tag on the returned function (as
 * `makeLimiter` does with `praxisRateLimit`), which is a small change worth
 * making next time this file is touched.
 */
const GATE_NAMES = ["platformCapCheck", "platformRoleCheck"];
const isGated = (names) => names.some((n) => GATE_NAMES.includes(n));

  it.each(gated.map((r) => [r.key, r]))("%s is gated", (_key, route) => {
    // Either gate is an authorisation decision — an ungated route has neither.
    expect(isGated(route.names)).toBe(true);
  });

  describe("the credential store specifically (SEC-H2 / API F-20)", () => {
    // Named individually so a regression names the finding, not just a path.
    const CREDENTIAL_ROUTES = [
      "get /settings",
      "post /settings/push/vapid/generate",
      "get /settings/:section/:key",
      "put /settings/:section/:key",
      "post /settings/:section/:key/test",
      "get /ai-vendors",
      "put /ai-vendors/:vendor",
      "post /ai-vendors/:vendor/test",
    ];

    it.each(CREDENTIAL_ROUTES)("%s exists and is gated", (key) => {
      const route = routes.find((r) => r.key === key);
      expect(route).toBeDefined();
      expect(isGated(route.names)).toBe(true);
    });
  });

  it("settings.read / settings.write are in the capability catalogue", () => {
    // The console renders the permission matrix from this list. A gate on a
    // capability the catalogue does not expose is a capability no one can grant,
    // which locks out every non-root role permanently rather than gating them.
    expect(CAP_CATALOGUE).toContain("settings.read");
    expect(CAP_CATALOGUE).toContain("settings.write");
  });

  it("the public allow-list has not grown", () => {
    // A deliberate tripwire. Widening the anonymous surface should require
    // editing a test that says, in words, what you are widening it to.
    expect([...PUBLIC].sort()).toEqual(["post /auth/login", "post /auth/refresh"]);
  });
});
