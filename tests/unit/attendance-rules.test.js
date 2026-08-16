"use strict";
/**
 * Attendance rules (0697).
 *
 * ── THE BUG AT THE TOP OF THE LIST ─────────────────────────────────────────
 *
 * The old lateness check read `new Date(clock_in_at).getHours()` — the SERVER's
 * clock. Every container we deploy runs UTC, so a Cameroonian employee (UTC+1)
 * arriving at 08:30 local read as 07:30 and was half an hour EARLY against an
 * 08:00 start. Nobody was ever late. The first test below is that one, and it
 * fails against the old implementation on any UTC host.
 *
 * The rest pin the policy that lives in `reconcileDay`'s branch ORDER: approved
 * leave beats a punch, the calendar beats an absence, and "absent" finally
 * means "expected and did not come" rather than "no row found".
 */

const rules = require("../../src/modules/hr/attendance/attendance.rules");

const DOUALA = "Africa/Douala"; // UTC+1, no DST — the deployment's real zone.

describe("reading the clock in the workplace timezone", () => {
  it("does not lose a real lateness because the server is on UTC", () => {
    // 08:30 in Douala is 07:30Z — half an hour late against an 08:00 start.
    const at = "2026-08-03T07:30:00Z";
    expect(rules.minutesLate({ clock_in_at: at, expected_start_time: "08:00", timeZone: DOUALA })).toBe(30);
    // The SAME instant read on a UTC host is 07:30, which is BEFORE the start —
    // so the old implementation called this employee early and charged nothing.
    // Kept here so the difference is visible rather than asserted in prose.
    expect(rules.minutesLate({ clock_in_at: at, expected_start_time: "08:00", timeZone: "UTC" })).toBe(0);
    expect(rules.wallClock(at, DOUALA).minutes).toBe(8 * 60 + 30);
  });

  it("measures lateness from the expected start, not from the grace window", () => {
    // 08:14 Douala = 07:14Z. Grace of 10 minutes is a THRESHOLD: 14 minutes
    // late is 14, not 4. Employees recognise the first number as "how late I
    // was" and would dispute the second.
    const at = "2026-08-03T07:14:00Z";
    expect(rules.minutesLate({ clock_in_at: at, expected_start_time: "08:00", grace_minutes: 10, timeZone: DOUALA })).toBe(14);
  });

  it("treats an arrival inside the grace window as on time", () => {
    const at = "2026-08-03T07:08:00Z"; // 08:08 local, 8 minutes past, grace 10
    expect(rules.minutesLate({ clock_in_at: at, expected_start_time: "08:00", grace_minutes: 10, timeZone: DOUALA })).toBe(0);
  });

  it("is not late when no start time is configured", () => {
    // Nothing to be late against. Silently assuming 08:00 would charge people
    // under a rule nobody set.
    expect(rules.minutesLate({ clock_in_at: "2026-08-03T15:00:00Z", timeZone: DOUALA })).toBe(0);
  });

  it("falls back to UTC on a mis-typed timezone rather than throwing", () => {
    // A bad setting must not stop the reconciler for the whole tenant.
    expect(rules.wallClock("2026-08-03T07:30:00Z", "Not/AZone").minutes).toBe(7 * 60 + 30);
  });

  it("reads midnight as 0, not 24", () => {
    // en-GB h23/h24 output prints "24" for midnight; unnormalised, a 00:05
    // punch looks sixteen hours late.
    expect(rules.wallClock("2026-08-02T23:05:00Z", DOUALA).minutes).toBe(5);
  });
});

describe("tiers", () => {
  const TIERS = [
    { after_minutes: 60, deduction_pct: 10 },
    { after_minutes: 120, deduction_pct: 20 },
    { after_minutes: 180, deduction_pct: 30 },
  ];

  it("takes the highest tier the lateness reaches", () => {
    expect(rules.tierPct(59, TIERS)).toBe(0);
    expect(rules.tierPct(60, TIERS)).toBe(10);
    expect(rules.tierPct(119, TIERS)).toBe(10);
    expect(rules.tierPct(200, TIERS)).toBe(30);
  });

  it("does not depend on the order the tiers were typed in", () => {
    // An HR manager appending a tier to the bottom of the list must not have it
    // shadowed by a smaller one above it.
    const jumbled = [TIERS[2], TIERS[0], TIERS[1]];
    expect(rules.tierPct(200, jumbled)).toBe(30);
    expect(rules.tierPct(60, jumbled)).toBe(10);
  });

  it("charges nothing on an empty or malformed tier list", () => {
    expect(rules.tierPct(300, [])).toBe(0);
    expect(rules.tierPct(300, [{ after_minutes: "soon", deduction_pct: 50 }])).toBe(0);
  });
});

describe("a day's pay", () => {
  it("divides by working days, not by the length of the month", () => {
    // 1/30th of a salary is smaller than the day the employee failed to work,
    // and the difference is the employer's to explain.
    expect(rules.dailyRate(660000, 22)).toBe(30000);
    expect(rules.dailyRate(660000, 20)).toBe(33000);
  });

  it("falls back to 22 days when no calendar could be established", () => {
    expect(rules.dailyRate(660000, 0)).toBe(30000);
  });
});

describe("reconciling a day", () => {
  const LATENESS = {
    hr_rule_id: "rule-late",
    effect: "DEDUCT_PCT_DAY",
    tiers: [{ after_minutes: 60, deduction_pct: 10 }],
  };
  const ABSENCE = { hr_rule_id: "rule-abs", effect: "DEDUCT_PCT_DAY", effect_value: 100 };
  const base = {
    expected_start_time: "08:00",
    timeZone: DOUALA,
    daily_rate: 30000,
    latenessRule: LATENESS,
    absenceRule: ABSENCE,
  };

  it("charges a tiered share of the day for a lateness", () => {
    // 09:30 local — an hour and a half past 08:00.
    const day = rules.reconcileDay({ ...base, clock_in_at: "2026-08-03T08:30:00Z" });
    expect(day.status).toBe("LATE");
    expect(day.minutes_late).toBe(90);
    expect(day.deduction_pct).toBe(10);
    expect(day.deduction_amount).toBe(3000);
    // Cited, so an employee can trace the charge to a rule rather than a mood.
    expect(day.hr_rule_id).toBe("rule-late");
  });

  it("flags the lateness but charges nothing when the rule only raises a query", () => {
    const day = rules.reconcileDay({
      ...base,
      clock_in_at: "2026-08-03T08:30:00Z",
      latenessRule: { ...LATENESS, effect: "QUERY_ONLY" },
    });
    expect(day.status).toBe("LATE");
    expect(day.minutes_late).toBe(90);
    expect(day.deduction_amount).toBe(0);
  });

  it("charges a full day for an unexcused absence", () => {
    const day = rules.reconcileDay({ ...base, clock_in_at: null });
    expect(day.status).toBe("ABSENT");
    expect(day.deduction_amount).toBe(30000);
  });

  it("does not call approved leave an absence", () => {
    // The whole reason this table exists: `absence()` today reports everyone on
    // holiday as absent, because no punch and no row are the same thing.
    const day = rules.reconcileDay({ ...base, clock_in_at: null, on_leave: true });
    expect(day.status).toBe("ON_LEAVE");
    expect(day.deduction_amount).toBe(0);
    expect(day.hr_rule_id).toBeNull();
  });

  it("marks unpaid leave for payroll without citing a rule", () => {
    // Unpaid leave costs the day, but the employee did nothing wrong — payroll
    // prorates it and no misconduct is recorded.
    const day = rules.reconcileDay({ ...base, clock_in_at: null, on_leave: true, leave_is_paid: false });
    expect(day.status).toBe("ON_LEAVE");
    expect(day.unpaid_leave).toBe(true);
    expect(day.deduction_amount).toBe(0);
  });

  it("lets leave beat a punch", () => {
    // Somebody on approved holiday who badges into the building has not started
    // a working day, and must not be charged for arriving at it late.
    const day = rules.reconcileDay({ ...base, clock_in_at: "2026-08-03T14:00:00Z", on_leave: true });
    expect(day.status).toBe("ON_LEAVE");
    expect(day.deduction_amount).toBe(0);
  });

  it("charges nothing on a public holiday or a non-working day", () => {
    expect(rules.reconcileDay({ ...base, clock_in_at: null, is_holiday: true })).toMatchObject({
      status: "HOLIDAY",
      deduction_amount: 0,
    });
    expect(rules.reconcileDay({ ...base, clock_in_at: null, is_working_day: false })).toMatchObject({
      status: "WEEKEND",
      deduction_amount: 0,
    });
  });

  it("records weekend work as present rather than as a weekend", () => {
    // Somebody who came in on a Saturday was there; the row should say so, and
    // it must not be measured for lateness against a shift they were not on.
    const day = rules.reconcileDay({ ...base, clock_in_at: "2026-08-01T12:00:00Z", is_working_day: false });
    expect(day.status).toBe("PRESENT");
    expect(day.deduction_amount).toBe(0);
  });

  it("charges nothing when no rule is configured", () => {
    // Rules seed INACTIVE. Until a tenant switches one on, reconciliation
    // records the facts and takes no money.
    const day = rules.reconcileDay({ ...base, clock_in_at: null, latenessRule: null, absenceRule: null });
    expect(day.status).toBe("ABSENT");
    expect(day.deduction_amount).toBe(0);
    expect(day.hr_rule_id).toBeNull();
  });
});

describe("working days", () => {
  it("prefers the employee's own schedule over the tenant weekend", () => {
    // A driver on Tue–Sat is not absent on Monday.
    expect(rules.isWorkingDay(1, { work_days: [2, 3, 4, 5, 6] })).toBe(false);
    expect(rules.isWorkingDay(6, { work_days: [2, 3, 4, 5, 6] })).toBe(true);
  });

  it("falls back to the tenant weekend when the employee has no schedule", () => {
    expect(rules.isWorkingDay(0, { weekendDays: [0, 6] })).toBe(false);
    expect(rules.isWorkingDay(3, { weekendDays: [0, 6] })).toBe(true);
  });
});

describe("rewards", () => {
  it("qualifies on either side of the comparator", () => {
    expect(rules.qualifies({ value: 20, comparator: "gte", threshold: 18 })).toBe(true);
    expect(rules.qualifies({ value: 1, comparator: "lte", threshold: 2 })).toBe(true);
    expect(rules.qualifies({ value: 3, comparator: "lte", threshold: 2 })).toBe(false);
  });

  it("resolves a bonus into money", () => {
    expect(rules.resolveReward({ effect: "BONUS_FIXED", effect_value: 25000 })).toEqual({ kind: "bonus", amount: 25000 });
    expect(rules.resolveReward({ effect: "BONUS_PCT_SALARY", effect_value: 5, monthlySalary: 660000 }))
      .toEqual({ kind: "bonus", amount: 33000 });
  });

  it("returns a raise as a PROPOSAL, never as a payroll line", () => {
    // A raise changes the employment terms. Nothing in a rules engine should be
    // able to write one.
    expect(rules.resolveReward({ effect: "SALARY_INCREASE_PCT", effect_value: 10, monthlySalary: 600000 }))
      .toEqual({ kind: "salary_increase", proposed_salary: 660000 });
  });

  it("resolves nothing when the figure would be zero or negative", () => {
    expect(rules.resolveReward({ effect: "BONUS_FIXED", effect_value: 0 })).toBeNull();
    expect(rules.resolveReward({ effect: "SALARY_INCREASE_PCT", effect_value: 0, monthlySalary: 600000 })).toBeNull();
  });
});
