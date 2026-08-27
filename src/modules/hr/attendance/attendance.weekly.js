/**
 * The weekly lateness query — raised after the week closes (guide §3.4).
 *
 * ── WHAT THIS ASKS THAT THE DAILY QUERY CANNOT ─────────────────────────────
 *
 * The daily auto-query (attendance.query) asks about a MORNING: "you clocked in
 * 25 minutes late on Tuesday, please explain." It is raised at the punch, while
 * the answer is still recallable, and it is the right question about one day.
 *
 * It is the wrong question about five. Somebody 20 minutes late every day of the
 * week gets five separate queries, each individually answerable ("traffic",
 * "traffic", "traffic"), and nobody — not the employee, not the manager reading
 * the replies — is ever shown the shape of it. The pattern is the thing worth
 * asking about, and no per-day question contains it.
 *
 * So this raises exactly ONE query per person per completed week, naming the
 * count, the total minutes and the dates, and asking about the pattern rather
 * than about any one morning.
 *
 * ── EMPLOYEE ONLY (decision 7) ─────────────────────────────────────────────
 *
 * Not the manager, not HR. They have analytics — the whole of PR2 exists to
 * answer "who is habitually late" on a screen, on demand, without generating a
 * document against anybody. Mailing them a second copy of a question addressed
 * to somebody else would be a disciplinary record raised against a person by a
 * batch job, which is not what a summary is for.
 *
 * ── EXPECTED WORKING DAYS ONLY, FROM THE CALENDAR ──────────────────────────
 *
 * A LATE row is not on its own proof that the day was owed as work: the
 * reconciler writes one against a punch, and PR1's whole point is that whether
 * a Saturday was a working day is the CALENDAR's answer (employee override →
 * entity calendar → tenant weekend), never the status's. A yard that opens on
 * Saturday and an office that does not produce identical `LATE` rows. So every
 * candidate day is put back through `attendance.calendar` before it counts,
 * and a holiday is dropped for the same reason.
 *
 * ── THE INDEX, WHICH IS THE WHOLE DEDUPLICATION STORY ──────────────────────
 *
 * `hr_rule_id` is NULL on these rows, deliberately, so they fall OUT of 0704's
 * daily index (`… WHERE source <> 'MANUAL' AND … hr_rule_id IS NOT NULL`) —
 * `'WEEKLY' <> 'MANUAL'` is true, so without the null they would land in it and
 * a week ending Sunday the 16th would collide with the lateness query for
 * Sunday the 16th, one silently overwriting the other.
 *
 * But a NULL is distinct from every other NULL in a unique index, so the null
 * alone means NO deduplication at all. 12745 adds the dedicated
 * `ux_hr_query_weekly_week (employee_id, work_date) WHERE source = 'WEEKLY'`,
 * and the upsert below names it. That pair — null rule id, dedicated index — is
 * what makes "one per person per week" structural.
 *
 * ── WHAT A RE-RUN MAY NOT UNDO ─────────────────────────────────────────────
 *
 * The same rule as the daily query: `status`, `response` and `responded_at` are
 * never touched. Somebody who answered on Monday has answered; the job running
 * again on Tuesday (or a manual backfill) must not reopen it and ask again.
 */
"use strict";

const { logger } = require("../../../config/logger");
const calendar = require("./attendance.calendar");
const leaveRules = require("../leave_allowance/leave.rules");
const rules = require("./attendance.rules");

/** Severity is fixed by decision 7 — a pattern is a WARNING, not a SERIOUS. */
const WEEKLY_SEVERITY = "WARNING";
const WEEKLY_SOURCE = "WEEKLY";
/** How long the employee has to answer. Matches the daily query's default. */
const WEEKLY_DUE_DAYS = 3;

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** ISO date + n days, via UTC arithmetic so no host zone can shift it. */
function addDays(isoDate, n) {
  const p = leaveRules.parseDate(isoDate);
  if (!p) return null;
  const t = Date.UTC(p.y, p.m - 1, p.d) + n * 86400000;
  const d = new Date(t);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * The last COMPLETED Monday–Sunday week, relative to a local date. Pure.
 *
 * Anchored on the Monday of `today`'s own week and stepped back seven days,
 * rather than on "seven days ago". Those differ whenever the job misses a night
 * and catches up on Wednesday: "seven days ago" would hand back a Wed–Tue
 * window that is not a week anybody recognises, and the following Monday would
 * then produce a SECOND query overlapping it. Anchoring on the weekday means
 * every run between Monday and Sunday names the same week, which is what makes
 * a missed night recoverable by simply running again.
 */
function lastCompletedWeek(todayIso) {
  const p = leaveRules.parseDate(todayIso);
  if (!p) return null;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  // Monday of the current week. Sunday (0) belongs to the week that began six
  // days earlier, not to the one starting tomorrow.
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const thisMonday = addDays(todayIso, -backToMonday);
  const weekStart = addDays(thisMonday, -7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

/** Is this ISO date a Monday — the morning the week became reportable. */
function isMonday(isoDate) {
  const p = leaveRules.parseDate(isoDate);
  if (!p) return false;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() === 1;
}

/**
 * The words. Pure, and separate from the write for the same reason
 * `composeQuery` is: this text is the only explanation the person receives, and
 * it is worth being able to read it in a test without a database.
 *
 * `waivedCount` is stated rather than silently dropped. The query counts only
 * the late days that still stand — a day a manager already forgave is not
 * evidence of anything the employee needs to explain again — but saying nothing
 * about them invites the honest reply "you're wrong, three of those were
 * cleared", and the answer would be that we agreed and just did not say so.
 */
function composeWeekly({ weekStart, weekEnd, lateDays = [], totalMinutes = 0, waivedCount = 0 }) {
  const dates = lateDays.map((d) => d.work_date);
  const n = dates.length;
  const subject = `Weekly lateness — ${weekStart} → ${weekEnd}`;
  const head =
    `You clocked in late on ${n} of your expected working day(s) in the week of ` +
    `${weekStart} to ${weekEnd}, for a total of ${totalMinutes} minute(s).`;
  const list = `\n\nThe day(s): ${dates.join(", ")}.`;
  const waived = waivedCount > 0
    ? `\n\n${waivedCount} further late day(s) that week were waived and are not counted here.`
    : "";
  const ask =
    "\n\nThis is a summary of the week, not a charge for any one morning — each of " +
    "those days was settled on its own. Please explain the pattern, and say what " +
    "would change it.";
  return { subject, body: `${head}${list}${waived}${ask}` };
}

/**
 * Raise or refresh the weekly query for one person and one completed week.
 *
 * `work_date` is the week END. It is a real date, so the row sorts and filters
 * alongside every other query in the employee's inbox, and it is the one column
 * the dedicated index keys on.
 */
async function upsertWeeklyQuery(client, { employeeId, weekStart, weekEnd, lateDays, totalMinutes, waivedCount = 0, actorId = null }) {
  const { subject, body } = composeWeekly({ weekStart, weekEnd, lateDays, totalMinutes, waivedCount });
  const { rows } = await client.query(
    `INSERT INTO hr_query (employee_id, subject, body, severity, due_at, issued_by,
                           work_date, hr_rule_id, attendance_id, source, minutes_late)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6, $7, NULL, NULL, $8, $9)
     ON CONFLICT (employee_id, work_date)
       WHERE source = 'WEEKLY' AND work_date IS NOT NULL
     DO UPDATE SET
       -- A later run sharpens the figures: a punch corrected on Tuesday, or a
       -- day waived after the first run, changes what the week actually was.
       subject      = EXCLUDED.subject,
       body         = EXCLUDED.body,
       severity     = EXCLUDED.severity,
       minutes_late = EXCLUDED.minutes_late,
       -- NOT status, response or responded_at — the same rule the daily query
       -- records. Somebody who answered on Monday has answered, and a job
       -- running again on Tuesday must not reopen their query and ask twice.
       updated_at   = now()
     RETURNING hr_query_id, status, source, work_date`,
    [employeeId, subject, body, WEEKLY_SEVERITY, String(WEEKLY_DUE_DAYS), actorId,
      weekEnd, WEEKLY_SOURCE, totalMinutes],
  );
  return rows[0];
}

/**
 * Every LATE reconciled day in the window, with the employee's calendar inputs
 * alongside — one query rather than a roster read plus a day read, because the
 * only people this job cares about are the ones who have a LATE row.
 *
 * `e.is_active` because somebody who left on Friday should not be sent a
 * question about their last week on Monday.
 */
async function lateDaysInWeek(client, { weekStart, weekEnd }) {
  const { rows } = await client.query(
    `SELECT d.employee_id, d.work_date, d.minutes_late, d.justified,
            e.full_name, e.entity_id, e.work_days, e.expected_start_time, e.grace_minutes
       FROM attendance_day d
       JOIN employee e ON e.employee_id = d.employee_id
      WHERE d.work_date BETWEEN $1 AND $2
        AND d.status = 'LATE'
        AND e.is_active
      ORDER BY d.employee_id, d.work_date`,
    [weekStart, weekEnd],
  );
  return rows;
}

/**
 * Group the week's LATE days by employee, keeping only days the CALENDAR says
 * were owed as work, and splitting the waived ones out of the count.
 *
 * Pure given a resolver, so the precedence question — "does this employee's
 * Saturday count?" — is answered by exactly the code PR1 wrote for it and can
 * be tested here without a database.
 */
function groupForWeek(rows, expectedFor) {
  const byEmployee = new Map();
  for (const r of rows) {
    const expected = expectedFor(r);
    // Never inferred from the status: a LATE row on a day nobody was expected
    // is not lateness, and a holiday is not a working day even when somebody
    // came in and punched on it.
    if (!expected || !expected.isWorkingDay || expected.isHoliday) continue;
    let entry = byEmployee.get(r.employee_id);
    if (!entry) {
      entry = { employeeId: r.employee_id, fullName: r.full_name, lateDays: [], totalMinutes: 0, waivedCount: 0 };
      byEmployee.set(r.employee_id, entry);
    }
    if (r.justified) {
      entry.waivedCount += 1;
      continue;
    }
    entry.lateDays.push({ work_date: r.work_date, minutes_late: Number(r.minutes_late) || 0 });
    entry.totalMinutes += Number(r.minutes_late) || 0;
  }
  // A week whose every late day was waived raises nothing: the manager has
  // already answered the question this query would ask.
  return [...byEmployee.values()].filter((e) => e.lateDays.length > 0);
}

/**
 * Run the weekly summary for one completed week.
 *
 * `weekEnd` names the week explicitly (the backfill endpoint's parameter);
 * omitted, it is the last completed week in the tenant's own zone. Idempotent
 * either way — the upsert and its index are what make repeated runs safe, not
 * this function remembering it already ran.
 */
async function runWeekly(client, { weekStart = null, weekEnd = null, today = null, timeZone = "Africa/Douala", actorId = null } = {}) {
  let bounds;
  if (weekStart && weekEnd) {
    bounds = { weekStart, weekEnd };
  } else if (weekEnd) {
    bounds = { weekStart: addDays(weekEnd, -6), weekEnd };
  } else {
    const localToday = today || rules.localDate(new Date(), timeZone);
    bounds = lastCompletedWeek(localToday);
  }
  if (!bounds || !bounds.weekStart || !bounds.weekEnd) {
    throw new Error("runWeekly: unusable week bounds");
  }

  const rows = await lateDaysInWeek(client, bounds);
  if (!rows.length) {
    return { ...bounds, candidates: 0, queries: 0, employees: 0 };
  }

  const ctx = await calendar.loadContext(client, { entityIds: rows.map((r) => r.entity_id) });
  const expectedFor = (r) => calendar.forEmployee(ctx, {
    entity_id: r.entity_id,
    work_days: r.work_days,
    expected_start_time: r.expected_start_time,
    grace_minutes: r.grace_minutes,
  }, r.work_date);

  const groups = groupForWeek(rows, expectedFor);
  let queries = 0;
  for (const g of groups) {
    await upsertWeeklyQuery(client, {
      employeeId: g.employeeId,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd,
      lateDays: g.lateDays,
      totalMinutes: g.totalMinutes,
      waivedCount: g.waivedCount,
      actorId,
    });
    queries += 1;
  }

  logger.info(
    { week_start: bounds.weekStart, week_end: bounds.weekEnd, candidates: rows.length, queries },
    "[attendance] weekly lateness summarised",
  );
  return { ...bounds, candidates: rows.length, queries, employees: groups.length };
}

module.exports = {
  addDays,
  lastCompletedWeek,
  isMonday,
  composeWeekly,
  upsertWeeklyQuery,
  lateDaysInWeek,
  groupForWeek,
  runWeekly,
  WEEKLY_SEVERITY,
  WEEKLY_SOURCE,
  WEEKLY_DUE_DAYS,
};
