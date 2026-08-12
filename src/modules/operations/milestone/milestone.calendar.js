/**
 * Working-time arithmetic for the milestone engine (MOD-31). PURE — no db, no
 * clock, no I/O. Everything the scheduler knows about "how long is eight hours"
 * comes from here.
 *
 * WHY THIS EXISTS AT ALL. The old engine added calendar days to a date. That
 * quietly produces due dates on Sundays and on 20 May, promises them to a
 * client, and then reports itself late for missing them. Customs counters,
 * terminal gates and shipping-line desks all keep hours, and a schedule that
 * does not know that is not a schedule — it is arithmetic with a logistics
 * vocabulary.
 *
 * THE MODEL. A calendar is: a timezone, per-weekday opening hours, and a set of
 * holidays. Time only accrues inside an open window. Adding 8 working hours at
 * 15:00 on a Friday (closes 17:00) consumes 2 hours on the Friday, skips the
 * closed Sunday, and lands mid-morning on Monday — or later still if the Monday
 * is 20 May.
 *
 * TIMEZONE HANDLING IS DELIBERATELY NOT NAÏVE. Offsets come from `Intl`, per
 * instant, so a zone with DST behaves correctly on the days it shifts.
 * Africa/Douala has no DST and a naïve +1 would have worked for the launch
 * tenant — which is exactly the kind of assumption that becomes a bug the first
 * time this ships somewhere else. Same reason the weekend is a per-weekday
 * table rather than "Saturday and Sunday": in much of the region the working
 * week is not the one that assumption encodes.
 *
 * PRECISION is whole minutes. Due dates are stored as DATE, floors are declared
 * in hours; minutes are finer than either and keep the accumulation exact.
 */
"use strict";

const MIN = 60 * 1000;
const DAY_MIN = 24 * 60;
/** Bound on any day-walking loop — ~5 years. A calendar with no open days at
 *  all would otherwise spin forever; this turns that into a thrown error. */
const MAX_DAYS = 1900;

/**
 * A calendar the scheduler can use.
 * @typedef {Object} CalendarSpec
 * @property {string} timezone      IANA zone, e.g. "Africa/Douala".
 * @property {Object} days          weekday (0=Sun) → { open, close } in minutes from midnight.
 * @property {Set<string>} fixed    recurring holidays as "MM-DD".
 * @property {Set<string>} dated    one-off holidays as "YYYY-MM-DD".
 */

/** "07:30" | "07:30:00" | 450 → 450 (minutes from local midnight). */
function toMinutes(v) {
  if (typeof v === "number") return v;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Build a CalendarSpec from the rows of working_calendar / _day / _holiday.
 *
 * A calendar with no open weekday is refused rather than defaulted: silently
 * substituting Mon–Fri would mean the engine schedules against hours the tenant
 * never agreed to, which is worse than an explicit failure at configuration
 * time.
 */
function buildCalendar({ timezone = "Africa/Douala", days = [], holidays = [] } = {}) {
  const spec = { timezone, days: {}, fixed: new Set(), dated: new Set() };
  for (const d of days) {
    const open = toMinutes(d.opens_at);
    const close = toMinutes(d.closes_at);
    if (open === null || close === null || close <= open) continue;
    spec.days[Number(d.weekday)] = { open, close };
  }
  for (const h of holidays) {
    const iso = String(h.holiday_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (h.is_recurring) spec.fixed.add(iso.slice(5));
    else spec.dated.add(iso);
  }
  if (!Object.keys(spec.days).length) {
    throw new Error("working calendar has no open days");
  }
  return spec;
}

/** Douala hours: the fallback used when a tenant has no calendar row at all. */
const DEFAULT_CALENDAR = buildCalendar({
  timezone: "Africa/Douala",
  days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_at: "07:30", closes_at: "17:00" }))
    .concat([{ weekday: 6, opens_at: "08:00", closes_at: "13:00" }]),
  holidays: [],
});

/**
 * Minutes to add to UTC to get local wall-clock time, at this instant.
 * Derived from Intl so DST zones are handled at the transition, not assumed away.
 */
function offsetMinutes(tz, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - date.getTime()) / MIN);
}

/** Instant → local wall clock { y, m, d, min, weekday, iso }. */
function toLocal(spec, instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const shifted = new Date(date.getTime() + offsetMinutes(spec.timezone, date) * MIN);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    min: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    iso: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
  };
}

/**
 * Local wall clock → instant.
 *
 * Two passes: the first offset is looked up from a provisional UTC reading, the
 * second re-reads it at the corrected instant. That second pass is what makes a
 * DST boundary land on the right side — the offset that applies is the one in
 * force at the resulting moment, not the one before the jump.
 */
function fromLocal(spec, { y, m, d, min }) {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + min * MIN;
  const guess = new Date(naive - offsetMinutes(spec.timezone, new Date(naive)) * MIN);
  return new Date(naive - offsetMinutes(spec.timezone, guess) * MIN);
}

/** Calendar-walk one local day forward. */
function nextDay({ y, m, d }) {
  const t = new Date(Date.UTC(y, m - 1, d) + DAY_MIN * MIN);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const isoOf = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

function isHoliday(spec, day) {
  const iso = isoOf(day);
  return spec.dated.has(iso) || spec.fixed.has(iso.slice(5));
}

/** The open window on a local day, or null when closed (weekend or holiday). */
function windowOn(spec, day) {
  if (isHoliday(spec, day)) return null;
  const weekday = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  return spec.days[weekday] || null;
}

const isWorkingDay = (spec, day) => windowOn(spec, day) !== null;

/**
 * The first working moment at or after `instant`.
 * Inside a window it is the instant itself; otherwise the next opening bell.
 */
function nextOpen(spec, instant) {
  let local = toLocal(spec, instant);
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const win = windowOn(spec, local);
    if (win) {
      if (local.min < win.open) return fromLocal(spec, { ...local, min: win.open });
      if (local.min < win.close) return fromLocal(spec, local);
    }
    local = { ...nextDay(local), min: 0 };
  }
  throw new Error("no working day found within " + MAX_DAYS + " days");
}

/**
 * Add working hours to an instant.
 *
 * Fractional hours are honoured (the scheduler hands out shares of a horizon,
 * which are rarely whole). Zero returns the next open moment rather than the
 * input — a stage due "now" on a Sunday is due Monday morning, not Sunday.
 */
function addWorkingHours(spec, instant, hours) {
  let remaining = Math.max(0, Math.round(Number(hours || 0) * 60));
  let cursor = nextOpen(spec, instant);
  if (remaining === 0) return cursor;

  for (let i = 0; i < MAX_DAYS; i += 1) {
    const local = toLocal(spec, cursor);
    const win = windowOn(spec, local);
    if (win) {
      const from = Math.max(local.min, win.open);
      const left = win.close - from;
      if (left > remaining) return fromLocal(spec, { ...local, min: from + remaining });
      remaining -= left;
      if (remaining === 0) return fromLocal(spec, { ...local, min: win.close });
    }
    cursor = fromLocal(spec, { ...nextDay(local), min: 0 });
  }
  throw new Error("addWorkingHours exceeded " + MAX_DAYS + " days");
}

/** Working hours between two instants (0 when b <= a). */
function workingHoursBetween(spec, a, b) {
  const start = new Date(a instanceof Date ? a.getTime() : a);
  const end = new Date(b instanceof Date ? b.getTime() : b);
  if (end <= start) return 0;

  let minutes = 0;
  let local = toLocal(spec, start);
  const endLocal = toLocal(spec, end);

  for (let i = 0; i < MAX_DAYS; i += 1) {
    const win = windowOn(spec, local);
    const sameDay = local.y === endLocal.y && local.m === endLocal.m && local.d === endLocal.d;
    if (win) {
      const from = Math.max(local.min, win.open);
      const to = sameDay ? Math.min(endLocal.min, win.close) : win.close;
      if (to > from) minutes += to - from;
    }
    if (sameDay) break;
    local = { ...nextDay(local), min: 0 };
  }
  return minutes / 60;
}

/**
 * Add working DAYS — used for `default_duration_days` and the offset fallback,
 * where a tenant means "seven working days", not fifty-three working hours.
 */
function addWorkingDays(spec, instant, days) {
  let left = Math.max(0, Math.round(Number(days || 0)));
  let local = toLocal(spec, instant);
  for (let i = 0; i < MAX_DAYS && left > 0; i += 1) {
    local = { ...nextDay(local), min: local.min };
    if (isWorkingDay(spec, local)) left -= 1;
  }
  if (left > 0) throw new Error("addWorkingDays exceeded " + MAX_DAYS + " days");
  return fromLocal(spec, local);
}

/** Local calendar date (YYYY-MM-DD) of an instant — what gets stored. */
const localDate = (spec, instant) => toLocal(spec, instant).iso;

module.exports = {
  buildCalendar,
  DEFAULT_CALENDAR,
  addWorkingHours,
  addWorkingDays,
  workingHoursBetween,
  nextOpen,
  isWorkingDay,
  isHoliday,
  windowOn,
  toLocal,
  fromLocal,
  localDate,
  offsetMinutes,
};
