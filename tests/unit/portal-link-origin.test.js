"use strict";
/**
 * Portal set-password / reset emails point at the tenant's PUBLIC host when it
 * has one — a different origin from the workspace host, which the installed
 * staff PWA owns (scope "/") and would otherwise open the link in.
 */
const mockQuery = jest.fn();
jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: (...a) => mockQuery(...a), on: jest.fn(), end: jest.fn() })),
  types: { setTypeParser: jest.fn() },
}));
jest.mock("../../src/modules/portal_auth/portal_auth.service", () => ({
  inviteUser: jest.fn(async () => ({ created: true })),
  requestReset: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../src/modules/branding/branding.service", () => ({ getBranding: jest.fn(async () => ({ name: "Acme" })) }));

const registry = require("../../src/services/tenant/registry.service");
const service = require("../../src/modules/portal_auth/portal_auth.service");
const { logger } = require("../../src/config/logger");
const controller = require("../../src/modules/portal_auth/portal_auth.controller");

beforeEach(() => {
  mockQuery.mockReset();
  service.inviteUser.mockClear();
  service.requestReset.mockClear();
});

describe("registry.publicSurfaceOrigin", () => {
  test("returns https://<host> for the tenant's public-surface host, primary first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ host: "www.acme-freight.com" }] });
    expect(await registry.publicSurfaceOrigin("t-1")).toBe("https://www.acme-freight.com");
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/surface = 'public'/);
    expect(sql).toMatch(/ORDER BY is_primary DESC, created_at/);
    expect(params).toEqual(["t-1"]);
  });

  test("null when the tenant has no public host (caller keeps its own origin)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await registry.publicSurfaceOrigin("t-1")).toBeNull();
  });

  test("null without a tenant id, and no query", async () => {
    expect(await registry.publicSurfaceOrigin(null)).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

function reqFor({ host = "acme.praxisls.com", tenantId = "t-1" } = {}) {
  return {
    protocol: "https",
    get: (h) => (h.toLowerCase() === "host" ? host : undefined),
    tenant: { tenant_id: tenantId, slug: "acme" },
    body: { email: "client@example.com", full_name: "Ada Client" },
    ip: "10.0.0.1",
    identityDb: (fn) => fn({}),
  };
}
const resFake = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn(() => res);
  return res;
};
const run = async (handler, req) => {
  const res = resFake();
  const next = jest.fn();
  await handler(req, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
};

describe("portal emails choose the link origin", () => {
  test("invite uses the public host when the tenant has one", async () => {
    mockQuery.mockResolvedValue({ rows: [{ host: "www.acme-freight.com" }] });
    await run(controller.invite, reqFor());
    expect(service.inviteUser.mock.calls[0][1].origin).toBe("https://www.acme-freight.com");
  });

  test("forgot uses the public host too", async () => {
    mockQuery.mockResolvedValue({ rows: [{ host: "www.acme-freight.com" }] });
    await run(controller.forgot, reqFor());
    expect(service.requestReset.mock.calls[0][1].origin).toBe("https://www.acme-freight.com");
  });

  test("without a public host, the request's own host (today's behaviour)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await run(controller.invite, reqFor());
    expect(service.inviteUser.mock.calls[0][1].origin).toBe("https://acme.praxisls.com");
  });

  test("a failed lookup still sends the email, on the request host, and says so", async () => {
    mockQuery.mockRejectedValue(new Error("platform db down"));
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await run(controller.invite, reqFor());
    expect(service.inviteUser.mock.calls[0][1].origin).toBe("https://acme.praxisls.com");
    expect(res.statusCode).toBe(201);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
