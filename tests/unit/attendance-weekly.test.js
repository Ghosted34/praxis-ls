"use strict";
/**
 * The weekly lateness query (PR3, guide §3.4) — composed, written and hooked.
 *
 * ── WHAT THIS FILE HAS TO PROVE ────────────────────────────────────────────
 *
 * Four things, and they are all about NOT breaking something that already
 * works:
 *
 *   1. One query per employee per completed week, and none at all for a week
 *      with no late days — the whole point is that a pattern is asked about
 *      once, not that everybody gets a weekly letter.
 *   2. It does not clobber the daily query. The two share a table and a
 *      `work_date` column, and 0704's index would happily have swallowed this
 *      row: `'WEEKLY' <> 'MANUAL'` is TRUE.
 *   3. It does not reset a RESPONDED status. Somebody who answered on Monday
 *      has answered.
 *   4. A throwing weekly writer does not change what reconciliation returns.
 *      Reconciliation decides what people are PAID; a summariser must never be
 *      able to take that down with it.
 *
 * The endpoint and the job step are INVOKED, not inspected — see the note at
 * the head of attendance-endpoints.test.js for why that standard exists.
 */

jest.mock("../../src/modules/hr/attendance/attendance.calendar", () => {
  const actual = jest.requireActual("../../src/modules/hr/attendance/attendance.calendar");
  return { ...actual, loadContext: jest.fn() };
});

const calendar = require("../../src/modules/hr/attendance/attendance.calendar");
const weekly = require("../../src/modules/hr/attendance/attendance.weekly");
const controller = require("../../src/modules/hr/attendance/attendance.controller");

const ADA = "11111111-1111-1111-1111-111111111111";
const BOLA = "22222222-2222-2222-2222-222222222222";

/** Mon 2026-08-10 → Sun 2026-08-16. The guide's own worked example. */
const WEEK_START = "2026-08-10";
const WEEK_END = "2026-08-16";
const MONDAY_AFTER = "2026-08-17";

const monFri = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
  holidays: [],
};
/** A yard that works Saturday — the shape that catches "expected" being read
 *  off the reconciled status instead of off the calendar. */
const monSat = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
  holidays: [],
};

const lateRow = (employee_id, work_date, minutes_late, extra = {}) => ({
  employee_id, work_date, minutes_late, justified: false,
  full_name: employee_id === ADA ? "Ada Mbarga" : "Bola Njie",
  entity_id: "e1", work_days: null, expected_start_time: null, grace_minutes: null,
  ...extra,
});

/** Ada was late three times; Bola once. */
const LATE_DAYS = [
  lateRow(ADA, "2026-08-10", 25),
  lateRow(ADA, "2026-08-12", 40),
  lateRow(ADA, "2026-08-13", 15),
  lateRow(BOLA, "2026-08-11", 12),
];

function clientFor({ lateDays = LATE_DAYS, onInsert = null, throwOnInsert = false } = {}) {
  const inserts = [];
  return {
    inserts,
    query: async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, " ");
      if (/FROM setting/.test(s)) return { rows: [{ value: "Africa/Douala" }] };
      if (/FROM attendance_day d JOIN employee e/.test(s)) {
        return { rows: lateDays.filter((d) => d.work_date >= params[0] && d.work_date <= params[1]) };
      }
      if (/INSERT INTO hr_query/.test(s)) {
        if (throwOnInsert) throw new Error("hr_query is on fire");
        inserts.push({ sql: s, params });
        if (onInsert) onInsert({ sql: s, params });
        return { rows: [{ hr_query_id: "q" + inserts.length, status: "OPEN", source: params[7], work_date: params[6] }] };
      }
      throw new Error("unhandled sql in weekly fixture: " + s.slice(0, 180));
    },
  };
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

/* ── The week it names ─────────────────────────────────────────────────────── */

describe("which week is summarised", () => {
  it("the Monday run covers the Monday–Sunday that just ended", () => {
    expect(weekly.lastCompletedWeek(MONDAY_AFTER)).toEqual({ weekStart: WEEK_START, weekEnd: WEEK_END });
  });

  it("a run later in the week still names THAT week, not a rolling seven days", () => {
    // A missed night is recovered by running again, and the catch-up run must
    // not invent a Wed–Tue window that would then overlap the next Monday's.
    for (const day of ["2026-08-18", "2026-08-19", "2026-08-22", "2026-08-23"]) {
      expect(weekly.lastCompletedWeek(day)).toEqual({ weekStart: WEEK_START, weekEnd: WEEK_END });
    }
  });

  it("Sunday belongs to the week it ends, not to the one starting tomorrow", () => {
    // 2026-08-23 is a Sunday: the week in progress is 17th–23rd, so the last
    // COMPLETED one is still the 10th–16th.
    expect(weekly.lastCompletedWeek("2026-08-23").weekEnd).toBe(WEEK_END);
    expect(weekly.isMonday("2026-08-23")).toBe(false);
    expect(weekly.isMonday(MONDAY_AFTER)).toBe(true);
  });
});

/* ── The words ─────────────────────────────────────────────────────────────── */

describe("what the employee is asked", () => {
  it("names the week, the count, the total and the dates", () => {
    const q = weekly.composeWeekly({
      weekStart: WEEK_START, weekEnd: WEEK_END,
      lateDays: [{ work_date: "2026-08-10" }, { work_date: "2026-08-12" }],
      totalMinutes: 65,
    });
    expect(q.subject).toBe("Weekly lateness — 2026-08-10 → 2026-08-16");
    expect(q.body).toContain("late on 2 of your expected working day(s)");
    expect(q.body).toContain("total of 65 minute(s)");
    expect(q.body).toContain("2026-08-10, 2026-08-12");
    expect(q.body).toContain("explain the pattern");
  });

  it("says it is not a second charge for the same mornings", () => {
    // Each of those days was already settled and, where a rule charged, already
    // deducted. A summary that read like a fresh penalty would be one.
    const q = weekly.composeWeekly({
      weekStart: WEEK_START, weekEnd: WEEK_END, lateDays: [{ work_date: "2026-08-10" }], totalMinutes: 25,
    });
    expect(q.body).toContain("not a charge for any one morning");
  });

  it("states waived days rather than dropping them in silence", () => {
    const q = weekly.composeWeekly({
      weekStart: WEEK_START, weekEnd: WEEK_END,
      lateDays: [{ work_date: "2026-08-10" }], totalMinutes: 25, waivedCount: 2,
    });
    expect(q.body).toContain("2 further late day(s) that week were waived");
  });
});

/* ── One per person per week ───────────────────────────────────────────────── */

describe("runWeekly", () => {
  it("raises exactly ONE query per employee for the week", async () => {
    const client = clientFor();
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });

    expect(out).toMatchObject({ weekStart: WEEK_START, weekEnd: WEEK_END, queries: 2, employees: 2 });
    expect(client.inserts).toHaveLength(2);
    const employees = client.inserts.map((i) => i.params[0]);
    expect(new Set(employees).size).toBe(2);
    expect(employees).toContain(ADA);
    expect(employees).toContain(BOLA);
  });

  it("rolls Ada's three late mornings into one query with the total", async () => {
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const ada = client.inserts.find((i) => i.params[0] === ADA);
    // subject, body, severity, due days, issued_by, work_date, source, minutes
    expect(ada.params[1]).toBe("Weekly lateness — 2026-08-10 → 2026-08-16");
    expect(ada.params[2]).toContain("late on 3 of your expected working day(s)");
    expect(ada.params[2]).toContain("2026-08-10, 2026-08-12, 2026-08-13");
    expect(ada.params[8]).toBe(80); // 25 + 40 + 15
  });

  it("writes severity WARNING and source WEEKLY", async () => {
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const ada = client.inserts.find((i) => i.params[0] === ADA);
    expect(ada.params[3]).toBe("WARNING");
    expect(ada.params[7]).toBe("WEEKLY");
  });

  it("keys the row on the week END date", async () => {
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(client.inserts.every((i) => i.params[6] === WEEK_END)).toBe(true);
  });

  it("raises nothing when nobody was late", async () => {
    const client = clientFor({ lateDays: [] });
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(out).toMatchObject({ queries: 0, candidates: 0 });
    expect(client.inserts).toHaveLength(0);
  });

  it("raises nothing for an employee whose every late day was waived", async () => {
    // The manager has already answered the question this query would ask.
    const client = clientFor({
      lateDays: [
        lateRow(ADA, "2026-08-10", 25, { justified: true }),
        lateRow(ADA, "2026-08-12", 40, { justified: true }),
      ],
    });
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(out.queries).toBe(0);
    expect(client.inserts).toHaveLength(0);
  });

  it("counts only the days that still stand, and says how many were waived", async () => {
    const client = clientFor({
      lateDays: [
        lateRow(ADA, "2026-08-10", 25),
        lateRow(ADA, "2026-08-12", 40, { justified: true }),
      ],
    });
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const ada = client.inserts.find((i) => i.params[0] === ADA);
    expect(ada.params[2]).toContain("late on 1 of your expected working day(s)");
    expect(ada.params[2]).toContain("1 further late day(s) that week were waived");
    expect(ada.params[8]).toBe(25);
  });

  it("takes expected working days from the CALENDAR, never from the status", async () => {
    // A LATE row on a Sunday. Under a Mon–Fri calendar nobody was expected, so
    // it is not evidence of lateness and must not raise a query on its own.
    const client = clientFor({ lateDays: [lateRow(ADA, "2026-08-16", 30)] });
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(out.queries).toBe(0);
  });

  it("counts a Saturday for a Mon–Sat yard", async () => {
    calendar.loadContext.mockResolvedValue({
      policyStart: "08:00", policyGrace: 10, weekendDays: [0, 6],
      fallbackTimezone: "Africa/Douala", publicHolidays: [], calendarFor: () => monSat,
    });
    const client = clientFor({ lateDays: [lateRow(ADA, "2026-08-15", 30)] });
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(out.queries).toBe(1);
    expect(client.inserts[0].params[2]).toContain("2026-08-15");
  });

  it("drops a holiday even when the day carries a LATE row", async () => {
    calendar.loadContext.mockResolvedValue({
      policyStart: "08:00", policyGrace: 10, weekendDays: [0, 6],
      fallbackTimezone: "Africa/Douala",
      publicHolidays: [{ holiday_on: "2026-08-12", is_recurring: false }],
      calendarFor: () => ({ ...monFri, inherited: true }),
    });
    const client = clientFor({ lateDays: [lateRow(ADA, "2026-08-12", 30)] });
    const out = await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(out.queries).toBe(0);
  });

  it("names a week explicitly for the backfill", async () => {
    const client = clientFor();
    const out = await weekly.runWeekly(client, { weekEnd: WEEK_END });
    expect(out).toMatchObject({ weekStart: WEEK_START, weekEnd: WEEK_END });
  });
});

/* ── It must not disturb the daily query ──────────────────────────────────── */

describe("the daily auto-query is untouched", () => {
  it("carries a NULL hr_rule_id so it stays OUT of the daily index", async () => {
    /*
     * 0704's index is (employee_id, work_date, hr_rule_id) WHERE source <>
     * 'MANUAL' AND work_date IS NOT NULL AND hr_rule_id IS NOT NULL. 'WEEKLY'
     * <> 'MANUAL' is TRUE, so a weekly row with a rule id would land in it —
     * and its work_date is a real day somebody can also be late on, so the
     * week ending Sunday the 16th would collide with the lateness query for
     * Sunday the 16th and one would silently overwrite the other.
     */
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const sql = client.inserts[0].sql;
    expect(sql).toMatch(/VALUES \(\$1,\$2,\$3,\$4, now\(\) \+ \(\$5 \|\| ' days'\)::interval, \$6, \$7, NULL, NULL, \$8, \$9\)/);
  });

  it("conflicts on the DEDICATED weekly index, not on the daily one", async () => {
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const sql = client.inserts[0].sql;
    expect(sql).toContain("ON CONFLICT (employee_id, work_date) WHERE source = 'WEEKLY'");
    expect(sql).not.toContain("hr_rule_id) WHERE source <> 'MANUAL'");
  });

  it("never updates status, response or responded_at", async () => {
    // Somebody who answered on Monday has answered. A job running again on
    // Tuesday — or a backfill — must not reopen their query and ask twice.
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    const update = client.inserts[0].sql.split("DO UPDATE SET")[1];
    expect(update).toBeDefined();
    expect(update).not.toMatch(/\bstatus\s*=/);
    expect(update).not.toMatch(/\bresponse\s*=/);
    expect(update).not.toMatch(/\bresponded_at\s*=/);
    // It DOES sharpen the figures — a punch corrected on Tuesday changes what
    // the week was.
    expect(update).toMatch(/\bbody\s*=/);
    expect(update).toMatch(/\bminutes_late\s*=/);
  });

  it("writes no attendance_id — a week is not one punch", async () => {
    const client = clientFor();
    await weekly.runWeekly(client, { today: MONDAY_AFTER });
    expect(client.inserts[0].sql).toContain("$7, NULL, NULL, $8, $9");
  });
});

/* ── POST /attendance/weekly-summaries ────────────────────────────────────── */

describe("POST /attendance/weekly-summaries", () => {
  function reqRes(body = {}, client) {
    const res = { body: null, code: 200,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; return this; },
    };
    return { req: { body, user: { user_id: "u1" }, tenantDb: (fn) => fn(client) }, res };
  }

  it("runs the summariser and answers with what it did", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ week_end: WEEK_END }, client);
    await controller.runWeekly(req, res);
    expect(res.body.data).toMatchObject({ weekStart: WEEK_START, weekEnd: WEEK_END, queries: 2 });
    expect(client.inserts).toHaveLength(2);
  });

  it("defaults to the last completed week when given no dates", async () => {
    const client = clientFor({ lateDays: [] });
    const { req, res } = reqRes({}, client);
    await controller.runWeekly(req, res);
    // Whatever today is, the window it chose is a Monday-to-Sunday week.
    expect(res.body.data.weekEnd).toBe(weekly.addDays(res.body.data.weekStart, 6));
    expect(weekly.isMonday(res.body.data.weekStart)).toBe(true);
  });

  it("is idempotent — pressing it twice upserts rather than asking twice", async () => {
    const client = clientFor();
    const { req, res } = reqRes({ week_end: WEEK_END }, client);
    await controller.runWeekly(req, res);
    const first = client.inserts.map((i) => JSON.stringify(i.params));
    await controller.runWeekly(req, res);
    const second = client.inserts.slice(2).map((i) => JSON.stringify(i.params));
    // Same rows, and the database refuses the duplicate on the weekly index.
    expect(second).toEqual(first);
  });
});

/* ── The reconcile hook ───────────────────────────────────────────────────── */

describe("the nightly hook", () => {
  const handler = require("../../src/jobs/handlers/attendance-reconcile");
  const reconcile = require("../../src/modules/hr/attendance/attendance.reconcile");
  const registry = require("../../src/services/tenant/registry.service");

  const META = { slug: "acme" };
  const RESULT = { work_date: "2026-08-16", employees: 12, written: 12, chargeable: 3 };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("summarises on a Monday", async () => {
    const client = clientFor();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-17T02:00:00Z")); // Monday, 03:00 Douala
    const out = await handler.weeklyStep(client, { tenant: "acme", env: "live" });
    expect(out).toMatchObject({ weekStart: WEEK_START, weekEnd: WEEK_END, queries: 2 });
  });

  it("does nothing on the other six nights", async () => {
    const client = clientFor();
    jest.useFakeTimers().setSystemTime(new Date("2026-08-19T02:00:00Z")); // Wednesday
    const out = await handler.weeklyStep(client, { tenant: "acme", env: "live" });
    expect(out).toBeNull();
    expect(client.inserts).toHaveLength(0);
  });

  it("a THROWING weekly writer does not change the reconcile return value", async () => {
    /*
     * Rule 1 of the guide, one level up. Reconciliation decides what people are
     * PAID; a summariser that raises a question about a pattern must never be
     * able to take that down with it.
     */
    jest.spyOn(reconcile, "reconcileDate").mockResolvedValue(RESULT);
    jest.spyOn(registry, "withTenantConnection")
      .mockImplementation((_meta, _env, fn) => fn(clientFor({ throwOnInsert: true })));
    jest.useFakeTimers().setSystemTime(new Date("2026-08-17T02:00:00Z")); // Monday

    const out = await handler({ data: { tenantMeta: META, env: "live" } });
    // Unchanged, and the job did not fail.
    expect(out).toEqual(RESULT);
  });

  it("the reconcile result survives a weekly step that throws before it even runs", async () => {
    jest.spyOn(reconcile, "reconcileDate").mockResolvedValue(RESULT);
    // A client that refuses every read — the timezone lookup itself throws.
    const broken = { query: async () => { throw new Error("connection reset"); } };
    jest.spyOn(registry, "withTenantConnection").mockImplementation((_meta, _env, fn) => fn(broken));

    const out = await handler({ data: { tenantMeta: META, env: "live" } });
    expect(out).toEqual(RESULT);
  });

  it("survives the weekly step failing to even get a connection", async () => {
    // `withTenantConnection` can throw on the ACQUIRE or on the COMMIT, neither
    // of which is inside `weeklyStep`'s own frame. The swallow has to sit
    // outside it or those two take the whole job down.
    jest.spyOn(reconcile, "reconcileDate").mockResolvedValue(RESULT);
    let call = 0;
    jest.spyOn(registry, "withTenantConnection").mockImplementation((_meta, _env, fn) => {
      call += 1;
      if (call === 1) return fn(clientFor());
      throw new Error("pool exhausted");
    });

    const out = await handler({ data: { tenantMeta: META, env: "live" } });
    expect(out).toEqual(RESULT);
    expect(call).toBe(2);
  });

  it("runs the weekly step on a SEPARATE connection, AFTER the reconcile committed", async () => {
    /*
     * THE REASON THIS IS NOT MERELY TIDY.
     *
     * `withTenantConnection` wraps `fn` in BEGIN…COMMIT on the pooled path. A
     * failed INSERT inside that transaction leaves it ABORTED, so Postgres
     * turns the following COMMIT into a rollback and every row the reconciler
     * just wrote is discarded — while the swallowed error meant the job still
     * reported success. Sharing one connection would have made a weekly bug
     * into a night where nobody was charged and nothing said so.
     */
    jest.spyOn(reconcile, "reconcileDate").mockResolvedValue(RESULT);
    const order = [];
    jest.spyOn(registry, "withTenantConnection").mockImplementation((_meta, _env, fn) => {
      order.push("acquire");
      return fn(clientFor());
    });
    jest.useFakeTimers().setSystemTime(new Date("2026-08-17T02:00:00Z"));

    await handler({ data: { tenantMeta: META, env: "live" } });
    // Two acquisitions, not one — the reconcile's transaction is closed before
    // the weekly writer can touch anything.
    expect(order).toEqual(["acquire", "acquire"]);
  });
});
