"use strict";
/**
 * Training session + compliance rules (0702).
 *
 * ── THE TWO PROPERTIES MOST OF THIS FILE IS ABOUT ──────────────────────────
 *
 * 1. NO PRESENCE IS NOT ABSENCE. `presenceAttendance` returns null when there
 *    is nothing to judge on, and a session that was never opened must not turn
 *    a roster of twenty people into twenty absences. This is the same failure
 *    0701's evidence module is built around — a missing measurement rendered as
 *    a bad result — and it is worth pinning in both places, because the two
 *    modules feed each other: training completion IS appraisal evidence.
 *
 * 2. A CERTIFICATE EXPIRES ON A DATE, NOT AFTER A NUMBER OF DAYS. Month
 *    arithmetic done by adding 30 days puts a January ticket into March. The
 *    tests below use the end-of-month cases specifically, because those are the
 *    ones that pass by accident with the wrong implementation for ten months of
 *    the year and then produce a wrong expiry date on somebody's forklift
 *    licence.
 */

const rules = require("../../src/modules/hr/training/training.rules");

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

describe("lifecycle", () => {
  it("lets a classroom session be closed out without ever going live", () => {
    // A course that ran off-system last Tuesday. Forcing somebody to press
    // Start on it is the ceremony that makes people stop recording training.
    expect(rules.assertTransition("SCHEDULED", "DONE")).toBe("DONE");
  });

  it("allows SCHEDULED → LIVE → DONE", () => {
    expect(rules.assertTransition("SCHEDULED", "LIVE")).toBe("LIVE");
    expect(rules.assertTransition("LIVE", "DONE")).toBe("DONE");
  });

  it("refuses to reopen a finished session", () => {
    expect(() => rules.assertTransition("DONE", "LIVE")).toThrow(/Cannot move training DONE → LIVE/);
  });

  it("refuses an unknown starting status rather than silently allowing it", () => {
    // TRANSITIONS[from] being undefined must not read as "no restrictions".
    expect(() => rules.assertTransition("ARCHIVED", "DONE")).toThrow(/Unknown training status/);
  });
});

/* ── Reachability ───────────────────────────────────────────────────────── */

describe("a session people can actually get to", () => {
  it("refuses an online session with no join link", () => {
    expect(() => rules.assertReachable({ mode: "ONLINE", join_url: "  " })).toThrow(/needs a join link/);
  });

  it("refuses an in-person session with no location", () => {
    expect(() => rules.assertReachable({ mode: "IN_PERSON", location: "" })).toThrow(/needs a location/);
  });

  it("demands BOTH for a hybrid session", () => {
    // The whole point of HYBRID: a form offering one box drops half the room.
    expect(() => rules.assertReachable({ mode: "HYBRID", location: "Room 2" })).toThrow(/join link/);
    expect(() => rules.assertReachable({ mode: "HYBRID", join_url: "https://x" })).toThrow(/location/);
    expect(rules.assertReachable({ mode: "HYBRID", join_url: "https://x", location: "Room 2" }))
      .toEqual({ mode: "HYBRID", join_url: "https://x", location: "Room 2" });
  });

  it("normalises surrounding space to null rather than storing a blank", () => {
    expect(rules.assertReachable({ mode: "IN_PERSON", location: " Room 2 ", join_url: "   " }))
      .toEqual({ mode: "IN_PERSON", location: "Room 2", join_url: null });
  });

  it("rejects a mode nobody defined", () => {
    expect(() => rules.assertReachable({ mode: "TELEPATHY" })).toThrow(/Unknown mode/);
  });
});

/* ── Duration ───────────────────────────────────────────────────────────── */

describe("planned vs actual duration", () => {
  it("reports the planned window in whole minutes", () => {
    expect(rules.plannedMinutes({ starts_at: "2026-09-01T08:00:00Z", ends_at: "2026-09-01T11:30:00Z" })).toBe(210);
  });

  it("returns null — not zero — for a session with no end time", () => {
    // Unbounded is not instant.
    expect(rules.plannedMinutes({ starts_at: "2026-09-01T08:00:00Z" })).toBeNull();
  });

  it("returns null for a window that ends before it starts", () => {
    expect(rules.plannedMinutes({ starts_at: "2026-09-01T11:00:00Z", ends_at: "2026-09-01T08:00:00Z" })).toBeNull();
  });

  it("gives a running session no duration yet", () => {
    // Reporting elapsed time as duration makes every live session look short.
    expect(rules.actualMinutes({ opened_at: "2026-09-01T08:05:00Z" })).toBeNull();
  });
});

/* ── Joining ────────────────────────────────────────────────────────────── */

describe("whether somebody may join, and why not", () => {
  const online = { status: "SCHEDULED", mode: "ONLINE", join_url: "https://meet.example/abc", starts_at: "2026-09-01T09:00:00Z" };

  it("opens the link fifteen minutes before the start", () => {
    const s = rules.joinState(online, "2026-09-01T08:50:00Z");
    expect(s.can_join).toBe(true);
    expect(s.minutes_until).toBe(10);
  });

  it("holds it shut before that, and says how long", () => {
    const s = rules.joinState(online, "2026-09-01T08:00:00Z");
    expect(s.can_join).toBe(false);
    expect(s.reason).toBe("TOO_EARLY");
    // A disabled button with no explanation sends people to the helpdesk.
    expect(s.minutes_until).toBe(60);
  });

  it("stays open for a session already running, however late somebody is", () => {
    const s = rules.joinState({ ...online, status: "LIVE" }, "2026-09-01T10:30:00Z");
    expect(s.can_join).toBe(true);
    expect(s.reason).toBe("LIVE");
  });

  it("explains an in-person session rather than showing a dead button", () => {
    const s = rules.joinState({ status: "SCHEDULED", mode: "IN_PERSON", location: "Room 2" }, "2026-09-01T09:00:00Z");
    expect(s.can_join).toBe(false);
    expect(s.message).toMatch(/in person/i);
  });

  it("distinguishes cancelled from finished", () => {
    expect(rules.joinState({ ...online, status: "CANCELLED" }).reason).toBe("CANCELLED");
    expect(rules.joinState({ ...online, status: "DONE" }).reason).toBe("ENDED");
  });

  it("lets people in when there is no start time to be early for", () => {
    const s = rules.joinState({ status: "SCHEDULED", mode: "ONLINE", join_url: "https://x" }, "2026-09-01T09:00:00Z");
    expect(s.can_join).toBe(true);
  });
});

/* ── Capacity ───────────────────────────────────────────────────────────── */

describe("capacity", () => {
  it("treats no capacity as unlimited, not as zero", () => {
    expect(rules.capacityState({ capacity: null, booked: 40 }))
      .toEqual({ capacity: null, booked: 40, remaining: null, is_full: false, is_over: false });
  });

  it("reports a full room", () => {
    expect(rules.capacityState({ capacity: 12, booked: 12 })).toMatchObject({ remaining: 0, is_full: true, is_over: false });
  });

  it("reports an over-booked room separately from a full one", () => {
    // Rows predating the capacity column can exceed it; the screen has to say
    // so rather than showing "0 remaining" as if it were fine.
    expect(rules.capacityState({ capacity: 10, booked: 14 })).toMatchObject({ remaining: 0, is_full: true, is_over: true });
  });

  it("never reports a negative remaining count", () => {
    expect(rules.capacityState({ capacity: 10, booked: 14 }).remaining).toBe(0);
  });
});

/* ── Presence ───────────────────────────────────────────────────────────── */

describe("attendance derived from presence", () => {
  it("returns null when there is no join to judge on", () => {
    // THE property. Twenty people on the roster of a session nobody opened must
    // not become twenty absences.
    expect(rules.presenceAttendance({ opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T12:00:00Z" })).toBeNull();
  });

  it("counts somebody present for most of a three-hour session", () => {
    const r = rules.presenceAttendance({
      joined_at: "2026-09-01T09:05:00Z", left_at: "2026-09-01T11:55:00Z",
      opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T12:00:00Z",
    });
    expect(r).toMatchObject({ attended: true, observed: true, reason: "PRESENT" });
    expect(r.present_minutes).toBe(170);
  });

  it("marks a partial attendance as not attended, and says it was partial", () => {
    // Half a safety course is not a safety course, and this ends up on a
    // certificate.
    const r = rules.presenceAttendance({
      joined_at: "2026-09-01T09:00:00Z", left_at: "2026-09-01T10:00:00Z",
      opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T12:00:00Z",
    });
    expect(r.attended).toBe(false);
    expect(r.reason).toBe("PARTIAL");
    expect(r.ratio).toBeCloseTo(0.33, 2);
  });

  it("does not apply a ratio to a ten-minute toolbox talk", () => {
    const r = rules.presenceAttendance({
      joined_at: "2026-09-01T09:02:00Z", left_at: "2026-09-01T09:10:00Z",
      opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T09:10:00Z",
    });
    expect(r).toMatchObject({ attended: true, reason: "JOINED", ratio: null });
  });

  it("credits somebody who joined a session that is still running", () => {
    const r = rules.presenceAttendance({ joined_at: "2026-09-01T09:05:00Z", opened_at: "2026-09-01T09:00:00Z" });
    expect(r).toMatchObject({ attended: true, reason: "JOINED" });
  });

  it("uses the session close as the leave time when nobody recorded one", () => {
    // Staying to the end is the normal case; it must not read as partial.
    const r = rules.presenceAttendance({
      joined_at: "2026-09-01T09:00:00Z",
      opened_at: "2026-09-01T09:00:00Z", closed_at: "2026-09-01T12:00:00Z",
    });
    expect(r).toMatchObject({ attended: true, reason: "PRESENT" });
    expect(r.ratio).toBe(1);
  });
});

/* ── Certificate expiry ─────────────────────────────────────────────────── */

describe("when a certificate lapses", () => {
  it("adds whole months, clamping to a shorter one", () => {
    // 31 Jan + 1 month is 28 Feb. Adding 30 days gives 2 March.
    expect(rules.certificateExpiry("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("gets the leap year right", () => {
    expect(rules.certificateExpiry("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("handles a twenty-four month ticket across two year boundaries", () => {
    expect(rules.certificateExpiry("2026-03-15", 24)).toBe("2028-03-15");
  });

  it("returns null when the qualification does not lapse", () => {
    // An induction is not a ticket.
    expect(rules.certificateExpiry("2026-03-15", null)).toBeNull();
    expect(rules.certificateExpiry("2026-03-15", 0)).toBeNull();
  });
});

/* ── Compliance ─────────────────────────────────────────────────────────── */

describe("the four states of a qualification", () => {
  const today = "2026-08-17";

  it("distinguishes never held from lapsed", () => {
    // Same operational answer, different conversation and different queue: a
    // refresher is booked, not an initial course.
    expect(rules.complianceStatus({ today }).status).toBe("NEVER");
    expect(rules.complianceStatus({ attendedOn: "2024-01-10", expiresOn: "2026-01-10", today }).status).toBe("EXPIRED");
  });

  it("flags the one state anybody can act on in time", () => {
    const r = rules.complianceStatus({ attendedOn: "2025-09-10", expiresOn: "2026-09-10", warnDays: 30, today });
    expect(r.status).toBe("EXPIRING");
    expect(r.days_remaining).toBe(24);
    // Still compliant TODAY — the point is the lead time, not a breach.
    expect(r.is_compliant).toBe(true);
  });

  it("respects the requirement's own lead time", () => {
    // A forklift assessment booked a quarter out; the same date is CURRENT
    // under a 30-day window and EXPIRING under a 90-day one.
    const args = { attendedOn: "2025-11-01", expiresOn: "2026-11-01", today };
    expect(rules.complianceStatus({ ...args, warnDays: 30 }).status).toBe("CURRENT");
    expect(rules.complianceStatus({ ...args, warnDays: 90 }).status).toBe("EXPIRING");
  });

  it("reads a certificate expiring today as zero days, not as expired", () => {
    const r = rules.complianceStatus({ attendedOn: "2025-08-17", expiresOn: today, today });
    expect(r.days_remaining).toBe(0);
    expect(r.status).toBe("EXPIRING");
  });

  it("does not let the hour of the report change the answer", () => {
    // Whole days computed on the dates, not the instants.
    const late = rules.complianceStatus({ attendedOn: "2025-08-17", expiresOn: "2026-08-18", today: "2026-08-17T23:59:00Z" });
    const early = rules.complianceStatus({ attendedOn: "2025-08-17", expiresOn: "2026-08-18", today: "2026-08-17T00:01:00Z" });
    expect(late.days_remaining).toBe(1);
    expect(early.days_remaining).toBe(1);
  });

  it("treats a non-lapsing qualification as permanently current", () => {
    expect(rules.complianceStatus({ attendedOn: "2019-01-01", expiresOn: null, today }))
      .toMatchObject({ status: "CURRENT", is_compliant: true, days_remaining: null });
  });
});

describe("who a requirement applies to", () => {
  const emp = { department: "Warehouse", job_title: "Forklift operator" };

  it("applies to everybody when neither field is set", () => {
    // "All staff must complete the annual fire briefing."
    expect(rules.requirementApplies({}, emp)).toBe(true);
  });

  it("matches a department typed with different case and stray space", () => {
    // employee.department is typed by hand.
    expect(rules.requirementApplies({ department: " warehouse " }, emp)).toBe(true);
  });

  it("narrows on job title as well", () => {
    expect(rules.requirementApplies({ department: "Warehouse", job_title: "Forklift operator" }, emp)).toBe(true);
    expect(rules.requirementApplies({ department: "Warehouse", job_title: "Picker" }, emp)).toBe(false);
  });

  it("never applies an inactive requirement", () => {
    expect(rules.requirementApplies({ is_active: false }, emp)).toBe(false);
  });

  it("does not match a set requirement against an employee with the field blank", () => {
    expect(rules.requirementApplies({ department: "Warehouse" }, { job_title: "Analyst" })).toBe(false);
  });
});
