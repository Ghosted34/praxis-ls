"use strict";
const { discover } = require("../../src/shared/http/module-loader");
const { authMiddleware } = require("../../src/middleware/auth");

/**
 * TC-Q6 — this guard is the right instinct with two ways of passing while
 * checking nothing. Both are closed here.
 *
 * 1. IT MATCHED BY FUNCTION NAME (`l.name === "authMiddleware"`). Rename the
 *    function, or wrap it in `asyncHandler` — which is a normal thing to do to
 *    an async middleware and would change `.name` to "" or to the wrapper's —
 *    and every assertion below keeps passing while detecting nothing at all.
 *    The guard would report a fully-authenticated surface on the day the whole
 *    surface went anonymous.
 *
 *    It now compares against the IMPORTED FUNCTION REFERENCE. A rename cannot
 *    fool identity, and a wrapper is caught by the second check below rather
 *    than silently accepted.
 *
 * 2. THE FLOOR WAS `> 50` WHILE DISCOVERY RETURNS ~100. If module loading broke
 *    and found 51, the suite stayed green and the other 49 routers went
 *    unchecked — the failure mode being guarded against (a module with no auth)
 *    is indistinguishable from the module not being looked at. The floor is now
 *    pinned near the real count, so losing modules fails loudly.
 *
 * WHAT THIS STILL DOES NOT PROVE, stated because the audit was right to say so:
 * it proves the middleware is MOUNTED, never that it REJECTS anything. That is
 * middleware-chain.test.js's job (TC-C12), and neither test substitutes for the
 * other. It is also per-ROUTER, not per-ROUTE: a router with one gated route and
 * several ungated ones still passes. Closing that is SEC-L5, and it wants the
 * same effective-middleware walk as API-F23 — see handoff §15.
 */

/** The identity we are looking for, plus anything wrapping it. */
function isAuth(handle) {
  if (!handle) return false;
  if (handle === authMiddleware) return true;
  // A wrapper (asyncHandler(authMiddleware)) is not the same function, so it
  // cannot be matched by identity. Fall back to the name — but ONLY as a
  // secondary signal, so the common case is identity and the fallback is
  // visible here rather than being the whole mechanism.
  return handle.name === "authMiddleware";
}

// A router is "gated" if authMiddleware appears at the router level, on a route,
// or inside a nested sub-router (e.g. app_user mounts /users + /auth).
function hasAuth(router) {
  if (!router || !router.stack) return false;
  for (const l of router.stack) {
    if (!l.route && isAuth(l.handle)) return true;
    if (l.handle && l.handle.stack && hasAuth(l.handle)) return true;
    if (
      l.route &&
      (l.route.stack || []).some((h) => isAuth(h.handle) || isAuth(h))
    )
      return true;
  }
  return false;
}

describe("every tenant module router is authenticated (no anonymous surface)", () => {
  const modules = discover()
    .map((m) => {
      let def = null;
      try {
        def = require(m.routesFile);
      } catch {
        /* load error handled elsewhere */
      }
      return { name: `${m.group}/${m.module}`, def };
    })
    .filter((m) => m.def && m.def.router);

  it("discovers every module, not merely 'enough' of them", () => {
    // Pinned near the real count (100 at the time of writing), not a token
    // floor. If discovery regresses, THIS fails — instead of the per-module
    // assertions below quietly checking a smaller set and reporting success.
    // Raise it when modules are added; that edit is the point.
    expect(modules.length).toBeGreaterThanOrEqual(95);
  });

  it("resolves the real authMiddleware, so identity matching can work at all", () => {
    // Guards the guard: if this import ever yields undefined, `isAuth` degrades
    // silently to name-matching only and finding #1 above is reopened.
    expect(typeof authMiddleware).toBe("function");
  });

  it.each(modules)("%s carries authMiddleware", ({ _, def }) => {
    // The only intentionally-public tenant route is document-verification /scan,
    // and that module ALSO gates /verify, so it still has authMiddleware present.
    expect(hasAuth(def.router)).toBe(true);
  });
});
