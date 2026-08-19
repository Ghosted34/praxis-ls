"use strict";
/**
 * reconcileDate against a fake client — the PR1 proof that a Mon–Sat entity
 * does not write WEEKEND on Saturday, that leave still wins, and that
 * yesterday's punch does not hide today's.
 */

jest.mock("../../src/modules/hr/attendance/attendance.calendar", () => {
  const actual = jest.requireActual("../../src/modules/hr/attendance/attendance.calendar");
  return {
    ...actual,
    loadContext: jest.fn(),
  };
});

const calendar = require("../../src/modules/hr/attendance/attendance.calendar");
const { reconcileDate } = require("../../src/modules/hr/attendance/attendance.reconcile");

const SAT = "2026-08-01";
const EMP = "11111111-1111-1111-1111-111111111111";
const monSat = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
  holidays: [],
};

function ctx() {
  return {
    policyStart: "08:00",
    policyGrace: 10,
    weekendDays: [0, 6],
    fallbackTimezone: "Africa/Douala",
    publicHolidays: [],
    calendarFor: () => monSat,
  };
}

function clientFor({ punches = [], leaves = [], roster = [{
  employee_id: EMP, full_name: "Ada", base_salary: 660000,
  expected_start_time: null, grace_minutes: null, work_days: null, entity_id: "e1",
}] } = {}) {
  const inserts = [];
  return {
    inserts,
    query: async (sql, params = []) => {
      const s = String(sql);
      if (/FROM setting/.test(s)) return { rows: [{ value: "Africa/Douala" }] };
      if (/FROM hr_rule/.test(s)) return { rows: [] };
      if (/FROM employee WHERE is_active/.test(s)) return { rows: roster };
      if (/FROM attendance_log/.test(s)) return { rows: punches };
      if (/FROM leave_request/.test(s)) return { rows: leaves };
      if (/FROM app_user/.test(s)) return { rows: [] };
      if (/INSERT INTO attendance_day/.test(s)) {
        const row = {
          attendance_day_id: "day-1",
          employee_id: params[0],
          work_date: params[1],
          status: params[2],
          expected_start_time: params[3],
          grace_minutes: params[4],
          first_clock_in_at: params[5],
          last_clock_out_at: params[6],
          minutes_late: params[7],
          daily_rate: params[8],
          deduction_pct: params[9],
          deduction_amount: params[10],
          justified: false,
          hr_query_id: null,
          hr_rule_id: params[11],
          leave_request_id: params[12],
          attendance_id: params[13],
        };
        inserts.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO immutable_ledger/.test(s)) return { rows: [] };
      throw new Error("unhandled sql in reconcile fixture: " + s.replace(/\s+/g, " ").slice(0, 160));
    },
  };
}

beforeEach(() => {
  calendar.loadContext.mockResolvedValue(ctx());
});

describe("reconcileDate (PR1 calendar)", () => {
  it("writes ABSENT on a Mon–Sat Saturday with no punch — never WEEKEND", async () => {
    const c = clientFor();
    const out = await reconcileDate(c, { date: SAT });
    expect(out.written).toBe(1);
    expect(c.inserts[0].status).toBe("ABSENT");
    expect(c.inserts[0].status).not.toBe("WEEKEND");
    expect(c.inserts[0].expected_start_time).toBe("07:30");
  });

  it("lets approved leave beat the calendar", async () => {
    const c = clientFor({
      leaves: [{ employee_id: EMP, leave_request_id: "lv1", is_paid: true }],
    });
    await reconcileDate(c, { date: SAT });
    expect(c.inserts[0].status).toBe("ON_LEAVE");
    expect(c.inserts[0].leave_request_id).toBe("lv1");
    expect(Number(c.inserts[0].deduction_amount)).toBe(0);
  });

  it("matches today's punch, not yesterday's earlier one", async () => {
    const c = clientFor({
      punches: [
        { employee_id: EMP, attendance_id: "yest", clock_in_at: "2026-07-31T07:00:00Z", clock_out_at: "2026-07-31T16:00:00Z" },
        { employee_id: EMP, attendance_id: "today", clock_in_at: "2026-08-01T06:20:00Z", clock_out_at: null },
      ],
    });
    await reconcileDate(c, { date: SAT });
    expect(c.inserts[0].attendance_id).toBe("today");
    expect(c.inserts[0].status).toBe("PRESENT");
  });
});
