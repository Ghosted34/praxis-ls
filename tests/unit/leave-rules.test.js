"use strict";
/**
 * Leave arithmetic (0696).
 *
 * WHAT WAS BROKEN. Nothing counted the days. `leave_request` held two date
 * strings that were not even validated against each other, so "3 days" and "3
 * weeks" were the same record, and no part of the product knew what an approval
 * cost the employee.
 *
 * These pin the four things that make a day count trustworthy: weekends and
 * public holidays are not charged to the employee, a recurring holiday matches
 * on month-and-day rather than on its stored year, half days can only discount
 * a day that is actually counted, and a backwards range is refused rather than
 * silently producing a negative that the ledger would post as entitlement
 * GAINED.
 */

const rules = require("../../src/modules/hr/leave_allowance/leave.rules");

// August 2026: the 1st is a Saturday, so Mon 3 – Fri 7 is a clean working week.
const NEW_YEAR = { holiday_on: "2000-01-01", is_recurring: true };
// 1 May 2026 is a Friday — a holiday that actually falls on a working day, so
// these assertions measure the holiday rather than the weekend beside it.
const LABOUR_DAY = { holiday_on: "2000-05-01", is_recurring: true };
const MOURNING = { holiday_on: "2026-08-05", is_recurring: false };

describe("countDays", () => {
  it("counts working days and skips the weekend", () => {
    // Mon 3rd → Fri 7th inclusive.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-07" })).toBe(5);
    // …and the following Monday adds one, not three.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-10" })).toBe(6);
  });

  it("does not charge the employee for a public holiday inside the span", () => {
    // Wed 5 Aug 2026 declared a one-off holiday.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-07", holidays: [MOURNING] })).toBe(4);
  });

  it("matches a recurring holiday on month and day, not on its stored year", () => {
    // The seeded rows carry an arbitrary year 2000 (see the migration). If the
    // counter compared full dates, every fixed national holiday would be
    // invisible from 2001 onwards.
    expect(rules.countDays({ starts_on: "2026-01-01", ends_on: "2026-01-02", holidays: [NEW_YEAR] })).toBe(1);
    // Mon 27 Apr – Fri 1 May is five working days; Labour Day takes one off.
    expect(rules.countDays({ starts_on: "2026-04-27", ends_on: "2026-05-01", holidays: [LABOUR_DAY] })).toBe(4);
  });

  it("runs calendar days straight through when the type says so", () => {
    // Maternity is counted in weeks and does not pause for a Sunday.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-09", counts_working_days: false })).toBe(7);
    // …and a holiday does not shorten it either: the same span is 2 working
    // days once Labour Day and the weekend come out, and 4 calendar days.
    const span = { starts_on: "2026-04-30", ends_on: "2026-05-03", holidays: [LABOUR_DAY] };
    expect(rules.countDays({ ...span, counts_working_days: false })).toBe(4);
    expect(rules.countDays(span)).toBe(1);
  });

  it("deducts half a day at each end", () => {
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-07", half_day_start: true })).toBe(4.5);
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-07", half_day_start: true, half_day_end: true })).toBe(4);
  });

  it("charges half a day, not zero, for one afternoon", () => {
    // Both flags on a single day would otherwise subtract a whole day and make
    // the request free.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-03", half_day_start: true, half_day_end: true })).toBe(0.5);
  });

  it("ignores a half day at an end that is not itself counted", () => {
    // Sat 1st is not a working day; taking its "afternoon" must not credit
    // half a day back against the Monday.
    expect(rules.countDays({ starts_on: "2026-08-01", ends_on: "2026-08-03", half_day_start: true })).toBe(1);
  });

  it("returns 0 for a span that is entirely non-working", () => {
    // Sat + Sun. The service refuses this rather than storing it — a zero-day
    // approval consumes nothing and means nothing.
    expect(rules.countDays({ starts_on: "2026-08-01", ends_on: "2026-08-02" })).toBe(0);
  });

  it("refuses a backwards range rather than returning a negative", () => {
    // The number this returns is posted to the ledger as a NEGATIVE movement.
    // A negative day count would flip the sign and hand the employee days.
    expect(rules.countDays({ starts_on: "2026-08-07", ends_on: "2026-08-03" })).toBeNull();
  });

  it("refuses missing and impossible dates", () => {
    expect(rules.countDays({ starts_on: "2026-08-03" })).toBeNull();
    expect(rules.countDays({ starts_on: "not-a-date", ends_on: "2026-08-03" })).toBeNull();
    // Would otherwise roll forward into March and lengthen the request.
    expect(rules.countDays({ starts_on: "2026-02-30", ends_on: "2026-03-02" })).toBeNull();
  });

  it("honours a tenant that works Saturdays", () => {
    // hr.weekend_days = [0] — a six-day week. Mon–Sat is six days, not five.
    expect(rules.countDays({ starts_on: "2026-08-03", ends_on: "2026-08-08", weekendDays: [0] })).toBe(6);
  });
});

describe("overlaps", () => {
  const a = { starts_on: "2026-08-03", ends_on: "2026-08-07" };

  it("catches a request that shares a single day", () => {
    // Inclusive at both ends: leave ending on the 7th and leave starting on the
    // 7th are the same day booked twice, and would be charged twice.
    expect(rules.overlaps(a, { starts_on: "2026-08-07", ends_on: "2026-08-10" })).toBe(true);
    expect(rules.overlaps(a, { starts_on: "2026-07-30", ends_on: "2026-08-03" })).toBe(true);
  });

  it("allows adjacent requests", () => {
    expect(rules.overlaps(a, { starts_on: "2026-08-08", ends_on: "2026-08-12" })).toBe(false);
  });

  it("catches full containment either way round", () => {
    expect(rules.overlaps(a, { starts_on: "2026-08-04", ends_on: "2026-08-05" })).toBe(true);
    expect(rules.overlaps(a, { starts_on: "2026-07-01", ends_on: "2026-12-31" })).toBe(true);
  });
});

describe("balanceFrom", () => {
  it("sums signed movements and reports consumption as a positive magnitude", () => {
    const out = rules.balanceFrom([
      { kind: "CARRYOVER", days: 2 },
      { kind: "ACCRUAL", days: 1.5 },
      { kind: "ACCRUAL", days: 1.5 },
      { kind: "TAKEN", days: -4 },
      { kind: "RETURNED", days: 4 },
      { kind: "TAKEN", days: -1.5 },
      { kind: "ADJUSTMENT", days: -0.5 },
    ]);
    // 2 + 1.5 + 1.5 − 4 + 4 − 1.5 − 0.5
    expect(out.balance).toBe(3);
    // A screen showing "Taken −5.5" reads as a correction, so the magnitudes
    // are reported positive and only `balance` carries the sign.
    expect(out.taken).toBe(5.5);
    expect(out.returned).toBe(4);
    expect(out.accrued).toBe(3);
    expect(out.carried).toBe(2);
    expect(out.adjustments).toBe(-0.5);
  });

  it("is zero on an empty ledger, not NaN", () => {
    expect(rules.balanceFrom([]).balance).toBe(0);
    expect(rules.balanceFrom().balance).toBe(0);
  });

  it("ignores a kind it does not know rather than dropping it from the balance", () => {
    // A kind added later must still count toward the total — silently omitting
    // it would make the balance disagree with the movements shown beside it.
    const out = rules.balanceFrom([{ kind: "SOMETHING_NEW", days: 3 }]);
    expect(out.balance).toBe(3);
  });
});

describe("accrualMonths", () => {
  it("stops at the current month", () => {
    const months = rules.accrualMonths({ hired_on: "2026-01-01", upto: "2026-08-16", year: 2026 });
    expect(months).toHaveLength(8);
    expect(months[0]).toEqual({ year: 2026, month: 1 });
    expect(months[7]).toEqual({ year: 2026, month: 8 });
  });

  it("does not credit the month somebody joined part-way through", () => {
    // Statutory accrual is per month of SERVICE. Eleven days of March is not a
    // month of it.
    const months = rules.accrualMonths({ hired_on: "2026-03-20", upto: "2026-08-16", year: 2026 });
    expect(months.map((m) => m.month)).toEqual([4, 5, 6, 7, 8]);
  });

  it("credits the joining month when service started on the 1st", () => {
    const months = rules.accrualMonths({ hired_on: "2026-03-01", upto: "2026-08-16", year: 2026 });
    expect(months.map((m) => m.month)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("accrues nothing for a year before the employee joined", () => {
    expect(rules.accrualMonths({ hired_on: "2026-03-01", upto: "2026-08-16", year: 2025 })).toEqual([]);
  });

  it("gives a full past year when asked for one", () => {
    expect(rules.accrualMonths({ hired_on: "2020-01-01", upto: "2026-08-16", year: 2025 })).toHaveLength(12);
  });

  it("accrues from January when no hire date is known", () => {
    // hired_on is backfilled by the migration, but a row written by an older
    // import can still be null; accruing from the start of the year is the
    // documented fallback rather than a crash.
    expect(rules.accrualMonths({ upto: "2026-04-10", year: 2026 })).toHaveLength(4);
  });
});
