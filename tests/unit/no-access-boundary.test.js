"use strict";

/**
 * THE HARD BOUNDARY BEHIND THE FRIENDLY PAGE.
 *
 * The client now answers a direct URL into a module you cannot see with a
 * branded page that NAMES the module and says what it is for — "Finance is not
 * part of your access", rather than a blank screen or a raw 403. That is a
 * deliberate disclosure: telling somebody Finance exists is actionable, and
 * "something went wrong" is not.
 *
 * It is also the exact shape of change that softens an API by accident. The
 * friendly rendering makes it tempting to give the refusal something to render
 * WITH — a count, a total, "you have 14 invoices you cannot see" — and each of
 * those is one line in a controller and a complete failure of the boundary. So
 * the line is drawn here, in a test, rather than in a comment:
 *
 *   the page may advertise that Finance exists.
 *   the API may never hand over a number from it.
 *
 * WHAT THIS ASSERTS, and why the status code is not enough. `expect(403)` passes
 * on a response whose body carries the very rows it refused — an error envelope
 * with a helpful `data` alongside it, a `meta.total`, a `fields` object built
 * from the record. Those are not hypothetical: they are what "make the 403 more
 * useful to the client" looks like when someone implements it. So every
 * assertion below reads the BODY, and the sentinel scan walks the whole response
 * for the values the controller would have returned had it run.
 *
 * The chain is REAL — the same composition `routes/index.js` uses and
 * `middleware-chain.test.js` exercises. Only the tenant registry and the
 * identity cache are mocked, because they are the two edges that need Postgres.
 */

require("../../src/shared/http/async-safe");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

let mockTenants = {};
let mockAuthUser = null;
let mockGrants = [];

/** Set by the controller if it ever runs. It must not. */
const controllerRan = { finance: 0 };

jest.mock("../../src/services/tenant/registry.service", () => ({
  SCHEMA: Symbol.for("praxis.schema"),
  resolveByHost: async (host) => mockTenants[host] || null,
  // `user_session` is answered because authMiddleware now verifies the session
  // named by the token's `sid` is still alive (SEC-M1), and "no row" means
  // revoked. A fake returning `{ rows: [] }` for everything answered that
  // security question without knowing it was being asked, turning every 403
  // assertion here into a 401. Model the query rather than soften the check.
  acquire: async () => ({
    async query(sql) {
      return /user_session/.test(sql)
        ? { rows: [{ killed_at: null }] }
        : { rows: [] };
    },
    release() {},
  }),
  withTenantConnection: async (_t, _e, fn) =>
    fn({
      async query(sql) {
        return /user_session/.test(sql)
          ? { rows: [{ killed_at: null }] }
          : { rows: [] };
      },
    }),
  invalidateHost: () => {},
  poolFor: () => null,
  listActiveTenants: async () => [],
  poolStats: () => ({}),
  hostCacheStats: () => ({}),
  closeAll: async () => {},
}));

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getAuthUser: async () => mockAuthUser,
  getGrants: async () => mockGrants,
  getUserScopeClosure: async () => [],
  getUserScopeIds: async () => [],
  invalidateUser: async () => {},
  invalidateGrants: async () => {},
  getApprovableModules: async () => [],
  getUserCapabilities: async () => [],
  getMaskedFieldKeys: async () => [],
  bumpScopeVersion: async () => {},
}));

const { config } = require("../../src/config/env");
const { requestIdMiddleware } = require("../../src/middleware/request-id");
const {
  hostTenantResolver,
} = require("../../src/middleware/host-tenent-resolver");
const { tenantContext } = require("../../src/middleware/tenant-context");
const { authMiddleware } = require("../../src/middleware/auth");
const { requirePermission } = require("../../src/middleware/rbac");
const {
  errorHandler,
  notFoundHandler,
} = require("../../src/middleware/error-handler");

const HOST = `acme.${config.APP_BASE_DOMAIN}`;

/**
 * Values that exist ONLY behind the grant. If any of these appears anywhere in
 * a refused response — at any depth, in any key — the boundary has leaked.
 * Deliberately distinctive strings and an implausible number, so a match is a
 * match and not a coincidence with a request id or a timestamp.
 */
const SECRET_TOTAL = 84213977.42;
const SECRET_CLIENT = "Zzyzx Holdings SARL";
const SECRET_DOC = "INV-SECRET-0001";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);

  const tenantRouter = express.Router();
  tenantRouter.use(hostTenantResolver, tenantContext);

  /**
   * Stands in for every gated read in Finance. It returns figures, because the
   * point is that a refused request never reaches something that would.
   */
  const financeController = (_req, res) => {
    controllerRan.finance += 1;
    res.json({
      data: [
        {
          doc_number: SECRET_DOC,
          client: SECRET_CLIENT,
          total_ttc: SECRET_TOTAL,
        },
      ],
      meta: { total: SECRET_TOTAL, count: 1 },
    });
  };

  tenantRouter.get(
    "/final-invoices",
    authMiddleware,
    requirePermission("MOD-51", "view"),
    financeController,
  );
  tenantRouter.get(
    "/final-invoices/:id",
    authMiddleware,
    requirePermission("MOD-51", "view"),
    financeController,
  );
  tenantRouter.post(
    "/final-invoices",
    authMiddleware,
    requirePermission("MOD-51", "create"),
    financeController,
  );

  app.use("/api", tenantRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const token = () =>
  jwt.sign(
    { sub: "u-1", typ: "access", sid: "s-1", jti: "j-1" },
    config.JWT_ACCESS_SECRET,
    { expiresIn: "15m" },
  );
const call = (method, path) =>
  request(app)
    [method](path)
    .set("Host", HOST)
    .set("Authorization", `Bearer ${token()}`);

/** Every scalar in a response, at any depth. */
function scalars(value, out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const v of value) scalars(v, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      scalars(v, out);
    }
    return out;
  }
  out.push(String(value));
  return out;
}

beforeEach(() => {
  mockTenants = {
    [HOST]: {
      tenant_id: "t-1",
      slug: "acme",
      status: "LIVE",
      is_live: true,
      live_schema: "live",
      sandbox_schema: "sandbox",
    },
  };
  // A warehouse role: authenticated, active, and holding nothing in Finance.
  mockAuthUser = {
    user_id: "u-1",
    email: "picker@acme.example",
    display_name: "Picker",
    status: "ACTIVE",
    role_ids: ["r-wms"],
    is_ceo: false,
  };
  mockGrants = [];
  controllerRan.finance = 0;
});

describe("the page is friendly; the API is not", () => {
  it("refuses with a real 403 and the code the client branches on", async () => {
    const res = await call("get", "/api/final-invoices").expect(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("NEVER RUNS THE HANDLER, so there is no payload to leak in the first place", async () => {
    // The strongest form of the guarantee. Everything below checks that the
    // response is clean; this checks that the data was never fetched.
    await call("get", "/api/final-invoices").expect(403);
    expect(controllerRan.finance).toBe(0);
  });

  it("returns a body with NO data — asserted on the body, not the status", async () => {
    const res = await call("get", "/api/final-invoices").expect(403);
    // The whole envelope, spelled out. A helpful `data: []` added later — the
    // usual first step towards a helpful `data: [...]` — fails here.
    expect(Object.keys(res.body).sort()).toEqual(["error", "request_id"]);
    expect(Object.keys(res.body.error).sort()).toEqual(["code", "message"]);
    expect(res.body.data).toBeUndefined();
    expect(res.body.meta).toBeUndefined();
  });

  it("leaks no figure, name or document number anywhere in the response", async () => {
    const res = await call("get", "/api/final-invoices").expect(403);
    const found = scalars(res.body);
    const serialised = JSON.stringify(res.body);

    for (const secret of [SECRET_CLIENT, SECRET_DOC, String(SECRET_TOTAL)]) {
      expect(found).not.toContain(secret);
      expect(serialised).not.toContain(secret);
    }
    // Nor a count of what is behind the wall. "14 invoices you cannot see" is
    // still a number from Finance.
    expect(serialised).not.toMatch(/"(total|count|rows|records)"\s*:/);
  });

  it("says only which module and action were refused, and quotes no record", async () => {
    // The message names MOD-51 — that is the same disclosure the friendly page
    // makes, and it is the useful half. What it must not do is grow an
    // identifier, a name or an amount to make itself more helpful.
    const res = await call("get", "/api/final-invoices").expect(403);
    expect(res.body.error.message).toBe("No permission for MOD-51.view");
  });

  it("refuses a DETAIL url the same way, with no hint that the record exists", async () => {
    // The direct-link case the friendly page exists for. A 404-vs-403 split
    // here would turn the endpoint into an existence oracle; a body carrying
    // the record's own id would be worse.
    const res = await call(
      "get",
      "/api/final-invoices/8f2c1d40-0000-4000-8000-000000000000",
    ).expect(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(res.body)).not.toContain("8f2c1d40");
    expect(controllerRan.finance).toBe(0);
  });

  it("refuses a WRITE it has no grant for, not just a read", async () => {
    mockGrants = [{ can_read: true, can_create: false }];
    const res = await call("post", "/api/final-invoices").expect(403);
    expect(res.body.error.message).toBe("No permission for MOD-51.create");
    expect(controllerRan.finance).toBe(0);
  });

  it("is unchanged by the client rendering a page instead of an error", async () => {
    // The regression this file exists for, stated directly: nothing about the
    // refusal is conditional on who is asking or on what they will render. Two
    // identical calls, one with the client's own header set, produce the same
    // refusal.
    const plain = await call("get", "/api/final-invoices").expect(403);
    const withHeader = await request(app)
      .get("/api/final-invoices")
      .set("Host", HOST)
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Praxis-Env", "live")
      .expect(403);

    expect(withHeader.body.error).toEqual(plain.body.error);
    expect(controllerRan.finance).toBe(0);
  });

  it("still serves the data to somebody who DOES hold the grant", async () => {
    // Guards against the tests above passing because the route is broken rather
    // than because it is guarded.
    mockGrants = [{ can_read: true }];
    const res = await call("get", "/api/final-invoices").expect(200);
    expect(res.body.meta.total).toBe(SECRET_TOTAL);
    expect(controllerRan.finance).toBe(1);
  });
});
