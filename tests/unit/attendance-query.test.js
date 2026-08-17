"use strict";
/**
 * The lateness query's wording (0704).
 *
 * ── WHY THE WORDING IS TESTED AT ALL ───────────────────────────────────────
 *
 * This text is the ONLY explanation the person being charged receives. It is
 * written by two different code paths — the punch and the nightly reconciler —
 * and the whole design depends on them producing the same query rather than two.
 *
 * ── THE DISTINCTION THAT MATTERS ───────────────────────────────────────────
 *
 * At the punch the deduction is a PROSPECT: the day is not over, and approved
 * leave, a corrected punch or a manager's waiver can still change it. Stating a
 * figure as fact at 08:40 and then charging something different is how a system
 * loses the entire benefit of having asked early — the next time, nobody
 * believes the number.
 */

const { composeQuery } = require("../../src/modules/hr/attendance/attendance.query");

const LATENESS = {
  hr_rule_id: "rule-1",
  code: "LATENESS_TIERED",
  name: "Lateness deduction",
  effect: "DEDUCT_PCT_DAY",
  query_severity: "WARNING",
  query_due_days: 2,
};
const ABSENCE = { ...LATENESS, code: "ABSENCE_UNEXCUSED", name: "Unexcused absence", query_severity: "SERIOUS" };

describe("what the employee is asked at the punch", () => {
  it("states the minutes and the start time they are measured against", () => {
    const q = composeQuery({
      rule: LATENESS, workDate: "2026-08-18", minutesLate: 90, expectedStart: "08:00", deduction: 0,
    });
    expect(q.subject).toBe("Lateness deduction — 2026-08-18");
    expect(q.body).toContain("90 minute(s) after your 08:00 start");
    expect(q.body).toContain("Please explain.");
  });

  it("puts a deduction as a PROSPECT while the day is still running", () => {
    const q = composeQuery({
      rule: LATENESS, workDate: "2026-08-18", minutesLate: 90, expectedStart: "08:00",
      deduction: 4500, settled: false,
    });
    expect(q.body).toContain("would carry a deduction of 4500");
    // Never as a settled fact — leave, a correction or a waiver can still change
    // it before the day is reconciled.
    expect(q.body).not.toContain("this carries a deduction");
  });

  it("says plainly when nothing is charged yet", () => {
    // More use than silence: it tells somebody 20 minutes late that they are
    // inside the grace window, which is something they can act on tomorrow.
    const q = composeQuery({
      rule: LATENESS, workDate: "2026-08-18", minutesLate: 20, expectedStart: "08:00", deduction: 0,
    });
    expect(q.body).toContain("No deduction applies at this point.");
  });

  it("does not promise a deduction for a rule that never charges", () => {
    const q = composeQuery({
      rule: { ...LATENESS, effect: "QUERY_ONLY" },
      workDate: "2026-08-18", minutesLate: 20, expectedStart: "08:00", deduction: 0,
    });
    expect(q.body).not.toMatch(/deduction/i);
  });
});

describe("what it becomes once the day is settled", () => {
  it("states the deduction as a fact", () => {
    const q = composeQuery({
      rule: LATENESS, workDate: "2026-08-18", minutesLate: 90, expectedStart: "08:00",
      deduction: 4500, settled: true,
    });
    expect(q.body).toContain("this carries a deduction of 4500");
    expect(q.body).toContain("stands until this query is resolved");
  });

  it("drops the grace-window note once settled", () => {
    // "No deduction applies at this point" is a statement about an unfinished
    // day. After settlement the absence of a charge speaks for itself.
    const q = composeQuery({
      rule: LATENESS, workDate: "2026-08-18", minutesLate: 20, expectedStart: "08:00",
      deduction: 0, settled: true,
    });
    expect(q.body).not.toContain("No deduction applies");
  });

  it("keeps the subject stable between the two moments, so it is one query", () => {
    const atPunch = composeQuery({ rule: LATENESS, workDate: "2026-08-18", minutesLate: 90, expectedStart: "08:00" });
    const settled = composeQuery({ rule: LATENESS, workDate: "2026-08-18", minutesLate: 90, expectedStart: "08:00", deduction: 4500, settled: true });
    expect(atPunch.subject).toBe(settled.subject);
  });
});

describe("absence", () => {
  it("does not talk about clocking in", () => {
    // There is no punch. A body that says "you clocked in null minutes after
    // your null start" is what the shared writer exists to prevent.
    const q = composeQuery({ rule: ABSENCE, workDate: "2026-08-18", absent: true, deduction: 15000, settled: true });
    expect(q.body).toContain("recorded absent on 2026-08-18");
    expect(q.body).not.toMatch(/clocked in/);
    expect(q.body).toContain("no approved leave");
  });

  it("carries the settled deduction like any other rule", () => {
    const q = composeQuery({ rule: ABSENCE, workDate: "2026-08-18", absent: true, deduction: 15000, settled: true });
    expect(q.body).toContain("deduction of 15000");
  });
});

describe("missing facts do not produce nonsense", () => {
  it("falls back to a word rather than printing null for the start time", () => {
    const q = composeQuery({ rule: LATENESS, workDate: "2026-08-18", minutesLate: 45, expectedStart: null });
    expect(q.body).toContain("after your expected start");
    expect(q.body).not.toContain("null");
  });

  it("treats a non-numeric deduction as no deduction", () => {
    const q = composeQuery({ rule: LATENESS, workDate: "2026-08-18", minutesLate: 45, expectedStart: "08:00", deduction: null, settled: true });
    expect(q.body).not.toMatch(/deduction of/);
  });
});
