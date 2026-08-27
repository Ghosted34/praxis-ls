"use strict";
/**
 * GET /attendance/map — the permission matrix, one test per row (PR3, §3.6).
 *
 * ── WHY A MATRIX AND NOT A HAPPY PATH ──────────────────────────────────────
 *
 * A map is the one attendance surface where a leak is not a row in a table
 * somebody has to read: it is a pin on a picture showing where a named
 * colleague physically was, at a time, to within a few metres. The interesting
 * cases are therefore the NEGATIVE ones — what each caller must NOT get — and
 * they are the ones a happy-path test never reaches. So every row of the
 * guide's matrix is a test, including the two that assert an empty payload.
 *
 * Both halves are invoked for real: the service function against a fake client
 * AND the controller handler against a fake req/res, asserting on the payload
 * that comes back. PR1 shipped a ReferenceError that crashed every clock-in
 * because no test had ever CALLED the endpoint; a route-table assertion would
 * pass over the same bug here.
 */

jest.mock("../../src/services/geoapify.service", () => ({
  ...jest.requireActual("../../src/services/geoapify.service"),
  hasKey: jest.fn(async () => false),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  ...jest.requireActual("../../src/shared/cache/identity-cache"),
  getGrants: jest.fn(),
}));

const geoapify = require("../../src/services/geoapify.service");
const identityCache = require("../../src/shared/cache/identity-cache");
const service = require("../../src/modules/hr/attendance/attendance.service");
const controller = require("../../src/modules/hr/attendance/attendance.controller");

const ADA = "11111111-1111-1111-1111-111111111111";
const BOLA = "22222222-2222-2222-2222-222222222222";
const ADA_USER = "99999999-9999-9999-9999-999999999999";
const ROLE = "55555555-5555-5555-5555-555555555555";

const FROM = "2026-08-03";
const TO = "2026-08-07";

/** Ada punched on site with a fix; Bola punched somewhere else entirely. The
 *  two coordinate pairs are far apart so "A cannot see B" is unambiguous. */
const PUNCHES = [
  {
    attendance_id: "p1", employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations",
    clock_in_at: "2026-08-03T06:20:00Z", clock_out_at: "2026-08-03T15:20:00Z",
    latitude: "4.050000", longitude: "9.700000", accuracy_m: "8.00", distance_m: "12.00",
    within_geofence: true, location_source: "gps", geo_label: "Bonabéri yard",
    work_site_id: "site-1", device_label: "Ada's phone",
  },
  {
    attendance_id: "p2", employee_id: BOLA, employee_name: "Bola Njie", department: "Finance",
    clock_in_at: "2026-08-04T07:00:00Z", clock_out_at: null,
    latitude: "12.345600", longitude: "-1.234500", accuracy_m: null, distance_m: "4200.00",
    within_geofence: false, location_source: "gps", geo_label: "Ouagadougou",
    work_site_id: null, device_label: "Bola's tablet",
  },
  // No fix at all. Cannot be a pin — and must be COUNTED, not dropped in
  // silence, or the map shows fewer punches than the day had and reads as
  // "everybody was on site".
  {
    attendance_id: "p3", employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations",
    clock_in_at: "2026-08-05T06:30:00Z", clock_out_at: null,
    latitude: null, longitude: null, accuracy_m: null, distance_m: null,
    within_geofence: null, location_source: "none", geo_label: null,
    work_site_id: null, device_label: "Ada's phone",
  },
];

const SITES = [
  { work_site_id: "site-1", entity_id: "e1", name: "Bonabéri yard", latitude: "4.050100", longitude: "9.700100", radius_m: 150, is_active: true },
  // Inactive sites are not drawn: a fence nobody is judged against is noise on
  // a map whose whole job is to explain an off-site pill.
  { work_site_id: "site-2", entity_id: "e1", name: "Old depot", latitude: "4.1", longitude: "9.8", radius_m: 200, is_active: false },
];

function clientFor({ punches = PUNCHES, sites = SITES, linkedEmployee = ADA } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, " ");
      seen.push({ sql: s, params });
      if (/FROM setting/.test(s)) {
        if (params[1] === "timezone") return { rows: [{ value: "Africa/Douala" }] };
        if (params[1] === "attendance_policy") return { rows: [{ value: { work_start: "08:00", grace_minutes: 10 } }] };
        return { rows: [] };
      }
      if (/FROM app_user/.test(s)) return { rows: linkedEmployee ? [{ employee_id: linkedEmployee }] : [] };
      if (/FROM work_site/.test(s)) return { rows: sites };
      if (/FROM attendance_log al/.test(s)) {
        // Honour the self filter the repo actually built, so the scoping
        // assertions below are assertions about the SQL that ran.
        const self = params.find((p) => p === ADA || p === BOLA);
        return { rows: self ? punches.filter((p) => p.employee_id === self) : punches };
      }
      throw new Error("unhandled sql in map fixture: " + s.slice(0, 180));
    },
  };
}

/** A req/res the real handler can run against, with the two grants dialled in. */
function reqRes({ team = false, ops = false, user = { user_id: ADA_USER, role_ids: [ROLE] }, client } = {}) {
  identityCache.getGrants.mockImplementation(async (_c, { module }) => {
    if (module === "MOD-14") return team ? [{ can_read: true }] : [{ can_read: false }];
    if (module === "MOD-00A") return ops ? [{ can_read: true }] : [{ can_read: false }];
    return [];
  });
  const res = { body: null, code: 200,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const query = { from: FROM, to: TO };
  const req = {
    validatedQuery: query, query, user, env: "live",
    tenantDb: (fn) => fn(client),
    identityDb: (fn) => fn({}),
  };
  return { req, res };
}

beforeEach(() => {
  geoapify.hasKey.mockResolvedValue(false);
  identityCache.getGrants.mockReset();
});

/* ── The service, scope by scope ───────────────────────────────────────────── */

describe("mapLayer", () => {
  it("team scope returns every punch that has a point, plus the active worksites", async () => {
    const out = await service.mapLayer(clientFor(), { from: FROM, to: TO, scope: "team" });
    expect(out.punches.map((p) => p.attendance_id)).toEqual(["p1", "p2"]);
    expect(out.no_gps_count).toBe(1);
    expect(out.worksites.map((w) => w.work_site_id)).toEqual(["site-1"]);
    // Coordinates come back as NUMBERS, not the driver's numeric strings — a
    // projection that receives "4.050000" places the pin at NaN.
    expect(typeof out.punches[0].latitude).toBe("number");
    expect(out.punches[0].latitude).toBeCloseTo(4.05, 5);
    expect(out.punches[0].location_status).toBe("on_site");
    expect(out.punches[1].location_status).toBe("off_site");
  });

  it("self scope returns the caller's own punches and NOBODY else's", async () => {
    const out = await service.mapLayer(clientFor(), {
      from: FROM, to: TO, scope: "self", actor: { user_id: ADA_USER },
    });
    expect(out.punches.map((p) => p.employee_id)).toEqual([ADA]);
    expect(out.punches.some((p) => p.employee_id === BOLA)).toBe(false);
    // Not one of Bola's coordinates anywhere in the payload.
    expect(JSON.stringify(out)).not.toContain("12.3456");
    expect(JSON.stringify(out)).not.toContain("Bola");
  });

  it("self scope draws no worksites — the site register is not 'my attendance'", async () => {
    const out = await service.mapLayer(clientFor(), {
      from: FROM, to: TO, scope: "self", actor: { user_id: ADA_USER },
    });
    expect(out.worksites).toEqual([]);
  });

  it("self scope with no linked employee returns nothing, never everybody", async () => {
    const out = await service.mapLayer(clientFor({ linkedEmployee: null }), {
      from: FROM, to: TO, scope: "self", actor: { user_id: ADA_USER },
    });
    expect(out.punches).toEqual([]);
    expect(out.worksites).toEqual([]);
  });

  it("none scope reads nothing at all", async () => {
    const client = clientFor();
    const out = await service.mapLayer(client, { from: FROM, to: TO, scope: "none" });
    expect(out.punches).toEqual([]);
    // Not merely filtered afterwards — no query was issued for it.
    expect(client.seen).toHaveLength(0);
  });
});

/* ── The matrix, through the controller ───────────────────────────────────── */

describe("GET /attendance/map — the permission matrix", () => {
  it("employee, no grants → own punch points only", async () => {
    const { req, res } = reqRes({ client: clientFor() });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.scope).toBe("self");
    expect(d.punches.map((p) => p.employee_id)).toEqual([ADA]);
    expect(d.worksites).toEqual([]);
    expect(d.ops.allowed).toBe(false);
  });

  it("employee A must not see employee B's coordinates", async () => {
    const { req, res } = reqRes({ client: clientFor() });
    await controller.map(req, res);
    const body = JSON.stringify(res.body.data);
    expect(body).not.toContain("12.3456");
    expect(body).not.toContain("-1.2345");
    expect(body).not.toContain("Ouagadougou");
    expect(body).not.toContain(BOLA);
  });

  it("MOD-14 view → team punches and worksites, and no commercial lanes", async () => {
    const { req, res } = reqRes({ team: true, client: clientFor() });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.scope).toBe("team");
    expect(d.punches.map((p) => p.employee_id).sort()).toEqual([ADA, BOLA]);
    expect(d.worksites).toHaveLength(1);
    // Attendance-only HR must never be handed the commercial picture.
    expect(d.ops.allowed).toBe(false);
  });

  it("ops grant only → lanes allowed, and NO HR pins", async () => {
    // The pure ops user: dispatch, no employee record of their own.
    const { req, res } = reqRes({ ops: true, client: clientFor({ linkedEmployee: null }) });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.ops.allowed).toBe(true);
    expect(d.punches).toEqual([]);
    expect(d.worksites).toEqual([]);
  });

  it("ops grant only, and also an employee → lanes plus their OWN pin, nobody else's", async () => {
    // Decision 8 is unconditional: own pins are always visible to the employee.
    // "No HR pins" is a rule about OTHER people, and this is the row that
    // proves it does not leak into one.
    const { req, res } = reqRes({ ops: true, client: clientFor() });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.ops.allowed).toBe(true);
    expect(d.punches.map((p) => p.employee_id)).toEqual([ADA]);
    expect(d.worksites).toEqual([]);
    expect(JSON.stringify(d)).not.toContain(BOLA);
  });

  it("both grants → team punches, worksites AND lanes", async () => {
    const { req, res } = reqRes({ team: true, ops: true, client: clientFor() });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.punches).toHaveLength(2);
    expect(d.worksites).toHaveLength(1);
    expect(d.ops.allowed).toBe(true);
  });

  it("neither grant and no employee record → nothing", async () => {
    const { req, res } = reqRes({ client: clientFor({ linkedEmployee: null }) });
    await controller.map(req, res);
    const d = res.body.data;
    expect(d.punches).toEqual([]);
    expect(d.worksites).toEqual([]);
    expect(d.ops.allowed).toBe(false);
  });

  it("the CEO sees everything without holding either grant", async () => {
    const { req, res } = reqRes({
      user: { user_id: ADA_USER, role_ids: [], is_ceo: true },
      client: clientFor(),
    });
    await controller.map(req, res);
    expect(res.body.data.scope).toBe("team");
    expect(res.body.data.ops.allowed).toBe(true);
  });
});

/* ── Tiles degrade rather than break ───────────────────────────────────────── */

describe("preview tiles", () => {
  it("reports no tile provider when the platform key is absent", async () => {
    geoapify.hasKey.mockResolvedValue(false);
    const { req, res } = reqRes({ team: true, client: clientFor() });
    await controller.map(req, res);
    // The client degrades to coordinates and an OSM link rather than drawing an
    // empty grey box that looks like a broken map.
    expect(res.body.data.tiles).toBeNull();
  });

  it("names geoapify when a key is configured", async () => {
    geoapify.hasKey.mockResolvedValue(true);
    const { req, res } = reqRes({ team: true, client: clientFor() });
    await controller.map(req, res);
    expect(res.body.data.tiles).toBe("geoapify");
  });

  it("resolves the key OUTSIDE the tenant connection", async () => {
    // Rule 6: nothing provider-shaped resolves while a pooled connection is
    // held. Proven by order — the key is settled before tenantDb is entered.
    const order = [];
    geoapify.hasKey.mockImplementation(async () => {
      order.push("hasKey");
      return true;
    });
    const client = clientFor();
    const { req, res } = reqRes({ team: true, client });
    req.tenantDb = (fn) => {
      order.push("tenantDb");
      return fn(client);
    };
    await controller.map(req, res);
    expect(order).toEqual(["hasKey", "tenantDb"]);
  });
});
