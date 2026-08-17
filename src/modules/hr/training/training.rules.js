/**
 * Training (MOD-18) — the session and compliance rules, pure.
 *
 * Nothing here touches a database, a clock it was not handed, or the network,
 * because every one of these answers is something a screen renders and a
 * scheduler acts on, and both need to agree. The two that matter most:
 *
 *   `presenceAttendance` — whether somebody actually attended, derived from
 *     when they joined and how long the session ran. This is the number that
 *     replaces a facilitator ticking twenty boxes from memory, so it has to be
 *     defensible to the person it marks absent.
 *
 *   `complianceStatus` — whether a qualification is current. Four states, not a
 *     boolean, because "expires in nine days" and "expired last March" call for
 *     completely different actions, and "never held it" is a third thing again.
 *
 * ── DATES ──────────────────────────────────────────────────────────────────
 *
 * Certificate validity is measured in MONTHS and answered as a DATE, so it is
 * done in UTC calendar arithmetic rather than by adding milliseconds. Thirty
 * days is not a month, and a ticket issued on 31 January valid for one month
 * expires on 28 February — not on 3 March, which is what date-arithmetic by
 * addition produces. 0700 learned this on probation dates; the same helper
 * shape is used here deliberately.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

/** Where the session happens. HYBRID is not decoration — it is the only mode
 *  where both a room and a link are required, and a screen that offers one box
 *  forces the organiser to drop half the attendees. */
const MODES = ["IN_PERSON", "ONLINE", "HYBRID"];

const STATUSES = ["SCHEDULED", "LIVE", "DONE", "CANCELLED"];

/**
 * LIVE sits between SCHEDULED and DONE, and SCHEDULED → DONE is kept alongside
 * it. A classroom session run off-system is closed out afterwards without ever
 * having been "live" here, and forcing somebody to press Start on a course that
 * finished last Tuesday is the kind of ceremony that makes people stop
 * recording training at all.
 */
const TRANSITIONS = {
  SCHEDULED: ["LIVE", "DONE", "CANCELLED"],
  LIVE: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

/** How early somebody may join before the published start. Fifteen minutes is
 *  the number every conferencing product uses and the one people expect; the
 *  point of having it at all is that a link which only works at exactly 09:00
 *  guarantees a late start. */
const JOIN_LEAD_MINUTES = 15;

/**
 * How much of a session you must be present for to count as having attended.
 *
 * Not 100%: somebody who drops for two minutes on a bad connection attended.
 * Not 50% either — half a safety course is not a safety course, and this
 * figure ends up on a certificate. Two thirds is the threshold most training
 * bodies publish for contact hours, and it is stated here as one constant so
 * that the screen explaining it and the job applying it cannot disagree.
 */
const ATTENDANCE_RATIO = 2 / 3;

/** Below this a session is too short for a ratio to mean anything — a
 *  ten-minute toolbox talk that somebody joined at all, they attended. */
const MIN_RATIO_MINUTES = 20;

const isDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
/** null and undefined both mean "not given" here, and the distinction between
 *  them is never meaningful in this module — a patch that omits a field and one
 *  that clears it both leave nothing to compute from. */
const nil = (v) => v === null || v === undefined;
const toDate = (v) => (nil(v) ? null : isDate(v) ? v : isDate(new Date(v)) ? new Date(v) : null);

function assertMode(mode) {
  if (!MODES.includes(mode)) {
    throw new AppError("BAD_TRAINING_MODE", `Unknown mode "${String(mode).slice(0, 40)}" — expected one of ${MODES.join(", ")}`, 422);
  }
  return mode;
}

function assertTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) throw new AppError("INVALID_TRANSITION", `Unknown training status "${String(from).slice(0, 40)}"`, 422);
  if (!allowed.includes(to)) {
    throw new AppError("INVALID_TRANSITION", `Cannot move training ${from} → ${to}`, 422);
  }
  return to;
}

/**
 * An ONLINE session with no join link is a meeting nobody can attend, and the
 * moment it is caught matters: at save time it is a sentence in a form, at
 * 09:00 on the day it is twenty people in a waiting room. HYBRID needs both —
 * that is what distinguishes it from the other two.
 */
function assertReachable({ mode, join_url, location }) {
  const m = assertMode(mode);
  const link = String(join_url || "").trim();
  const room = String(location || "").trim();
  if ((m === "ONLINE" || m === "HYBRID") && !link) {
    throw new AppError("JOIN_LINK_REQUIRED", `A ${m.toLowerCase().replace("_", "-")} session needs a join link`, 422);
  }
  if ((m === "IN_PERSON" || m === "HYBRID") && !room) {
    throw new AppError("LOCATION_REQUIRED", `A ${m.toLowerCase().replace("_", "-")} session needs a location`, 422);
  }
  return { mode: m, join_url: link || null, location: room || null };
}

/** Planned length in whole minutes, or null when the session has no window.
 *  Null is not zero: a session with no end time is unbounded, not instant. */
function plannedMinutes({ starts_at, ends_at } = {}) {
  const a = toDate(starts_at);
  const b = toDate(ends_at);
  if (!a || !b) return null;
  const mins = Math.round((b.getTime() - a.getTime()) / 60000);
  return mins > 0 ? mins : null;
}

/** How long it actually ran. Null while it is still running — an open session
 *  has no duration yet, and reporting the elapsed time as its duration would
 *  make every in-progress session look like a short one. */
function actualMinutes({ opened_at, closed_at } = {}) {
  const a = toDate(opened_at);
  const b = toDate(closed_at);
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/**
 * May somebody join right now, and if not, why not.
 *
 * Returns a reason rather than a bare false, because every one of these is
 * something the screen has to say out loud. A disabled button with no
 * explanation sends people to the helpdesk.
 */
function joinState(training = {}, now = new Date()) {
  const at = toDate(now) || new Date();
  const status = training.status || "SCHEDULED";
  if (status === "CANCELLED") return { can_join: false, reason: "CANCELLED", message: "This session was cancelled." };
  if (status === "DONE") return { can_join: false, reason: "ENDED", message: "This session has finished." };
  if (!training.join_url) {
    return { can_join: false, reason: "NO_LINK", message: training.mode === "IN_PERSON" ? "This session is in person." : "No join link has been set." };
  }
  if (status === "LIVE") return { can_join: true, reason: "LIVE", message: "In progress." };

  const starts = toDate(training.starts_at);
  // No start time and not yet live: there is nothing to be early FOR. Allowing
  // the join is the kinder failure — the link either works or it does not.
  if (!starts) return { can_join: true, reason: "OPEN", message: "Joinable." };
  const minutesUntil = Math.round((starts.getTime() - at.getTime()) / 60000);
  if (minutesUntil > JOIN_LEAD_MINUTES) {
    return { can_join: false, reason: "TOO_EARLY", minutes_until: minutesUntil, message: `Opens ${JOIN_LEAD_MINUTES} minutes before the start.` };
  }
  return { can_join: true, reason: "SOON", minutes_until: minutesUntil, message: minutesUntil > 0 ? `Starts in ${minutesUntil} min.` : "Starting now." };
}

/**
 * Capacity as a state, not a number. `remaining: null` means unlimited and is
 * deliberately not Infinity — it crosses JSON, and `Infinity` serialises to
 * `null` anyway while reading as a number in the code that produced it.
 */
function capacityState({ capacity = null, booked = 0 } = {}) {
  const cap = nil(capacity) ? null : Number(capacity);
  const taken = Math.max(0, Number(booked) || 0);
  if (nil(cap) || !Number.isFinite(cap) || cap <= 0) {
    return { capacity: null, booked: taken, remaining: null, is_full: false, is_over: false };
  }
  const remaining = cap - taken;
  return { capacity: cap, booked: taken, remaining: Math.max(0, remaining), is_full: remaining <= 0, is_over: remaining < 0 };
}

/**
 * Did they attend, judged on presence?
 *
 * Returns null — never false — when there is nothing to judge on. A session
 * that was never opened, or an attendee who never joined an in-person course
 * where joining is not a thing, has NO presence evidence, and turning that into
 * "absent" is the same mistake 0701 spends most of its tests avoiding: absence
 * of data read as a bad result. The caller decides what to do with null; what
 * this must never do is invent an answer.
 */
function presenceAttendance({ joined_at, left_at, opened_at, closed_at } = {}) {
  const joined = toDate(joined_at);
  if (!joined) return null;

  const sessionMinutes = actualMinutes({ opened_at, closed_at });
  const left = toDate(left_at) || toDate(closed_at);
  const presentMinutes = left ? Math.max(0, Math.round((left.getTime() - joined.getTime()) / 60000)) : null;

  // They joined, and either the session is still running or nobody recorded
  // when they left. Joining is the evidence; there is no ratio to apply.
  if (nil(sessionMinutes) || nil(presentMinutes) || sessionMinutes < MIN_RATIO_MINUTES) {
    return { attended: true, observed: true, present_minutes: presentMinutes, session_minutes: sessionMinutes, ratio: null, reason: "JOINED" };
  }
  const ratio = presentMinutes / sessionMinutes;
  return {
    attended: ratio >= ATTENDANCE_RATIO,
    observed: true,
    present_minutes: presentMinutes,
    session_minutes: sessionMinutes,
    ratio: Math.round(ratio * 100) / 100,
    reason: ratio >= ATTENDANCE_RATIO ? "PRESENT" : "PARTIAL",
  };
}

/** Add whole months in UTC, clamping to the end of the shorter month: 31 Jan
 *  + 1 month is 28 Feb, not 3 March. */
function addMonths(dateish, months) {
  const d = toDate(dateish);
  const n = Number(months);
  if (!d || !Number.isFinite(n)) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const lastOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + n, Math.min(day, lastOfTarget)));
}

const ymd = (d) => (toDate(d) ? toDate(d).toISOString().slice(0, 10) : null);

/**
 * When a certificate issued on `issuedOn` under `validMonths` lapses.
 * Null when the requirement says it never does — an induction is not a ticket.
 */
function certificateExpiry(issuedOn, validMonths) {
  if (nil(validMonths) || validMonths === "") return null;
  const n = Number(validMonths);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ymd(addMonths(issuedOn, n));
}

/**
 * The four states of a qualification, with the days that separate them.
 *
 *   NEVER    — no pass on record. The person cannot do the job today.
 *   EXPIRED  — held it, it has lapsed. Same operational answer as NEVER, a
 *              completely different conversation, and a different queue: a
 *              refresher is booked, not an initial course.
 *   EXPIRING — lapses inside the requirement's warning window. The only state
 *              anybody can act on in time, which is the reason it exists.
 *   CURRENT  — nothing to do.
 *
 * `warnDays` comes from the requirement rather than being a constant here
 * because the lead time is a property of the course: a first-aid refresher runs
 * monthly, a forklift assessment is booked a quarter out.
 */
function complianceStatus({ expiresOn = null, attendedOn = null, warnDays = 30, today = new Date() } = {}) {
  const t = toDate(today) || new Date();
  const todayYmd = ymd(t);
  if (!attendedOn && !expiresOn) {
    return { status: "NEVER", days_remaining: null, expires_on: null, is_compliant: false };
  }
  if (!expiresOn) {
    // Held, and it does not lapse.
    return { status: "CURRENT", days_remaining: null, expires_on: null, is_compliant: true };
  }
  const exp = ymd(expiresOn);
  // Whole days, computed on the DATES rather than on the instants, so a
  // certificate expiring today reads as 0 regardless of the hour the report
  // happens to run.
  const days = Math.round((Date.parse(exp + "T00:00:00Z") - Date.parse(todayYmd + "T00:00:00Z")) / 86400000);
  if (days < 0) return { status: "EXPIRED", days_remaining: days, expires_on: exp, is_compliant: false };
  const warn = Number.isFinite(Number(warnDays)) ? Math.max(0, Number(warnDays)) : 30;
  if (days <= warn) return { status: "EXPIRING", days_remaining: days, expires_on: exp, is_compliant: true };
  return { status: "CURRENT", days_remaining: days, expires_on: exp, is_compliant: true };
}

/**
 * Does a requirement apply to this employee?
 *
 * Both fields blank means everybody — that is how "all staff must complete the
 * annual fire briefing" is stated. A set field must match, case-insensitively
 * and ignoring surrounding space, because `employee.department` is typed by
 * hand and "Warehouse" and "warehouse " are the same department.
 */
function requirementApplies(requirement = {}, employee = {}) {
  if (requirement.is_active === false) return false;
  const norm = (v) => String(nil(v) ? "" : v).trim().toLowerCase();
  if (requirement.department && norm(requirement.department) !== norm(employee.department)) return false;
  if (requirement.job_title && norm(requirement.job_title) !== norm(employee.job_title)) return false;
  return true;
}

module.exports = {
  MODES, STATUSES, TRANSITIONS, JOIN_LEAD_MINUTES, ATTENDANCE_RATIO, MIN_RATIO_MINUTES,
  assertMode, assertTransition, assertReachable,
  plannedMinutes, actualMinutes, joinState, capacityState, presenceAttendance,
  addMonths, certificateExpiry, complianceStatus, requirementApplies,
};
