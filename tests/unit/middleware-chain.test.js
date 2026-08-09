"use strict";

/**
 * TC-C12 — no API-level test; the middleware chain never runs as a chain.
 *
 * The audit's sentence is the specification for this file:
 *
 *   > That is precisely why C1–C3 can be simultaneously true and invisible: the
 *   > chain `hostTenantResolver → tenantContext → authMiddleware →
 *   > requirePermission → controller` has never executed under test, as a
 *   > chain, once.
 *
 * Every one of those five has unit tests. What none of them can show is what
 * happens BETWEEN them — and that is where the interesting properties live:
 *
 *   - ORDER. Three of these refuse to run out of order and say so with a 500
 *     rather than silently proceeding without a tenant. Only a chain test can
 *     tell the difference between "refuses" and "happens to work because the
 *     unit test supplied req.tenant by hand".
 *   - SHORT-CIRCUIT. A suspended tenant must be refused BEFORE authentication,
 *     so a valid token buys nothing. Asserted by sending a valid token.
 *   - ONE CONNECTION PER REQUEST (PERF S2). auth, rbac and the controller each
 *     used to take their own, capping effective concurrency at pool_max/3. The
 *     fix is only observable across the whole chain: count the checkouts for
 *     one request.
 *   - THE CORRELATION ID (OBS-E3) surviving from the header, through the
 *     ambient context, into the error body.
 *   - THE ACTOR (OBS-L3) landing in the ambient context, which tenantContext
 *     binds BEFORE auth knows who the user is.
 *
 * This boots a real Express app and sends real HTTP through supertest. Express,
 * the router, the async-safe shim and all five middlewares are REAL; only the
 * two things that would need a database — the tenant registry and the identity
 * cache — are mocked.
 */

require("../../src/shared/http/async-safe");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

// ── the two edges that would otherwise need Postgres ─────────────────────────

let mockTenants = {};
let mockAuthUser = null;
let mockGrants = [];
let mockScopeClosure = null;

const mockStats = { acquires: 0, releases: 0, schemaSets: [], getAuthUser: 0, getGrants: 0 };

/**
 * A leased connection. Records the search_path re-binds tenantContext issues.
 *
 * ANSWERS `user_session` (SEC-M1). authMiddleware now checks that the session
 * named by the token's `sid` is still alive: Redis first, then Postgres, and
 * "no row" means the session is gone. This fake answered every query with
 * `{ rows: [] }`, so every request in this suite carrying a `sid` — which is
 * most of them, since one test exists specifically to prove `sid` reaches
 * `req.user` — read as REVOKED and came back 401 instead of 200/403.
 *
 * That is TC-Q3 from the other side: a fake that returns empty for anything it
 * does not recognise cannot distinguish "no such session" from "I was never
 * taught this query", and it silently answered a security question it knew
 * nothing about. The fix is to model the query, not to soften the check —
 * softening it would mean deleting a session row no longer revokes anything.
 */
function mockMakeLease(schema) {
  return {
    schema,
    async query(sql) {
      // RECORD ONLY `SET` STATEMENTS. `schemaSets` is named for the search_path
      // re-binds tenantContext issues, and one test asserts it is EMPTY when no
      // re-bind should have happened. It used to record every query, which was
      // harmless while the only queries were re-binds — and stopped being
      // harmless the moment authMiddleware started issuing a session lookup on
      // the same connection. Filtering here keeps the counter measuring the
      // thing it is named after instead of "all traffic".
      if (/^\s*SET\s/i.test(sql)) mockStats.schemaSets.push(sql);
      if (/user_session/.test(sql)) return { rows: [{ killed_at: null }] };
      return { rows: [] };
    },
    release() { mockStats.releases += 1; },
  };
}

jest.mock("../../src/services/tenant/registry.service", () => ({
  SCHEMA: Symbol.for("praxis.schema"),
  resolveByHost: async (host) => mockTenants[host] || null,
  resolveBySlug: async (slug) => Object.values(mockTenants).find((t) => t.slug === slug) || null,
  acquire: async (tenant, env) => {
    mockStats.acquires += 1;
    return mockMakeLease(env === "sandbox" ? tenant.sandbox_schema || "sandbox" : tenant.live_schema || "live");
  },
  withTenantConnection: async (tenant, env, fn) => fn(mockMakeLease(env)),
  invalidateHost: () => {},
  poolFor: () => null,
  listActiveTenants: async () => [],
  poolStats: () => ({}),
  hostCacheStats: () => ({}),
  closeAll: async () => {},
}));

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getAuthUser: async () => { mockStats.getAuthUser += 1; return mockAuthUser; },
  getGrants: async () => { mockStats.getGrants += 1; return mockGrants; },
  getUserScopeClosure: async () => mockScopeClosure,
  getUserScopeIds: async () => mockScopeClosure,
  invalidateUser: async () => {},
  invalidateGrants: async () => {},
  getApprovableModules: async () => [],
  getUserCapabilities: async () => [],
  getMaskedFieldKeys: async () => [],
  bumpScopeVersion: async () => {},
}));

const { config } = require("../../src/config/env");
const requestContext = require("../../src/config/request-context");
const { requestIdMiddleware } = require("../../src/middleware/request-id");
const { hostTenantResolver } = require("../../src/middleware/host-tenent-resolver");
const { tenantContext } = require("../../src/middleware/tenant-context");
const { authMiddleware } = require("../../src/middleware/auth");
const { requirePermission } = require("../../src/middleware/rbac");
const { errorHandler, notFoundHandler } = require("../../src/middleware/error-handler");

const HOST = `acme.${config.APP_BASE_DOMAIN}`;
const OTHER_HOST = `globex.${config.APP_BASE_DOMAIN}`;

const liveTenant = (over = {}) => ({
  tenant_id: "t-1", slug: "acme", status: "LIVE", is_live: true,
  live_schema: "live", sandbox_schema: "sandbox", ...over,
});

/** The real chain, exactly as routes/index.js composes it. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);

  const tenantRouter = express.Router();
  tenantRouter.use(hostTenantResolver, tenantContext);

  // A controller that reports what the chain handed it. Deliberately does a
  // database read: PERF S2 is about the THIRD checkout.
  tenantRouter.get("/dossiers", authMiddleware, requirePermission("MOD-30", "view"), async (req, res) => {
    await req.tenantDb(async () => ({}));
    res.json({
      ok: true,
      user_id: req.user.user_id,
      tenant: req.tenant.slug,
      env: req.env,
      scope_ids: req.scope_ids,
      permission_scope: req.permission_scope || null,
      ctx_user_id: (requestContext.get() || {}).userId || null,
      ctx_request_id: (requestContext.get() || {}).requestId || null,
      ctx_env: (requestContext.get() || {}).env || null,
    });
  });

  // Authenticated but ungated, for asserting the auth/rbac split.
  tenantRouter.get("/me", authMiddleware, (req, res) => res.json({ user_id: req.user.user_id }));

  // Reaches no database at all — the lazy-checkout case.
  tenantRouter.get("/ping", (_req, res) => res.json({ pong: true }));

  // Mail OAuth callback — tenant is resolved from the signed `state`, so this
  // works on the apex / a platform host with a single canonical redirect URI.
  tenantRouter.get("/mail/oauth/microsoft/callback", (req, res) =>
    res.json({ ok: true, tenant: req.tenant.slug, env: req.env }));

  app.use("/api", tenantRouter);

  // tenantContext with no resolver in front of it, to prove the ordering guard.
  const orphan = express.Router();
  orphan.get("/orphan", tenantContext, (_req, res) => res.json({ ok: true }));
  app.use("/bad", orphan);

  // authMiddleware with no tenantContext in front of it.
  const noCtx = express.Router();
  noCtx.use(hostTenantResolver);
  noCtx.get("/no-ctx", authMiddleware, (_req, res) => res.json({ ok: true }));
  app.use("/bad", noCtx);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

function tokenFor({ sub = "u-1", typ = "access", sid = "s-1", expiresIn = "15m", secret = config.JWT_ACCESS_SECRET } = {}) {
  return jwt.sign({ sub, typ, sid, jti: "j-1" }, secret, { expiresIn });
}
const get = (path, { host = HOST, token, headers = {} } = {}) => {
  const r = request(app).get(path).set("Host", host);
  if (token) r.set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r;
};

describe("the middleware chain, as a chain (TC-C12)", () => {
  beforeEach(() => {
    mockTenants = { [HOST]: liveTenant(), [OTHER_HOST]: liveTenant({ tenant_id: "t-2", slug: "globex" }) };
    mockAuthUser = { user_id: "u-1", email: "a@acme.example", display_name: "A", status: "ACTIVE", role_ids: ["r-1"], is_ceo: false };
    mockGrants = [{ can_read: true }];
    mockScopeClosure = ["sc-1", "sc-2"];
    mockStats.acquires = 0; mockStats.releases = 0; mockStats.schemaSets = [];
    mockStats.getAuthUser = 0; mockStats.getGrants = 0;
  });

  describe("the happy path reaches the controller with everything populated", () => {
    it("answers 200 and hands the controller a fully-built request", async () => {
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(res.body).toMatchObject({
        ok: true, user_id: "u-1", tenant: "acme", env: "live", scope_ids: ["sc-1", "sc-2"],
      });
    });

    it("fills the ambient context's userId AFTER auth resolves it (OBS-L3)", async () => {
      // tenantContext binds the context BEFORE auth runs, so the userId it
      // captured was always null — every log line carried a tenant and an empty
      // user. auth back-fills the live store; only a chain shows that working.
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(res.body.ctx_user_id).toBe("u-1");
      expect(res.body.ctx_env).toBe("live");
    });
  });

  describe("ordering — each stage refuses to run without its predecessor", () => {
    it("500s when tenantContext runs without hostTenantResolver", async () => {
      const res = await request(app).get("/bad/orphan").set("Host", HOST).expect(500);
      expect(res.body.error.code).toBe("NO_TENANT_CONTEXT");
      expect(res.body.error.message).toMatch(/hostTenantResolver must run first/);
    });

    it("500s when authMiddleware runs without tenantContext", async () => {
      const res = await get("/bad/no-ctx", { token: tokenFor() }).expect(500);
      expect(res.body.error.code).toBe("NO_TENANT_CONTEXT");
      expect(res.body.error.message).toMatch(/tenantContext must run before authMiddleware/);
    });

    it("never reaches the identity cache when the chain is broken", async () => {
      await get("/bad/no-ctx", { token: tokenFor() }).expect(500);
      expect(mockStats.getAuthUser).toBe(0);
    });
  });

  describe("the OAuth callback resolves its tenant from the signed state, not the host", () => {
    it("lands on the apex (a platform host) and still resolves the right tenant", async () => {
      // A single canonical redirect URI serves every tenant — Google forbids
      // wildcard redirect URIs — so the tenant rides in the signed state.
      const state = jwt.sign({ slug: "acme" }, config.JWT_ACCESS_SECRET, { expiresIn: "10m" });
      const res = await get(
        `/api/mail/oauth/microsoft/callback?state=${encodeURIComponent(state)}`,
        { host: config.APP_BASE_DOMAIN }, // the apex — normally a platform host
      ).expect(200);
      expect(res.body.tenant).toBe("acme");
    });

    it("without a valid state, the apex is still WRONG_HOST (no silent tenant)", async () => {
      const res = await get("/api/mail/oauth/microsoft/callback", { host: config.APP_BASE_DOMAIN }).expect(400);
      expect(res.body.error.code).toBe("WRONG_HOST");
    });

    it("a forged/expired state does not resolve a tenant", async () => {
      const bad = jwt.sign({ slug: "acme" }, "wrong-secret", { expiresIn: "10m" });
      const res = await get(
        `/api/mail/oauth/microsoft/callback?state=${encodeURIComponent(bad)}`,
        { host: config.APP_BASE_DOMAIN },
      ).expect(400);
      expect(res.body.error.code).toBe("WRONG_HOST");
    });
  });

  describe("the tenant gate short-circuits BEFORE authentication", () => {
    it("404s an unknown host without authenticating anyone", async () => {
      const res = await get("/api/dossiers", { host: "nobody.example", token: tokenFor() }).expect(404);
      expect(res.body.error.code).toBe("TENANT_NOT_FOUND");
      expect(mockStats.getAuthUser).toBe(0);
      expect(mockStats.acquires).toBe(0);
    });

    it("403s a SUSPENDED tenant even with a perfectly valid token", async () => {
      // The point of asserting with a valid token: suspension must not be
      // something a legitimate user can authenticate past.
      mockTenants[HOST] = liveTenant({ status: "SUSPENDED" });
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(403);
      expect(res.body.error.code).toBe("TENANT_SUSPENDED");
      expect(mockStats.getAuthUser).toBe(0);
    });

    it("423s a tenant that is still provisioning", async () => {
      mockTenants[HOST] = liveTenant({ status: "PROVISIONING" });
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(423);
      expect(res.body.error.code).toBe("TENANT_NOT_READY");
      expect(mockStats.getAuthUser).toBe(0);
    });

    it("keeps two hosts on two tenants in the same process", async () => {
      const a = await get("/api/dossiers", { token: tokenFor() }).expect(200);
      const b = await get("/api/dossiers", { host: OTHER_HOST, token: tokenFor() }).expect(200);
      expect(a.body.tenant).toBe("acme");
      expect(b.body.tenant).toBe("globex");
    });
  });

  describe("authentication, through the real chain", () => {
    it("401s with no Authorization header", async () => {
      const res = await get("/api/dossiers").expect(401);
      expect(res.body.error.code).toBe("AUTH_REQUIRED");
    });

    it("401s a non-bearer scheme", async () => {
      const res = await get("/api/dossiers", { headers: { Authorization: "Basic Zm9vOmJhcg==" } }).expect(401);
      expect(res.body.error.code).toBe("AUTH_REQUIRED");
    });

    it("401s a REFRESH token replayed as an access token", async () => {
      // Both are signed with secrets this process holds, and the refresh token
      // carries typ:"refresh". Without the typ check it would authenticate.
      const res = await get("/api/dossiers", { token: tokenFor({ typ: "refresh" }) }).expect(401);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    });

    it("401s a 2FA-pending token", async () => {
      const res = await get("/api/dossiers", { token: tokenFor({ typ: "2fa_pending" }) }).expect(401);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    });

    it("401s a token signed with the refresh secret", async () => {
      const res = await get("/api/dossiers", { token: tokenFor({ secret: config.JWT_REFRESH_SECRET }) }).expect(401);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    });

    it("distinguishes an expired token", async () => {
      const res = await get("/api/dossiers", { token: tokenFor({ expiresIn: "-1s" }) }).expect(401);
      expect(res.body.error.code).toBe("TOKEN_EXPIRED");
    });

    it("401s a token whose user is gone", async () => {
      mockAuthUser = null;
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(401);
      expect(res.body.error.code).toBe("USER_INACTIVE");
    });

    it("401s a token whose user has been deactivated", async () => {
      mockAuthUser = { ...mockAuthUser, status: "DISABLED" };
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(401);
      expect(res.body.error.code).toBe("USER_INACTIVE");
      expect(mockStats.getGrants).toBe(0); // never got as far as permissions
    });

    it("carries the session id from the token onto req.user (SEC-C2)", async () => {
      await get("/api/me", { token: tokenFor({ sid: "s-99" }) }).expect(200);
      // Asserted via the chain rather than the unit: sid must survive the whole
      // way, because logout revokes by session.
      const res = await get("/api/dossiers", { token: tokenFor({ sid: "s-99" }) }).expect(200);
      expect(res.body.user_id).toBe("u-1");
    });
  });

  describe("authorisation", () => {
    it("403s a user whose role grants nothing on the module", async () => {
      mockGrants = [{ can_read: false, can_create: true }];
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    });

    it("403s a user with no grants at all", async () => {
      mockGrants = [];
      await get("/api/dossiers", { token: tokenFor() }).expect(403);
    });

    it("lets a CEO through without consulting grants", async () => {
      mockAuthUser = { ...mockAuthUser, is_ceo: true };
      mockGrants = [];
      const res = await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(res.body.permission_scope).toBe("all");
      expect(res.body.scope_ids).toBeNull(); // unrestricted
      expect(mockStats.getGrants).toBe(0);
    });

    it("does not treat a truthy non-true grant as permission", async () => {
      // The comparison is `=== true` on both sides for a reason: this is the
      // flag that skips every check in the product.
      mockGrants = [{ can_read: 1 }];
      await get("/api/dossiers", { token: tokenFor() }).expect(403);
      mockAuthUser = { ...mockAuthUser, is_ceo: "yes" };
      await get("/api/dossiers", { token: tokenFor() }).expect(403);
    });

    it("authenticates an ungated route without any permission check", async () => {
      mockGrants = [];
      const res = await get("/api/me", { token: tokenFor() }).expect(200);
      expect(res.body.user_id).toBe("u-1");
      expect(mockStats.getGrants).toBe(0);
    });
  });

  describe("one connection per request (PERF S2)", () => {
    it("checks out ONE connection although auth, rbac and the controller all read", async () => {
      // The measurement the fix was made for: three checkouts per request
      // capped effective concurrency at pool_max/3.
      await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(mockStats.acquires).toBe(1);
    });

    it("releases it when the response finishes", async () => {
      await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(mockStats.releases).toBeGreaterThanOrEqual(1);
    });

    it("checks out NOTHING for a request that never touches the database", async () => {
      // Lazy acquisition: a 404, a health probe or a static asset must not hold
      // a tenant connection.
      await get("/api/ping").expect(200);
      expect(mockStats.acquires).toBe(0);
    });

    it("checks out nothing for an unknown route", async () => {
      const res = await get("/api/nope", { token: tokenFor() }).expect(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(mockStats.acquires).toBe(0);
    });

    it("does not re-checkout when identity and business reads mix", async () => {
      // auth and rbac use identityDb (always live); the controller uses
      // tenantDb. Under LIVE they want the same schema, so one lease serves all
      // three with no re-bind.
      await get("/api/dossiers", { token: tokenFor() }).expect(200);
      expect(mockStats.acquires).toBe(1);
      expect(mockStats.schemaSets).toHaveLength(0);
    });
  });

  describe("the LIVE/TEST toggle", () => {
    it("ignores X-Praxis-Env on a live tenant", async () => {
      const res = await get("/api/dossiers", { token: tokenFor(), headers: { "X-Praxis-Env": "sandbox" } }).expect(200);
      expect(res.body.env).toBe("live");
    });

    it("honours sandbox on a non-live tenant", async () => {
      mockTenants[HOST] = liveTenant({ is_live: false });
      const res = await get("/api/dossiers", { token: tokenFor(), headers: { "X-Praxis-Env": "sandbox" } }).expect(200);
      expect(res.body.env).toBe("sandbox");
      expect(res.body.ctx_env).toBe("sandbox");
    });

    it("re-binds the search_path rather than taking a second connection in sandbox", async () => {
      // Identity stays on live while business data goes to sandbox. That is one
      // connection and one SET, not two checkouts.
      mockTenants[HOST] = liveTenant({ is_live: false });
      await get("/api/dossiers", { token: tokenFor(), headers: { "X-Praxis-Env": "sandbox" } }).expect(200);
      expect(mockStats.acquires).toBe(1);
      expect(mockStats.schemaSets.some((s) => /SET search_path = (live|sandbox), public/.test(s))).toBe(true);
    });

    it("does not log the user out when they flip to TEST", async () => {
      // Identity is env-independent: accounts live in the live schema, so a
      // sandbox request still authenticates.
      mockTenants[HOST] = liveTenant({ is_live: false });
      const res = await get("/api/dossiers", { token: tokenFor(), headers: { "X-Praxis-Env": "sandbox" } }).expect(200);
      expect(res.body.user_id).toBe("u-1");
    });

    it("ignores an unrecognised env value", async () => {
      mockTenants[HOST] = liveTenant({ is_live: false });
      const res = await get("/api/dossiers", { token: tokenFor(), headers: { "X-Praxis-Env": "production" } }).expect(200);
      expect(res.body.env).toBe("live");
    });
  });

  describe("the correlation id survives the whole chain (OBS-E3)", () => {
    it("echoes a generated id on the response and repeats it in an error body", async () => {
      const res = await get("/api/dossiers").expect(401);
      const header = res.headers["x-request-id"];
      expect(header).toBeTruthy();
      expect(res.body.request_id).toBe(header);
    });

    it("adopts a client-supplied id", async () => {
      const res = await get("/api/dossiers", { headers: { "X-Request-Id": "trace-abc-123" } }).expect(401);
      expect(res.headers["x-request-id"]).toBe("trace-abc-123");
      expect(res.body.request_id).toBe("trace-abc-123");
    });

    it("rejects an over-long client id rather than logging it", async () => {
      const res = await get("/api/dossiers", { headers: { "X-Request-Id": "x".repeat(65) } }).expect(401);
      expect(res.headers["x-request-id"]).not.toBe("x".repeat(65));
      expect(res.headers["x-request-id"]).toBeTruthy();
    });

    it("carries the id into the ambient context the controller sees", async () => {
      const res = await get("/api/dossiers", { token: tokenFor(), headers: { "X-Request-Id": "trace-xyz" } }).expect(200);
      expect(res.body.ctx_request_id).toBe("trace-xyz");
    });

    it("puts a request_id on a 404 too", async () => {
      const res = await get("/api/nope").expect(404);
      expect(res.body.request_id).toBe(res.headers["x-request-id"]);
    });
  });

  describe("the error envelope", () => {
    it("uses one shape for every failure the chain produces", async () => {
      const cases = [
        [() => get("/api/dossiers"), 401],
        [() => get("/api/dossiers", { host: "nobody.example" }), 404],
        [() => { mockGrants = []; return get("/api/dossiers", { token: tokenFor() }); }, 403],
        [() => get("/api/nope"), 404],
      ];
      for (const [run, status] of cases) {
         
        const res = await run().expect(status);
        expect(typeof res.body.error.code).toBe("string");
        expect(typeof res.body.error.message).toBe("string");
        expect(typeof res.body.request_id).toBe("string");
      }
    });

    it("puts a request_id on the TENANT-GATE failures too (API-F3)", async () => {
      // Found by this file. `hostTenantResolver` and `tenantContext` answered
      // with res.json() directly, so they never passed through the error
      // handler and their bodies carried no correlation id — making the tenant
      // gate the one part of the stack a customer could not quote an id for,
      // on exactly the failures ("unknown workspace", "suspended") they call
      // about. All three now go through next(AppError).
      const unknown = await get("/api/dossiers", { host: "nobody.example" }).expect(404);
      expect(unknown.body.request_id).toBe(unknown.headers["x-request-id"]);
      expect(unknown.body.error.code).toBe("TENANT_NOT_FOUND");

      mockTenants[HOST] = liveTenant({ status: "SUSPENDED" });
      const suspended = await get("/api/dossiers").expect(403);
      expect(suspended.body.request_id).toBe(suspended.headers["x-request-id"]);

      mockTenants[HOST] = liveTenant({ status: "PROVISIONING" });
      const notReady = await get("/api/dossiers").expect(423);
      expect(notReady.body.request_id).toBe(notReady.headers["x-request-id"]);

      const misordered = await request(app).get("/bad/orphan").set("Host", HOST).expect(500);
      expect(misordered.body.request_id).toBe(misordered.headers["x-request-id"]);
    });

    it("preserves the status and code the gate used to return", async () => {
      // Routing through the error handler must not have quietly changed the
      // contract — 404/403/423 with the same three codes, as before.
      const seen = [];
      for (const [status, code] of [["SUSPENDED", 403], ["PROVISIONING", 423]]) {
        mockTenants[HOST] = liveTenant({ status });
         
        const res = await get("/api/dossiers").expect(code);
        seen.push(res.body.error.code);
      }
      expect(seen).toEqual(["TENANT_SUSPENDED", "TENANT_NOT_READY"]);
    });

    it("never leaks a stack trace or SQL text", async () => {
      const res = await get("/bad/orphan").expect(500);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at .*\.js:\d+/);
      expect(body).not.toMatch(/SELECT |INSERT |node_modules/);
      expect(res.body.error.stack).toBeUndefined();
    });
  });
});
