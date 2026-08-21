/**
 * SLA clocks on tenant business hours (§9.2).
 *
 * PURE given hours, holidays and `now`. A thread arriving Friday 16:30 with a
 * 4-business-hour SLA is due Monday 10:30, not Saturday.
 *
 * ── WHY THE TIMEZONE IS NOT OPTIONAL ────────────────────────────────────────
 *
 * The first version of this file computed with `getDay()` and `setHours()`,
 * which read the *server's* zone. `business_hours.timezone` exists precisely
 * because those are two different things: the API runs wherever it is deployed
 * and the office opens at 08:00 in Douala. On a UTC container that is an hour
 * out every day of the year — enough to move a Friday-16:30 arrival to the
 * wrong side of closing, and to turn a Monday-10:30 due time into Monday 09:30:
 * a breach reported an hour early, every time, silently.
 *
 * §9.10 criterion 5 makes the same point in the other direction: the
 * recipient-local scheduler must render 09:00 Paris as 08:00 Douala in summer
 * and 09:00 in winter. Both need an IANA zone and real DST arithmetic rather
 * than a fixed offset, so the zone helpers below are exported for that caller.
 *
 * Everything here works in absolute time (a `Date`) and converts to and from
 * wall-clock only at the boundaries, which is the only arrangement that
 * survives a DST transition landing inside a business day.
 */
"use strict";

const DEFAULT_TZ = "Africa/Douala";

/* ── Zone arithmetic ──────────────────────────────────────────────────────── */

const FMT = new Map();
function formatter(tz) {
  if (!FMT.has(tz)) {
    FMT.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return FMT.get(tz);
}

/** Wall-clock fields of `date` as seen in `tz`, plus day of week (0 = Sunday). */
function partsIn(date, tz = DEFAULT_TZ) {
  const p = Object.fromEntries(
    formatter(tz).formatToParts(date)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second, dow };
}

/** `tz`'s offset from UTC at this instant, in milliseconds (east positive). */
function offsetAt(date, tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which `tz`'s wall clock reads the given fields.
 *
 * Two passes, because the offset that applies depends on the instant we are
 * trying to find. The second pass is what makes spring-forward and fall-back
 * days come out right instead of an hour adrift.
 */
function zonedToUtc({ y, m, d, h = 0, mi = 0 }, tz = DEFAULT_TZ) {
  let ts = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetAt(new Date(ts), tz);
  ts -= first;
  const second = offsetAt(new Date(ts), tz);
  if (second !== first) ts += first - second;
  return new Date(ts);
}

/* ── Business calendar ────────────────────────────────────────────────────── */

function isHoliday(date, holidays = [], tz = DEFAULT_TZ) {
  const p = partsIn(date, tz);
  const key = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return holidays.some((h) => String((h && h.holiday_on) || h).slice(0, 10) === key);
}

function hoursFor(date, hours = [], tz = DEFAULT_TZ) {
  const { dow } = partsIn(date, tz);
  return hours.find((h) => Number(h.day_of_week) === dow) || null;
}

function parseHm(t) {
  const [h, m] = String(t).split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * The zone to compute in, taken from the rows themselves.
 *
 * `timezone` is a per-row column, so a tenant that ever runs two offices would
 * otherwise silently get one office's clock applied to both.
 */
function zoneOf(hours = [], fallback = DEFAULT_TZ) {
  const row = (hours || []).find((h) => h && h.timezone);
  return (row && row.timezone) || fallback;
}

function startOfNextDay(date, tz) {
  const p = partsIn(date, tz);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d) + 24 * 3600 * 1000);
  return zonedToUtc({
    y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate(), h: 0, mi: 0,
  }, tz);
}

/**
 * Add `minutes` of business time to `from`.
 *
 * Walks day by day in the office's zone, consuming whatever of each open window
 * remains. The 400-iteration guard is generous (about a year of closed days)
 * because the alternative to a guard is a tenant with no `business_hours` rows
 * hanging a worker. A return equal to the input means "no calendar configured",
 * which `due()` turns into a null due date rather than a fake one.
 */
function addBusinessMinutes(from, minutes, { hours = [], holidays = [], timezone = null } = {}) {
  const tz = timezone || zoneOf(hours);
  let left = Math.max(0, Number(minutes) || 0);
  let cursor = new Date(from);
  let guard = 0;

  while (left > 0 && guard < 400) {
    guard += 1;
    const slot = hoursFor(cursor, hours, tz);
    if (!slot || isHoliday(cursor, holidays, tz)) {
      cursor = startOfNextDay(cursor, tz);
      continue;
    }
    const p = partsIn(cursor, tz);
    const open = parseHm(slot.opens_at);
    const close = parseHm(slot.closes_at);
    const openAt = zonedToUtc({ y: p.y, m: p.m, d: p.d, h: open.h, mi: open.m }, tz);
    const closeAt = zonedToUtc({ y: p.y, m: p.m, d: p.d, h: close.h, mi: close.m }, tz);

    if (cursor < openAt) cursor = openAt;
    if (cursor >= closeAt) { cursor = startOfNextDay(cursor, tz); continue; }

    const available = Math.round((closeAt - cursor) / 60000);
    const take = Math.min(available, left);
    cursor = new Date(cursor.getTime() + take * 60000);
    left -= take;
  }
  return cursor;
}

/* ── Policy application ───────────────────────────────────────────────────── */

/**
 * Pick the minutes this thread is entitled to.
 *
 * The VIP tier was previously `policy.applies_to_vip ? first_response_minutes :
 * first_response_minutes` — the same value on both branches, so the seeded
 * one-hour VIP promise silently resolved to the ordinary four hours. A VIP
 * policy is a SEPARATE row (`applies_to_vip = true`), so which tier applies is
 * decided by whoever selects the row; all that is decided here is which of the
 * two clocks on it is wanted.
 */
function minutesFor(policy = {}, clock = "first_response") {
  return clock === "resolution"
    ? Number(policy.resolution_minutes) || 0
    : Number(policy.first_response_minutes) || 0;
}

function due(arrivedAt, policy = {}, ctx = {}, clock = "first_response") {
  const mins = minutesFor(policy, clock);
  if (!mins) return null;
  if (policy.business_hours_only === false) {
    return new Date(new Date(arrivedAt).getTime() + mins * 60000);
  }
  // No calendar means no promise we can keep. Checked HERE rather than left to
  // `addBusinessMinutes` because that function's guard walks 400 closed days
  // and returns a date a year out — which is not "unknown", it is a due date
  // nobody will ever breach, and it would read on screen as a working SLA.
  if (!(ctx.hours || []).length) return null;
  return addBusinessMinutes(arrivedAt, mins, ctx);
}

/** Both clocks for a newly arrived thread. */
function dueDates(arrivedAt, policy, ctx) {
  return {
    first_response_due_at: due(arrivedAt, policy, ctx, "first_response"),
    resolution_due_at: due(arrivedAt, policy, ctx, "resolution"),
  };
}

/** Back-compat name, kept for the existing unit test and earlier callers. */
const dueAt = (arrivedAt, policy, ctx) => due(arrivedAt, policy, ctx, "first_response");

/**
 * Is this thread's clock running?
 *
 * PENDING means "waiting on the customer", so it pauses; RESOLVED stops
 * everything; the first outbound message stops the first-response clock only.
 */
function isRunning(thread = {}, clock = "first_response") {
  if (thread.work_status === "RESOLVED") return false;
  if (thread.work_status === "PENDING") return false;
  if (clock === "first_response") return !thread.first_responded_at;
  return !thread.resolved_at;
}

function isBreached(thread = {}, now = new Date(), clock = "first_response") {
  if (!isRunning(thread, clock)) return false;
  const dueField = clock === "resolution" ? thread.resolution_due_at : thread.first_response_due_at;
  return Boolean(dueField) && new Date(dueField) <= now;
}

module.exports = {
  DEFAULT_TZ,
  addBusinessMinutes, dueAt, due, dueDates, minutesFor,
  isHoliday, hoursFor, isRunning, isBreached,
  partsIn, offsetAt, zonedToUtc, zoneOf,
};
