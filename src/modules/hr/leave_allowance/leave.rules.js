/**
 * Leave arithmetic (MOD-15) — pure, deterministic, no I/O (KB §9).
 *
 * Two questions live here, and both were previously unanswerable:
 *
 *   HOW LONG IS THIS REQUEST?  Counting days between two dates sounds trivial
 *   and is not: weekends are excluded for annual leave but not for maternity,
 *   public holidays fall inside a span and must not be charged to the employee,
 *   half days at either end are the commonest real request, and a recurring
 *   holiday (1 January) has to match on month-and-day while a moveable one
 *   (Eid) matches an exact date.
 *
 *   WHAT IS THIS EMPLOYEE'S BALANCE?  The sum of signed ledger movements, split
 *   out by kind so the screen can show WHERE the number came from rather than
 *   only the number — which is the entire reason the ledger exists.
 *
 * ── DATES ARE HANDLED AS Y/M/D, NEVER AS INSTANTS ──────────────────────────
 *
 * `new Date("2026-08-16")` is midnight UTC, and asking it for `getDay()` from a
 * negative offset returns the PREVIOUS day — which turns a Monday into a
 * Sunday and silently drops it from the count. Leave is a calendar fact, not a
 * moment in time, so everything below works on integer year/month/day parsed
 * out of the ISO string and uses UTC accessors exclusively.
 */
"use strict";

/** Saturday and Sunday, as JS day numbers. A tenant working a six-day week
 *  overrides this via the `hr.weekend_days` setting. */
const DEFAULT_WEEKEND = [0, 6];

/** "2026-08-16" or a Date → { y, m, d }. Anything unparseable → null. */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-tripped through UTC so 2026-02-30 is rejected rather than rolling
  // forward into March and quietly lengthening the request.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() + 1 !== mo || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const toUtc = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d));
const iso = (date) => date.toISOString().slice(0, 10);

/**
 * Is this date a non-working day?
 *
 * `holidays` is the calendar as stored: `{ holiday_on, is_recurring }`. A
 * recurring row carries an arbitrary year (see migration 0696) and matches on
 * month and day alone; a non-recurring one matches the exact date.
 */
function isNonWorkingDay(date, { weekendDays = DEFAULT_WEEKEND, holidays = [] } = {}) {
  if (weekendDays.includes(date.getUTCDay())) return true;
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  return holidays.some((h) => {
    const p = parseDate(h.holiday_on);
    if (!p) return false;
    if (h.is_recurring) return p.m === m && p.d === d;
    return p.y === y && p.m === m && p.d === d;
  });
}

/**
 * How many days a request consumes.
 *
 * @param starts_on / ends_on  inclusive ISO dates
 * @param counts_working_days  false = calendar days run straight through
 *                             (maternity is counted in weeks and does not
 *                             pause for a Sunday)
 * @param half_day_start / half_day_end  deduct half a day at that end, but only
 *                             if that end is itself a counted day — taking the
 *                             "afternoon" of a Sunday you were never working
 *                             must not credit you half a day back
 * @returns days (0 when the span is entirely non-working), or null if the dates
 *          are missing/unparseable/reversed — the caller refuses the request
 *          rather than storing a guess.
 */
function countDays({
  starts_on,
  ends_on,
  counts_working_days = true,
  half_day_start = false,
  half_day_end = false,
  weekendDays = DEFAULT_WEEKEND,
  holidays = [],
} = {}) {
  const from = parseDate(starts_on);
  const to = parseDate(ends_on);
  if (!from || !to) return null;
  const start = toUtc(from);
  const end = toUtc(to);
  if (end < start) return null;

  const counted = [];
  for (let cur = start; cur <= end; cur = new Date(cur.getTime() + 86400000)) {
    if (counts_working_days && isNonWorkingDay(cur, { weekendDays, holidays })) continue;
    counted.push(iso(cur));
  }
  if (!counted.length) return 0;

  let days = counted.length;
  // Only when the day being halved is actually in the count — and only once
  // when the request is a single day, or "half day start + half day end" on one
  // afternoon would subtract a whole day and cost the employee nothing.
  if (half_day_start && counted[0] === iso(start)) days -= 0.5;
  if (half_day_end && counted[counted.length - 1] === iso(end) && iso(end) !== iso(start)) days -= 0.5;

  return Math.round(days * 100) / 100;
}

/**
 * Do two date ranges overlap? Inclusive at both ends — leave ending on the 5th
 * and leave starting on the 5th are the same day booked twice.
 */
function overlaps(a, b) {
  const aStart = parseDate(a.starts_on);
  const aEnd = parseDate(a.ends_on);
  const bStart = parseDate(b.starts_on);
  const bEnd = parseDate(b.ends_on);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return toUtc(aStart) <= toUtc(bEnd) && toUtc(bStart) <= toUtc(aEnd);
}

/**
 * Fold ledger rows into a balance.
 *
 * Broken out by kind rather than reduced to one figure: "you have 4 days left"
 * invites the reply "out of what?", and the answer — 18 accrued, 2 carried, 16
 * taken — is what settles it without anyone opening the database.
 *
 * `days` is signed in the table, so `taken` and `forfeited` are reported as
 * POSITIVE magnitudes here (a screen showing "Taken −16" reads as a correction)
 * while `balance` is the honest signed sum.
 */
function balanceFrom(entries = []) {
  const out = { accrued: 0, carried: 0, taken: 0, returned: 0, adjustments: 0, forfeited: 0, balance: 0 };
  for (const e of entries) {
    const days = Number(e.days) || 0;
    out.balance += days;
    switch (e.kind) {
      case "ACCRUAL": out.accrued += days; break;
      case "CARRYOVER": out.carried += days; break;
      case "TAKEN": out.taken += -days; break;
      case "RETURNED": out.returned += days; break;
      case "ADJUSTMENT": out.adjustments += days; break;
      case "FORFEIT": out.forfeited += -days; break;
      default: break;
    }
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/**
 * Months of service accrued within one calendar year, for the accrual job.
 *
 * A hire on the 20th does not earn that month: the statutory rate is "per month
 * of service", and crediting a full month for eleven days of it is a gift the
 * employer did not make. A month is earned once the employee has been there for
 * the whole of it, so joining on the 1st counts and joining on the 2nd does not.
 *
 * @returns the list of { year, month } to post, oldest first.
 */
function accrualMonths({ hired_on, upto, year } = {}) {
  const hired = parseDate(hired_on);
  const end = parseDate(upto);
  if (!end) return [];
  const y = year || end.y;
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    // The month must be over (or be the current one, fully served) …
    if (y > end.y || (y === end.y && m > end.m)) break;
    // … and the employee must have been employed from its first day.
    if (hired) {
      if (y < hired.y) continue;
      if (y === hired.y && (m < hired.m || (m === hired.m && hired.d > 1))) continue;
    }
    months.push({ year: y, month: m });
  }
  return months;
}

module.exports = {
  DEFAULT_WEEKEND,
  parseDate,
  isNonWorkingDay,
  countDays,
  overlaps,
  balanceFrom,
  accrualMonths,
};
