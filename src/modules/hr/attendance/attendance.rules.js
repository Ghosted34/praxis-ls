/**
 * Attendance & house-rule arithmetic (MOD-14 / 0697) — pure, no I/O.
 *
 * ── THE TIMEZONE BUG THIS FIXES ────────────────────────────────────────────
 *
 * The old `lateness()` did this:
 *
 *     const d = new Date(clockInAt);
 *     const mins = d.getHours() * 60 + d.getMinutes();  // server-local
 *
 * `getHours()` reads the SERVER's clock. Deployed on a UTC host — which is
 * every container we run — a Cameroonian employee (UTC+1) clocking in at 08:30
 * local reads as 07:30, i.e. half an hour EARLY against an 08:00 start. Nobody
 * was ever late, and the one time somebody was, the figure was an hour out. The
 * comment beside it said "(tz caveat)".
 *
 * Everything here takes the workplace timezone explicitly and reads the wall
 * clock in it via Intl, which is the only way to be right across DST and across
 * whatever the host happens to be set to.
 *
 * ── WHY THE DEDUCTION IS A TIER LOOKUP AND NOT A FORMULA ───────────────────
 *
 * "10% per hour late" sounds cleaner and is not what anybody's staff handbook
 * says. Real policies are stepped and they stop — 1h/2h/3h, and past three
 * hours it is a disciplinary matter rather than a bigger number. A tier list is
 * what a tenant can read back and recognise as their own rule.
 */
"use strict";

/** Round to 2dp the way money is rounded everywhere else in the product. */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The wall clock at an instant, in a named timezone.
 *
 * @returns { y, m, d, minutes } — minutes since local midnight, or null if the
 *          instant or the zone is unusable. A bad zone falls back to UTC rather
 *          than throwing: a mis-typed setting must not stop the reconciler for
 *          the whole tenant.
 */
function wallClock(instant, timeZone = "UTC") {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (!at || Number.isNaN(at.getTime())) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
  } catch {
    return wallClock(at, "UTC");
  }
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  // "24" for midnight is legal in en-GB hourCycle h23/h24 output; normalise it,
  // or a punch at 00:05 reads as 24:05 and looks sixteen hours late.
  const hour = get("hour") % 24;
  return { y: get("year"), m: get("month"), d: get("day"), minutes: hour * 60 + get("minute") };
}

/** "08:30" → 510. Anything unparseable → null, so the caller can fall back. */
function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
function localDate(instant, timeZone = "UTC") {
  const w = wallClock(instant, timeZone);
  if (!w) return null;
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/**
 * How late a punch was, in minutes past the grace window.
 *
 * Grace is a threshold, not a discount: arriving 11 minutes late with a 10
 * minute grace is 11 minutes late, not 1. The grace decides WHETHER somebody is
 * late; the figure is measured from the expected start, because that is what an
 * employee recognises as "how late I was".
 */
function minutesLate({ clock_in_at, expected_start_time, grace_minutes = 0, timeZone = "UTC" } = {}) {
  const expected = parseHHMM(expected_start_time);
  if (expected === null || !clock_in_at) return 0;
  const w = wallClock(clock_in_at, timeZone);
  if (!w) return 0;
  const over = w.minutes - expected;
  if (over <= Number(grace_minutes || 0)) return 0;
  return over;
}

/**
 * The deduction percentage for a lateness, from a rule's tiers.
 *
 * Tiers are evaluated by threshold, largest first, so the order they were typed
 * in cannot change the answer — an HR manager appending a 4-hour tier to the
 * bottom of the list must not have it shadowed by the 1-hour one above it.
 */
function tierPct(minutes, tiers = []) {
  const late = Number(minutes) || 0;
  if (!(late > 0) || !Array.isArray(tiers)) return 0;
  const sorted = [...tiers]
    .map((t) => ({ after: Number(t.after_minutes), pct: Number(t.deduction_pct) }))
    .filter((t) => Number.isFinite(t.after) && Number.isFinite(t.pct))
    .sort((a, b) => b.after - a.after);
  const hit = sorted.find((t) => late >= t.after);
  return hit ? hit.pct : 0;
}

/**
 * One day's pay.
 *
 * Divided by the WORKING days in the month, not by 30: a deduction of "one
 * day's pay" that quietly means 1/30th of the salary is smaller than the day
 * the employee actually failed to work, and the difference is the employer's
 * to explain. `workingDays` falls back to 22 only when the caller could not
 * establish a calendar at all.
 */
function dailyRate(monthlySalary, workingDays) {
  const days = Number(workingDays) > 0 ? Number(workingDays) : 22;
  return round2(Number(monthlySalary || 0) / days);
}

/** Does this employee work on this JS day number? */
function isWorkingDay(dayNumber, { work_days = null, weekendDays = [0, 6] } = {}) {
  if (Array.isArray(work_days) && work_days.length) return work_days.map(Number).includes(Number(dayNumber));
  return !weekendDays.map(Number).includes(Number(dayNumber));
}

/**
 * Decide one employee's day.
 *
 * The order of the branches IS the policy, and it is the half that was missing:
 * an approved leave beats everything, because an employee on holiday who
 * happens to badge into the building has not started a working day; then the
 * calendar (holiday, then non-working weekday); then the punch. Absence is the
 * last branch rather than the first, which is why "absent" now means "expected
 * and did not come" instead of "no row found".
 *
 * @returns { status, minutes_late, deduction_pct, deduction_amount, hr_rule_id }
 */
function reconcileDay({
  clock_in_at = null,
  clock_out_at = null,
  on_leave = false,
  leave_is_paid = true,
  is_holiday = false,
  is_working_day = true,
  expected_start_time = null,
  grace_minutes = 0,
  timeZone = "UTC",
  daily_rate = 0,
  latenessRule = null,
  absenceRule = null,
} = {}) {
  const nothing = { minutes_late: 0, deduction_pct: 0, deduction_amount: 0, hr_rule_id: null };

  // Approved leave wins outright. Unpaid leave still costs the day, but it is
  // not a lateness and not misconduct — payroll prorates it (0698) and no rule
  // is cited, because the employee did nothing wrong.
  if (on_leave) return { ...nothing, status: "ON_LEAVE", unpaid_leave: !leave_is_paid };
  if (is_holiday) return { ...nothing, status: "HOLIDAY" };
  if (!is_working_day) return { ...nothing, status: clock_in_at ? "PRESENT" : "WEEKEND", first_clock_in_at: clock_in_at };

  if (clock_in_at) {
    const late = minutesLate({ clock_in_at, expected_start_time, grace_minutes, timeZone });
    if (!late) return { ...nothing, status: "PRESENT", first_clock_in_at: clock_in_at, last_clock_out_at: clock_out_at };
    const pct = latenessRule ? tierPct(late, latenessRule.tiers) : 0;
    return {
      status: "LATE",
      minutes_late: late,
      first_clock_in_at: clock_in_at,
      last_clock_out_at: clock_out_at,
      deduction_pct: pct,
      // Only DEDUCT_PCT_DAY costs money per day; a QUERY_ONLY lateness rule
      // flags the day and charges nothing, which is what most employers
      // actually want for a first offence.
      deduction_amount:
        latenessRule && latenessRule.effect === "DEDUCT_PCT_DAY" ? round2((Number(daily_rate) * pct) / 100) : 0,
      hr_rule_id: latenessRule ? latenessRule.hr_rule_id : null,
    };
  }

  // Expected, no punch, no leave.
  const pct = absenceRule && absenceRule.effect === "DEDUCT_PCT_DAY" ? Number(absenceRule.effect_value || 0) : 0;
  return {
    status: "ABSENT",
    minutes_late: 0,
    deduction_pct: pct,
    deduction_amount: round2((Number(daily_rate) * pct) / 100),
    hr_rule_id: absenceRule ? absenceRule.hr_rule_id : null,
  };
}

/**
 * Does a month's performance earn a REWARD rule?
 *
 * Separate from `reconcileDay` because rewards are measured over a period and
 * deductions over a day — folding them together is how "you were late once in
 * March" ends up cancelling a punctuality bonus that was never about one day.
 */
function qualifies({ value, comparator = "gte", threshold } = {}) {
  const v = Number(value);
  const t = Number(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t)) return false;
  return comparator === "lte" ? v <= t : v >= t;
}

/**
 * Turn a qualified reward rule into money.
 *
 * `SALARY_INCREASE_PCT` deliberately returns a PROPOSAL rather than an amount:
 * a raise is not a payroll line, it is a change to the employment terms, and
 * nothing here should be able to write one.
 */
function resolveReward({ effect, effect_value, monthlySalary = 0 } = {}) {
  const value = Number(effect_value) || 0;
  const base = Number(monthlySalary) || 0;
  if (effect === "BONUS_FIXED") return value > 0 ? { kind: "bonus", amount: round2(value) } : null;
  if (effect === "BONUS_PCT_SALARY") {
    const amt = round2((base * value) / 100);
    return amt > 0 ? { kind: "bonus", amount: amt } : null;
  }
  if (effect === "SALARY_INCREASE_PCT") {
    const proposed = round2(base * (1 + value / 100));
    return proposed > base ? { kind: "salary_increase", proposed_salary: proposed } : null;
  }
  return null;
}

module.exports = {
  round2,
  wallClock,
  parseHHMM,
  localDate,
  minutesLate,
  tierPct,
  dailyRate,
  isWorkingDay,
  reconcileDay,
  qualifies,
  resolveReward,
};
