"use strict";
/**
 * My Workspace — turning what a person typed into an instant.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 *
 * `<DateTimeField>` writes `YYYY-MM-DDTHH:mm` — no offset, deliberately, since
 * the field's whole job is to read and write dd/mm/yyyy HH:mm whatever the
 * operating system's locale is. That string is a WALL-CLOCK TIME, and a
 * wall-clock time is not an instant until you say whose wall it is.
 *
 * `new Date("2026-09-15T17:00")` answers that question using the SERVER's
 * clock. In a container with no `TZ` set that is UTC, so a Douala user typing
 * 17:00 gets a task due at 18:00 their time — and every reminder fires an hour
 * early. The round-trip looks clean, the row stores what was sent, and nothing
 * errors. It is wrong an hour at a time, forever, and no test that does not
 * pin a timezone can see it.
 *
 * So: a string WITH an offset is already an instant and is passed through
 * untouched. A string WITHOUT one is read as the tenant's workplace clock —
 * the same `hr.timezone` setting the attendance reconciler uses to decide what
 * "08:00" means, because a due date and a shift start are the same kind of
 * fact and should not be able to disagree about which city they are in.
 *
 * ── WHY NOT A DATE LIBRARY ─────────────────────────────────────────────────
 *
 * The offset arithmetic below is `Intl.DateTimeFormat` with `timeZone` and
 * `formatToParts`, both platform features. Reaching for a dependency to do
 * this would add a library to every tenant container for eleven lines, and the
 * IANA database it ships is the same one the platform already uses.
 */

const { getSetting } = require("../../../shared/config/settings");

/** The tenant's workplace clock. Douala unless told otherwise — see 0697. */
async function timezoneOf(client) {
  const v = await getSetting(client, "hr", "timezone", "Africa/Douala");
  return typeof v === "string" && v.trim() ? v.trim() : "Africa/Douala";
}

/**
 * The UTC instant a wall-clock time in `timeZone` corresponds to.
 *
 * Iterate rather than compute once, because the offset is a function of the
 * instant and the instant is what we are solving for: near a DST transition a
 * single guess measures the offset on the WRONG SIDE of it. Re-anchoring each
 * pass on its own previous estimate converges — pass 2 corrects pass 1's
 * offset, pass 3 confirms it did. Three passes is enough for every IANA zone
 * (an offset changes by at most one step per transition), and the loop exits
 * early once two passes agree.
 *
 * THE BUG THIS SHAPE AVOIDS: writing pass 2 as `asUtc - (shift(first) - asUtc)`
 * re-references the ORIGINAL estimate and so subtracts the correction pass 1
 * just made — the function then returns the input unchanged for every zone,
 * which reads as "no conversion needed" and passes a test that only checks a
 * UTC+0 case. Re-anchoring on `est` makes that impossible.
 */
function zonedWallClockToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  /** What `ms` LOOKS LIKE on a clock in `timeZone`, as if it were UTC. */
  const rendered = (ms) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    // `hour` renders as "24" at midnight in en-GB with hour12:false.
    const hh = get("hour") % 24;
    return Date.UTC(get("year"), get("month") - 1, get("day"), hh, get("minute"), get("second"));
  };
  let est = target;
  for (let i = 0; i < 3; i += 1) {
    const next = est + (target - rendered(est));
    if (next === est) break;
    est = next;
  }
  return new Date(est).toISOString();
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Normalise a user-supplied datetime to a UTC ISO instant.
 *
 * `dateOnlyTime` is what a BARE DATE means for this field, and it differs by
 * field on purpose: a task due "15/09" is wanted by end of the working day, so
 * 17:00 — a task due at 00:00 is overdue the moment it is written and would
 * sort above everything else on the day it is created. An event ON "15/09"
 * starts at midnight, because that is what "all day" means.
 *
 * Returns null for null/undefined/"" so "no reminder" stays expressible, and
 * null for a string it cannot read rather than throwing: the Zod schema has
 * already rejected a malformed value, so reaching here with junk means a
 * caller bypassed validation, and an invalid date that renders as an empty
 * field is a smaller failure than a 500 on a list.
 */
function toInstant(value, { timeZone, dateOnlyTime = null } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;

  // Already an instant — the caller told us the offset, so there is nothing to
  // interpret and nothing to get wrong.
  if (HAS_OFFSET.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const dt = s.match(DATE_TIME);
  if (dt) {
    return zonedWallClockToUtc({
      year: +dt[1], month: +dt[2], day: +dt[3],
      hour: +dt[4], minute: +dt[5], second: +(dt[6] || 0),
    }, timeZone);
  }

  const bare = s.match(BARE_DATE);
  if (bare) {
    const [h, m, sec] = String(dateOnlyTime || "00:00:00").split(":").map(Number);
    return zonedWallClockToUtc({
      year: +bare[1], month: +bare[2], day: +bare[3], hour: h, minute: m, second: sec || 0,
    }, timeZone);
  }

  // Last resort: something with an unusual but readable shape.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { timezoneOf, toInstant, zonedWallClockToUtc };
