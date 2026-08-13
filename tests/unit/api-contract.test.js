"use strict";

/**
 * API F-30 / F-18 — the mechanism that catches a contract regression, and the
 * versioning it needs to sit on.
 *
 * F-30's finding is that nothing would catch a breaking change: no versioning
 * to roll behind, no trustworthy spec to diff, and of 80 test files exactly one
 * drives HTTP — against a synthetic app. Zero assert the response shape of a
 * real endpoint. A PR renaming `{ data }` to `{ items }` on any of 731 routes
 * passes CI.
 *
 * `check-api-contract.js` closes that by diffing the live route surface against
 * a committed snapshot. The part worth testing is not the mounting — that is
 * the module loader, covered elsewhere — but the JUDGEMENT: what counts as
 * breaking. A snapshot check whose rules are wrong is worse than none, because
 * it produces a green tick over a broken contract.
 *
 * The rule being asserted: removals and lost gates fail; additions do not. That
 * asymmetry is the whole design. A check that fails on every added route gets
 * `--update`d reflexively, and a snapshot nobody reads is a rubber stamp.
 */

const { diffSurface } = require("../../scripts/check-api-contract");
const {
  apiVersionHeaders,
  deprecate,
  CURRENT,
} = require("../../src/middleware/api-version");

const route = (over = {}) => ({
  auth: true,
  rbac: true,
  validated: true,
  ...over,
});

/** Minimal res that records what was set. */
function makeRes() {
  const headers = {};
  return {
    headers,
    set(k, v) {
      headers[k] = v;
      return this;
    },
  };
}

describe("API contract snapshot (F-30)", () => {
  describe("what counts as breaking", () => {
    it("passes when nothing changed", () => {
      const s = { "GET /api/tenant/clients": route() };
      expect(diffSurface(s, s).breaking).toBe(0);
    });

    it("FAILS when a route disappears", () => {
      const before = {
        "GET /api/tenant/clients": route(),
        "GET /api/tenant/leads": route(),
      };
      const after = { "GET /api/tenant/clients": route() };
      const d = diffSurface(before, after);
      expect(d.breaking).toBe(1);
      expect(d.removed).toEqual(["GET /api/tenant/leads"]);
    });

    it("FAILS when a route loses its auth gate", () => {
      const before = { "GET /api/tenant/clients": route() };
      const after = { "GET /api/tenant/clients": route({ auth: false }) };
      const d = diffSurface(before, after);
      expect(d.breaking).toBe(1);
      expect(d.weakened[0]).toContain("lost auth");
    });

    it("FAILS when a route loses its permission gate", () => {
      const before = { "POST /api/tenant/invoices": route() };
      const after = { "POST /api/tenant/invoices": route({ rbac: false }) };
      expect(diffSurface(before, after).weakened[0]).toContain("lost rbac");
    });

    it("FAILS when a route loses its validator (SEC H3)", () => {
      const before = { "PUT /api/tenant/permissions/grant": route() };
      const after = {
        "PUT /api/tenant/permissions/grant": route({ validated: false }),
      };
      expect(diffSurface(before, after).weakened[0]).toContain(
        "lost validated",
      );
    });

    it("reports every lost gate on a route, not just the first", () => {
      const before = { "POST /api/tenant/x": route() };
      const after = {
        "POST /api/tenant/x": route({
          auth: false,
          rbac: false,
          validated: false,
        }),
      };
      expect(diffSurface(before, after).weakened).toHaveLength(3);
    });

    it("does NOT fail when a route is added", () => {
      const before = { "GET /api/tenant/clients": route() };
      const after = { ...before, "GET /api/tenant/leads": route() };
      const d = diffSurface(before, after);
      expect(d.breaking).toBe(0);
      expect(d.added).toEqual(["GET /api/tenant/leads"]);
    });

    it("does NOT fail when a gate is ADDED to an existing route", () => {
      const before = { "GET /api/tenant/clients": route({ rbac: false }) };
      const after = { "GET /api/tenant/clients": route({ rbac: true }) };
      expect(diffSurface(before, after).breaking).toBe(0);
    });

    it("treats a changed METHOD on the same path as a removal", () => {
      // POST /x becoming PUT /x breaks every caller; the key includes the verb
      // precisely so this is not invisible.
      const before = { "POST /api/tenant/x": route() };
      const after = { "PUT /api/tenant/x": route() };
      const d = diffSurface(before, after);
      expect(d.removed).toEqual(["POST /api/tenant/x"]);
      expect(d.breaking).toBe(1);
    });

    it("counts removals and weakened gates together", () => {
      const before = { a: route(), b: route() };
      const after = { b: route({ auth: false }) };
      expect(diffSurface(before, after).breaking).toBe(2);
    });

    it("handles an empty snapshot without treating everything as removed", () => {
      const after = { "GET /api/tenant/clients": route() };
      const d = diffSurface({}, after);
      expect(d.breaking).toBe(0);
      expect(d.added).toHaveLength(1);
    });
  });
});

describe("API versioning (F-18)", () => {
  it("stamps every response with the version that served it", () => {
    const res = makeRes();
    apiVersionHeaders(
      { originalUrl: `/api/${CURRENT}/tenant/clients` },
      res,
      () => {},
    );
    expect(res.headers["X-API-Version"]).toBe(CURRENT);
  });

  it("marks an unversioned path as legacy without refusing it", () => {
    // The React app, the PWA and every existing integration call /api/... .
    // Refusing them would be a breaking change made in the name of enabling
    // breaking changes to be made safely.
    const res = makeRes();
    let nexted = false;
    apiVersionHeaders({ originalUrl: "/api/tenant/clients" }, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(res.headers["X-API-Deprecation-Notice"]).toContain(CURRENT);
  });

  it("does not mark a versioned path as legacy", () => {
    const res = makeRes();
    apiVersionHeaders(
      { originalUrl: `/api/${CURRENT}/tenant/clients` },
      res,
      () => {},
    );
    expect(res.headers["X-API-Deprecation-Notice"]).toBeUndefined();
  });

  describe("deprecate()", () => {
    it("emits the RFC 8594 headers", () => {
      const res = makeRes();
      deprecate({
        sunset: "2026-04-01",
        replacement: "/api/v1/new",
        reason: "Superseded.",
      })({}, res, () => {});
      expect(res.headers.Deprecation).toBe("true");
      expect(res.headers.Sunset).toContain("2026");
      expect(res.headers.Link).toBe('</api/v1/new>; rel="successor-version"');
      expect(res.headers.Warning).toContain("299");
      expect(res.headers.Warning).toContain("/api/v1/new");
    });

    it("announces but never enforces — the request still proceeds", () => {
      // Turning an endpoint off is a deploy, and it should be a deliberate one.
      let nexted = false;
      deprecate({ sunset: "2000-01-01" })({}, makeRes(), () => {
        nexted = true;
      });
      expect(nexted).toBe(true);
    });

    it("omits Sunset rather than emitting an unparseable date", () => {
      const res = makeRes();
      deprecate({ sunset: "not a date" })({}, res, () => {});
      expect(res.headers.Sunset).toBeUndefined();
      expect(res.headers.Deprecation).toBe("true");
    });

    it("works with no options at all", () => {
      const res = makeRes();
      deprecate()({}, res, () => {});
      expect(res.headers.Deprecation).toBe("true");
      expect(res.headers.Warning).toContain("deprecated");
    });

    it("escapes quotes so the Warning header stays parseable", () => {
      const res = makeRes();
      deprecate({ reason: 'Use the "new" endpoint.' })({}, res, () => {});
      const quotes = (res.headers.Warning.match(/"/g) || []).length;
      expect(quotes).toBe(2); // only the pair that delimits the value
    });
  });
});
