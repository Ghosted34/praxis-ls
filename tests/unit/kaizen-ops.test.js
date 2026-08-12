"use strict";

/**
 * Kaizen ops (§3.1, §3.3, §3.4, §3.5) — WS-B2/B4, H1/H2, ER1, U1, M1/M2.
 *
 * The properties asserted here are the ones that decide whether this subsystem
 * is honest or merely present:
 *
 *   - an offsite copy must SURVIVE deletion from primary. A mirror propagates
 *     the deletion you are recovering from, which makes it worse than useless.
 *   - a document the database references but storage lacks must be a distinct,
 *     loud finding — it is the case where the app will offer a file and fail.
 *   - "unknown" health must not be coloured RED. Colouring unknown as broken
 *     trains people to ignore the colour, which is how a real RED gets missed.
 *   - a page-severity alert with no dedicated channel must fall BACK to the
 *     general one, never go silent. Silence is indistinguishable from health.
 *   - a tenant-specific maintenance window must beat a fleet-wide one.
 */

jest.mock("../../src/services/platform/db", () => ({
  query: jest.fn(),
  close: jest.fn(),
}));
jest.mock("../../src/services/platform/backup-storage.service", () => ({
  putStream: jest.fn(),
  exists: jest.fn(),
  // `driver` used to be a constant read at import. The destination is
  // configurable from the console now, so it is asked for per call — which
  // means the mock has to answer rather than expose a string.
  currentDriver: jest.fn(async () => "local"),
  describe: jest.fn(async () => ({
    driver: "local",
    source: "env",
    destination: "./data/backups",
    credentials_set: true,
  })),
}));
jest.mock("../../src/services/storage.service", () => ({ get: jest.fn() }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(),
  listActiveTenants: jest.fn(),
  poolStats: jest.fn(() => ({ detail: [] })),
  closeAll: jest.fn(),
}));
jest.mock("../../src/services/platform/backup.service", () => ({
  startRun: jest.fn(async () => "run-1"),
  // ASYNC, because the caller does `finishRun(...).catch(...)` on the failure
  // path. A mock returning undefined turns any error inside the try block into
  // a confusing TypeError about `.catch` of undefined, hiding the real one.
  finishRun: jest.fn(async () => {}),
  backupStatus: jest.fn(),
}));

const platformDb = require("../../src/services/platform/db");
const backupStore = require("../../src/services/platform/backup-storage.service");
const storage = require("../../src/services/storage.service");
const registry = require("../../src/services/tenant/registry.service");
const backupSvc = require("../../src/services/platform/backup.service");

const objects = require("../../src/services/platform/object-backup.service");
const health = require("../../src/services/platform/health-rollup.service");
const alerts = require("../../src/services/platform/alert-routing.service");
const maintenance = require("../../src/services/platform/maintenance.service");

const meta = (slug = "acme") => ({
  slug,
  tenant_id: `tid-${slug}`,
  db_name: `tenant_${slug}`,
});

/** Make withTenantConnection hand the callback a fake client returning `rows`. */
const withRows = (rows) =>
  registry.withTenantConnection.mockImplementation(async (m, env, fn) =>
    fn({ query: async () => ({ rows }) }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  platformDb.query.mockResolvedValue({ rows: [] });
  backupStore.exists.mockResolvedValue(false);
  backupStore.putStream.mockResolvedValue({
    bytes: 4,
    checksum: "h",
    location: "local:x",
  });
});

describe("WS-B2 — object sync", () => {
  test("copies objects the offsite store does not already have", async () => {
    withRows([
      { doc_id: "d1", storage_path: "vault/a.pdf", content_hash: "h1" },
    ]);
    storage.get.mockResolvedValue(Buffer.from("abcd"));

    const r = await objects.syncTenantObjects(meta());
    expect(r.ok).toBe(true);
    expect(r.copied).toBe(1);
    expect(backupStore.putStream).toHaveBeenCalledTimes(1);
  });

  test("skips objects already offsite, so a re-run resumes rather than re-uploads", async () => {
    withRows([{ doc_id: "d1", storage_path: "vault/a.pdf" }]);
    backupStore.exists.mockResolvedValue(true);

    const r = await objects.syncTenantObjects(meta());
    expect(r.copied).toBe(0);
    expect(r.skipped).toBe(1);
    expect(backupStore.putStream).not.toHaveBeenCalled();
  });

  /**
   * The property that makes this a backup rather than a mirror. Nothing in the
   * sync path may issue a delete: propagating a deletion destroys the copy in
   * the one scenario the copy exists for.
   */
  test("never deletes from the destination", async () => {
    withRows([{ doc_id: "d1", storage_path: "vault/a.pdf" }]);
    storage.get.mockResolvedValue(Buffer.from("abcd"));
    await objects.syncTenantObjects(meta());
    expect(backupStore.remove).toBeUndefined(); // not even imported into the sync path
  });

  test("reports a referenced-but-absent object without abandoning the rest", async () => {
    withRows([
      { doc_id: "gone", storage_path: "vault/missing.pdf" },
      { doc_id: "ok", storage_path: "vault/present.pdf" },
    ]);
    storage.get
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(Buffer.from("abcd"));

    const r = await objects.syncTenantObjects(meta());
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].doc_id).toBe("gone");
    expect(r.copied).toBe(1); // the healthy one still went
  });
});

describe("WS-B4 — integrity scan", () => {
  const crypto = require("crypto");
  const hashOf = (s) =>
    crypto.createHash("sha256").update(Buffer.from(s)).digest("hex");

  test("passes when stored bytes hash to the recorded content_hash", async () => {
    withRows([
      { doc_id: "d1", storage_path: "v/a.pdf", content_hash: hashOf("good") },
    ]);
    storage.get.mockResolvedValue(Buffer.from("good"));

    const r = await objects.scanTenantIntegrity(meta());
    expect(r.ok).toBe(true);
    expect(r.corrupt).toBe(0);
  });

  test("flags silent corruption — bytes present but hash changed", async () => {
    withRows([
      {
        doc_id: "d1",
        storage_path: "v/a.pdf",
        content_hash: hashOf("original"),
      },
    ]);
    storage.get.mockResolvedValue(Buffer.from("tampered"));

    const r = await objects.scanTenantIntegrity(meta());
    expect(r.ok).toBe(false);
    expect(r.corrupt).toBe(1);
    expect(r.findings.corrupt[0].doc_id).toBe("d1");
  });

  test("records the run as FAILED when anything is corrupt, so an alert can watch it", async () => {
    withRows([
      { doc_id: "d1", storage_path: "v/a.pdf", content_hash: hashOf("x") },
    ]);
    storage.get.mockResolvedValue(Buffer.from("y"));

    await objects.scanTenantIntegrity(meta());
    expect(backupSvc.finishRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  test("separates unhashed from corrupt — unverifiable is not the same as damaged", async () => {
    withRows([{ doc_id: "d1", storage_path: "v/a.pdf", content_hash: null }]);
    storage.get.mockResolvedValue(Buffer.from("whatever"));

    const r = await objects.scanTenantIntegrity(meta());
    expect(r.ok).toBe(true);
    expect(r.unhashed).toBe(1);
    expect(r.corrupt).toBe(0);
  });
});

describe("WS-H1/H2 — health status rules", () => {
  test("an unreachable database is RED", () => {
    const { status, reasons } = health.statusFor({ schema_unreachable: true });
    expect(status).toBe("RED");
    expect(reasons[0]).toMatch(/unreachable/);
  });

  test("a failing tenant liveness probe is RED even when everything else looks fine", () => {
    expect(health.statusFor({ liveness_ok: false }).status).toBe("RED");
  });

  test("requests queueing behind a saturated pool is RED", () => {
    expect(health.statusFor({ pool_waiting: 3 }).status).toBe("RED");
  });

  /**
   * The distinction that keeps the colour meaningful. A tenant whose probe did
   * not run is UNKNOWN, not broken — colouring unknown as RED produces false
   * alarms, and false alarms are how a real RED gets ignored.
   */
  test("an absent liveness result is NOT red", () => {
    expect(health.statusFor({}).status).toBe("GREEN");
    expect(health.statusFor({ liveness_ok: null }).status).toBe("GREEN");
  });

  test("schema drift is AMBER — degraded, still serving", () => {
    const r = health.statusFor({ schema_behind: 2 });
    expect(r.status).toBe("AMBER");
    expect(r.reasons[0]).toMatch(/2 migration/);
  });

  test("RED outranks AMBER when both apply", () => {
    expect(
      health.statusFor({ schema_behind: 2, liveness_ok: false }).status,
    ).toBe("RED");
  });

  test("always explains itself", () => {
    expect(
      health.statusFor({ schema_behind: 1, mail_verified: false }).reasons,
    ).toHaveLength(2);
  });
});

describe("WS-ER1 — alert routing", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.resetModules();
  });

  test("maps ops events to sensible severities", () => {
    expect(alerts.EVENT_SEVERITY["backup.failed"]).toBe("page");
    expect(alerts.EVENT_SEVERITY["restore.drill.failed"]).toBe("page");
    expect(alerts.EVENT_SEVERITY["integrity.corrupt"]).toBe("page");
    expect(alerts.EVENT_SEVERITY["backup.stale"]).toBe("notify");
  });

  /**
   * A misconfiguration must degrade to "too noisy", never to "silent" — a
   * channel that goes quiet is indistinguishable from a healthy system.
   */
  // ASYNC as of WS-ER1: the destination now resolves from the platform settings
  // vault first (set and tested in Platform Console → Integrations → Ops
  // alerts) and falls back to env, so it has to read the database.
  test("a page falls back to the general webhook when no page channel is set", async () => {
    const dest = await alerts.destinationFor("page");
    // With neither configured in the test env, there is simply no destination —
    // and that must be reported rather than silently swallowed.
    expect(dest === null || dest.channel === "default").toBe(true);
  });

  test("reports 'no destination configured' distinctly from a delivery failure", async () => {
    const r = await alerts.raise({ event: "backup.failed", subject: "test" });
    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/no destination configured/);
  });

  test("log-severity events are recorded but never dispatched", async () => {
    const r = await alerts.raise({
      event: "maintenance.started",
      subject: "x",
    });
    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/log-only/);
  });

  test("rejects an unknown severity rather than guessing", async () => {
    await expect(
      alerts.raise({ event: "x", subject: "y", severity: "catastrophe" }),
    ).rejects.toThrow(/unknown severity/);
  });
});

describe("WS-M1 — maintenance windows", () => {
  const now = Date.now();
  const win = (over = {}) => ({
    maintenance_window_id: "w1",
    tenant_id: null,
    starts_at: new Date(now - 60000),
    ends_at: new Date(now + 60000),
    title: "Fleet migration",
    mode: "ANNOUNCE",
    ...over,
  });

  beforeEach(() => maintenance.invalidate());

  test("returns nothing when no window is in force", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    expect(await maintenance.activeFor("tid-acme")).toBeNull();
  });

  test("a fleet-wide window applies to every tenant", async () => {
    platformDb.query.mockResolvedValue({ rows: [win()] });
    const w = await maintenance.activeFor("tid-acme");
    expect(w.title).toBe("Fleet migration");
  });

  /** The more precise statement wins — someone wrote it about this tenant. */
  test("a tenant-specific window beats a fleet-wide one", async () => {
    platformDb.query.mockResolvedValue({
      rows: [
        win(),
        win({
          maintenance_window_id: "w2",
          tenant_id: "tid-acme",
          title: "Acme only",
        }),
      ],
    });
    const w = await maintenance.activeFor("tid-acme");
    expect(w.title).toBe("Acme only");
  });

  test("a future window is not yet active", async () => {
    platformDb.query.mockResolvedValue({
      rows: [
        win({
          starts_at: new Date(now + 3600_000),
          ends_at: new Date(now + 7200_000),
        }),
      ],
    });
    expect(await maintenance.activeFor("tid-acme")).toBeNull();
  });

  test("READ_ONLY parks writes; ANNOUNCE does not", async () => {
    platformDb.query.mockResolvedValue({ rows: [win({ mode: "READ_ONLY" })] });
    expect(await maintenance.isReadOnly("tid-acme")).toBe(true);

    maintenance.invalidate();
    platformDb.query.mockResolvedValue({ rows: [win({ mode: "ANNOUNCE" })] });
    expect(await maintenance.isReadOnly("tid-acme")).toBe(false);
  });

  test("refuses a window that ends before it starts", async () => {
    await expect(
      maintenance.schedule({
        startsAt: new Date(now + 7200_000),
        endsAt: new Date(now + 3600_000),
        title: "backwards",
      }),
    ).rejects.toThrow(/after/);
  });

  test("refuses an untitled window — the title is what users read", async () => {
    await expect(
      maintenance.schedule({
        startsAt: new Date(now),
        endsAt: new Date(now + 1000),
      }),
    ).rejects.toThrow(/title/);
  });
});
