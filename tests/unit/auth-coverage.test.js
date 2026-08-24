"use strict";
const { discover } = require("../../src/shared/http/module-loader");
const { authMiddleware } = require("../../src/middleware/auth");
const { isRateLimiter } = require("../../src/shared/http/rate-limit");

/**
 * ── THE ANONYMOUS SURFACE, AND WHY THERE IS EXACTLY ONE ────────────────────
 *
 * This guard's whole value is that it fails when somebody ships a tenant module
 * without auth. The moment a legitimate exception exists, the guard is one
 * `.filter()` away from becoming decoration — so the exception is a NAMED
 * ALLOW-LIST with three properties, all asserted below:
 *
 *   1. Adding a module to it is a deliberate, reviewable edit to this file.
 *   2. A STALE entry fails, so deleting a public module cannot leave a hole
 *      that a future module could silently occupy by taking its name.
 *   3. An allow-listed module must carry a RATE LIMITER on every route. Auth is
 *      not merely absent there, it is REPLACED — a public write endpoint with no
 *      limiter is the actual vulnerability this exception could introduce, and
 *      it is worth more than the auth check it is standing in for.
 *
 * `hr/careers` is the public job-adverts page. It cannot be authenticated by
 * construction: the people using it do not have accounts, and the whole point is
 * that strangers can read a vacancy and apply to it. Its compensating controls
 * live in careers.service (responses are built from an allow-list, never a row;
 * lookup is by minted token only, never by vacancy_id; every refusal is the same
 * 404 so nothing can be enumerated) and careers.validator (every field bounded).
 */
const PUBLIC_BY_DESIGN = new Map([
  [
    "hr/careers",
    "Public job adverts + applications. Callers have no accounts by definition.",
  ],
  [
    "sales/proposal_public",
    "Expiring proposal links are intentionally readable by prospects without accounts; every route is limited and every refusal is a uniform 404.",
  ],
  [
    "sales/portfolio_public",
    "Published marketing stories are intentionally public; responses are allow-listed, consent-aware and every route is limited.",
  ],
  ["sales/public_intake", "Marketing website forms submit bounded, rate-limited CRM intake without accounts."],
  ["operations/tracking_public", "Exact-reference shipment tracking is public, allow-listed and rate-limited against guessing."],
  [
    "mail/public_secure",
    "Secure download links are intentionally reachable without an account; lookup is by minted token only, every refusal is a uniform 404, and the route is rate-limited.",
  ],
  [
    "vault/signature_public",
    "The public signing page. A counterparty with no account, on a phone, holding a link IS the feature; the token is a peppered 32-byte credential emailed once and never stored, every refusal is a uniform 404, the read is pinned to live, and every route is rate-limited — keyed on the TOKEN rather than the IP, so a signatory behind a corporate NAT is not throttled by a colleague (SIGNATURE_ENGINEERING_GUIDE §6.4, §6.6).",
  ],
  [
    "vault/document_verification",
    "The verification portal a printed QR resolves to. A stranger holding a document checking it WITHOUT an account is the entire feature; lookup is by the printed code only, every refusal is a uniform 404 that cannot distinguish malformed from never-existed, the read is pinned to live, and the route is rate-limited — which, since the code is 2^60 and stored in plaintext, is the sole defence against enumeration (SIGNATURE_ENGINEERING_GUIDE §3.7, §5.4).",
  ],
  [
    "vault/qes_public",
    "The certified-signature provider webhook. The caller is the provider itself, and the credential is the signature on the event — verified on the raw body before any field is trusted, a failure answers 401 with nothing from the body logged, the lookup is tenant-scoped by host, the read is pinned to live, and the route is rate-limited. Not feature-gated on purpose: the flag gates the action (the handoff), not the receipt of an event about an envelope started when the flag was on (SIGNATURE_ENGINEERING_GUIDE §7.4 step 5, §7.6 criterion 4).",
  ],
]);

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

  it("every allow-listed public module still exists", () => {
    // Property 2. A stale entry is worse than no allow-list: it is a named hole
    // that a future module could occupy just by being called the same thing.
    const names = new Set(modules.map((m) => m.name));
    for (const name of PUBLIC_BY_DESIGN.keys()) expect(names).toContain(name);
  });

  it.each(modules.filter((m) => !PUBLIC_BY_DESIGN.has(m.name)))(
    "%s carries authMiddleware",
    ({ _, def }) => {
      expect(hasAuth(def.router)).toBe(true);
    },
  );

  describe("the anonymous surface is rate limited instead", () => {
    const publicModules = modules.filter((m) => PUBLIC_BY_DESIGN.has(m.name));

    it("there is at least one, or this allow-list is dead code", () => {
      expect(publicModules.length).toBe(PUBLIC_BY_DESIGN.size);
    });

    it.each(publicModules)("%s limits EVERY route", ({ _, def }) => {
      // Property 3, and the reason this exception is safe to grant. Walked
      // per-ROUTE rather than per-router: a public module with a limiter on
      // three of four endpoints has one open door, and "the router has a
      // limiter somewhere" would call that a pass.
      const routes = [];
      const walk = (router) => {
        for (const l of (router && router.stack) || []) {
          if (l.route) routes.push(l.route);
          else if (l.handle && l.handle.stack) walk(l.handle);
        }
      };
      walk(def.router);

      expect(routes.length).toBeGreaterThan(0);
      // Collected and compared as a LIST rather than asserted in a loop, so a
      // failure names every unlimited route at once instead of stopping at the
      // first — and so the expectation reads as "nothing is unlimited" rather
      // than depending on a regex to tell `limited` from `UNLIMITED`.
      const unlimited = routes
        .filter(
          (route) =>
            !(route.stack || []).some(
              (h) => isRateLimiter(h.handle) || isRateLimiter(h),
            ),
        )
        .map(
          (route) =>
            `${Object.keys(route.methods).join("/").toUpperCase()} ${route.path}`,
        );
      expect(unlimited).toEqual([]);
    });
  });
});
