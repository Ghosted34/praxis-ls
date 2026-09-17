"use strict";
/**
 * Recurrence — the RRULE subset this product understands (13840).
 *
 * ── WHY A HAND-ROLLED PARSER AND NOT `rrule` ───────────────────────────────
 *
 * The npm package is excellent and would be the right call for a calendar that
 * imports arbitrary .ics files. This is not that: the repeat picker offers five
 * options, the rules are written by our own client, and the arithmetic has to
 * happen in the TENANT'S zone rather than UTC — which is a `timeZone` argument
 * here and a `tzid` dance there. workspace.time.js already refuses to add a
 * date library for eleven lines of offset arithmetic, and this file is the same
 * argument with more lines.
 *
 * The cost of hand-rolling is that we must be honest about the subset, so the
 * parser REJECTS what it does not implement rather than silently ignoring it.
 * `FREQ=HOURLY`, `BYSETPOS`, `WKST`, a multi-day `BYDAY` — each is a 422 naming
 * the part, not a rule that quietly means something else. A parser that accepts
 * `BYSETPOS=-1` and drops it produces "the last Friday of the month" that fires
 * on the first one, and nothing in the round trip looks wrong.
 *
 * ── THE ONE INVARIANT ──────────────────────────────────────────────────────
 *
 * `nextOccurrence(rule, { after })` requires that `after` IS an occurrence of
 * the series. Every step is relative to it — an interval of 2 weeks means "two
 * weeks after the last one", not "an even week number" — which is what makes
 * the sweep's cursor work: it always passes the previous occurrence, never an
 * arbitrary instant. Passing a non-occurrence gives a valid-looking date that
 * is not on the series.
 *
 * ── WHY THE ARITHMETIC IS ON CALENDAR FIELDS ───────────────────────────────
 *
 * A month is not a number of milliseconds and neither is a day, once a zone is
 * involved. So an instant is read into tenant-zone calendar fields, the fields
 * are advanced as a plain tuple, and the result is converted back through
 * `zonedWallClockToUtc` — the same function that resolves what a person typed.
 * Adding 30 days to "14th of the month" instead would drift by a day per month
 * in a zone with DST, and the drift is invisible until a deadline lands on the
 * wrong day.
 */

const { zonedWallClockToUtc } = require("./workspace.time");

/** What the picker can produce, and therefore what the parser accepts. */
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** iCal's weekday names to `Date#getDay()` numbers (0 = Sunday). */
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * How far the monthly/yearly searches will look before giving up.
 *
 * A bound rather than a `while (true)`: `BYMONTHDAY=30` never matches February
 * and `BYMONTHDAY=29` on a yearly rule only matches a leap year, so an unbounded
 * search is correct but a TYPO (`BYMONTHDAY=32`) would spin forever inside a
 * per-tenant worker. 120 months is ten years of monthly stepping, which is past
 * any real `UNTIL` and well past what a person sets by hand.
 */
const MAX_STEPS = 120;

class RecurrenceError extends Error {
  constructor(message, part) {
    super(message);
    this.name = "RecurrenceError";
    /** The RRULE part that is wrong, for a 422 that names the field. */
    this.part = part || "recurrence_rule";
  }
}

/** How many days a month has, on the proleptic Gregorian calendar. */
function daysInMonth(year, month) {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A calendar tuple advanced by whole days. */
function plusDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { ...parts, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * An instant read as calendar fields on a zone's wall clock.
 *
 * The mirror of `zonedWallClockToUtc`'s own `rendered()`, kept here rather than
 * exported from there because that one exists to solve for an offset and this
 * one exists to be read by a person.
 */
function zonedParts(instant, timeZone) {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new RecurrenceError("the anchor is not a readable date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // `hour` renders as "24" at midnight in en-GB with hour12:false.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** `20270917T235959Z` → an instant. Also accepts a full ISO 8601 string. */
function parseUntil(value) {
  const basic = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (basic) {
    const [, y, m, d, hh, mm, ss] = basic;
    // An UNTIL written as a bare day means the END of that day: "repeat until
    // 17/09" that stops at 00:00 on the 17th omits the occurrence on the 17th,
    // which reads as a bug to the person who set it.
    const iso = `${y}-${m}-${d}T${hh || "23"}:${mm || "59"}:${ss || "59"}Z`;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) throw new RecurrenceError(`UNTIL=${value} is not a date`, "UNTIL");
    return at.toISOString();
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new RecurrenceError(`UNTIL=${value} is not a date`, "UNTIL");
  return at.toISOString();
}

/**
 * An RRULE string into the parts this engine implements.
 *
 * Throws `RecurrenceError` naming the offending part, so the validator can turn
 * it into a 422 the user can act on. Unknown parts are a rejection, not a
 * warning — see the header.
 */
function parseRule(rule) {
  const raw = String(rule || "").trim().toUpperCase();
  if (!raw) throw new RecurrenceError("a repeat rule cannot be empty");
  const body = raw.startsWith("RRULE:") ? raw.slice(6) : raw;

  const out = { freq: null, interval: 1, byMonthDay: [], byDay: [], until: null, count: null };
  for (const chunk of body.split(";")) {
    if (!chunk.trim()) continue;
    const eq = chunk.indexOf("=");
    if (eq <= 0) throw new RecurrenceError(`"${chunk}" is not NAME=VALUE`);
    const key = chunk.slice(0, eq).trim();
    const value = chunk.slice(eq + 1).trim();
    switch (key) {
      case "FREQ": {
        if (!FREQS.includes(value)) {
          throw new RecurrenceError(
            `FREQ=${value} is not supported — this product repeats daily, weekly, monthly or yearly`,
            "FREQ",
          );
        }
        out.freq = value;
        break;
      }
      case "INTERVAL": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 366) {
          throw new RecurrenceError("INTERVAL must be a whole number of repetitions between 1 and 366", "INTERVAL");
        }
        out.interval = n;
        break;
      }
      case "BYMONTHDAY": {
        const days = value.split(",").map((v) => Number(v.trim()));
        for (const d of days) {
          // Negative (from-the-end) days are rejected: "the 31st from the end"
          // is a rule nobody sets by hand and one more way to be quietly wrong.
          if (!Number.isInteger(d) || d < 1 || d > 31) {
            throw new RecurrenceError("BYMONTHDAY must be day numbers between 1 and 31", "BYMONTHDAY");
          }
        }
        out.byMonthDay = [...new Set(days)].sort((a, b) => a - b);
        break;
      }
      case "BYDAY": {
        const days = value.split(",").map((v) => v.trim());
        for (const d of days) {
          if (!(d in WEEKDAYS)) throw new RecurrenceError(`BYDAY=${d} is not a weekday`, "BYDAY");
        }
        // One weekday only. A multi-day weekly rule ("every Monday AND
        // Thursday") is two series wearing a trench coat: it needs a week
        // cursor to stay aligned with INTERVAL, and the picker does not offer
        // it. Rejecting is honest; accepting and mis-stepping is not.
        if (days.length > 1) {
          throw new RecurrenceError("a weekly repeat can name one weekday, not several", "BYDAY");
        }
        out.byDay = days.map((d) => WEEKDAYS[d]);
        break;
      }
      case "UNTIL":
        out.until = parseUntil(value);
        break;
      case "COUNT": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          throw new RecurrenceError("COUNT must be a whole number between 1 and 1000", "COUNT");
        }
        out.count = n;
        break;
      }
      default:
        throw new RecurrenceError(`${key} is not supported by this product's repeat rules`, key);
    }
  }

  if (!out.freq) throw new RecurrenceError("a repeat rule needs FREQ", "FREQ");
  if (out.byMonthDay.length && out.freq !== "MONTHLY") {
    throw new RecurrenceError("BYMONTHDAY only applies to a monthly repeat", "BYMONTHDAY");
  }
  if (out.byDay.length && out.freq !== "WEEKLY") {
    throw new RecurrenceError("BYDAY only applies to a weekly repeat", "BYDAY");
  }
  if (out.until && out.count) {
    throw new RecurrenceError("a repeat ends at a date OR after a number of times, not both");
  }
  return out;
}

/** The canonical string form, so two rules that mean the same thing compare equal. */
function canonicalise(rule) {
  const r = parseRule(rule);
  const parts = [`FREQ=${r.freq}`];
  if (r.interval !== 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay.length) parts.push(`BYDAY=${Object.keys(WEEKDAYS).find((k) => WEEKDAYS[k] === r.byDay[0])}`);
  if (r.byMonthDay.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(",")}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  return parts.join(";");
}

/* ── the four steppers ────────────────────────────────────────────────────── */

function nextWeekly(from, r) {
  // No BYDAY means "the same weekday as the anchor", which is what a weekly
  // repeat with no day chosen has to mean.
  const target = r.byDay.length ? r.byDay[0] : new Date(Date.UTC(from.year, from.month - 1, from.day)).getUTCDay();
  const current = new Date(Date.UTC(from.year, from.month - 1, from.day)).getUTCDay();
  let ahead = (target - current + 7) % 7;
  if (ahead === 0) ahead = 7;
  // Every Nth week: the rest of the gap is whole weeks on top of the first one.
  return plusDays(from, ahead + (r.interval - 1) * 7);
}

function nextMonthly(from, r) {
  const days = r.byMonthDay.length ? r.byMonthDay : [from.day];
  // Later in the SAME month first — a rule naming the 1st and the 15th fires
  // twice a month, and the anchor being the 1st means the 15th is next.
  const laterThisMonth = days.find((d) => d > from.day && d <= daysInMonth(from.year, from.month));
  if (laterThisMonth !== undefined) return { ...from, day: laterThisMonth };

  let year = from.year;
  let month = from.month;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    month += r.interval;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    // A day the month does not have is skipped, which is what iCal does: "the
    // 31st of every month" fires in the months that have one.
    const valid = days.filter((d) => d <= daysInMonth(year, month));
    if (valid.length) return { ...from, year, month, day: Math.min(...valid) };
  }
  return null;
}

function nextYearly(from, r) {
  for (let i = 1; i <= MAX_STEPS; i += 1) {
    const year = from.year + r.interval * i;
    if (from.day <= daysInMonth(year, from.month)) return { ...from, year };
    // 29 February: the next leap year, not 1 March. A birthday or an annual
    // filing date that silently moves to the 1st is the kind of drift this
    // module exists to prevent.
  }
  return null;
}

/**
 * The occurrence after `after`, as an instant on the tenant's clock — or null
 * when the series has ended.
 *
 * `existingCount` is how many rows the series already has, and is what makes
 * `COUNT=5` mean five occurrences rather than five more. The caller reads it;
 * this file stays pure and testable without a database.
 */
function nextOccurrence(rule, { after, timeZone, existingCount = null } = {}) {
  if (!after) return null;
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  const from = zonedParts(after, timeZone);

  let next = null;
  if (r.freq === "DAILY") next = plusDays(from, r.interval);
  else if (r.freq === "WEEKLY") next = nextWeekly(from, r);
  else if (r.freq === "MONTHLY") next = nextMonthly(from, r);
  else if (r.freq === "YEARLY") next = nextYearly(from, r);
  if (!next) return null;

  const iso = zonedWallClockToUtc(next, timeZone);
  // Belt and braces: a stepper that returned the anchor or earlier would make
  // the sweep spawn the same occurrence forever, and the unique index would
  // hide it as a no-op while the cursor never advanced.
  if (new Date(iso).getTime() <= new Date(after).getTime()) return null;
  if (r.until && new Date(iso).getTime() > new Date(r.until).getTime()) return null;
  if (r.count !== null && existingCount !== null && existingCount >= r.count) return null;
  return iso;
}

/** The weekday name a weekly rule lands on, for a log line or a sentence. */
function weekdayName(rule) {
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  return r.byDay.length ? WEEKDAY_NAMES[r.byDay[0]] : null;
}

module.exports = {
  parseRule,
  canonicalise,
  nextOccurrence,
  zonedParts,
  weekdayName,
  RecurrenceError,
  FREQS,
  MAX_STEPS,
};
