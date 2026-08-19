"use strict";
/**
 * Expected-day resolver (PR1).
 *
 * Attendance used to ignore the entity working calendar. A Mon–Sat yard then
 * charged Saturday as WEEKEND/absent. These tests pin the precedence the
 * reconciler now shares with the rest of the product.
 */

const { decideExpected, workingDaysInMonth, weekdayOf } = require("../../src/modules/hr/attendance/attendance.calendar");

const SAT = "2026-08-01"; // Saturday
const SUN = "2026-08-02";
const MON = "2026-08-03";

const monSat = {
  inherited: false,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" })),
  holidays: [{ holiday_date: "2026-08-03", is_recurring: false, name_fr: "Test" }],
};

const inheritedDefault = {
  inherited: true,
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "08:00", closes_at: "17:00" })),
  holidays: [],
};

describe("weekdayOf", () => {
  it("reads the calendar date, not a local Date parse", () => {
    expect(weekdayOf(SAT)).toBe(6);
    expect(weekdayOf(SUN)).toBe(0);
    expect(weekdayOf(MON)).toBe(1);
  });
});

describe("entity working calendar", () => {
  it("treats Saturday as a working day on a Mon–Sat yard", () => {
    const d = decideExpected({ isoDate: SAT, calendar: monSat });
    expect(d.isWorkingDay).toBe(true);
    expect(d.isHoliday).toBe(false);
    expect(d.source).toBe("entity");
    expect(d.expectedStart).toBe("07:30");
  });

  it("still treats Sunday as closed when the calendar has no Sunday window", () => {
    const d = decideExpected({ isoDate: SUN, calendar: monSat });
    expect(d.isWorkingDay).toBe(false);
  });

  it("uses the entity holiday and ignores a tenant public holiday on an OWN calendar", () => {
    const ownHoliday = decideExpected({ isoDate: MON, calendar: monSat, publicHolidays: [] });
    expect(ownHoliday.isHoliday).toBe(true);
    const tenantOnly = decideExpected({
      isoDate: "2026-05-20",
      calendar: monSat,
      publicHolidays: [{ holiday_on: "2026-05-20", is_recurring: true }],
    });
    // Own calendar is the authority — 20 May is not on the entity list.
    expect(tenantOnly.isHoliday).toBe(false);
  });

  it("unions tenant public holidays when the calendar is inherited", () => {
    const d = decideExpected({
      isoDate: "2026-05-20",
      calendar: inheritedDefault,
      publicHolidays: [{ holiday_on: "2026-05-20", is_recurring: true }],
    });
    expect(d.isHoliday).toBe(true);
    expect(d.source).toBe("entity");
  });
});

describe("employee override", () => {
  it("beats the entity week — a Tue–Sat driver is not expected on Monday", () => {
    const d = decideExpected({
      isoDate: MON,
      workDays: [2, 3, 4, 5, 6],
      calendar: monSat,
    });
    expect(d.isWorkingDay).toBe(false);
    expect(d.source).toBe("employee");
  });

  it("keeps the employee's own start time over the entity opens_at", () => {
    const d = decideExpected({
      isoDate: SAT,
      workDays: [6],
      expectedStart: "06:00",
      calendar: monSat,
    });
    expect(d.expectedStart).toBe("06:00");
    expect(d.isWorkingDay).toBe(true);
  });

  it("still marks a holiday even when the employee works that weekday", () => {
    const d = decideExpected({
      isoDate: MON, // entity holiday on 2026-08-03
      workDays: [1, 2, 3, 4, 5],
      calendar: monSat,
    });
    expect(d.isWorkingDay).toBe(true);
    expect(d.isHoliday).toBe(true);
  });
});

describe("tenant fallback", () => {
  it("uses weekend_days when there is no calendar and no employee week", () => {
    const sat = decideExpected({ isoDate: SAT, weekendDays: [0, 6], policyStart: "08:00" });
    expect(sat.isWorkingDay).toBe(false);
    expect(sat.source).toBe("tenant");
    const wed = decideExpected({ isoDate: "2026-08-05", weekendDays: [0, 6] });
    expect(wed.isWorkingDay).toBe(true);
    expect(wed.expectedStart).toBe("08:00");
  });
});

describe("a Mon–Sat Saturday is not a weekend for reconciliation", () => {
  const rules = require("../../src/modules/hr/attendance/attendance.rules");

  it("charges ABSENT, not WEEKEND, when nobody punched", () => {
    const exp = decideExpected({ isoDate: SAT, calendar: { ...monSat, holidays: [] } });
    expect(exp.isWorkingDay).toBe(true);
    const day = rules.reconcileDay({
      clock_in_at: null,
      is_working_day: exp.isWorkingDay,
      is_holiday: exp.isHoliday,
      expected_start_time: exp.expectedStart,
      timeZone: exp.timezone,
      daily_rate: 30000,
      absenceRule: { hr_rule_id: "abs", effect: "DEDUCT_PCT_DAY", effect_value: 100 },
    });
    expect(day.status).toBe("ABSENT");
    expect(day.status).not.toBe("WEEKEND");
  });
});

describe("hhmm", () => {
  const { hhmm } = require("../../src/modules/hr/attendance/attendance.calendar");
  it("strips seconds and pads the hour", () => {
    expect(hhmm("7:30:00")).toBe("07:30");
    expect(hhmm("08:00")).toBe("08:00");
    expect(hhmm("bad")).toBeNull();
  });
});

describe("workingDaysInMonth", () => {
  it("counts Saturday for a Mon–Sat entity", () => {
    const n = workingDaysInMonth(2026, 8, (iso) => decideExpected({ isoDate: iso, calendar: { ...monSat, holidays: [] } }));
    // August 2026: 5 Saturdays, 5 Sundays, 31 days → 31 - 5 Sundays = 26 if Sat works.
    expect(n).toBe(26);
  });
});
