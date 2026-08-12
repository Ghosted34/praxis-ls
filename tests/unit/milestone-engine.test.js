"use strict";
/**
 * Milestone engine (MOD-31) — working-time calendar + re-baselining scheduler.
 *
 * These are the tests that matter for this module: the scheduler is pure, and
 * every business rule the product committed to (frozen DONE, a locked SLA,
 * delays push but early finishes do not pull, floors that refuse to compress,
 * attribution to the tier that actually slipped) is assertable here without a
 * database. If one of these breaks, a client is being told a date that is not
 * true.
 *
 * Dates are pinned in Africa/Douala (UTC+1, no DST) and February 2026 is used
 * throughout: 2026-02-06 is a Friday, so a single fixture exercises the Friday
 * cut-off, the short Saturday, and the closed Sunday.
 */
const cal = require("../../src/modules/operations/milestone/milestone.calendar");
const sched = require("../../src/modules/operations/milestone/milestone.schedule");

const SPEC = cal.DEFAULT_CALENDAR; // Mon–Fri 07:30–17:00, Sat 08:00–13:00, Sun closed
const at = (s) => new Date(s);

describe("working calendar", () => {
  it("consumes only open hours and skips the closed Sunday", () => {
    // Fri 15:00 → 2h to close, Sat gives 5h, Sun is closed, 1h into Monday.
    const out = cal.addWorkingHours(SPEC, at("2026-02-06T15:00:00+01:00"), 8);
    expect(cal.localDate(SPEC, out)).toBe("2026-02-09");
    expect(cal.toLocal(SPEC, out).min).toBe(8 * 60 + 30);
  });

  it("skips a public holiday", () => {
    const withHoliday = cal.buildCalendar({
      timezone: "Africa/Douala",
      days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" }))
        .concat([{ weekday: 6, opens_at: "08:00", closes_at: "13:00" }]),
      holidays: [{ holiday_date: "2026-02-09", is_recurring: false }],
    });
    const out = cal.addWorkingHours(withHoliday, at("2026-02-06T15:00:00+01:00"), 8);
    expect(cal.localDate(withHoliday, out)).toBe("2026-02-10");
  });

  it("accepts a holiday_date as a Date, which is what the database returns", () => {
    // THE REGRESSION. `node-postgres` parses a `date` column into a JS Date, so
    // every holiday row arriving from the tenant DB is a Date — and the first
    // version of the parser stringified it to "Thu Jan 01", failed its own ISO
    // test, and DROPPED it. Every configured public holiday was silently
    // ignored and the engine scheduled straight through 20 May. Nothing threw;
    // only an end-to-end run against real Postgres could see it.
    const spec = cal.buildCalendar({
      days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "08:00", closes_at: "17:00" })),
      holidays: [
        { holiday_date: new Date(2026, 4, 20), is_recurring: true },   // 20 May
        { holiday_date: new Date(2026, 3, 3), is_recurring: false },   // 3 April
      ],
    });
    expect(cal.isHoliday(spec, { y: 2027, m: 5, d: 20 })).toBe(true);
    expect(cal.isHoliday(spec, { y: 2026, m: 4, d: 3 })).toBe(true);
    expect(cal.isHoliday(spec, { y: 2027, m: 4, d: 3 })).toBe(false);
  });

  it("skips a holiday that falls mid-calculation rather than scheduling through it", () => {
    const spec = cal.buildCalendar({
      days: [1, 2, 3].map((weekday) => ({ weekday, opens_at: "08:00", closes_at: "16:00" })),
      holidays: [{ holiday_date: new Date(2026, 4, 20), is_recurring: true, name_fr: "Fête Nationale" }],
    });
    // Tue 19 May 15:00 + 4h: 1h to close, Wed 20 May is the holiday, Thu–Sun
    // closed, so it lands on Monday 25 May.
    const out = cal.addWorkingHours(spec, at("2026-05-19T15:00:00+01:00"), 4);
    expect(cal.localDate(spec, out)).toBe("2026-05-25");
  });

  it("honours a recurring holiday in any year", () => {
    const spec = cal.buildCalendar({
      days: [{ weekday: 1, opens_at: "08:00", closes_at: "17:00" }],
      holidays: [{ holiday_date: "2020-05-20", is_recurring: true }],
    });
    expect(cal.isHoliday(spec, { y: 2027, m: 5, d: 20 })).toBe(true);
    expect(cal.isHoliday(spec, { y: 2027, m: 5, d: 21 })).toBe(false);
  });

  it("measures working hours between two instants", () => {
    const hours = cal.workingHoursBetween(
      SPEC, at("2026-02-06T15:00:00+01:00"), at("2026-02-09T08:30:00+01:00"),
    );
    expect(hours).toBeCloseTo(8, 5);
  });

  it("is the inverse of itself: add N hours, measure N hours", () => {
    const start = at("2026-02-03T09:15:00+01:00");
    for (const h of [1, 4, 9.5, 20, 47.25]) {
      const end = cal.addWorkingHours(SPEC, start, h);
      expect(cal.workingHoursBetween(SPEC, start, end)).toBeCloseTo(h, 5);
    }
  });

  it("counts working DAYS, skipping Sunday", () => {
    // Fri + 3 working days → Sat, Mon, Tue (Sunday is not a working day).
    const out = cal.addWorkingDays(SPEC, at("2026-02-06T09:00:00+01:00"), 3);
    expect(cal.localDate(SPEC, out)).toBe("2026-02-10");
  });

  it("snaps a closed moment forward to the next opening", () => {
    const sunday = at("2026-02-08T10:00:00+01:00");
    expect(cal.localDate(SPEC, cal.nextOpen(SPEC, sunday))).toBe("2026-02-09");
  });

  it("refuses a calendar with no open day rather than assuming Mon–Fri", () => {
    expect(() => cal.buildCalendar({ days: [] })).toThrow(/no open days/);
  });
});

describe("distribute — weight share with floors (guardrail 3)", () => {
  const stages = (defs) => defs.map((d, i) => ({ key: "s" + i, weight: d[0], minDurationHours: d[1] }));

  it("splits by weight when no floor binds", () => {
    const out = sched.distribute(stages([[25, 0], [25, 0], [50, 0]]), 100);
    expect(out.get("s0")).toBeCloseTo(25);
    expect(out.get("s2")).toBeCloseTo(50);
  });

  it("pins a starved stage at its floor and redistributes the rest", () => {
    // s0 would get 10h on weight alone but needs 30; the other two absorb the
    // difference in proportion rather than every stage inflating past the total.
    const out = sched.distribute(stages([[10, 30], [45, 0], [45, 0]]), 100);
    expect(out.get("s0")).toBeCloseTo(30);
    expect(out.get("s1")).toBeCloseTo(35);
    expect(out.get("s2")).toBeCloseTo(35);
  });

  it("always sums to exactly the horizon", () => {
    const out = sched.distribute(stages([[10, 30], [45, 5], [45, 0]]), 100);
    const total = [...out.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("returns null when the floors cannot fit — the breach signal", () => {
    expect(sched.distribute(stages([[50, 60], [50, 60]]), 100)).toBeNull();
  });
});

/** A four-stage chain with an anchor at #2 and the SLA locked on #4. */
function chain(overrides = {}) {
  const base = [
    { key: "a", seq: 1, code: "BOOKING", weight: 20, minDurationHours: 2, ownerTier: "INTERNAL" },
    { key: "b", seq: 2, code: "ARRIVAL", weight: 30, minDurationHours: 4, ownerTier: "CARRIER", isAnchor: true },
    { key: "c", seq: 3, code: "CUSTOMS", weight: 30, minDurationHours: 8, ownerTier: "AUTHORITY" },
    { key: "d", seq: 4, code: "DELIVERY", weight: 20, minDurationHours: 4, ownerTier: "INTERNAL", isTargetLock: true },
  ];
  return base.map((s) => ({ status: "PENDING", ...s, ...(overrides[s.key] || {}) }));
}

const run = (stages, opts = {}) => sched.computeSchedule({
  stages,
  now: at("2026-02-02T08:00:00+01:00"),
  openedAt: at("2026-02-02T08:00:00+01:00"),
  targetDate: at("2026-02-13T17:00:00+01:00"),
  calendar: SPEC,
  ...opts,
});

const byKey = (res) => Object.fromEntries(res.stages.map((s) => [s.key, s]));

describe("computeSchedule", () => {
  it("orders the chain and lands the last stage on the target", () => {
    const out = byKey(run(chain()));
    expect(cal.localDate(SPEC, out.d.forecastDue)).toBe("2026-02-13");
    const seq = ["a", "b", "c", "d"].map((k) => out[k].forecastDue.getTime());
    expect(seq).toEqual([...seq].sort((x, y) => x - y));
  });

  it("marks the chain provisional until the anchor stage completes", () => {
    expect(run(chain()).meta.provisional).toBe(true);
    const met = run(chain({ b: { status: "DONE", completedAt: at("2026-02-04T10:00:00+01:00") } }));
    expect(met.meta.provisional).toBe(false);
  });

  it("guardrail 1: a DONE stage is frozen and never recomputed", () => {
    const done = {
      status: "DONE",
      completedAt: at("2026-02-04T10:00:00+01:00"),
      baselineDue: at("2026-02-03T17:00:00+01:00"),
      plannedDue: at("2026-02-03T17:00:00+01:00"),
      forecastDue: at("2026-02-03T17:00:00+01:00"),
    };
    const out = byKey(run(chain({ a: done })));
    expect(out.a.frozen).toBe(true);
    expect(out.a.plannedDue).toEqual(done.plannedDue);
    expect(out.a.health).toBe(sched.HEALTH.DONE);
  });

  it("re-anchors the remainder on the ACTUAL completion, not the plan", () => {
    // The carrier berths two days late; everything after is measured from the
    // real event, so customs cannot still be forecast at its original slot.
    const onTime = byKey(run(chain({
      b: { status: "DONE", completedAt: at("2026-02-04T10:00:00+01:00") },
    })));
    const late = byKey(run(chain({
      b: { status: "DONE", completedAt: at("2026-02-06T10:00:00+01:00") },
    })));
    expect(late.c.forecastDue.getTime()).toBeGreaterThan(onTime.c.forecastDue.getTime());
  });

  it("guardrail 2: the locked SLA holds while the rest compresses", () => {
    // Anchor lands Thursday 13:30, leaving 13 working hours to the locked
    // Friday 17:00 — enough to fit the 12h of floors, but only just. Customs
    // (weight 30 of the remaining 50) would get 7.8h and needs 8.
    const out = byKey(run(chain({
      a: { status: "DONE", completedAt: at("2026-02-12T13:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-12T13:30:00+01:00") },
    })));
    // The commitment on the locked stage stays ON the target despite the slip,
    // even though the forecast has already run past it...
    expect(out.d.plannedDue).toEqual(at("2026-02-13T17:00:00+01:00"));
    // ...and the squeeze is visible rather than silent.
    expect(out.c.atFloor || out.d.atFloor).toBe(true);
  });

  it("guardrail 3: reports BREACH_FORECAST instead of an impossible schedule", () => {
    const out = run(chain({
      a: { status: "DONE", completedAt: at("2026-02-13T15:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-13T15:30:00+01:00") },
    }));
    expect(out.meta.breached).toBe(true);
    const stages = byKey(out);
    expect(stages.c.health).toBe(sched.HEALTH.BREACH);
    // The forecast tells the truth: the floors run past the locked date.
    expect(stages.d.forecastDue.getTime()).toBeGreaterThan(at("2026-02-13T17:00:00+01:00").getTime());
  });

  it("AUTO_RELEASE moves the commitment; HOLD_AND_ALERT does not", () => {
    const late = {
      a: { status: "DONE", completedAt: at("2026-02-13T15:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-13T15:30:00+01:00") },
      d: { plannedDue: at("2026-02-13T17:00:00+01:00") },
    };
    const held = run(chain(late));
    expect(held.meta.lockReleased).toBeFalsy();
    expect(byKey(held).d.plannedDue).toEqual(at("2026-02-13T17:00:00+01:00"));

    const released = run(chain(late), { policy: { onFloorReached: "AUTO_RELEASE" } });
    expect(released.meta.lockReleased).toBe(true);
    expect(byKey(released).d.plannedDue.getTime())
      .toBeGreaterThan(at("2026-02-13T17:00:00+01:00").getTime());
  });

  it("REQUIRE_REPLAN flags for a human instead of deciding", () => {
    const out = run(chain({
      a: { status: "DONE", completedAt: at("2026-02-13T15:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-13T15:30:00+01:00") },
    }), { policy: { onFloorReached: "REQUIRE_REPLAN" } });
    expect(out.meta.requiresReplan).toBe(true);
  });

  it("guardrail 2 (asymmetry): LATE pushes the commitment out", () => {
    const planned = at("2026-02-09T12:00:00+01:00");
    const out = byKey(run(chain({
      a: { status: "DONE", completedAt: at("2026-02-10T16:00:00+01:00") },
      c: { plannedDue: planned },
    })));
    expect(out.c.plannedDue.getTime()).toBeGreaterThan(planned.getTime());
    expect(out.c.outcome).toBe(sched.OUTCOME.SHIFTED);
  });

  it("guardrail 2 (asymmetry): EARLY improves the forecast but NOT the promise", () => {
    // Generous, but still inside the locked delivery date — a commitment
    // that sits AFTER the lock is incoherent for a different reason.
    const generousPromise = at("2026-02-12T17:00:00+01:00");
    const out = byKey(run(chain({
      a: { status: "DONE", completedAt: at("2026-02-02T09:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-02T10:00:00+01:00") },
      c: { plannedDue: generousPromise },
    })));
    expect(out.c.plannedDue).toEqual(generousPromise);          // promise held
    expect(out.c.forecastDue.getTime()).toBeLessThan(generousPromise.getTime()); // truth told
    expect(out.c.outcome).toBe(sched.OUTCOME.NO_CHANGE);
  });

  it("PULL_ALWAYS lets the promise track the forecast when a tenant wants that", () => {
    // Generous, but still inside the locked delivery date — a commitment
    // that sits AFTER the lock is incoherent for a different reason.
    const generousPromise = at("2026-02-12T17:00:00+01:00");
    const out = byKey(run(chain({
      a: { status: "DONE", completedAt: at("2026-02-02T09:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-02T10:00:00+01:00") },
      c: { plannedDue: generousPromise },
    }), { policy: { earlyCompletion: "PULL_ALWAYS" } }));
    expect(out.c.plannedDue.getTime()).toBeLessThan(generousPromise.getTime());
  });

  it("writes the baseline once and never moves it", () => {
    const first = byKey(run(chain()));
    const baseline = first.a.baselineDue;
    const second = byKey(run(chain({
      a: { baselineDue: baseline },
      b: { status: "DONE", completedAt: at("2026-02-10T10:00:00+01:00") },
    })));
    expect(second.a.baselineDue).toEqual(baseline);
  });

  it("respects a manual per-dossier date override", () => {
    const manual = at("2026-02-12T09:00:00+01:00");
    const out = byKey(run(chain({ c: { manualDueOverride: manual } })));
    expect(out.c.forecastDue).toEqual(manual);
  });

  it("lands the LOCKED stage on the target, not the end of the chain", () => {
    // "Delivery by the 13th" is a promise about DELIVERY. Stages after it —
    // empty return, final invoice — are real work that happens afterwards, and
    // spreading the horizon across them would deliver early and then breach a
    // promise nobody made about the paperwork.
    const withTail = chain().concat([
      { key: "e", seq: 5, code: "EMPTY_RETURN", weight: 10, minDurationHours: 2, ownerTier: "INTERNAL", status: "PENDING" },
      { key: "f", seq: 6, code: "FILE_CLOSED", weight: 10, minDurationHours: 2, ownerTier: "INTERNAL", status: "PENDING" },
    ]);
    const out = byKey(run(withTail));
    expect(cal.localDate(SPEC, out.d.forecastDue)).toBe("2026-02-13");
    expect(out.e.forecastDue.getTime()).toBeGreaterThan(out.d.forecastDue.getTime());
    expect(out.f.forecastDue.getTime()).toBeGreaterThan(out.e.forecastDue.getTime());
  });

  it("never commits an upstream stage LATER than the locked stage it precedes", () => {
    // The incoherent plan this pins: delivery committed for the 13th while the
    // customs clearance that must precede it is committed for the 14th.
    const out = byKey(run(chain({
      a: { status: "DONE", completedAt: at("2026-02-13T14:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-13T15:00:00+01:00") },
    })));
    expect(out.c.plannedDue.getTime()).toBeLessThanOrEqual(out.d.plannedDue.getTime());
    // ...and the forecast is still allowed to tell the truth.
    expect(out.c.forecastDue.getTime()).toBeGreaterThan(out.d.plannedDue.getTime());
  });

  it("a target that has ALREADY passed is a breach, not silence", () => {
    // The regression this pins: `target <= anchor` used to fall into the
    // no-horizon branch, so a file that blew its promised date quietly stopped
    // forecasting — at exactly the moment somebody needed to know.
    const out = run(chain({
      a: { status: "DONE", completedAt: at("2026-02-20T10:00:00+01:00") },
      b: { status: "DONE", completedAt: at("2026-02-20T11:00:00+01:00") },
    }));
    expect(out.meta.breached).toBe(true);
    const stages = byKey(out);
    expect(stages.c.health).toBe(sched.HEALTH.BREACH);
    expect(stages.c.forecastDue.getTime()).toBeGreaterThan(at("2026-02-20T11:00:00+01:00").getTime());
  });

  it("keeps the offset dates when the dossier has no target at all", () => {
    const out = run(chain(), { targetDate: null });
    expect(out.stages.every((s) => s.noHorizon || s.frozen)).toBe(true);
  });

  it("scores health against the commitment", () => {
    const out = byKey(sched.computeSchedule({
      stages: chain({ c: { plannedDue: at("2026-02-02T09:00:00+01:00") } }),
      now: at("2026-02-05T08:00:00+01:00"),
      openedAt: at("2026-02-02T08:00:00+01:00"),
      targetDate: at("2026-02-13T17:00:00+01:00"),
      calendar: SPEC,
    }));
    expect(out.c.health).toBe(sched.HEALTH.DELAYED);
  });
});

describe("segments", () => {
  const warehousing = [
    { key: "i1", seq: 1, code: "GATE_IN", weight: 40, minDurationHours: 2, segment: "INBOUND", status: "PENDING", ownerTier: "INTERNAL" },
    { key: "i2", seq: 2, code: "GRN", weight: 60, minDurationHours: 2, segment: "INBOUND", status: "PENDING", ownerTier: "INTERNAL", isTargetLock: true },
    { key: "s1", seq: 3, code: "CYCLE_COUNT", weight: 0, minDurationHours: 0, segment: "STEADY", cadence: "MONTHLY", status: "PENDING", ownerTier: "INTERNAL" },
    { key: "o1", seq: 4, code: "GATE_OUT", weight: 100, minDurationHours: 2, segment: "OUTBOUND", status: "PENDING", ownerTier: "INTERNAL" },
  ];

  it("gives steady-state stages no dates and never marks them late", () => {
    const out = byKey(run(warehousing));
    expect(out.s1.steady).toBe(true);
    expect(out.s1.plannedDue).toBeNull();
    expect(out.s1.health).toBe(sched.HEALTH.OK);
  });

  it("schedules each bounded segment on its own horizon", () => {
    const out = run(warehousing);
    expect(Object.keys(out.meta.segments).sort()).toEqual(["INBOUND", "OUTBOUND"]);
  });
});

describe("attributeVariance — guardrail 4", () => {
  const stage = {
    ownerTier: "CARRIER",
    plannedDue: at("2026-02-04T12:00:00+01:00"),
    baselineDue: at("2026-02-03T12:00:00+01:00"),
  };

  it("charges the slip to the tier that owns the slipping stage", () => {
    const v = sched.attributeVariance({
      stage, completedAt: at("2026-02-05T12:00:00+01:00"), calendar: SPEC,
    });
    expect(v.attributedTo).toBe("CARRIER");
    expect(v.late).toBe(true);
    expect(v.varianceHours).toBeGreaterThan(0);
  });

  it("measures the slip in WORKING hours, not wall-clock", () => {
    // Fri 12:00 → Mon 12:00 is 72 wall-clock hours but only 15 working ones
    // (5h Fri + 5h Sat + 4.5h Mon).
    const v = sched.attributeVariance({
      stage: { ...stage, plannedDue: at("2026-02-06T12:00:00+01:00") },
      completedAt: at("2026-02-09T12:00:00+01:00"),
      calendar: SPEC,
    });
    expect(v.varianceHours).toBe(15);
  });

  it("attributes nothing when a stage finishes early", () => {
    const v = sched.attributeVariance({
      stage, completedAt: at("2026-02-03T12:00:00+01:00"), calendar: SPEC,
    });
    expect(v.attributedTo).toBeNull();
    expect(v.varianceHours).toBeLessThan(0);
  });

  it("records a force-majeure code alongside the measured variance, not instead of it", () => {
    const v = sched.attributeVariance({
      stage, completedAt: at("2026-02-06T12:00:00+01:00"), calendar: SPEC,
      causeReasonCode: "FORCE_MAJEURE",
    });
    expect(v.causeReasonCode).toBe("FORCE_MAJEURE");
    expect(v.varianceHours).toBeGreaterThan(0);
    expect(v.attributedTo).toBe("CARRIER");
  });
});
