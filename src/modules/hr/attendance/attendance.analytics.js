/**
 * Attendance analytics (PR2) — PURE. Rows in, numbers out. No client, no query.
 *
 * ── WHY IT IS PURE ─────────────────────────────────────────────────────────
 *
 * These are the figures a manager acts on and an employee disputes: a
 * punctuality percentage that is wrong by one day is an argument, and one that
 * cannot be reproduced in a unit test is an argument nobody can settle. Every
 * fact arrives as an argument so the whole thing tests against fixtures.
 *
 * ── EXPECTED WORKING DAYS COME FROM `attendance.calendar`, OR NOT AT ALL ────
 *
 * This module NEVER decides whether a date is a working day. It cannot: that
 * answer depends on the employee override, the entity working calendar and the
 * tenant weekend, and PR1 put all three behind one resolver precisely so a
 * second opinion could not exist. The caller passes `expectedFor(employeeId,
 * isoDate)` — built from `attendance.calendar.forEmployee` — and without it
 * every expected-day figure is reported as `null` rather than guessed.
 *
 * Guessing from the reconciled STATUS would be the tempting shortcut and it is
 * wrong: `reconcileDay` records a punch on a non-working day as PRESENT (see
 * attendance.rules.js:171), so "PRESENT" does not mean "was expected" and a
 * Saturday shift would silently inflate the denominator of every rate here.
 *
 * ── WHY SOME RATES ARE `null` AND NOT `0` ──────────────────────────────────
 *
 * A percentage over an empty denominator is not zero, it is unknown. A new
 * employee with no attended days has no punctuality; a tenant with no worksite
 * has no on-site rate. Reporting 0% would read as "never on time" and 100% as
 * "flawless", and both are inventions. `null` is what the UI renders as "—".
 */
"use strict";

const { weekdayOf } = require("./attendance.calendar");
const { locationStatus } = require("./attendance.location");

/** Statuses that mean the person turned up. NOT the same as "was expected". */
const ATTENDED = new Set(["PRESENT", "LATE"]);
/** Statuses that mean the day was not owed as work. */
const NOT_WORKED = new Set(["ON_LEAVE", "HOLIDAY", "WEEKEND", "OFF"]);

const pad = (n) => String(n).padStart(2, "0");
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/** A rate, or null when nothing was measured. See the header. */
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : null);

/** YYYY-MM-DD → epoch ms at UTC midnight, or null. */
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

function isoOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Every ISO date in [from, to] inclusive.
 *
 * BOUNDED, and deliberately so. The validator caps the window at 366 days, but
 * this loop is also reachable from a job and from a test, and an unbounded
 * `while (t <= end)` over a mistyped year is a hung request rather than a bad
 * answer. A reversed pair yields nothing instead of looping forever.
 */
function eachDate(from, to, cap = 400) {
  const start = parseIso(from);
  const end = parseIso(to);
  if (start === null || end === null || end < start) return [];
  const out = [];
  for (let t = start; t <= end && out.length < cap; t += 86400000) out.push(isoOf(t));
  return out;
}

/** Hours between two instants, or 0 when either is missing or out of order. */
function hoursBetween(inAt, outAt) {
  if (!inAt || !outAt) return 0;
  const a = new Date(inAt).getTime();
  const b = new Date(outAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 3600000;
}

/** One accumulator — the same shape for the window, a department and a person,
 *  so the UI renders a rollup row and a compare row with one component. */
function emptyTotals() {
  return {
    employees: 0,
    expected_days: 0,
    reconciled_days: 0,
    attended_days: 0,
    present_days: 0,
    late_days: 0,
    absent_days: 0,
    on_leave_days: 0,
    holiday_days: 0,
    off_days: 0,
    days_off: 0,
    minutes_late: 0,
    hours_worked: 0,
    deduction_total: 0,
    waived_total: 0,
    punches: 0,
    on_site_punches: 0,
    off_site_punches: 0,
    no_gps_punches: 0,
    unfenced_punches: 0,
  };
}

/** Count one reconciled day into a bucket. */
function addDay(t, day) {
  const status = String(day.status || "").toUpperCase();
  t.reconciled_days += 1;
  if (ATTENDED.has(status)) t.attended_days += 1;
  if (status === "PRESENT") t.present_days += 1;
  if (status === "LATE") t.late_days += 1;
  if (status === "ABSENT") t.absent_days += 1;
  if (status === "ON_LEAVE") t.on_leave_days += 1;
  if (status === "HOLIDAY") t.holiday_days += 1;
  if (status === "WEEKEND" || status === "OFF") t.off_days += 1;
  if (NOT_WORKED.has(status)) t.days_off += 1;
  t.minutes_late += num(day.minutes_late);
  // Waived money is NOT charged money. Keeping the two apart is the whole
  // point of a waiver keeping its figure (0697): payroll reads `deduction_total`
  // and a manager reads `waived_total` to see what forgiveness costs.
  if (day.justified) t.waived_total += num(day.deduction_amount);
  else t.deduction_total += num(day.deduction_amount);
}

/** Count one punch into a bucket. */
function addPunch(t, punch) {
  t.punches += 1;
  const where = punch.location_status || locationStatus(punch);
  if (where === "on_site") t.on_site_punches += 1;
  else if (where === "off_site") t.off_site_punches += 1;
  else if (where === "no_gps") t.no_gps_punches += 1;
  else t.unfenced_punches += 1;
}

/**
 * Close a bucket: derive the rates and round the sums.
 *
 * `punctuality_pct` is on-time days over ATTENDED days, not over expected days.
 * The two readings are genuinely different questions and folding them into one
 * number makes it answer neither: "of the days you worked, how many did you
 * start on time" is punctuality, and "of the days you were expected, how many
 * did you work" is `attendance_pct`, reported beside it. An absence is not a
 * late arrival, and it is already its own KPI.
 *
 * `on_site_pct` counts only punches a geofence could actually judge. A punch
 * with no fix, or one taken by a tenant that has not placed a worksite, is not
 * evidence of being off-site — counting either as a miss would make the figure
 * say "people are working elsewhere" when it means "we did not look".
 */
function seal(t) {
  const judged = t.on_site_punches + t.off_site_punches;
  return {
    ...t,
    hours_worked: round2(t.hours_worked),
    deduction_total: round2(t.deduction_total),
    waived_total: round2(t.waived_total),
    punctuality_pct: pct(t.present_days, t.attended_days),
    attendance_pct: t.expected_days > 0 ? pct(t.attended_days, t.expected_days) : null,
    absence_pct: t.expected_days > 0 ? pct(t.absent_days, t.expected_days) : null,
    on_site_pct: pct(t.on_site_punches, judged),
  };
}

/** The roster in scope: whoever was passed, else whoever appears in the rows. */
function rosterOf(employees, days, punches) {
  const by = new Map();
  const put = (id, name, department, entity) => {
    if (!id) return;
    const seen = by.get(id);
    if (seen) {
      if (!seen.employee_name && name) seen.employee_name = name;
      if (!seen.department && department) seen.department = department;
      return;
    }
    by.set(id, {
      employee_id: id,
      employee_name: name || null,
      department: department || null,
      entity_id: entity || null,
    });
  };
  for (const e of employees) put(e.employee_id, e.full_name || e.employee_name, e.department, e.entity_id);
  for (const d of days) put(d.employee_id, d.employee_name, d.department, d.entity_id);
  for (const p of punches) put(p.employee_id, p.employee_name, p.department, p.entity_id);
  return [...by.values()];
}

const DEPT_UNSET = "—";
const keyOf = (employeeId, isoDate) => `${employeeId}|${isoDate}`;

/**
 * Summarize a window.
 *
 * @param {Object}   opts
 * @param {string}   opts.from        ISO date, inclusive.
 * @param {string}   opts.to          ISO date, inclusive.
 * @param {Object[]} [opts.days]      `attendance_day` rows (reconcile.daysFor).
 * @param {Object[]} [opts.punches]   `attendance_log` rows. `work_date` (the
 *                                    LOCAL date, resolved by the caller — never
 *                                    `clock_in_at::date`) buckets a punch onto
 *                                    a day; without it the punch still counts
 *                                    toward the location split.
 * @param {Object[]} [opts.employees] Roster in scope. Lets a person with no
 *                                    rows at all still appear, with their
 *                                    expected days counted — which is what
 *                                    makes a full month of absence visible.
 * @param {Function} [opts.expectedFor] `(employeeId, isoDate) => expected` from
 *                                    `attendance.calendar`. See the header.
 * @returns {{window, kpis, heatmap, byDepartment, byEmployee}}
 */
function summarize({ from, to, days = [], punches = [], employees = [], expectedFor = null } = {}) {
  const dates = eachDate(from, to);
  const roster = rosterOf(employees, days, punches);
  const knowsExpected = typeof expectedFor === "function";

  const total = emptyTotals();
  const byEmployee = new Map();
  const byDepartment = new Map();

  const bucketFor = (employeeId) => {
    if (!byEmployee.has(employeeId)) {
      const who = roster.find((r) => r.employee_id === employeeId) || { employee_id: employeeId };
      byEmployee.set(employeeId, {
        employee_id: employeeId,
        employee_name: who.employee_name || null,
        department: who.department || null,
        ...emptyTotals(),
        employees: 1,
      });
    }
    return byEmployee.get(employeeId);
  };
  const deptFor = (name) => {
    const key = name || DEPT_UNSET;
    if (!byDepartment.has(key)) {
      byDepartment.set(key, { department: key, ...emptyTotals() });
    }
    return byDepartment.get(key);
  };

  // Seed a bucket for everyone in scope, so a person with nothing recorded is
  // a row of zeroes rather than a missing row — "no data" and "never turned up"
  // must not look the same on a compare table.
  for (const r of roster) {
    bucketFor(r.employee_id);
    deptFor(r.department).employees += 1;
  }
  total.employees = roster.length;

  // ── Expected working days, from the calendar resolver only ──
  const expectedKeys = new Set();
  const expectedPerDate = new Map();
  if (knowsExpected) {
    for (const r of roster) {
      for (const iso of dates) {
        let exp = null;
        try {
          exp = expectedFor(r.employee_id, iso);
        } catch {
          // One unusable employee must not blank the whole report. The day is
          // simply not counted as expected, which is what an unknown calendar
          // honestly means.
          exp = null;
        }
        if (!exp || !exp.isWorkingDay || exp.isHoliday) continue;
        expectedKeys.add(keyOf(r.employee_id, iso));
        expectedPerDate.set(iso, (expectedPerDate.get(iso) || 0) + 1);
        total.expected_days += 1;
        bucketFor(r.employee_id).expected_days += 1;
        deptFor(r.department).expected_days += 1;
      }
    }
  }

  // ── Reconciled days ──
  const cells = new Map();
  for (const iso of dates) {
    cells.set(iso, {
      date: iso,
      weekday: weekdayOf(iso),
      expected: knowsExpected ? expectedPerDate.get(iso) || 0 : null,
      reconciled: 0,
      present: 0,
      late: 0,
      absent: 0,
      on_leave: 0,
      holiday: 0,
      off: 0,
      minutes_late: 0,
      hours_worked: 0,
      status: null,
    });
  }

  const dayCovered = new Set();
  for (const day of days) {
    const iso = String(day.work_date || "").slice(0, 10);
    const cell = cells.get(iso);
    // A row outside the asked-for window is not this report's business. It can
    // arrive from a caller reusing a wider fetch, and counting it would make the
    // KPIs disagree with the heatmap they sit above.
    if (!cell) continue;
    const emp = bucketFor(day.employee_id);
    const dept = deptFor(emp.department);
    const status = String(day.status || "").toUpperCase();

    addDay(total, day);
    addDay(emp, day);
    addDay(dept, day);

    const hours = hoursBetween(day.first_clock_in_at, day.last_clock_out_at);
    total.hours_worked += hours;
    emp.hours_worked += hours;
    dept.hours_worked += hours;
    if (day.employee_id) dayCovered.add(keyOf(day.employee_id, iso));

    cell.reconciled += 1;
    if (status === "PRESENT") cell.present += 1;
    if (status === "LATE") cell.late += 1;
    if (status === "ABSENT") cell.absent += 1;
    if (status === "ON_LEAVE") cell.on_leave += 1;
    if (status === "HOLIDAY") cell.holiday += 1;
    if (status === "WEEKEND" || status === "OFF") cell.off += 1;
    cell.minutes_late += num(day.minutes_late);
    cell.hours_worked += hours;
    // One person in scope means the heatmap is that person's calendar, and a
    // cell can carry the status itself rather than a count of one.
    cell.status = roster.length === 1 ? status : null;
  }

  // ── Punches ──
  for (const punch of punches) {
    const emp = bucketFor(punch.employee_id);
    const dept = deptFor(emp.department);
    addPunch(total, punch);
    addPunch(emp, punch);
    addPunch(dept, punch);

    const iso = punch.work_date ? String(punch.work_date).slice(0, 10) : null;
    if (!iso || !cells.has(iso)) continue;
    // Hours from the punch ONLY where no reconciled day covers it. The
    // reconciler already folded the punch into the day; adding both would
    // double-count every completed shift in the window.
    if (punch.employee_id && dayCovered.has(keyOf(punch.employee_id, iso))) continue;
    const hours = hoursBetween(punch.clock_in_at, punch.clock_out_at);
    if (!hours) continue;
    total.hours_worked += hours;
    emp.hours_worked += hours;
    dept.hours_worked += hours;
    cells.get(iso).hours_worked += hours;
  }

  const heatmap = dates.map((iso) => {
    const c = cells.get(iso);
    return { ...c, hours_worked: round2(c.hours_worked) };
  });

  return {
    window: { from, to, days: dates.length },
    kpis: seal(total),
    heatmap,
    byDepartment: [...byDepartment.values()]
      .map(seal)
      .sort((a, b) => String(a.department).localeCompare(String(b.department))),
    byEmployee: [...byEmployee.values()]
      .map(seal)
      .sort((a, b) => String(a.employee_name || "").localeCompare(String(b.employee_name || ""))),
    expected_source: knowsExpected ? "calendar" : null,
  };
}

module.exports = {
  summarize,
  eachDate,
  hoursBetween,
  emptyTotals,
  seal,
  ATTENDED,
  NOT_WORKED,
};
