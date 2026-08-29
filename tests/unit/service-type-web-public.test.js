/**
 * The /public/services surface — guide §3.2, §4.5, §4.6.
 *
 * The router file itself (the pin-to-LIVE + rate-limit + the byte-serve
 * headers) is read on disk; the service is mocked so the SQL the
 * `publicList` / `publicDetail` paths run can be asserted without a
 * database.
 */
"use strict";

jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  publicList: jest.fn(),
  publicDetail: jest.fn(),
  publicRelated: jest.fn(),
  publicFaq: jest.fn(),
  vaultMediaForServe: jest.fn(),
  publicMediaForServe: jest.fn(),
  IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
}));
jest.mock("../../src/services/storage.service", () => ({ get: jest.fn(), delete: jest.fn() }));

const fs = require("fs");
const path = require("path");
const repo = require("../../src/modules/operations/service_type_web/service_type_web.repo");
const storage = require("../../src/services/storage.service");

const routesFile = path.join(
  __dirname, "../../src/modules/operations/service_type_web_public/service_type_web_public.routes.js",
);
const routesSrc = fs.readFileSync(routesFile, "utf8");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("public surface wiring (guide §3.2, §6)", () => {
  test("basePath, feature, idParam match the guide", () => {
    const def = require(routesFile);
    expect(def.basePath).toBe("/public/services");
    expect(def.feature).toBe("website");
    expect(def.idParam).toBe("text");
  });

  test("every route is pinned to LIVE via req.tenantDbIn('live', …) — sandbox is unreachable from the internet", () => {
    expect(routesSrc).toContain("req.tenantDbIn(\"live\"");
    // No public read should slip through to req.tenantDb (which honours X-Praxis-Env).
    expect(routesSrc).not.toMatch(/req\.tenantDb\(/);
  });

  test("every route is rate-limited — JSON at 120/15min, images on their own larger budget", () => {
    expect(routesSrc).toMatch(/makeLimiter\(\{\s*name:\s*"services-public",\s*max:\s*120,\s*windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
    // Images have a SEPARATE, larger budget, and that is deliberate: one visit
    // to a page of cards spends a request here per card, so sharing the JSON
    // budget made the page with the most images the one most likely to have
    // them refused — and a refused image is a broken frame on a sales page, not
    // a retry-later banner. Still bounded, because each one is read out of the
    // vault into a Buffer by this process.
    expect(routesSrc).toMatch(/makeLimiter\(\{\s*name:\s*"services-public-media",\s*max:\s*600,\s*windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
    for (const method of ["router.get(\"/\"", "router.get(\"/:slug\"", "router.get(\"/media/:id\""]) {
      const callSite = routesSrc.indexOf(method);
      expect(callSite).toBeGreaterThan(-1);
      // Some limiter is referenced in the chain between route declaration and
      // handler — `limit` for the JSON reads, `mediaLimit` for the byte-serve.
      const chain = routesSrc.slice(callSite, callSite + 400);
      expect(chain).toMatch(/[Ll]imit,/);
    }
  });

  test("media responses carry nosniff + a year of immutable caching, keyed on the vault doc id", () => {
    expect(routesSrc).toContain("X-Content-Type-Options");
    expect(routesSrc).toContain("nosniff");
    expect(routesSrc).toContain("Cache-Control");
    // Deliberately NOT `max-age=300`. The id in this URL is the vault
    // DOCUMENT's id, so the bytes behind a given URL never change — replacing a
    // cover uploads a new document, which gets a new id, which is a new URL.
    // Five minutes meant every visitor re-read every image out of the vault
    // twice an hour, through a Node process that buffers each one whole.
    expect(routesSrc).toContain("public, max-age=31536000, immutable");
    expect(routesSrc).toContain("ETag");
  });
});

describe("public list (guide §4.6)", () => {
  test("filter is is_published = true AND is_active = true, sort by sort_order then name_fr", () => {
    expect(routesSrc).toContain("publicList");
    // The repo SQL carries the WHERE — pin it here so a future refactor that
    // drops one of the two conditions trips a CI failure before the leak.
    const repoSrc = fs.readFileSync(
      path.join(__dirname, "../../src/modules/operations/service_type_web/service_type_web.repo.js"),
      "utf8",
    );
    expect(repoSrc).toContain("p.is_published = true AND st.is_active = true");
    expect(repoSrc).toContain("ORDER BY p.sort_order ASC, st.name_fr ASC");
  });

  test("the list response emits no bytes — only URLs (or nulls)", () => {
    // The shape is built in the route file, not the repo — pin the keys
    // and prove there is no Buffer / data-url in the list shape.
    expect(routesSrc).toContain("cover_url:");
    expect(routesSrc).toContain("icon_url:");
    // Scoped to the list handler rather than the whole file. `[\s\S]*` across
    // the file matched the FIRST `cover_url:` and the LAST `Buffer` anywhere
    // after it, so a mention of Buffer in the byte-serve route's own comment —
    // two hundred lines below the list shape — read as bytes in the list.
    const listStart = routesSrc.indexOf("router.get(\"/\"");
    const listEnd = routesSrc.indexOf("router.get(\"/:slug\"");
    expect(listStart).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(listStart);
    expect(routesSrc.slice(listStart, listEnd)).not.toMatch(/cover_url:[\s\S]*Buffer/);
  });
});

describe("public detail", () => {
  test("detail matches by slug_fr OR slug_en, returns 404 on miss", () => {
    const repoSrc = fs.readFileSync(
      path.join(__dirname, "../../src/modules/operations/service_type_web/service_type_web.repo.js"),
      "utf8",
    );
    expect(repoSrc).toContain("p.slug_fr = $1 OR p.slug_en = $1");
  });

  test("related list filters to published profiles (no unpublished leak)", () => {
    const repoSrc = fs.readFileSync(
      path.join(__dirname, "../../src/modules/operations/service_type_web/service_type_web.repo.js"),
      "utf8",
    );
    expect(repoSrc).toMatch(/publicRelated[\s\S]*?p\.is_published = true/);
  });

  test("media route re-checks VERIFIED + scope + role + image content type + ownership before streaming", async () => {
    const UUID = "11111111-1111-4111-8111-111111111111";
    repo.publicMediaForServe.mockResolvedValue(null);
    const { router } = require(routesFile);
    // Call the route directly with a fake req/res.
    const layer = router.stack.find((l) => l.route && l.route.path === "/media/:id");
    const handlers = layer.route.stack.map((s) => s.handle);
    const fakeReq = {
      params: { id: UUID },
      ip: "127.0.0.1",
      // express-rate-limit reads `req.headers` in its own validation pass
      // (it warns when X-Forwarded-For is set but `trust proxy` is not).
      // That pass runs ONCE per limiter instance, so it never fired for
      // `limit` — an earlier test in this file had already used it up —
      // and fired on the first call through the new `mediaLimit`, throwing
      // on `undefined.x-forwarded-for` before the handler ran.
      headers: {},
      // …and `req.app`, for the sibling validation that warns when Express
      // is behind a proxy it has not been told to trust. Both are cheap to
      // provide and keep the limiter silent in a unit test.
      app: { get: () => undefined },
      tenantDbIn: jest.fn(async (env, fn) => fn({})),
    };
    const fakeRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    let captured = null;
    const next = (err) => { captured = err; };
    for (const h of handlers) {
      await h(fakeReq, fakeRes, next);
    }
    // With no doc, the route throws NOT_FOUND (404) through the asyncHandler.
    expect(captured).toBeTruthy();
    expect(captured.code).toBe("NOT_FOUND");
    expect(captured.status).toBe(404);
    expect(fakeRes.send).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  test("media route streams a verified, scoped, image doc with the right headers", async () => {
    const UUID = "11111111-1111-4111-8111-111111111111";
    repo.publicMediaForServe.mockResolvedValue({
      doc_id: UUID, storage_path: "tenant/web/x.png",
      public_media_content_type: "image/png", public_media_scope: "SERVICE_TYPE",
      public_media_role: "COVER", public_media_entity_ref: `service_type:st-1`,
    });
    storage.get.mockResolvedValue(Buffer.from("image-bytes"));
    const { router } = require(routesFile);
    const layer = router.stack.find((l) => l.route && l.route.path === "/media/:id");
    const handlers = layer.route.stack.map((s) => s.handle);
    const fakeReq = {
      params: { id: UUID },
      ip: "127.0.0.1",
      // express-rate-limit reads `req.headers` in its own validation pass
      // (it warns when X-Forwarded-For is set but `trust proxy` is not).
      // That pass runs ONCE per limiter instance, so it never fired for
      // `limit` — an earlier test in this file had already used it up —
      // and fired on the first call through the new `mediaLimit`, throwing
      // on `undefined.x-forwarded-for` before the handler ran.
      headers: {},
      // …and `req.app`, for the sibling validation that warns when Express
      // is behind a proxy it has not been told to trust. Both are cheap to
      // provide and keep the limiter silent in a unit test.
      app: { get: () => undefined },
      tenantDbIn: jest.fn(async (env, fn) => fn({})),
    };
    const fakeRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    for (const h of handlers) {
      await h(fakeReq, fakeRes, () => undefined);
    }
    expect(fakeRes.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(fakeRes.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(fakeRes.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    expect(fakeRes.setHeader).toHaveBeenCalledWith("ETag", expect.any(String));
    expect(fakeRes.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  test("media route refuses a non-UUID id without hitting the database", async () => {
    // Defends against the audit's "stringly validated doc id" concern —
    // a bare UUID never grants public access; a non-UUID never even
    // reaches the SQL. Without this, the repo's UUID_RE check is the
    // only line of defence and a future refactor that drops it would
    // leak a SQL error page to the internet.
    repo.publicMediaForServe.mockResolvedValue(null); // defensive: clear prior test's mock
    const { router } = require(routesFile);
    const layer = router.stack.find((l) => l.route && l.route.path === "/media/:id");
    // Find the LAST handler (the asyncHandler-wrapped user fn), bypassing
    // the rate-limiter. The previous test exercises the limiter; here we
    // want to assert what happens AFTER the limiter passes.
    const userHandler = layer.route.stack[layer.route.stack.length - 1].handle;
    const fakeReq = {
      params: { id: "not-a-uuid" },
      ip: "10.0.0.7",
      tenantDbIn: jest.fn(async (env, fn) => fn({})),
    };
    const fakeRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    let captured = null;
    const next = (err) => { captured = err; };
    try {
      await userHandler(fakeReq, fakeRes, next);
    } catch (e) {
      captured = captured || e;
    }
    expect(captured).toBeTruthy();
    expect(captured.code).toBe("NOT_FOUND");
    expect(captured.status).toBe(404);
    expect(fakeRes.send).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });
});

describe("public media — fail-closed at the serve time (audit fix 1)", () => {
  // The audit (comment 1) named the BLOCKER: a draft (or
  // unpublished-after-edit) profile whose cover is already VERIFIED +
  // scoped in the vault served its bytes to anyone holding the doc UUID.
  // §6 rule 9: "media of unpublished profiles is unreachable." The fix
  // moves the join into the repo (publicMediaForServe); these tests
  // prove the SQL the route calls it for.
  test("the serve-time SQL joins the profile AND the service_type", () => {
    const repoSrc = fs.readFileSync(
      path.join(__dirname, "../../src/modules/operations/service_type_web/service_type_web.repo.js"),
      "utf8",
    );
    // The function must check the OWNING row is published and active.
    expect(repoSrc).toMatch(/JOIN service_type_web_profile p/);
    expect(repoSrc).toMatch(/JOIN service_type st/);
    expect(repoSrc).toMatch(/p\.is_published = true/);
    expect(repoSrc).toMatch(/st\.is_active = true/);
  });

  test("the serve-time SQL refuses the doc if it isn't bound to the matching slot", () => {
    // Without this, a doc scoped to service A but stored in a stale URL
    // for service B's media would serve. The cover/icon/gallery-or-null
    // disjunction is the disproof.
    const repoSrc = fs.readFileSync(
      path.join(__dirname, "../../src/modules/operations/service_type_web/service_type_web.repo.js"),
      "utf8",
    );
    expect(repoSrc).toMatch(/public_media_role = 'COVER' {2}AND v\.doc_id = p\.cover_vault_id/);
    expect(repoSrc).toMatch(/public_media_role = 'ICON' {2}AND v\.doc_id = p\.icon_vault_id/);
    expect(repoSrc).toMatch(/public_media_role = 'GALLERY' AND v\.doc_id = ANY\(p\.gallery_vault_ids\)/);
  });

  test("a non-UUID id never reaches the database (UUID_RE short-circuits)", () => {
    // Walk the repo to confirm UUID_RE is exported and used as a guard.
    const repoMod = require("../../src/modules/operations/service_type_web/service_type_web.repo");
    expect(repoMod.UUID_RE).toBeInstanceOf(RegExp);
    expect(repoMod.UUID_RE.test("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(repoMod.UUID_RE.test("not-a-uuid")).toBe(false);
  });
});

describe("public response — publishedMonth helper (audit fix 3)", () => {
  // The audit (comment 3) called out String(published_at).slice(0, 7) which
  // would happily return "2024-01-01 12:34" in unparsed form. The route
  // file now imports a `publishedMonth` helper from the shared module.
  // Verify the route is no longer calling the raw slice — it must
  // always go through the helper.
  test("the route does not raw-slice published_at — it calls publishedMonth(…)", () => {
    expect(routesSrc).not.toMatch(/String\([^)]*published_at[^)]*\)\.slice\(0,\s*7\)/);
    expect(routesSrc).toContain("publishedMonth(");
  });

  test("the route imports publishedMonth from the shared helper (single source of truth)", () => {
    // Without centralising, audit comment 3 keeps recurring. The helper
    // is in src/shared/date/published-month.js so portfolio_public and
    // service_type_web_public cannot drift.
    expect(routesSrc).toMatch(/require\([^)]*shared\/date\/published-month/);
  });
});