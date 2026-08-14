"use strict";

/**
 * Kaizen ops API (src/modules/platform/ops/*) — INFRASTRUCTURE_PLAN §3.
 *
 * The jobs that write tenant_health, backup_run, restore_drill, uptime_sample
 * and maintenance_window all shipped before anything could read them. These
 * routes are that read path, so the tests focus on the three things that decide
 * whether the surface is safe rather than on re-testing the services:
 *
 *   1. CAPABILITY GATING — reads, actions and tenant-visible changes are three
 *      different levels of trust, and a route wired to the wrong one is not
 *      visible by reading the handler.
 *   2. ROUTE ORDER — literal segments must beat their `:param` siblings, or
 *      GET /ops/backups/runs binds slug="runs" and 422s. That failure looks
 *      like a broken dashboard and is annoying to trace, so it is asserted.
 *   3. EXPENSIVE ACTIONS DETACH — a fleet backup or a restore drill must not be
 *      awaited inside the request, and a rejection from the detached promise
 *      must not become an unhandled rejection (which kills the process).
 *
 * Services are mocked throughout: this is about the HTTP layer.
 */

const express = require("express");
const request = require("supertest");

jest.mock("../../src/services/platform/health-rollup.service", () => ({
  fleetHealth: jest.fn(async () => ({ tenants: [] })),
  tenantHistory: jest.fn(async () => []),
  collectFleetHealth: jest.fn(async () => ({
    total: 2,
    green: 2,
    amber: 0,
    red: 0,
  })),
}));
jest.mock("../../src/services/platform/backup.service", () => ({
  backupStatus: jest.fn(async () => ({
    rpo_hours: 24,
    tenants: [],
    stale_count: 0,
    never_count: 0,
  })),
  recentRuns: jest.fn(async () => []),
  preflight: jest.fn(async () => ({
    ok: true,
    pg_dump: "16.2",
    pg_restore: "16.2",
    server: "16.2",
    error: null,
  })),
  backupTenant: jest.fn(async () => ({ ok: true })),
  backupFleet: jest.fn(async () => ({ total: 1, ok: 1, failed: 0 })),
}));
jest.mock("../../src/services/platform/restore.service", () => ({
  recentDrills: jest.fn(async () => ({
    drills: [],
    coverage: [],
    never_drilled: [],
    rto_target_seconds: 3600,
  })),
  restoreTenant: jest.fn(async () => ({ ok: true })),
  runScheduledDrill: jest.fn(async () => ({ ok: true, slug: "acme" })),
}));
jest.mock("../../src/services/platform/object-backup.service", () => ({
  objectBackupStatus: jest.fn(async () => []),
  syncTenantObjects: jest.fn(async () => ({ copied: 0 })),
  scanTenantIntegrity: jest.fn(async () => ({ clean: true })),
}));
jest.mock("../../src/services/platform/uptime.service", () => ({
  availability: jest.fn(async () => []),
  incidents: jest.fn(async () => []),
  probeTargets: jest.fn(async () => []),
  probeAll: jest.fn(async () => ({ probed: 3, down: 0 })),
}));
jest.mock("../../src/services/platform/maintenance.service", () => ({
  list: jest.fn(async () => []),
  schedule: jest.fn(async (a) => ({ maintenance_window_id: "w1", ...a })),
  cancel: jest.fn(async () => ({ maintenance_window_id: "w1" })),
  telemetrySnapshot: jest.fn(async () => ({ slug: "acme" })),
}));
jest.mock("../../src/services/platform/backup-storage.service", () => ({
  pruneRetention: jest.fn(async () => ({ removed: [], kept: 3 })),
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveBySlug: jest.fn(async (slug) =>
    slug === "ghost"
      ? null
      : { slug, tenant_id: "11111111-1111-4111-8111-111111111111" },
  ),
}));

// requireCap is the thing under test, so it is NOT mocked — only the auth that
// populates req.platformUser / req.platformCaps, which a real login would do.
let CAPS = new Set();
let ROLE = "PLATFORM_SUPPORT";

const backup = require("../../src/services/platform/backup.service");
const restore = require("../../src/services/platform/restore.service");
const maintenance = require("../../src/services/platform/maintenance.service");
const registry = require("../../src/services/tenant/registry.service");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.platformUser = { platform_user_id: "u1", role: ROLE };
    req.platformCaps = CAPS;
    next();
  });
  app.use("/", require("../../src/modules/platform/ops/ops.routes"));
  // Mirrors the app's error envelope closely enough to assert status codes.
  app.use((err, _req, res, _next) => {
    res
      .status(err.status || 500)
      .json({ error: { code: err.code, message: err.message } });
  });
  return app;
}

let app;
beforeEach(() => {
  CAPS = new Set();
  ROLE = "PLATFORM_SUPPORT";
  app = makeApp();
});

const TID = "11111111-1111-4111-8111-111111111111";
const WID = "22222222-2222-4222-8222-222222222222";

describe("capability gating", () => {
  test("reads require ops.read", async () => {
    await request(app).get("/ops/health").expect(403);
    CAPS = new Set(["ops.read"]);
    app = makeApp();
    await request(app).get("/ops/health").expect(200);
  });

  test("ops.read does NOT let you trigger work", async () => {
    CAPS = new Set(["ops.read"]);
    app = makeApp();
    // Reading a dashboard at 3am and starting twelve concurrent pg_dumps from
    // it are different levels of trust.
    await request(app).post("/ops/backups").expect(403);
    await request(app).post("/ops/drills").expect(403);
    await request(app).post("/ops/uptime/probe").expect(403);
    expect(backup.backupFleet).not.toHaveBeenCalled();
  });

  test("ops.operate does NOT let you change what tenant users see", async () => {
    CAPS = new Set(["ops.read", "ops.operate"]);
    app = makeApp();
    // A maintenance window banners every user of a tenant, and READ_ONLY parks
    // their writes. That does not follow from being allowed to run a backup.
    await request(app)
      .post("/ops/maintenance")
      .send({
        starts_at: "2026-08-12T01:00:00Z",
        ends_at: "2026-08-12T03:00:00Z",
        title: "x",
      })
      .expect(403);
    await request(app).delete(`/ops/maintenance/${WID}`).expect(403);
    expect(maintenance.schedule).not.toHaveBeenCalled();
  });

  test("root admin bypasses every capability check", async () => {
    ROLE = "PLATFORM_ROOT_ADMIN";
    app = makeApp();
    await request(app).get("/ops/health").expect(200);
    await request(app).post("/ops/backups").expect(202);
  });

  test("support telemetry is gated on support.read, not ops.read", async () => {
    // The triager who can open the ticket must be able to see the context the
    // workstream exists to attach to it.
    CAPS = new Set(["ops.read"]);
    app = makeApp();
    await request(app).get("/ops/telemetry/acme").expect(403);

    CAPS = new Set(["support.read"]);
    app = makeApp();
    await request(app).get("/ops/telemetry/acme").expect(200);
  });
});

describe("route ordering — literal segments beat :param siblings", () => {
  beforeEach(() => {
    CAPS = new Set(["ops.read"]);
    app = makeApp();
  });

  test("GET /ops/backups/runs is the run log, not slug='runs'", async () => {
    const res = await request(app).get("/ops/backups/runs").expect(200);
    expect(backup.recentRuns).toHaveBeenCalled();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /ops/backups/preflight is the tooling check", async () => {
    await request(app).get("/ops/backups/preflight").expect(200);
    expect(backup.preflight).toHaveBeenCalled();
  });

  test("GET /ops/uptime/incidents and /targets are not swallowed", async () => {
    await request(app).get("/ops/uptime/incidents").expect(200);
    await request(app).get("/ops/uptime/targets").expect(200);
  });

  test("GET /ops/health/:tenantId still resolves a real uuid", async () => {
    await request(app).get(`/ops/health/${TID}`).expect(200);
  });

  test("GET /ops/health/:tenantId rejects a non-uuid with 422, not 500", async () => {
    await request(app).get("/ops/health/not-a-uuid").expect(422);
  });
});

describe("expensive actions are detached", () => {
  beforeEach(() => {
    CAPS = new Set(["ops.read", "ops.operate"]);
    app = makeApp();
  });

  test("fleet backup answers 202 without awaiting the dump", async () => {
    let release;
    backup.backupFleet.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    const res = await request(app).post("/ops/backups").expect(202);
    expect(res.body.data.accepted).toBe(true);
    // The request finished while the job is still running — the point of 202.
    release({ total: 1, ok: 1, failed: 0 });
  });

  test("a detached failure is swallowed, not turned into an unhandled rejection", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    backup.backupFleet.mockRejectedValueOnce(new Error("disk full"));

    await request(app).post("/ops/backups").expect(202);
    await new Promise((r) => setImmediate(r));

    // The FAILED row is recorded by the service; this asserts only that the
    // process survives. "The API restarted because someone clicked Back up now"
    // is a spectacular way to fail.
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  test("a drill for one tenant resolves the slug and detaches", async () => {
    await request(app).post("/ops/drills/acme").send({}).expect(202);
    expect(registry.resolveBySlug).toHaveBeenCalledWith("acme");
    expect(restore.restoreTenant).toHaveBeenCalledWith({
      slug: "acme",
      at: null,
    });
  });

  test("an unknown tenant is a 404 before anything is started", async () => {
    await request(app).post("/ops/backups/ghost").expect(404);
    expect(backup.backupTenant).not.toHaveBeenCalled();
  });

  test("health collection stays synchronous — the operator wants the refreshed grid", async () => {
    const res = await request(app).post("/ops/health/collect").expect(200);
    expect(res.body.data.total).toBe(2);
  });
});

describe("maintenance windows", () => {
  beforeEach(() => {
    CAPS = new Set(["ops.read", "ops.maintain"]);
    app = makeApp();
  });

  test("a window scoped by slug resolves to a tenant_id", async () => {
    await request(app)
      .post("/ops/maintenance")
      .send({
        tenant_slug: "acme",
        starts_at: "2026-08-12T01:00:00Z",
        ends_at: "2026-08-12T03:00:00Z",
        title: "Database upgrade",
        mode: "READ_ONLY",
      })
      .expect(201);
    expect(maintenance.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TID,
        mode: "READ_ONLY",
        title: "Database upgrade",
      }),
    );
  });

  test("no slug means a deliberate fleet-wide window", async () => {
    await request(app)
      .post("/ops/maintenance")
      .send({
        starts_at: "2026-08-12T01:00:00Z",
        ends_at: "2026-08-12T03:00:00Z",
        title: "Fleet migration",
      })
      .expect(201);
    expect(maintenance.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null }),
    );
  });

  test("an unknown slug is 404 — never a silently fleet-wide window", async () => {
    // The dangerous misreading: asking to park ONE tenant and parking all of them.
    await request(app)
      .post("/ops/maintenance")
      .send({
        tenant_slug: "ghost",
        starts_at: "2026-08-12T01:00:00Z",
        ends_at: "2026-08-12T03:00:00Z",
        title: "x",
      })
      .expect(404);
    expect(maintenance.schedule).not.toHaveBeenCalled();
  });

  test("ends_at before starts_at is rejected at the edge", async () => {
    await request(app)
      .post("/ops/maintenance")
      .send({
        starts_at: "2026-08-12T03:00:00Z",
        ends_at: "2026-08-12T01:00:00Z",
        title: "backwards",
      })
      .expect(422);
  });

  test("an unknown mode is rejected rather than defaulted", async () => {
    await request(app)
      .post("/ops/maintenance")
      .send({
        starts_at: "2026-08-12T01:00:00Z",
        ends_at: "2026-08-12T03:00:00Z",
        title: "x",
        mode: "SHUT_EVERYTHING",
      })
      .expect(422);
  });

  test("cancelling a window that is not active is a 404, not a silent 200", async () => {
    maintenance.cancel.mockResolvedValueOnce(null);
    await request(app).delete(`/ops/maintenance/${WID}`).expect(404);
  });
});

describe("query bounds", () => {
  beforeEach(() => {
    CAPS = new Set(["ops.read"]);
    app = makeApp();
  });

  test("uptime window is capped — an unbounded days is a full-table scan", async () => {
    await request(app).get("/ops/uptime?days=99999").expect(422);
    await request(app).get("/ops/uptime?days=365").expect(200);
  });

  test("run-log limit is capped", async () => {
    await request(app).get("/ops/backups/runs?limit=100000").expect(422);
  });

  test("an unknown backup kind is rejected", async () => {
    await request(app).get("/ops/backups/runs?kind=NONSENSE").expect(422);
  });
});
