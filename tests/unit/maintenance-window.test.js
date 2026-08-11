"use strict";

/**
 * WS-M1 — maintenance windows, end to end through the tenant gate.
 *
 * Before this work the window was schedulable and stored, and that was all: no
 * tenant user ever saw a banner and READ_ONLY parked nothing. The behaviours
 * worth pinning are therefore the two halves that were missing —
 *
 *   1. VISIBILITY. A window must be announced BEFORE it starts, or the notice
 *      arrives at the same instant as the disruption and is not a notice. That
 *      is `visibleFor` vs `activeFor`, and conflating them is the original bug.
 *
 *   2. THE WRITE GATE. Reads must pass, writes must be refused with a typed
 *      423, and — most important — a failure to CHECK must fail open. A
 *      platform-DB hiccup blocking every write across the fleet would be far
 *      worse than a window that briefly fails to apply.
 */

jest.mock("../../src/services/platform/db", () => ({ query: jest.fn(), close: jest.fn() }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: jest.fn(),
  resolveBySlug: jest.fn(),
}));

const platformDb = require("../../src/services/platform/db");
const registry = require("../../src/services/tenant/registry.service");
const maintenance = require("../../src/services/platform/maintenance.service");
const { hostTenantResolver } = require("../../src/middleware/host-tenent-resolver");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

const win = (over = {}) => ({
  maintenance_window_id: "w1",
  tenant_id: TENANT,
  starts_at: hoursFromNow(-1),
  ends_at: hoursFromNow(1),
  title: "Database upgrade",
  message: null,
  mode: "ANNOUNCE",
  notice_hours: 24,
  ...over,
});

/** Feed loadWindows() a fixed set and clear its 30s cache. */
function given(windows) {
  platformDb.query.mockResolvedValue({ rows: windows });
  maintenance.invalidate();
}

beforeEach(() => {
  jest.clearAllMocks();
  maintenance.invalidate();
});

describe("visibleFor — announcement, not just the disruption", () => {
  test("an upcoming window inside its notice period is visible and marked UPCOMING", async () => {
    given([win({ starts_at: hoursFromNow(3), ends_at: hoursFromNow(5), notice_hours: 24 })]);
    const v = await maintenance.visibleFor(TENANT);
    expect(v.state).toBe("UPCOMING");
    expect(v.starts_in_minutes).toBeGreaterThan(150);
  });

  test("an upcoming window OUTSIDE its notice period is not visible yet", async () => {
    // Starts in 3 days, one hour's notice — nobody should see it today.
    given([win({ starts_at: hoursFromNow(72), ends_at: hoursFromNow(74), notice_hours: 1 })]);
    expect(await maintenance.visibleFor(TENANT)).toBeNull();
  });

  test("notice_hours = 0 means the banner appears only once it starts", async () => {
    given([win({ starts_at: hoursFromNow(2), ends_at: hoursFromNow(4), notice_hours: 0 })]);
    expect(await maintenance.visibleFor(TENANT)).toBeNull();
  });

  test("an active window is visible and marked ACTIVE with no negative countdown", async () => {
    given([win()]);
    const v = await maintenance.visibleFor(TENANT);
    expect(v.state).toBe("ACTIVE");
    // A countdown past zero renders as "starts in -47 minutes".
    expect(v.starts_in_minutes).toBe(0);
  });

  test("an UPCOMING read-only window warns without claiming writes are blocked yet", async () => {
    given([win({ starts_at: hoursFromNow(2), ends_at: hoursFromNow(4), mode: "READ_ONLY" })]);
    const v = await maintenance.visibleFor(TENANT);
    expect(v.state).toBe("UPCOMING");
    expect(v.writes_blocked).toBe(false);
  });

  test("an ACTIVE read-only window reports writes blocked", async () => {
    given([win({ mode: "READ_ONLY" })]);
    expect((await maintenance.visibleFor(TENANT)).writes_blocked).toBe(true);
  });

  test("a fleet-wide window (tenant_id null) applies to everyone", async () => {
    given([win({ tenant_id: null })]);
    expect(await maintenance.visibleFor(OTHER)).not.toBeNull();
  });

  test("a tenant-specific window beats a fleet-wide one — it is the deliberate statement", async () => {
    given([
      win({ maintenance_window_id: "fleet", tenant_id: null, title: "Fleet migration" }),
      win({ maintenance_window_id: "mine", tenant_id: TENANT, title: "Just us" }),
    ]);
    expect((await maintenance.visibleFor(TENANT)).title).toBe("Just us");
    // ...and the other tenant still gets the fleet one.
    expect((await maintenance.visibleFor(OTHER)).title).toBe("Fleet migration");
  });

  test("no window at all returns null — the answer nearly every time", async () => {
    given([]);
    expect(await maintenance.visibleFor(TENANT)).toBeNull();
  });
});

describe("the tenant write gate", () => {
  const LIVE = { slug: "acme", tenant_id: TENANT, status: "LIVE", is_live: true };

  function run({ method = "POST", tenant = LIVE } = {}) {
    registry.resolveByHost.mockResolvedValue(tenant);
    const req = { headers: { host: "acme.praxisls.com" }, method, path: "/api/tenant/clients", query: {} };
    const res = {};
    return new Promise((resolve) => {
      hostTenantResolver(req, res, (err) => resolve({ err, req }));
    });
  }

  test("a write during an ACTIVE read-only window is refused with a typed 423", async () => {
    given([win({ mode: "READ_ONLY" })]);
    const { err } = await run({ method: "POST" });
    expect(err).toBeTruthy();
    expect(err.code).toBe("MAINTENANCE_READ_ONLY");
    // 423 Locked, matching TENANT_NOT_READY: temporary and expected, not a
    // client mistake to correct and not a server fault to page about.
    expect(err.status).toBe(423);
    // Details let a client show a real countdown instead of "try again later".
    expect(err.details.ends_at).toBeTruthy();
  });

  test("reads pass during a read-only window — the workspace stays useful", async () => {
    given([win({ mode: "READ_ONLY" })]);
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const { err } = await run({ method });
      expect(err).toBeUndefined();
    }
  });

  test("OPTIONS specifically passes, so CORS preflight is not broken", async () => {
    // A blocked preflight turns "you cannot save right now" into "the app is
    // broken", which is a much worse message and a much longer support call.
    given([win({ mode: "READ_ONLY" })]);
    const { err } = await run({ method: "OPTIONS" });
    expect(err).toBeUndefined();
  });

  test("an ANNOUNCE window does not block writes", async () => {
    given([win({ mode: "ANNOUNCE" })]);
    const { err } = await run({ method: "POST" });
    expect(err).toBeUndefined();
  });

  test("an UPCOMING read-only window does not block writes yet", async () => {
    given([win({ starts_at: hoursFromNow(2), ends_at: hoursFromNow(4), mode: "READ_ONLY" })]);
    const { err } = await run({ method: "POST" });
    expect(err).toBeUndefined();
  });

  test("another tenant's read-only window does not block this tenant", async () => {
    given([win({ tenant_id: OTHER, mode: "READ_ONLY" })]);
    const { err } = await run({ method: "POST" });
    expect(err).toBeUndefined();
  });

  test("a fleet-wide read-only window blocks every tenant", async () => {
    given([win({ tenant_id: null, mode: "READ_ONLY" })]);
    const { err } = await run({ method: "POST" });
    expect(err.code).toBe("MAINTENANCE_READ_ONLY");
  });

  test("a failing maintenance lookup FAILS OPEN — a platform-DB hiccup must not block the fleet", async () => {
    maintenance.invalidate();
    platformDb.query.mockRejectedValue(new Error("platform db unreachable"));
    const { err } = await run({ method: "POST" });
    expect(err).toBeUndefined();
  });

  test("the gate runs after the status gates — suspended still wins", async () => {
    given([win({ mode: "READ_ONLY" })]);
    const { err } = await run({ method: "POST", tenant: { ...LIVE, status: "SUSPENDED" } });
    expect(err.code).toBe("TENANT_SUSPENDED");
  });

  test("req.tenant is still attached on a blocked write", async () => {
    // The error handler and access log both read it; losing it would make the
    // one request class you most want to trace the one with no tenant on it.
    given([win({ mode: "READ_ONLY" })]);
    const { req } = await run({ method: "POST" });
    expect(req.tenant.slug).toBe("acme");
  });
});
