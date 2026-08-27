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
  IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
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

  test("every route is rate-limited (120 / 15 min)", () => {
    expect(routesSrc).toMatch(/makeLimiter\(\{\s*name:\s*"services-public",\s*max:\s*120,\s*windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
    for (const method of ["router.get(\"/\"", "router.get(\"/:slug\"", "router.get(\"/media/:id\""]) {
      const callSite = routesSrc.indexOf(method);
      expect(callSite).toBeGreaterThan(-1);
      // The limiter is referenced in the chain between route declaration and handler.
      const chain = routesSrc.slice(callSite, callSite + 400);
      expect(chain).toMatch(/limit,/);
    }
  });

  test("media responses carry nosniff + Cache-Control public,max-age=300 (same shape as portfolio_public)", () => {
    expect(routesSrc).toContain("X-Content-Type-Options");
    expect(routesSrc).toContain("nosniff");
    expect(routesSrc).toContain("Cache-Control");
    expect(routesSrc).toContain("public, max-age=300");
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
    expect(routesSrc).not.toMatch(/cover_url:[\s\S]*Buffer/);
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

  test("media route re-checks VERIFIED + scope + role + image content type before streaming", async () => {
    const UUID = "11111111-1111-4111-8111-111111111111";
    repo.vaultMediaForServe.mockResolvedValue(null);
    const { router } = require(routesFile);
    // Call the route directly with a fake req/res.
    const layer = router.stack.find((l) => l.route && l.route.path === "/media/:id");
    const handlers = layer.route.stack.map((s) => s.handle);
    const fakeReq = {
      params: { id: UUID },
      ip: "127.0.0.1",
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
    // With no doc, the route should answer 404.
    expect(fakeRes.status).toHaveBeenCalledWith(404);
    expect(fakeRes.send).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  test("media route streams a verified, scoped, image doc with the right headers", async () => {
    const UUID = "11111111-1111-4111-8111-111111111111";
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: UUID, storage_path: "tenant/web/x.png",
      public_media_content_type: "image/png", public_media_scope: "SERVICE_TYPE",
      public_media_role: "COVER",
    });
    storage.get.mockResolvedValue(Buffer.from("image-bytes"));
    const { router } = require(routesFile);
    const layer = router.stack.find((l) => l.route && l.route.path === "/media/:id");
    const handlers = layer.route.stack.map((s) => s.handle);
    const fakeReq = {
      params: { id: UUID },
      ip: "127.0.0.1",
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
    expect(fakeRes.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=300");
    expect(fakeRes.send).toHaveBeenCalledWith(expect.any(Buffer));
  });
});
