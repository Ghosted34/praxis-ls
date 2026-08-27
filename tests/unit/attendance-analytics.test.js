"use strict";
/**
 * The analytics summarizer (PR2) — the KPI arithmetic, against fixtures.
 *
 * WHAT THESE PIN, and why each one is a bug somebody would otherwise ship:
 *
 *   · Expected working days come from the CALENDAR resolver and from nothing
 *     else. `reconcileDay` records a punch on a non-working day as PRESENT, so
 *     inferring "was expected" from the status inflates the denominator of
 *     every rate by however much weekend work the team does.
 *   · A WAIVED day is not a charged day. The waiver keeps its figure (0697), so
 *     a summarizer that just sums `deduction_amount` reports money nobody owes.
 *   · A rate over an empty denominator is null, not 0 and not 100.
 *   · An employee with no rows at all is a row of zeroes, not a missing row.
 */

const {
  summarize,
  eachDate,
  hoursBetween,
} = require("../../src/modules/hr/attendance/attendance.analytics");

const ADA = "11111111-1111-1111-1111-111111111111";
const BOLA = "22222222-2222-2222-2222-222222222222";

const MON = "2026-08-03";
const TUE = "2026-08-04";
const WED = "2026-08-05";
const SAT = "2026-08-01";

const roster = [
  { employee_id: ADA, full_name: "Ada", department: "Operations", entity_id: "e1" },
  { employee_id: BOLA, full_name: "Bola", department: "Finance", entity_id: "e1" },
];

/** Mon–Fri, nothing else. Stands in for `calendar.forEmployee`. */
const monFri = (_employeeId, isoDate) => {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return { isWorkingDay: day >= 1 && day <= 5, isHoliday: false };
};

describe("eachDate", () => {
  it("is inclusive at both ends", () => {
    expect(eachDate(MON, WED)).toEqual([MON, TUE, WED]);
  });
  it("yields nothing for a reversed pair rather than looping", () => {
    expect(eachDate(WED, MON)).toEqual([]);
  });
  it("is bounded, so a mistyped year is a short answer and not a hung request", () => {
    expect(eachDate("2026-01-01", "2999-01-01").length).toBe(400);
  });
});

describe("hoursBetween", () => {
  it("measures a shift", () => {
    expect(hoursBetween("2026-08-03T07:00:00Z", "2026-08-03T16:30:00Z")).toBe(9.5);
  });
  it("is 0 when the shift never closed, rather than counting to now", () => {
    expect(hoursBetween("2026-08-03T07:00:00Z", null)).toBe(0);
  });
  it("is 0 when the pair is out of order, rather than negative hours", () => {
    expect(hoursBetween("2026-08-03T16:00:00Z", "2026-08-03T07:00:00Z")).toBe(0);
  });
});

describe("expected working days", () => {
  it("counts them from the calendar resolver, per employee per date", () => {
    // Sat 1 Aug → Wed 5 Aug is 5 dates; Mon/Tue/Wed are working, ×2 people.
    const out = summarize({ from: SAT, to: WED, employees: roster, expectedFor: monFri });
    expect(out.kpis.expected_days).toBe(6);
    expect(out.expected_source).toBe("calendar");
  });

  it("does NOT infer them from the status — a Saturday punch is PRESENT, not expected", () => {
    const out = summarize({
      from: SAT,
      to: SAT,
      employees: [roster[0]],
      expectedFor: monFri,
      days: [{ employee_id: ADA, work_date: SAT, status: "PRESENT", minutes_late: 0 }],
    });
    // The person turned up and it counts as attendance; it was still not a day
    // anybody expected of them, so it must not enter the expected denominator.
    expect(out.kpis.attended_days).toBe(1);
    expect(out.kpis.expected_days).toBe(0);
    expect(out.kpis.attendance_pct).toBeNull();
  });

  it("reports null rather than a guess when no resolver is supplied", () => {
    const out = summarize({
      from: MON,
      to: MON,
      employees: [roster[0]],
      days: [{ employee_id: ADA, work_date: MON, status: "LATE", minutes_late: 20 }],
    });
    expect(out.kpis.expected_days).toBe(0);
    expect(out.kpis.attendance_pct).toBeNull();
    expect(out.expected_source).toBeNull();
  });
});

describe("KPI arithmetic", () => {
  const days = [
    { employee_id: ADA, work_date: MON, status: "PRESENT", minutes_late: 0, deduction_amount: 0, first_clock_in_at: "2026-08-03T07:00:00Z", last_clock_out_at: "2026-08-03T16:00:00Z" },
    { employee_id: ADA, work_date: TUE, status: "LATE", minutes_late: 25, deduction_amount: 5000, first_clock_in_at: "2026-08-04T08:25:00Z", last_clock_out_at: "2026-08-04T16:00:00Z" },
    { employee_id: ADA, work_date: WED, status: "ABSENT", minutes_late: 0, deduction_amount: 22000 },
    { employee_id: BOLA, work_date: MON, status: "ON_LEAVE", minutes_late: 0, deduction_amount: 0 },
    { employee_id: BOLA, work_date: TUE, status: "LATE", minutes_late: 10, deduction_amount: 3000, justified: true },
    { employee_id: BOLA, work_date: WED, status: "PRESENT", minutes_late: 0, deduction_amount: 0, first_clock_in_at: "2026-08-05T07:30:00Z", last_clock_out_at: "2026-08-05T15:30:00Z" },
  ];
  const out = summarize({ from: MON, to: WED, days, employees: roster, expectedFor: monFri });

  it("counts each status once", () => {
    expect(out.kpis.present_days).toBe(2);
    expect(out.kpis.late_days).toBe(2);
    expect(out.kpis.absent_days).toBe(1);
    expect(out.kpis.on_leave_days).toBe(1);
    expect(out.kpis.attended_days).toBe(4);
  });

  it("counts leave, holidays and non-working days as days off", () => {
    expect(out.kpis.days_off).toBe(1);
  });

  it("reads punctuality over ATTENDED days, not over expected days", () => {
    // 2 on time of 4 attended. Absence is its own KPI and must not be folded in.
    expect(out.kpis.punctuality_pct).toBe(50);
  });

  it("reads attendance separately, over expected days", () => {
    expect(out.kpis.expected_days).toBe(6);
    expect(out.kpis.attendance_pct).toBe(66.7);
  });

  it("sums minutes late", () => {
    expect(out.kpis.minutes_late).toBe(35);
  });

  it("sums hours from in/out", () => {
    // 9h (Ada Mon) + 7h35 (Ada Tue, a late start is a shorter day) + 8h (Bola Wed).
    // The ABSENT and ON_LEAVE rows have no in/out and contribute nothing.
    expect(out.kpis.hours_worked).toBe(24.58);
  });

  it("EXCLUDES a waived day from the charged total and reports it separately", () => {
    expect(out.kpis.deduction_total).toBe(27000);
    expect(out.kpis.waived_total).toBe(3000);
  });
});

describe("on-site rate", () => {
  const punch = (over) => ({ employee_id: ADA, clock_in_at: "2026-08-03T07:00:00Z", ...over });

  it("counts only punches a geofence could judge", () => {
    const out = summarize({
      from: MON,
      to: MON,
      employees: [roster[0]],
      expectedFor: monFri,
      punches: [
        punch({ location_source: "gps", within_geofence: true }),
        punch({ location_source: "gps", within_geofence: true }),
        punch({ location_source: "gps", within_geofence: false }),
        // No fix, and a fix with no worksite to judge it against. Neither is
        // evidence of being elsewhere.
        punch({ location_source: "none" }),
        punch({ location_source: "gps", latitude: 4, longitude: 9, within_geofence: null }),
      ],
    });
    expect(out.kpis.punches).toBe(5);
    expect(out.kpis.on_site_punches).toBe(2);
    expect(out.kpis.off_site_punches).toBe(1);
    expect(out.kpis.no_gps_punches).toBe(1);
    expect(out.kpis.unfenced_punches).toBe(1);
    expect(out.kpis.on_site_pct).toBe(66.7);
  });

  it("is null, not 0%, when nothing could be judged", () => {
    const out = summarize({
      from: MON,
      to: MON,
      employees: [roster[0]],
      expectedFor: monFri,
      punches: [punch({ location_source: "none" })],
    });
    expect(out.kpis.on_site_pct).toBeNull();
  });
});

describe("hours from punches", () => {
  it("uses a punch only where no reconciled day already covers that date", () => {
    const out = summarize({
      from: MON,
      to: TUE,
      employees: [roster[0]],
      expectedFor: monFri,
      days: [{ employee_id: ADA, work_date: MON, status: "PRESENT", first_clock_in_at: "2026-08-03T07:00:00Z", last_clock_out_at: "2026-08-03T15:00:00Z" }],
      punches: [
        // Same day as the reconciled row — already counted, must not double.
        { employee_id: ADA, work_date: MON, clock_in_at: "2026-08-03T07:00:00Z", clock_out_at: "2026-08-03T15:00:00Z" },
        // Tuesday has no reconciled row yet (today, or the job has not run).
        { employee_id: ADA, work_date: TUE, clock_in_at: "2026-08-04T07:00:00Z", clock_out_at: "2026-08-04T12:00:00Z" },
      ],
    });
    expect(out.kpis.hours_worked).toBe(13);
  });
});

describe("heatmap", () => {
  const out = summarize({
    from: SAT,
    to: MON,
    employees: roster,
    expectedFor: monFri,
    days: [
      { employee_id: ADA, work_date: MON, status: "LATE", minutes_late: 15 },
      { employee_id: BOLA, work_date: MON, status: "ABSENT", minutes_late: 0 },
    ],
  });

  it("has one cell per date in the window, reconciled or not", () => {
    expect(out.heatmap.map((c) => c.date)).toEqual([SAT, "2026-08-02", MON]);
  });

  it("carries how many people were expected on each date", () => {
    expect(out.heatmap[0].expected).toBe(0); // Saturday
    expect(out.heatmap[2].expected).toBe(2); // Monday, both of them
  });

  it("counts the statuses on the cell", () => {
    expect(out.heatmap[2]).toMatchObject({ late: 1, absent: 1, reconciled: 2, minutes_late: 15 });
  });

  it("carries the status itself when exactly one person is in scope", () => {
    const one = summarize({
      from: MON,
      to: MON,
      employees: [roster[0]],
      expectedFor: monFri,
      days: [{ employee_id: ADA, work_date: MON, status: "LATE", minutes_late: 15 }],
    });
    expect(one.heatmap[0].status).toBe("LATE");
    // …and not when several are, because "the status" is then a fiction.
    expect(out.heatmap[2].status).toBeNull();
  });

  it("ignores a day row outside the window rather than counting it", () => {
    const out2 = summarize({
      from: MON,
      to: MON,
      employees: [roster[0]],
      expectedFor: monFri,
      days: [
        { employee_id: ADA, work_date: MON, status: "PRESENT" },
        { employee_id: ADA, work_date: "2026-07-30", status: "ABSENT", deduction_amount: 9999 },
      ],
    });
    expect(out2.kpis.reconciled_days).toBe(1);
    expect(out2.kpis.absent_days).toBe(0);
    expect(out2.kpis.deduction_total).toBe(0);
  });
});

describe("compare rows", () => {
  const out = summarize({
    from: MON,
    to: TUE,
    employees: roster,
    expectedFor: monFri,
    days: [
      { employee_id: ADA, work_date: MON, status: "LATE", minutes_late: 30, deduction_amount: 5000 },
      { employee_id: ADA, work_date: TUE, status: "PRESENT", minutes_late: 0 },
      { employee_id: BOLA, work_date: MON, status: "PRESENT", minutes_late: 0 },
      { employee_id: BOLA, work_date: TUE, status: "PRESENT", minutes_late: 0 },
    ],
  });

  it("gives one row per employee, with the same shape as the window totals", () => {
    expect(out.byEmployee.map((r) => r.employee_name)).toEqual(["Ada", "Bola"]);
    const ada = out.byEmployee.find((r) => r.employee_id === ADA);
    expect(ada).toMatchObject({ late_days: 1, present_days: 1, expected_days: 2, punctuality_pct: 50, deduction_total: 5000 });
    expect(out.byEmployee.find((r) => r.employee_id === BOLA).punctuality_pct).toBe(100);
  });

  it("rolls up by department", () => {
    expect(out.byDepartment.map((d) => d.department)).toEqual(["Finance", "Operations"]);
    expect(out.byDepartment.find((d) => d.department === "Operations")).toMatchObject({
      employees: 1, late_days: 1, minutes_late: 30,
    });
  });

  it("gives an employee with no rows a row of zeroes, not absence from the table", () => {
    const out2 = summarize({ from: MON, to: TUE, employees: roster, expectedFor: monFri });
    expect(out2.byEmployee).toHaveLength(2);
    expect(out2.byEmployee[0]).toMatchObject({ reconciled_days: 0, expected_days: 2, punctuality_pct: null });
  });

  it("buckets people with no department under one heading rather than dropping them", () => {
    const out2 = summarize({
      from: MON,
      to: MON,
      employees: [{ employee_id: ADA, full_name: "Ada", department: null }],
      expectedFor: monFri,
      days: [{ employee_id: ADA, work_date: MON, status: "PRESENT" }],
    });
    expect(out2.byDepartment).toHaveLength(1);
    expect(out2.byDepartment[0].present_days).toBe(1);
  });
});
