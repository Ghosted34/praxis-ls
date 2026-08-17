"use strict";
/**
 * Scoring an appraisal from evidence (0701).
 *
 * ── THE PROPERTY THAT MATTERS MOST ─────────────────────────────────────────
 *
 * NO DATA IS NOT A ZERO. A new hire with no reconciled attendance, a tenant
 * that never switched the reconciler on, a KPI with no target — every one of
 * those must come back `null` with a reason, never 0. Zero reads as "failed",
 * and a manager skimming twenty rows will not stop to ask which kind of zero
 * they are looking at. Most of the tests below are that one property, from a
 * different angle each time.
 *
 * The second is that the WORKING comes back with the answer: an employee
 * disputing a score is entitled to the arithmetic, not the verdict.
 */

const ev = require("../../src/modules/hr/appraisal/appraisal.evidence");

describe("punctuality", () => {
  it("measures on-time days against days actually worked", () => {
    const out = ev.punctuality({ present_days: 20, late_days: 2 });
    expect(out.rating).toBe(4.5); // 18/20 of a 5-point scale
    expect(out.evidence).toMatchObject({ present_days: 20, late_days: 2, on_time_days: 18 });
  });

  it("does not count leave or holidays against anybody", () => {
    // Measured against days WORKED, not the calendar. Otherwise the people
    // penalised hardest are the ones who took the leave they are owed.
    const took = ev.punctuality({ present_days: 10, late_days: 0 });
    const didNot = ev.punctuality({ present_days: 20, late_days: 0 });
    expect(took.rating).toBe(didNot.rating);
  });

  it("returns null, not zero, when there is no attendance at all", () => {
    const out = ev.punctuality({ present_days: 0, late_days: 0 });
    expect(out.rating).toBeNull();
    expect(out.reason).toBe("no_attendance");
  });

  it("cannot be dragged below zero by nonsense counts", () => {
    // More late days than days worked is a data fault, not a −2 rating.
    expect(ev.punctuality({ present_days: 5, late_days: 99 }).rating).toBe(0);
  });
});

describe("absence", () => {
  it("scores unexcused days against expected days", () => {
    expect(ev.absence({ expected_days: 20, absent_days: 1 }).rating).toBe(4.75);
  });

  it("is null when nothing was expected", () => {
    expect(ev.absence({ expected_days: 0, absent_days: 0 }).rating).toBeNull();
  });
});

describe("conduct", () => {
  it("steps down from full marks rather than scoring a ratio", () => {
    // Nobody's conduct is "60% of the available conduct".
    expect(ev.conduct({ breaches: 0 }).rating).toBe(5);
    expect(ev.conduct({ breaches: 1, tolerance: 1 }).rating).toBe(5);
    expect(ev.conduct({ breaches: 2, tolerance: 1 }).rating).toBe(4);
    expect(ev.conduct({ breaches: 4, tolerance: 1 }).rating).toBe(2);
  });

  it("floors at zero however many breaches there are", () => {
    expect(ev.conduct({ breaches: 50, tolerance: 1 }).rating).toBe(0);
  });

  it("keeps the tolerance visible in the evidence", () => {
    // "Why is this 4?" — because two breaches, one of them free.
    expect(ev.conduct({ breaches: 2, tolerance: 1 }).evidence).toMatchObject({
      breaches: 2,
      tolerance: 1,
      counted: 1,
    });
  });
});

describe("training", () => {
  it("scores attendance against sessions the person was rostered onto", () => {
    expect(ev.training({ rostered: 4, attended: 3 }).rating).toBe(3.75);
  });

  it("does not penalise somebody who was never put on a course", () => {
    const out = ev.training({ rostered: 0, attended: 0 });
    expect(out.rating).toBeNull();
    expect(out.reason).toBe("not_rostered");
  });
});

describe("attainment", () => {
  it("scores actual against target and caps at the scale", () => {
    expect(ev.attainment({ actual: 80, target: 100 }).rating).toBe(4);
    // Beating the target by a mile is full marks, not seven out of five.
    expect(ev.attainment({ actual: 300, target: 100 }).rating).toBe(5);
  });

  it("is null when there is no target to score against", () => {
    expect(ev.attainment({ actual: 80, target: 0 }).reason).toBe("no_target");
    expect(ev.attainment({ actual: 80 }).reason).toBe("no_target");
  });
});

describe("scoreTarget", () => {
  it("leaves a hand-scored KPI alone", () => {
    expect(ev.scoreTarget({}, {})).toMatchObject({ rating: null, reason: "manual" });
  });

  it("says it does not know a source rather than scoring zero", () => {
    // A tenant naming a metric the scorer has not learned yet gets an honest
    // gap, not an employee marked down for it.
    const out = ev.scoreTarget({ auto_source: "customer_smiles" }, {});
    expect(out.rating).toBeNull();
    expect(out.reason).toBe("unknown_source");
  });

  it("honours a target's own scale", () => {
    const out = ev.scoreTarget(
      { auto_source: "attendance_punctuality", scale_max: 10 },
      { present_days: 10, late_days: 0 },
    );
    expect(out.rating).toBe(10);
  });
});

describe("rolling up a cycle", () => {
  it("weights the ratings", () => {
    const out = ev.overall([
      { rating: 5, weight: 50 },
      { rating: 3, weight: 50 },
    ]);
    expect(out.score).toBe(4);
    expect(out.weight_used).toBe(100);
  });

  it("renormalises across what could actually be measured", () => {
    // THE BUG THIS PREVENTS: one unscored KPI at 25% weight quietly costing a
    // quarter of everybody's appraisal. "We could not measure your training" is
    // not "you scored zero on training".
    const out = ev.overall([
      { rating: 4, weight: 75 },
      { rating: null, weight: 25 },
    ]);
    expect(out.score).toBe(4);
    expect(out.scored).toBe(1);
    expect(out.of).toBe(2);
    // …and it says so, so a manager can see the review is partial.
    expect(out.weight_used).toBe(75);
  });

  it("falls back to a plain mean when nobody set weights", () => {
    expect(ev.overall([{ rating: 4 }, { rating: 2 }]).score).toBe(3);
  });

  it("is null when nothing could be scored at all", () => {
    const out = ev.overall([{ rating: null, weight: 100 }]);
    expect(out.score).toBeNull();
    expect(out.scored).toBe(0);
  });

  it("is null on an empty cycle rather than zero", () => {
    expect(ev.overall([]).score).toBeNull();
  });
});

describe("bands", () => {
  it("names the score", () => {
    expect(ev.bandFor(4.8)).toBe("Outstanding");
    expect(ev.bandFor(3.7)).toBe("Exceeds expectations");
    expect(ev.bandFor(3)).toBe("Meets expectations");
    expect(ev.bandFor(2)).toBe("Below expectations");
    expect(ev.bandFor(0.5)).toBe("Unsatisfactory");
  });

  it("gives the same words on a different scale", () => {
    // A tenant scoring out of 10 should not find everybody Outstanding.
    expect(ev.bandFor(7.4, 10)).toBe("Exceeds expectations");
    expect(ev.bandFor(9.5, 10)).toBe("Outstanding");
  });

  it("names nothing when there is no score", () => {
    expect(ev.bandFor(null)).toBeNull();
  });
});

describe("weights", () => {
  it("reports the total rather than enforcing it", () => {
    // An HR manager building a target set is legitimately unbalanced half way
    // through; refusing the fourth KPI because the first three do not yet total
    // 100 makes the screen unusable.
    expect(ev.weightCheck([{ weight: 40 }, { weight: 30 }])).toEqual({
      total: 70,
      target: 100,
      balanced: false,
    });
    expect(ev.weightCheck([{ weight: 40 }, { weight: 60 }]).balanced).toBe(true);
  });

  it("is zero and unbalanced for an empty set", () => {
    expect(ev.weightCheck([])).toMatchObject({ total: 0, balanced: false });
  });
});
