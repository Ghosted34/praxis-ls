/**
 * Expected working day for attendance (PR1).
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 *
 * Reconciliation used to decide "is this person expected today?" from
 * `employee.work_days` or the tenant `hr.weekend_days` setting, plus
 * `public_holiday`. The rest of the product already has a better answer: the
 * corporate **working calendar** (opens/closes per weekday, entity timezone,
 * entity holidays), which the milestone engine uses so a Douala yard and an
 * N'Djamena office are not the same week.
 *
 * Attendance that ignores that calendar marks Saturday absent for a Mon–Sat
 * yard and charges people for a day nobody asked them to work — or worse,
 * fails to charge a real working Saturday. One resolver, used by the
 * reconciler and (later) analytics, is the only way those answers stay the
 * same.
 *
 * ── PRECEDENCE ──────────────────────────────────────────────────────────────
 *
 *   1. Employee override (`work_days`, `expected_start_time`, `grace_minutes`)
 *      when set — a driver on Tue–Sat is not the office week.
 *   2. The entity working calendar (own, or inherited tenant default — same
 *      read as `corporate_entity.calendar.get`).
 *   3. Tenant `hr.weekend_days` + `hr.attendance_policy` + `public_holiday`.
 *
 * Holidays: an entity with its OWN calendar is the authority (entity holidays
 * only). An inherited calendar still UNIONS tenant `public_holiday` so a
 * national day is not dropped because nobody copied it onto the default.
 *
 * `decideExpected` is PURE. I/O lives in `loadContext`.
 */
"use strict";

const entityCalendar = require("../../master/corporate_entity/corporate_entity.calendar");
const { getSetting } = require("../../../shared/config/settings");
const leaveRules = require("../leave_allowance/leave.rules");
const rules = require("./attendance.rules");

const pad = (n) => String(n).padStart(2, "0");

/** "07:30:00" / "07:30" → "07:30" for the lateness parser. */
function hhmm(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!m) return null;
  return `${pad(Number(m[1]))}:${m[2]}`;
}

function weekdayOf(isoDate) {
  const p = leaveRules.parseDate(isoDate);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

function holidayMatches(isoDate, holidays, dateKey) {
  const p = leaveRules.parseDate(isoDate);
  if (!p || !Array.isArray(holidays)) return false;
  return holidays.some((h) => {
    const raw = h[dateKey] ?? h.holiday_date ?? h.holiday_on;
    const hp = leaveRules.parseDate(raw);
    if (!hp) return false;
    if (h.is_recurring) return hp.m === p.m && hp.d === p.d;
    return hp.y === p.y && hp.m === p.m && hp.d === p.d;
  });
}

/**
 * Decide what this ISO date is for one employee.
 *
 * @returns {{
 *   weekday: number|null,
 *   isWorkingDay: boolean,
 *   isHoliday: boolean,
 *   expectedStart: string,
 *   graceMinutes: number,
 *   timezone: string,
 *   source: 'employee'|'entity'|'tenant',
 * }}
 */
function decideExpected({
  isoDate,
  workDays = null,
  expectedStart = null,
  graceMinutes = null,
  calendar = null,
  publicHolidays = [],
  weekendDays = [0, 6],
  policyStart = "08:00",
  policyGrace = 10,
  fallbackTimezone = "Africa/Douala",
} = {}) {
  const weekday = weekdayOf(isoDate);
  const timezone = (calendar && calendar.timezone) || fallbackTimezone;
  const ownCalendar = !!(calendar && calendar.inherited === false);
  const calDays = (calendar && calendar.days) || [];
  const calHolidays = (calendar && calendar.holidays) || [];

  const entityHoliday = holidayMatches(isoDate, calHolidays, "holiday_date");
  const publicHoliday = holidayMatches(isoDate, publicHolidays, "holiday_on");
  // Own calendar is the authority. Inherited still unions the tenant list so a
  // national day is not lost because nobody copied it onto the default.
  const isHoliday = ownCalendar ? entityHoliday : (entityHoliday || publicHoliday);

  const openDay = calDays.find((d) => Number(d.weekday) === weekday);
  const hasEmployeeDays = Array.isArray(workDays) && workDays.length > 0;

  let isWorkingDay;
  let source;
  if (hasEmployeeDays) {
    isWorkingDay = workDays.map(Number).includes(Number(weekday));
    source = "employee";
  } else if (calendar && calDays.length) {
    isWorkingDay = !!openDay;
    source = "entity";
  } else {
    isWorkingDay = rules.isWorkingDay(weekday, { weekendDays });
    source = "tenant";
  }

  const start = hhmm(expectedStart) || (openDay && hhmm(openDay.opens_at)) || hhmm(policyStart) || "08:00";
  const grace = graceMinutes === null || graceMinutes === undefined
    ? Number(policyGrace)
    : Number(graceMinutes);

  return {
    weekday,
    isWorkingDay: !!isWorkingDay && weekday !== null,
    isHoliday,
    expectedStart: start,
    graceMinutes: Number.isFinite(grace) ? grace : 10,
    timezone,
    source,
  };
}

/** Working days in a calendar month under the same resolver as the day itself. */
function workingDaysInMonth(year, month, decide) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d += 1) {
    const iso = `${year}-${pad(month)}-${pad(d)}`;
    const exp = decide(iso);
    if (exp.isWorkingDay && !exp.isHoliday) n += 1;
  }
  return n;
}

/**
 * Load calendars + tenant fallbacks once per reconcile pass.
 *
 * One `get` per distinct entity_id (plus a null-entity read for people with
 * no entity). A 300-person roster in two companies is two calendar reads, not
 * 300 — the old path already batched punches and leave for the same reason.
 */
async function loadContext(client, { entityIds = [] } = {}) {
  const [policyRaw, weekendRaw, tzRaw, holidaysRes] = await Promise.all([
    getSetting(client, "hr", "attendance_policy", null),
    getSetting(client, "hr", "weekend_days", null),
    getSetting(client, "hr", "timezone", "Africa/Douala"),
    client.query("SELECT holiday_on, is_recurring FROM public_holiday WHERE is_active"),
  ]);
  const policy = policyRaw || {};
  const list = Array.isArray(weekendRaw) ? weekendRaw : weekendRaw && Array.isArray(weekendRaw.days) ? weekendRaw.days : null;
  const weekendDays = (list || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const fallbackTimezone = typeof tzRaw === "string" && tzRaw.trim() ? tzRaw.trim() : "Africa/Douala";

  const ids = [...new Set((entityIds || []).filter(Boolean))];
  const byEntity = new Map();
  const unique = ids.length ? ids : [null];
  await Promise.all(unique.map(async (id) => {
    try {
      const cal = await entityCalendar.get(client, id);
      if (id) byEntity.set(id, cal);
      else byEntity.set(null, cal);
    } catch {
      // A missing calendar must not stop the reconciler. decideExpected falls
      // back to tenant weekend + policy.
      if (id) byEntity.set(id, null);
      else byEntity.set(null, null);
    }
  }));
  // People whose entity was not in the list still inherit the tenant default.
  if (!byEntity.has(null)) {
    try {
      byEntity.set(null, await entityCalendar.get(client, null));
    } catch {
      byEntity.set(null, null);
    }
  }

  return {
    policyStart: typeof policy.work_start === "string" && policy.work_start ? policy.work_start : "08:00",
    policyGrace: Number.isFinite(Number(policy.grace_minutes)) ? Number(policy.grace_minutes) : 10,
    weekendDays: weekendDays.length ? weekendDays : [0, 6],
    fallbackTimezone,
    publicHolidays: holidaysRes.rows,
    calendarFor: (entityId) => byEntity.get(entityId) || byEntity.get(null) || null,
  };
}

function forEmployee(ctx, emp, isoDate) {
  return decideExpected({
    isoDate,
    workDays: emp.work_days,
    expectedStart: emp.expected_start_time,
    graceMinutes: emp.grace_minutes,
    calendar: ctx.calendarFor(emp.entity_id),
    publicHolidays: ctx.publicHolidays,
    weekendDays: ctx.weekendDays,
    policyStart: ctx.policyStart,
    policyGrace: ctx.policyGrace,
    fallbackTimezone: ctx.fallbackTimezone,
  });
}

module.exports = {
  hhmm,
  weekdayOf,
  decideExpected,
  workingDaysInMonth,
  loadContext,
  forEmployee,
};
