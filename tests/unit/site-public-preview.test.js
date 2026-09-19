"use strict";

/**
 * The authenticated preview of the public site (Decision Q9, CE-29).
 *
 * ── WHAT THESE TESTS ARE ACTUALLY PROTECTING ───────────────────────────────
 *
 * The anonymous website reads are pinned to LIVE so an internet caller can
 * never open the rehearsal. The preview is the deliberate other half of that
 * rule: a signed-in operator with MOD-01 or MOD-29 view may read the
 * STRANGER-FACING payload built from the SANDBOX schema. Every safeguard the
 * audit named is asserted here against the REAL router — mounted and driven,
 * not inspected:
 *
 *   AUTHENTICATION   an anonymous caller gets 401, not a sandbox read.
 *   PERMISSION       a signed-in caller without the grant gets 403.
 *   ENVIRONMENT      the preview reads SANDBOX and only sandbox; the anonymous
 *                    reads stay on LIVE whatever a header says.
 *   CACHE            `private, no-store` — never `public`, never an edge TTL,
 *                    because a CDN that cached a test payload would serve
 *                    rehearsal bytes to strangers after the tab closed.
 *   ROBOTS           `X-Robots-Tag: noindex, nofollow` on every response.
 *   ISOLATION        the tenant comes from the request's own host resolver and
 *                    nothing in the URL or body names one; a workspace with
 *                    no Test schema answers 404 rather than 500.
 *
 * The middlewares are the REAL authMiddleware and the REAL
 * requireAnyPermission — the whole point is the chain — so the user they
 * describe is minted honestly (a signed JWT against the configured secret)
 * and only the identity CACHE is stubbed, exactly the way the careers tests
 * stub their repos. The async-safe shim is loaded for the same reason
 * server.js loads it: without it an async middleware's rejection never
 * reaches the error handler and the request hangs.
 */

require("../../src/shared/http/async-safe");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { config } = require("../../src/config/env");
const identityCache = require("../../src/shared/cache/identity-cache");
const storage = require("../../src/services/storage.service");
const { router } = require("../../src/modules/site/site_public/site_public.routes");
const {
  errorHandler,
  notFoundHandler,
} = require("../../src/middleware/error-handler");

/**
 * The stub identity the cache will answer with. NOT the CEO: the CEO bypass
 * would skip the grant check entirely, and the 403 case below is half of what
 * "controlled" means.
 */
const USER = {
  user_id: "11111111-1111-1111-1111-111111111111",
  email: "editor@example.test",
  role_ids: ["22222222-2222-2222-2222-222222222222"],
  is_ceo: false,
  status: "ACTIVE",
};

const token = () =>
  jwt.sign({ sub: USER.user_id, typ: "access" }, config.JWT_ACCESS_SECRET);

/**
 * Mount the REAL router the way the module loader does, with a stand-in for
 * the middleware that runs upstream of it (host resolver + tenant context).
 * `tenantDbIn` records the environment it was asked for and delegates to the
 * per-test client, so LIVE/SANDBOX pinning is an assertion, not an assumption.
 */
function buildApp({ client, hasSandbox = true } = {}) {
  const app = express();
  const asked = [];
  app.use((req, _res, next) => {
    req.tenant = { slug: "test-tenant", sandbox_schema: hasSandbox ? "sandbox" : null };
    req.identityDb = (fn) => fn({ env: "live" });
    req.tenantDbIn = (env, fn) => {
      asked.push(env);
      return fn(client || { async query() { return { rows: [] }; } });
    };
    next();
  });
  app.use("/public/site", router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  app.asked = asked;
  return app;
}

/** The sandbox client: one published ACTIVE entity. */
const REHEARSAL_ENTITY = {
  entity_id: "e1",
  code: "SLAS",
  legal_name: "Rehearsal Logistics Ltd",
  trading_name: null,
  country_code: "CM",
  address: null,
  public_enabled: true,
  registration_status: "ACTIVE",
  public_summary_fr: "Une répétition.",
  public_summary_en: "A rehearsal.",
  public_coverage: [],
  public_focus: [],
  public_cover_vault_id: null,
};

function sandboxClient() {
  return {
    async query(text) {
      if (/FROM corporate_entity/.test(String(text))) return { rows: [REHEARSAL_ENTITY] };
      return { rows: [] };
    },
  };
}

beforeEach(() => {
  jest.spyOn(identityCache, "getAuthUser").mockResolvedValue(USER);
  jest.spyOn(identityCache, "getUserScopeClosure").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

/** Grants as rbac reads them: ACTION_COLUMN.view is `can_read`. */
const grantView = () =>
  jest.spyOn(identityCache, "getGrants").mockResolvedValue([{ can_read: true }]);
const grantNothing = () =>
  jest.spyOn(identityCache, "getGrants").mockResolvedValue([{}]);

describe("the anonymous reads stay LIVE-only (Q9)", () => {
  it("serves /entities from the LIVE schema whatever the caller's header says", async () => {
    const app = buildApp({ client: sandboxClient() });
    // A hostile header on an anonymous request: the pinning must ignore it.
    const res = await request(app)
      .get("/public/site/entities")
      .set("X-Praxis-Env", "sandbox");
    expect(res.status).toBe(200);
    // The stand-in middleware records the schema the route asked for. LIVE —
    // not the header's "sandbox" — is the whole anonymous contract.
    expect(app.asked).toEqual(["live"]);
  });

  it("an anonymous preview request is 401, never a sandbox read", async () => {
    const app = buildApp({ client: sandboxClient() });
    const res = await request(app).get("/public/site/preview/entities");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
    // Nothing touched a schema on the way out.
    expect(app.asked).toEqual([]);
  });
});

describe("the authenticated preview (Q9)", () => {
  it("serves the stranger-facing payload from the SANDBOX schema for a permitted caller", async () => {
    grantView();
    const app = buildApp({ client: sandboxClient() });
    const res = await request(app)
      .get("/public/site/preview/entities")
      .set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].legal_name).toBe("Rehearsal Logistics Ltd");
    // The safeguards travel on every preview response.
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(app.asked).toEqual(["sandbox"]);
  });

  it("reads SANDBOX even when the caller's own toggle says LIVE", async () => {
    grantView();
    const app = buildApp({ client: sandboxClient() });
    const res = await request(app)
      .get("/public/site/preview/entities")
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Praxis-Env", "live");
    expect(res.status).toBe(200);
    // The preview's one job is the schema a stranger can never select; it is
    // not a mirror of the caller's environment toggle.
    expect(app.asked).toEqual(["sandbox"]);
  });

  it("refuses a signed-in caller without MOD-01 or MOD-29 view", async () => {
    grantNothing();
    const app = buildApp({ client: sandboxClient() });
    const res = await request(app)
      .get("/public/site/preview/entities")
      .set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
    expect(app.asked).toEqual([]);
  });

  it("answers 404, not 500, on a workspace with no Test schema", async () => {
    grantView();
    const app = buildApp({ client: sandboxClient(), hasSandbox: false });
    const res = await request(app)
      .get("/public/site/preview/entities")
      .set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(404);
    expect(app.asked).toEqual([]);
  });
});

describe("the preview's media routes (Q9)", () => {
  const DOC_ID = "33333333-3333-3333-3333-333333333333";
  const DOC = {
    doc_id: DOC_ID,
    storage_path: "t/vault/rehearsal.png",
    public_media_content_type: "image/png",
    public_media_variants: { widths: [480], formats: ["webp"] },
  };

  /** Answers the entity-cover owner join, applying the predicates the SQL
   *  carries — the same trick as the lifecycle tests, so the preview is
   *  proving it runs the REAL gates, not a relaxation of them. */
  function mediaClient() {
    return {
      async query(text) {
        const q = String(text);
        if (/JOIN corporate_entity/.test(q)) {
          const ok =
            /o\.public_enabled\s*=\s*true/.test(q) &&
            /o\.registration_status\s*=\s*'ACTIVE'/.test(q);
          return { rows: ok ? [DOC] : [] };
        }
        return { rows: [] };
      },
    };
  }

  beforeEach(() => {
    grantView();
    jest.spyOn(storage, "get").mockResolvedValue(Buffer.from("rehearsal-bytes"));
  });

  it("serves preview bytes with no public caching at all", async () => {
    const app = buildApp({ client: mediaClient() });
    const res = await request(app)
      .get(`/public/site/preview/media/${DOC_ID}`)
      .set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    // The anonymous media route's year-long immutable public cache is exactly
    // what a preview must NOT carry. (Express's own weak ETag may stand: with
    // `no-store` nothing is allowed to keep the representation it tags.)
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("serves a recorded derivative and refuses a guessed one", async () => {
    const app = buildApp({ client: mediaClient() });
    const ok = await request(app)
      .get(`/public/site/preview/media/${DOC_ID}/480.webp`)
      .set("Authorization", `Bearer ${token()}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");

    // A width the ladder never recorded: 404, the same answer the public
    // route gives, so a guessed URL learns nothing.
    const guessed = await request(app)
      .get(`/public/site/preview/media/${DOC_ID}/1600.avif`)
      .set("Authorization", `Bearer ${token()}`);
    expect(guessed.status).toBe(404);
  });

  it("keeps the anonymous media route on LIVE — a stranger cannot fetch the rehearsal's bytes", async () => {
    const liveOnly = {
      async query() {
        // The LIVE schema in this scenario holds no such document.
        return { rows: [] };
      },
    };
    const app = buildApp({ client: liveOnly });
    const res = await request(app).get(`/public/site/media/${DOC_ID}`);
    expect(res.status).toBe(404);
    expect(app.asked).toEqual(["live"]);
  });
});
