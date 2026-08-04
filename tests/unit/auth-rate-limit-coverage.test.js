"use strict";

/**
 * Structural guard: every route that hands out or guesses a credential is rate
 * limited.
 *
 * Audit SEC-C3 (2026-08-04). Before this, `forgot-password` and
 * `reset-password` were limited and `/login`, `/refresh`, `/2fa/verify` and
 * `/pin/login` were not — across all THREE auth tiers. The recovery surface was
 * defended and the front door was open, on staff, platform and the
 * internet-facing customer portal alike.
 *
 * The failure this test exists to catch is not "someone deletes a limiter". It
 * is "someone adds a fifth way to obtain a token and doesn't think about it" —
 * which is how the first four came to be unprotected.
 *
 * Asserts against the live Express stack rather than the source text, and
 * detects limiters by the `praxisRateLimit` tag rather than by function name,
 * because express-rate-limit returns an anonymous function. A control the test
 * cannot see is a control the test cannot defend.
 */

const { isRateLimiter, rateLimitStoreKind } = require("../../src/shared/http/rate-limit");

const tenantAuth = require("../../src/modules/security/app_user/app_user.routes").router;
const portal = require("../../src/modules/portal_auth/portal_auth.routes").router;
const platform = require("../../src/modules/platform/platform.routes");

/**
 * Recover the mount path of a nested router from its layer regexp.
 *
 * Without this, `router.use("/users", usersRouter)` flattens to `/:id/password`
 * and the test cannot tell a staff admin route from an auth route — which is
 * how the first draft of this file waived the wrong one. Express does not
 * expose the mount path directly on the layer, so it is parsed back out of the
 * generated regexp (`^\/users\/?(?=\/|$)`).
 */
function mountPath(layer) {
  const s = layer.regexp && layer.regexp.source;
  if (!s || s === "^\\/?(?=\\/|$)") return ""; // mounted at "/"
  const m = s.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  return m ? "/" + m[1].replace(/\\\//g, "/") : "";
}

function routesOf(router, prefix = "") {
  const out = [];
  for (const layer of router.stack || []) {
    if (layer.route) {
      const limiters = (layer.route.stack || [])
        .filter((h) => isRateLimiter(h.handle))
        .map((h) => h.handle.praxisRateLimit);
      for (const method of Object.keys(layer.route.methods)) {
        out.push({
          key: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
          limiters,
        });
      }
    } else if (layer.handle && layer.handle.stack) {
      out.push(...routesOf(layer.handle, prefix + mountPath(layer)));
    }
  }
  return out;
}

/**
 * Every public credential surface in the product, by tier, with the limiter it
 * must carry. Written out longhand on purpose — this list IS the spec, and a
 * reviewer should be able to read it without running anything.
 */
const REQUIRED = [
  // Tenant staff
  ["tenant", tenantAuth, "POST /auth/login", "login"],
  ["tenant", tenantAuth, "POST /auth/refresh", "refresh"],
  ["tenant", tenantAuth, "POST /auth/2fa/verify", "totp"],
  ["tenant", tenantAuth, "POST /auth/pin/login", "pin"],
  ["tenant", tenantAuth, "POST /auth/forgot-password", "forgot"],
  ["tenant", tenantAuth, "POST /auth/reset-password", "reset"],
  // External portal — clients, investors, auditors. Internet-facing.
  ["portal", portal, "POST /auth/login", "login"],
  ["portal", portal, "POST /auth/forgot", "forgot"],
  ["portal", portal, "POST /auth/accept", "reset"],
  // Praxis platform staff — highest privilege, no 2FA, no session store (M6).
  ["platform", platform, "POST /auth/login", "login"],
  ["platform", platform, "POST /auth/refresh", "refresh"],
];

describe("SEC-C3 — every credential surface is rate limited", () => {
  it.each(REQUIRED.map(([tier, r, key, limiter]) => [`${tier} ${key}`, r, key, limiter]))(
    "%s carries the '%s' limiter",
    (_label, router, key, expected) => {
      const route = routesOf(router).find((r) => r.key === key);
      expect(route).toBeDefined();
      expect(route.limiters).toContain(expected);
    },
  );

  it("the limiter runs before the validator", () => {
    // Ordering matters: a malformed flood should be rejected by the cheap
    // check, not after Zod has parsed a 2MB body 10,000 times.
    const login = (tenantAuth.stack || [])
      .flatMap((l) => (l.handle && l.handle.stack ? l.handle.stack : []))
      .find((l) => l.route && l.route.path === "/login");
    expect(login).toBeDefined();
    const idx = login.route.stack.findIndex((h) => isRateLimiter(h.handle));
    expect(idx).toBe(0);
  });

  it("no credential surface was missed across the three tiers", () => {
    // Catches the "someone added a fifth way in" case the named list above
    // cannot: any route whose path looks like a token-obtaining action must be
    // limited or explicitly waived here.
    const WAIVED = new Set([
      // Authenticated device management — already behind authMiddleware, and
      // the caller must hold a valid access token to reach them at all.
      "POST /auth/pin/register",
      "GET /auth/pin/devices",
      "DELETE /auth/pin/devices/:deviceId",
    ]);
    const suspicious = /login|refresh|verify|forgot|reset|accept|pin|password/i;
    const missed = [];
    for (const [tier, router] of [["tenant", tenantAuth], ["portal", portal], ["platform", platform]]) {
      for (const r of routesOf(router)) {
        if (!suspicious.test(r.key)) continue;
        if (WAIVED.has(r.key)) continue;
        // Staff-managed password setting is gated by RBAC, not by IP limits.
        if (r.key.includes("/users/")) continue;
        if (r.limiters.length === 0) missed.push(`${tier} ${r.key}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it("reports which store is in use", () => {
    // In unit tests Redis is not initialised, so this is the in-memory
    // fallback. The assertion is that the function answers honestly — the
    // readiness probe surfaces the same value, so an operator can see when a
    // multi-container deploy has silently dropped to per-process limits.
    expect(["redis", "memory"]).toContain(rateLimitStoreKind());
  });
});
