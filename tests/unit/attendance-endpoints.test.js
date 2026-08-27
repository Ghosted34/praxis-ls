"use strict";
/**
 * The PR2 endpoints, INVOKED.
 *
 * ── WHY THIS FILE IS SHAPED LIKE THIS ──────────────────────────────────────
 *
 * PR1 shipped a ReferenceError that crashed every clock-in — twice, on the same
 * function. The suite could not catch it because no test had ever CALLED the
 * endpoint: there were schema tests, and there were route-table tests, and
 * neither executes a line of the handler.
 *
 * So every endpoint added here is called for real — the service function
 * against a fake client, and the controller handler against a fake req/res —
 * and the assertion is on the payload that comes back, not on the shape of the
 * code that produced it. A name that does not resolve fails these tests.
 */

jest.mock("../../src/modules/hr/attendance/attendance.calendar", () => {
  const actual = jest.requireActual("../../src/modules/hr/attendance/attendance.calendar");
  return { ...actual, loadContext: jest.fn() };
});

// The workbook context is a tenant read (branding, entity, currency catalogue)
// with nothing to say about attendance. Stubbed to the neutral default so the
// controller's real code path — resolve inside tenantDb, hand to the builder —
// still runs end to end.
jest.mock("../../src/services/spreadsheet", () => {
  const actual = jest.requireActual("../../src/services/spreadsheet");
  return { ...actual, resolveContext: jest.fn(async () => actual.neutralContext()) };
});

const calendar = require("../../src/modules/hr/attendance/attendance.calendar");
const service = require("../../src/modules/hr/attendance/attendance.service");
const controller = require("../../src/modules/hr/attendance/attendance.controller");
const reconcile = require("../../src/modules/hr/attendance/attendance.reconcile");
const { parseCsv } = require("../../src/services/spreadsheet");

const ADA = "11111111-1111-1111-1111-111111111111";
const BOLA = "22222222-2222-2222-2222-222222222222";
const USER = "99999999-9999-9999-9999-999999999999";

const MON = "2026-08-03";
const TUE = "2026-08-04";
const FRI = "2026-08-07";
const SAT = "2026-08-01";

/** Mon–Fri, 07:30. The resolver the service will consult for expected days. */
const monFri = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
  holidays: [],
};

/** A yard that also works Saturday, and opens LATER on it. The shape that
 *  catches an expected-start resolved once per employee instead of per date. */
const monSatLateSaturday = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
    { weekday: 6, opens_at: "09:00", closes_at: "13:00" },
  ],
  holidays: [],
};

const ROSTER = [
  { employee_id: ADA, full_name: "Ada Mbarga", department: "Operations", entity_id: "e1", work_days: null, expected_start_time: null, grace_minutes: null },
  { employee_id: BOLA, full_name: "Bola Njie", department: "Finance", entity_id: "e1", work_days: null, expected_start_time: null, grace_minutes: null },
];

const DAYS = [
  { employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations", work_date: MON, status: "PRESENT", minutes_late: 0, deduction_amount: "0.00", justified: false, first_clock_in_at: "2026-08-03T06:20:00Z", last_clock_out_at: "2026-08-03T15:20:00Z", attendance_id: "p1", location_source: "gps", within_geofence: true, geo_label: "Bonabéri yard", device_label: "Ada's phone", device_trusted: true, entity_name: "Praxis Douala SARL", expected_start_time: "07:30" },
  { employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations", work_date: TUE, status: "LATE", minutes_late: 25, deduction_amount: "5000.00", justified: false, first_clock_in_at: "2026-08-04T07:00:00Z", last_clock_out_at: "2026-08-04T15:00:00Z", attendance_id: "p2", location_source: "gps", within_geofence: false, rule_code: "LATE-01" },
  { employee_id: BOLA, employee_name: "Bola Njie", department: "Finance", work_date: MON, status: "ABSENT", minutes_late: 0, deduction_amount: "22000.00", justified: false },
];

const PUNCHES = [
  { attendance_id: "p1", employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations", clock_in_at: "2026-08-03T06:20:00Z", clock_out_at: "2026-08-03T15:20:00Z", latitude: "4.050000", longitude: "9.700000", within_geofence: true, location_source: "gps", geo_label: "Bonabéri yard", distance_m: "12.00", device_label: "Ada's phone" },
  { attendance_id: "p2", employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations", clock_in_at: "2026-08-04T07:00:00Z", clock_out_at: "2026-08-04T15:00:00Z", latitude: null, longitude: null, within_geofence: null, location_source: "none", geo_label: null, distance_m: null, device_label: "Ada's phone" },
];

/**
 * A fake tenant client. Every query the report path makes is answered, and
 * anything unrecognised THROWS rather than returning `{rows: []}` — a silent
 * empty result is how a broken query passes a test.
 */
function clientFor({ roster = ROSTER, days = DAYS, punches = PUNCHES, linkedEmployee = ADA } = {}) {
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
      if (/FROM employee e/.test(s)) {
        // Honour the filters the repo actually built, so a test asserting
        // self-scoping is asserting on the SQL that ran.
        let out = roster;
        const idParam = params.find((p) => Array.isArray(p));
        if (idParam) out = out.filter((e) => idParam.includes(e.employee_id));
        else if (params.some((p) => p === ADA || p === BOLA)) out = out.filter((e) => params.includes(e.employee_id));
        if (params.includes("Finance")) out = out.filter((e) => e.department === "Finance");
        return { rows: out };
      }
      if (/FROM attendance_day d/.test(s)) {
        let out = days.filter((d) => d.work_date >= params[0] && d.work_date <= params[1]);
        const idParam = params.find((p) => Array.isArray(p));
        if (idParam) out = out.filter((d) => idParam.includes(d.employee_id));
        else if (params.some((p) => p === ADA || p === BOLA)) out = out.filter((d) => params.includes(d.employee_id));
        if (params.includes("Finance")) out = out.filter((d) => d.department === "Finance");
        return { rows: out };
      }
      if (/FROM attendance_log al/.test(s)) {
        let out = punches;
        const idParam = params.find((p) => Array.isArray(p));
        if (idParam) out = out.filter((p) => idParam.includes(p.employee_id));
        else if (params.some((p) => p === ADA || p === BOLA)) out = out.filter((p) => params.includes(p.employee_id));
        if (params.includes("Finance")) out = out.filter((p) => p.department === "Finance");
        return { rows: out };
      }
      throw new Error("unhandled sql in endpoint fixture: " + s.slice(0, 180));
    },
  };
}

/** A req/res pair the real handlers can run against. */
function reqRes(query = {}, { user = { user_id: USER }, env = "live", client } = {}) {
  const res = { headers: {}, body: null, code: 200,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
  const req = { validatedQuery: query, query, user, env, tenantDb: (fn) => fn(client) };
  return { req, res };
}

beforeEach(() => {
  calendar.loadContext.mockResolvedValue({
    policyStart: "08:00",
    policyGrace: 10,
    weekendDays: [0, 6],
    fallbackTimezone: "Africa/Douala",
    publicHolidays: [],
    calendarFor: () => monFri,
  });
});

/* ── GET /attendance/analytics ─────────────────────────────────────────── */

describe("GET /attendance/analytics", () => {
  it("returns KPIs, a heatmap, department rollup and compare rows", async () => {
    const out = await service.analytics(clientFor(), { from: MON, to: FRI });

    expect(out.kpis).toMatchObject({
      present_days: 1,
      late_days: 1,
      absent_days: 1,
      attended_days: 2,
      minutes_late: 25,
      punctuality_pct: 50,
    });
    // Mon–Fri × 2 people = 10 expected days, from the calendar resolver.
    expect(out.kpis.expected_days).toBe(10);
    expect(out.kpis.deduction_total).toBe(27000);
    expect(out.heatmap).toHaveLength(5);
    expect(out.heatmap[0]).toMatchObject({ date: MON, expected: 2, present: 1, absent: 1 });
    expect(out.byDepartment.map((d) => d.department)).toEqual(["Finance", "Operations"]);
    expect(out.byEmployee.map((e) => e.employee_name)).toEqual(["Ada Mbarga", "Bola Njie"]);
    expect(out.days).toHaveLength(3);
    expect(out.timezone).toBe("Africa/Douala");
    // The day rows carry the punch's location word — and ONLY where there was
    // a punch. An absence must not come back wearing a red "No GPS" pill.
    expect(out.days.find((d) => d.work_date === MON && d.employee_id === ADA).location_status).toBe("on_site");
    expect(out.days.find((d) => d.work_date === TUE).location_status).toBe("off_site");
    expect(out.days.find((d) => d.employee_id === BOLA).location_status).toBeUndefined();
    expect(out.truncated).toBe(false);
  });

  it("counts the on-site split from the punches", async () => {
    const out = await service.analytics(clientFor(), { from: MON, to: FRI });
    expect(out.kpis.punches).toBe(2);
    expect(out.kpis.on_site_punches).toBe(1);
    expect(out.kpis.no_gps_punches).toBe(1);
    // One judged punch, and it was on site.
    expect(out.kpis.on_site_pct).toBe(100);
  });

  it("narrows to a compare set", async () => {
    const out = await service.analytics(clientFor(), { from: MON, to: FRI, employeeIds: [BOLA] });
    expect(out.byEmployee).toHaveLength(1);
    expect(out.byEmployee[0].employee_name).toBe("Bola Njie");
    expect(out.kpis.absent_days).toBe(1);
    expect(out.kpis.expected_days).toBe(5);
  });

  it("narrows to a department", async () => {
    const out = await service.analytics(clientFor(), { from: MON, to: FRI, department: "Finance" });
    expect(out.byEmployee).toHaveLength(1);
    expect(out.byEmployee[0].employee_id).toBe(BOLA);
  });

  it("never counts a non-working day as expected — the calendar decides", async () => {
    // Saturday only: nobody is expected, so there is no attendance rate to give.
    const out = await service.analytics(clientFor({ days: [] }), { from: SAT, to: SAT });
    expect(out.kpis.expected_days).toBe(0);
    expect(out.kpis.attendance_pct).toBeNull();
    expect(out.heatmap[0].expected).toBe(0);
  });

  it("runs through the controller and answers with the payload", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI }, { client });
    await controller.analytics(req, res);
    expect(res.body.data.kpis.late_days).toBe(1);
    expect(res.body.data.heatmap).toHaveLength(5);
  });
});

/* ── GET /attendance/analytics/mine ────────────────────────────────────── */

describe("GET /attendance/analytics/mine", () => {
  it("answers for the caller's own employee record only", async () => {
    const out = await service.myAnalytics(clientFor(), { from: MON, to: FRI, actor: { user_id: USER } });
    expect(out.byEmployee).toHaveLength(1);
    expect(out.byEmployee[0].employee_id).toBe(ADA);
    expect(out.days.every((d) => d.employee_id === ADA)).toBe(true);
    expect(out.kpis.absent_days).toBe(0); // Bola's absence is not theirs to see
  });

  it("cannot be widened by a query string naming somebody else", async () => {
    // The route's schema has no selector on it at all, and the service drops
    // one anyway. Both locks are exercised here.
    const out = await service.myAnalytics(clientFor(), {
      from: MON, to: FRI, actor: { user_id: USER },
      employeeIds: [BOLA], department: "Finance", employee_id: BOLA,
    });
    expect(out.byEmployee.map((e) => e.employee_id)).toEqual([ADA]);
  });

  it("gives an unlinked user an empty report, NOT the whole company", async () => {
    const out = await service.myAnalytics(clientFor({ linkedEmployee: null }), { from: MON, to: FRI, actor: { user_id: USER } });
    expect(out.days).toEqual([]);
    expect(out.byEmployee).toEqual([]);
    expect(out.kpis.reconciled_days).toBe(0);
    expect(out.kpis.deduction_total).toBe(0);
  });

  it("runs through the controller", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI }, { client });
    await controller.myAnalytics(req, res);
    expect(res.body.data.byEmployee.map((e) => e.employee_id)).toEqual([ADA]);
  });
});

/* ── GET /attendance/punches/mine ──────────────────────────────────────── */

describe("GET /attendance/punches/mine", () => {
  it("returns the caller's punches, dated in the workplace zone", async () => {
    const rows = await service.myPunches(clientFor(), { from: MON, to: FRI, actor: { user_id: USER } });
    expect(rows).toHaveLength(2);
    // 06:20Z on the 3rd is 07:20 in Douala — the same local day. The point is
    // that the date is resolved in the zone, never from `clock_in_at::date`.
    expect(rows[0].work_date).toBe(MON);
    expect(rows[0].location_status).toBe("on_site");
    expect(rows[1].location_status).toBe("no_gps");
  });

  it("measures lateness against the entity calendar's own opening time", async () => {
    const rows = await service.myPunches(clientFor(), { from: MON, to: FRI, actor: { user_id: USER } });
    // 07:20 local against a 07:30 open with 10 minutes' grace: on time.
    expect(rows[0].is_late).toBe(false);
    // 08:00 local against the same: 30 minutes past the open. Grace is a
    // THRESHOLD, not a subtraction (attendance.rules.minutesLate) — once it is
    // crossed the figure is the whole lateness, which is what gets charged.
    expect(rows[1].is_late).toBe(true);
    expect(rows[1].minutes_late).toBe(30);
  });

  it("judges each punch against ITS OWN weekday's opening time", async () => {
    // The calendar opens 07:30 Mon–Fri but 09:00 on Saturday. A Saturday punch
    // at 08:30 local is EARLY, and would read as an hour late if the expected
    // start were resolved once per employee from the window's first day.
    calendar.loadContext.mockResolvedValue({
      policyStart: "08:00",
      policyGrace: 10,
      weekendDays: [0],
      fallbackTimezone: "Africa/Douala",
      publicHolidays: [],
      calendarFor: () => monSatLateSaturday,
    });
    const saturdayPunch = {
      attendance_id: "p9", employee_id: ADA, employee_name: "Ada Mbarga", department: "Operations",
      // 07:30Z on Saturday 8 Aug = 08:30 in Douala, half an hour before it opens.
      clock_in_at: "2026-08-08T07:30:00Z", clock_out_at: "2026-08-08T12:00:00Z",
      latitude: null, longitude: null, within_geofence: null, location_source: "none",
      geo_label: null, distance_m: null, device_label: "Ada's phone",
    };
    // The window OPENS ON A MONDAY on purpose: a cached expected start would be
    // Monday's 07:30, and this Saturday punch would read as an hour late. A
    // window starting on the Saturday itself would hide the bug entirely.
    const rows = await service.myPunches(clientFor({ punches: [saturdayPunch] }), {
      from: MON, to: "2026-08-08", actor: { user_id: USER },
    });
    expect(rows[0].work_date).toBe("2026-08-08");
    expect(rows[0].is_late).toBe(false);
    expect(rows[0].minutes_late).toBe(0);
  });

  it("gives an unlinked user nothing rather than everybody's punches", async () => {
    const rows = await service.myPunches(clientFor({ linkedEmployee: null }), { from: MON, to: FRI, actor: { user_id: USER } });
    expect(rows).toEqual([]);
  });

  it("runs through the controller", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI }, { client });
    await controller.myPunches(req, res);
    expect(res.body.data).toHaveLength(2);
  });
});

/* ── GET /attendance/export ────────────────────────────────────────────── */

describe("GET /attendance/export", () => {
  it("builds an xlsx of the window", async () => {
    const file = await service.exportWindow(clientFor(), { from: MON, to: FRI, format: "xlsx" });
    expect(file.filename).toBe(`attendance-${MON}-${FRI}.xlsx`);
    expect(file.contentType).toMatch(/spreadsheetml/);
    expect(file.buffer.length).toBeGreaterThan(0);
    expect(file.rows).toBe(5); // 3 days + 2 punches
  });

  it("builds a csv of Days carrying the reconciled figures", async () => {
    const file = await service.exportWindow(clientFor(), { from: MON, to: FRI, format: "csv" });
    const rows = parseCsv(file.buffer);
    expect(rows).toHaveLength(3);
    const late = rows.find((r) => r.Status === "LATE");
    expect(late).toMatchObject({ Employee: "Ada Mbarga", "Minutes late": "25", Deduction: "5000", Waived: "No" });
    // The expected flag came from the calendar, not from the status.
    expect(late.Expected).toBe("Yes");
  });

  it("honours ?sheet=punches", async () => {
    const file = await service.exportWindow(clientFor(), { from: MON, to: FRI, format: "csv", sheet: "punches" });
    const rows = parseCsv(file.buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Employee: "Ada Mbarga", "Within geofence": "Yes" });
  });

  it("narrows to a compare set", async () => {
    const file = await service.exportWindow(clientFor(), { from: MON, to: FRI, format: "csv", employeeIds: [BOLA] });
    const rows = parseCsv(file.buffer);
    expect(rows.map((r) => r.Employee)).toEqual(["Bola Njie"]);
  });

  it("runs through the controller, with the download headers", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI, format: "csv" }, { client });
    await controller.exportWindow(req, res);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="attendance-${MON}-${FRI}.csv"`);
    expect(res.headers["x-praxis-truncated"]).toBeUndefined();
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it("names a sandbox file unmistakably, through the controller", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI, format: "csv" }, { client, env: "sandbox" });
    await controller.exportWindow(req, res);
    expect(res.headers["content-disposition"]).toContain("SANDBOX");
  });
});

/* ── GET /attendance/export/mine ───────────────────────────────────────── */

describe("GET /attendance/export/mine", () => {
  it("exports the caller's own rows only", async () => {
    const file = await service.myExport(clientFor(), { from: MON, to: FRI, format: "csv", actor: { user_id: USER } });
    const rows = parseCsv(file.buffer);
    expect(rows.map((r) => r.Employee)).toEqual(["Ada Mbarga", "Ada Mbarga"]);
  });

  it("gives an unlinked user an empty file, not everybody's", async () => {
    const file = await service.myExport(clientFor({ linkedEmployee: null }), { from: MON, to: FRI, format: "csv", actor: { user_id: USER } });
    expect(parseCsv(file.buffer)).toEqual([]);
    expect(file.filename).toBe(`attendance-${MON}-${FRI}.csv`);
  });

  it("runs through the controller", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ from: MON, to: FRI, format: "csv" }, { client });
    await controller.myExport(req, res);
    expect(res.headers["content-disposition"]).toContain("attendance-");
    expect(parseCsv(res.body).every((r) => r.Employee === "Ada Mbarga")).toBe(true);
  });
});

/* ── daysFor filters ───────────────────────────────────────────────────── */

describe("reconcile.daysFor", () => {
  const capture = () => {
    const calls = [];
    return { calls, client: { query: async (sql, params) => { calls.push({ sql: String(sql).replace(/\s+/g, " "), params }); return { rows: [] }; } } };
  };

  it("accepts a set of employees as one bound array, not an interpolated list", async () => {
    const { calls, client } = capture();
    await reconcile.daysFor(client, { from: MON, to: FRI, employeeIds: [ADA, BOLA] });
    expect(calls[0].sql).toContain("= ANY($3::uuid[])");
    expect(calls[0].params).toContainEqual([ADA, BOLA]);
  });

  it("caps the compare set at 50", async () => {
    const { calls, client } = capture();
    await reconcile.daysFor(client, { from: MON, to: FRI, employeeIds: Array.from({ length: 80 }, () => ADA) });
    expect(calls[0].params.find((p) => Array.isArray(p))).toHaveLength(reconcile.MAX_EMPLOYEE_IDS);
  });

  it("matches a department case- and whitespace-insensitively", async () => {
    const { calls, client } = capture();
    await reconcile.daysFor(client, { from: MON, to: FRI, department: " operations " });
    expect(calls[0].sql).toContain("lower(btrim(e.department)) = lower(btrim($3))");
  });

  it("bounds the answer with a row ceiling", async () => {
    const { calls, client } = capture();
    await reconcile.daysFor(client, { from: MON, to: FRI });
    expect(calls[0].sql).toMatch(/LIMIT \$\d+$/);
    expect(calls[0].params[calls[0].params.length - 1]).toBe(reconcile.DAYS_LIMIT);
  });

  it("joins what the export needs, so the file and the screen cannot disagree", async () => {
    const { calls, client } = capture();
    await reconcile.daysFor(client, { from: MON, to: FRI });
    for (const col of ["e.department", "ce.legal_name", "lt.name", "al.geo_label", "dev.label"]) {
      expect(calls[0].sql).toContain(col);
    }
  });
});
