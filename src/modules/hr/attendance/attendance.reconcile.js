/**
 * Attendance reconciliation (MOD-14 / 0697).
 *
 * Turns punches, approved leave and the holiday calendar into ONE ROW PER
 * EMPLOYEE PER DAY, with the money at stake frozen onto it.
 *
 * ── WHY THIS IS A PASS OVER THE ROSTER, NOT A HOOK ON CLOCK-IN ─────────────
 *
 * Most of what decides a day is not the punch. Approved leave, a public
 * holiday, a weekend, a shift the employee does not work, and above all the
 * ABSENCE of any punch — none of those are events anything can hook. Only a
 * pass over the whole roster after the day is over knows which applies, which
 * is why `absence()` (the read-time query this replaces) could only ever answer
 * "nobody clocked in" and never "and here is why that was fine".
 *
 * ── RE-RUNNING IS SAFE, AND THAT IS LOAD-BEARING ───────────────────────────
 *
 * The upsert is on (employee_id, work_date). A day gets reconciled again when
 * somebody back-dates a leave approval, corrects a punch, or switches a rule
 * on — and the row must then say what is true NOW, not what was true at
 * midnight. Two exceptions are preserved across a re-run, because they are
 * decisions rather than derivations:
 *
 *   · a WAIVED day stays waived, with the same figure. Recomputing a waiver
 *     away would silently re-charge somebody a manager had excused.
 *   · the QUERY already raised is kept. Re-running must not send an employee
 *     the same question five times.
 *
 * ── THE DEDUCTION IS FROZEN, THE STATUS IS NOT ─────────────────────────────
 *
 * `daily_rate`, `deduction_pct` and `deduction_amount` are written from the
 * salary and the rule in force AT RECONCILIATION. A pay rise in June must not
 * make January's lateness more expensive. The status can and should move, since
 * a leave request approved late genuinely changes what that Tuesday was.
 */
"use strict";

const rules = require("./attendance.rules");
const leaveRules = require("../leave_allowance/leave.rules");
const { getSetting } = require("../../../shared/config/settings");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
// 0704: the shared query writer. The punch raises it; this adopts it.
const hrQuery = require("./attendance.query");
const calendar = require("./attendance.calendar");

const MODULE = "MOD-14";

/** The tenant's workplace clock. Douala unless told otherwise (0697). */
async function timezoneOf(client) {
  const v = await getSetting(client, "hr", "timezone", "Africa/Douala");
  return typeof v === "string" && v.trim() ? v.trim() : "Africa/Douala";
}

/** The active rule of a kind, or null. First by code, so the choice is stable. */
async function activeRule(client, kind) {
  const { rows } = await client.query(
    "SELECT * FROM hr_rule WHERE kind = $1 AND is_active ORDER BY code LIMIT 1",
    [kind],
  );
  return rows[0] || null;
}

/** Working days in a calendar month, for the daily rate.
 *  Delegates to `attendance.calendar` so a Mon–Sat entity is not charged as if
 *  Saturday were a weekend — the same resolver the day itself uses. */
function workingDaysInMonth(year, month, decide) {
  if (typeof decide === "function") return calendar.workingDaysInMonth(year, month, decide);
  // Legacy shape (weekendDays / workDays / holidays) — kept so a caller that
  // has not moved onto the resolver still gets an answer, not a throw.
  const { weekendDays = [0, 6], workDays = null, holidays = [] } = decide || {};
  return calendar.workingDaysInMonth(year, month, (iso) => calendar.decideExpected({
    isoDate: iso, workDays, publicHolidays: holidays, weekendDays,
  }));
}

/**
 * Reconcile one date across the whole active roster.
 *
 * @param date  ISO date to reconcile. Defaults to YESTERDAY, not today: a day
 *              still in progress has no absences, only people who have not
 *              arrived yet, and charging them at 09:00 would be nonsense.
 */
async function reconcileDate(client, { date = null, actor = {} } = {}) {
  const timeZone = await timezoneOf(client);
  const day = date || defaultDate(timeZone);
  const [latenessRule, absenceRule] = await Promise.all([
    activeRule(client, "LATENESS"),
    activeRule(client, "ABSENCE"),
  ]);

  const parsed = leaveRules.parseDate(day);
  if (!parsed) throw new Error(`reconcileDate: unusable date ${day}`);

  const { rows: roster } = await client.query(
    `SELECT employee_id, full_name, base_salary, expected_start_time, grace_minutes, work_days, entity_id
       FROM employee WHERE is_active ORDER BY employee_id`,
  );

  const ctx = await calendar.loadContext(client, {
    entityIds: roster.map((e) => e.entity_id),
  });

  // ALL punches in the window, not DISTINCT ON employee. The earliest punch in
  // a ±1 day window is often YESTERDAY's — filtering to today's local date
  // afterwards then looked like the person never arrived.
  const { rows: punches } = await client.query(
    `SELECT employee_id, attendance_id, clock_in_at, clock_out_at
       FROM attendance_log
      WHERE clock_in_at >= ($1::date)::timestamptz - interval '1 day'
        AND clock_in_at <  ($1::date)::timestamptz + interval '2 days'
      ORDER BY employee_id, clock_in_at`,
    [day],
  );
  const { rows: leaves } = await client.query(
    `SELECT lr.employee_id, lr.leave_request_id, coalesce(lt.is_paid, true) AS is_paid
       FROM leave_request lr
       LEFT JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
      WHERE lr.status IN ('APPROVED','TAKEN')
        AND lr.starts_on <= $1::date AND lr.ends_on >= $1::date`,
    [day],
  );
  const leaveBy = Object.fromEntries(leaves.map((l) => [l.employee_id, l]));
  const punchesByEmp = {};
  for (const p of punches) {
    (punchesByEmp[p.employee_id] || (punchesByEmp[p.employee_id] = [])).push(p);
  }

  const actorId = await resolveActorId(client, actor.user_id);
  let charged = 0;
  let written = 0;

  for (const emp of roster) {
    const expected = calendar.forEmployee(ctx, emp, day);
    const punch = (punchesByEmp[emp.employee_id] || []).find(
      (p) => rules.localDate(p.clock_in_at, expected.timezone) === day,
    ) || null;
    const leave = leaveBy[emp.employee_id] || null;

    const monthDays = workingDaysInMonth(parsed.y, parsed.m, (iso) => calendar.forEmployee(ctx, emp, iso));
    const dailyRate = rules.dailyRate(emp.base_salary, monthDays);

    const decided = rules.reconcileDay({
      clock_in_at: punch ? punch.clock_in_at : null,
      clock_out_at: punch ? punch.clock_out_at : null,
      on_leave: !!leave,
      leave_is_paid: leave ? leave.is_paid : true,
      is_holiday: expected.isHoliday,
      is_working_day: expected.isWorkingDay,
      expected_start_time: expected.expectedStart,
      grace_minutes: expected.graceMinutes,
      timeZone: expected.timezone,
      daily_rate: dailyRate,
      latenessRule,
      absenceRule,
    });

    const row = await upsertDay(client, {
      employee_id: emp.employee_id,
      work_date: day,
      status: decided.status,
      expected_start_time: expected.expectedStart,
      grace_minutes: expected.graceMinutes,
      first_clock_in_at: punch ? punch.clock_in_at : null,
      last_clock_out_at: punch ? punch.clock_out_at : null,
      minutes_late: decided.minutes_late,
      daily_rate: dailyRate,
      deduction_pct: decided.deduction_pct,
      deduction_amount: decided.deduction_amount,
      hr_rule_id: decided.hr_rule_id,
      leave_request_id: leave ? leave.leave_request_id : null,
      attendance_id: punch ? punch.attendance_id : null,
    });
    written += 1;
    if (Number(row.deduction_amount) > 0 && !row.justified) charged += 1;

    /*
     * The query is raised AFTER the row exists, so it can point at it.
     *
     * 0704 CHANGED THE CONDITION HERE, and the old one is the bug. It was
     * `!row.hr_query_id` — "this day has no query yet" — which was true and
     * sufficient while the reconciler was the only thing that raised one. Now
     * the PUNCH raises the lateness query the moment somebody clocks in late,
     * hours before any `attendance_day` row exists to hold the link. The old
     * test would have seen an empty `hr_query_id`, concluded nobody had asked,
     * and asked a second time that night about the same morning.
     *
     * So the reconciler now looks for the query by (employee, day, rule) and
     * ADOPTS it — linking the day to it and updating it with the settled
     * figure, which is the number that actually gets charged. The upsert is
     * keyed on the same partial unique index, so even a path that skips this
     * lookup cannot produce the duplicate.
     */
    const rule = decided.hr_rule_id === (latenessRule && latenessRule.hr_rule_id) ? latenessRule : absenceRule;
    if (rule && rule.auto_query && !row.justified && decided.hr_rule_id) {
      await settleQuery(client, { day: row, employee: emp, rule, actorId });
    }
  }

  await audit(client, {
    actorUserId: actorId,
    action: "attendance.reconciled",
    moduleKey: MODULE,
    entityRef: `attendance_day:${day}`,
    after: { work_date: day, employees: roster.length, chargeable: charged },
  });
  return { work_date: day, employees: roster.length, written, chargeable: charged };
}

/** Yesterday in the workplace zone — see reconcileDate's note on `date`. */
function defaultDate(timeZone) {
  return rules.localDate(new Date(Date.now() - 86400000), timeZone);
}

/**
 * Write the day, preserving the decisions a re-run must not undo.
 *
 * `justified` and `hr_query_id` are excluded from the UPDATE for exactly that
 * reason, and a waived day keeps its frozen deduction rather than being
 * re-priced (the COALESCE on the money columns).
 */
async function upsertDay(client, d) {
  const { rows } = await client.query(
    `INSERT INTO attendance_day
       (employee_id, work_date, status, expected_start_time, grace_minutes,
        first_clock_in_at, last_clock_out_at, minutes_late, daily_rate,
        deduction_pct, deduction_amount, hr_rule_id, leave_request_id, attendance_id, reconciled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
       status = EXCLUDED.status,
       expected_start_time = EXCLUDED.expected_start_time,
       grace_minutes = EXCLUDED.grace_minutes,
       first_clock_in_at = EXCLUDED.first_clock_in_at,
       last_clock_out_at = EXCLUDED.last_clock_out_at,
       minutes_late = EXCLUDED.minutes_late,
       -- A waived day keeps the figure it was waived at. Re-pricing it would
       -- change what a manager decided to forgive.
       daily_rate = CASE WHEN attendance_day.justified THEN attendance_day.daily_rate ELSE EXCLUDED.daily_rate END,
       deduction_pct = CASE WHEN attendance_day.justified THEN attendance_day.deduction_pct ELSE EXCLUDED.deduction_pct END,
       deduction_amount = CASE WHEN attendance_day.justified THEN attendance_day.deduction_amount ELSE EXCLUDED.deduction_amount END,
       hr_rule_id = EXCLUDED.hr_rule_id,
       leave_request_id = EXCLUDED.leave_request_id,
       attendance_id = EXCLUDED.attendance_id,
       reconciled_at = now(),
       updated_at = now()
     RETURNING *`,
    [d.employee_id, d.work_date, d.status, d.expected_start_time, d.grace_minutes,
      d.first_clock_in_at, d.last_clock_out_at, d.minutes_late, d.daily_rate,
      d.deduction_pct, d.deduction_amount, d.hr_rule_id, d.leave_request_id, d.attendance_id],
  );
  return rows[0];
}

/**
 * Settle the day's query: adopt the one the punch already raised, or raise it.
 *
 * Either way the day ends up pointing at exactly one query carrying the SETTLED
 * figure. `settled: true` is what changes the wording from "this would carry a
 * deduction of X" — which is all the punch could honestly say, with the day
 * still running — to "this carries a deduction of X", which is what is actually
 * coming off the payslip.
 *
 * An ABSENCE has no punch to have raised anything, so that path is always a
 * first raise; it goes through the same writer so the two kinds of query cannot
 * drift in wording or severity.
 */
async function settleQuery(client, { day, employee, rule, actorId }) {
  const absent = day.status === "ABSENT";
  const existing = await hrQuery.findAutoQuery(client, {
    employeeId: employee.employee_id, workDate: day.work_date, ruleId: rule.hr_rule_id,
  });
  const q = await hrQuery.upsertAutoQuery(client, {
    employeeId: employee.employee_id,
    workDate: day.work_date,
    rule,
    // The FIRST raiser owns `source` (the upsert does not overwrite it), so
    // passing RECONCILE here only takes effect when nothing existed.
    source: "RECONCILE",
    minutesLate: absent ? null : day.minutes_late,
    expectedStart: day.expected_start_time,
    deduction: day.deduction_amount,
    absent,
    settled: true,
    attendanceId: day.attendance_id || null,
    actorId,
  });
  if (day.hr_query_id !== q.hr_query_id) {
    await client.query(
      "UPDATE attendance_day SET hr_query_id = $2 WHERE attendance_day_id = $1",
      [day.attendance_day_id, q.hr_query_id],
    );
  }
  logger.debug(
    { employee: employee.employee_id, date: day.work_date, rule: rule.code, adopted: !!existing },
    existing ? "[attendance] adopted the clock-in query" : "[attendance] auto-query raised",
  );
  return q.hr_query_id;
}

/**
 * Waive or uphold ONE day.
 *
 * The single primitive that moves money here — the query inbox and the payroll
 * review sheet both call it, so an employee can never see one answer in My HR
 * while payroll acts on another. Waiving keeps the amount (see the table
 * comment) so upholding restores exactly what was forgiven rather than
 * recomputing a figure under today's rules.
 */
async function setJustified(client, { id, justified, justification = null, actor = {} }) {
  const actorId = await resolveActorId(client, actor.user_id);
  const { rows } = await client.query(
    `UPDATE attendance_day
        SET justified = $2,
            justification = CASE WHEN $2 THEN $3 ELSE NULL END,
            justified_by = CASE WHEN $2 THEN $4 ELSE NULL END,
            justified_at = CASE WHEN $2 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE attendance_day_id = $1
      RETURNING *`,
    [id, !!justified, justification, actorId],
  );
  const row = rows[0];
  if (!row) return null;
  // Closing the query is the visible half of the decision: an employee whose
  // explanation was accepted should not still be looking at an open question.
  if (row.hr_query_id && justified) {
    await client.query("UPDATE hr_query SET status = 'CLOSED', updated_at = now() WHERE hr_query_id = $1 AND status <> 'CLOSED'", [row.hr_query_id]);
  }
  await audit(client, {
    actorUserId: actorId,
    action: justified ? "attendance.day_waived" : "attendance.day_upheld",
    moduleKey: MODULE,
    entityRef: `attendance_day:${row.attendance_day_id}`,
    after: row,
  });
  return row;
}

/**
 * Reconciled days over a window — My HR, the payroll review sheet, the history
 * widget, analytics and the export all read THIS.
 *
 * ── WHY ONE READER AND NOT FIVE ────────────────────────────────────────────
 *
 * A day row is what an employee disputes and what payroll charges. The moment
 * the export selects its own columns, the export and the screen can disagree
 * about what a day was — and the person holding the spreadsheet is the one who
 * finds out. So the joins the export needs (department, entity, leave type, and
 * the punch's own location/device facts) live here, on the query everybody
 * already used, rather than in a second query beside it.
 *
 * ── THE CAP ────────────────────────────────────────────────────────────────
 *
 * One row per employee per day: with the window now 366 days (PR2 raised it
 * from 92), an unfiltered year on a 300-person roster is six figures of rows.
 * `limit` is a CEILING, not a page — a caller compares `rows.length` against it
 * to know the answer was cut short. It is deliberately well above any
 * interactive window and equal to the export's own row cap.
 *
 * @param {string[]} [employeeIds] up to 50. The compare set for analytics.
 * @param {string}   [department]  matched case- and whitespace-insensitively,
 *                                 the same way employees.repo matches it.
 */
const DAYS_LIMIT = 20000;
/** The compare set a person can actually read across. Also the bound that keeps
 *  `= ANY($n)` from being handed a 10k-element array. */
const MAX_EMPLOYEE_IDS = 50;

async function daysFor(client, { employeeId = null, employeeIds = null, department = null, from, to, limit = DAYS_LIMIT } = {}) {
  const params = [from, to];
  const wh = ["d.work_date BETWEEN $1 AND $2"];
  if (employeeId) { params.push(employeeId); wh.push(`d.employee_id = $${params.length}`); }
  const set = Array.isArray(employeeIds) ? employeeIds.filter(Boolean).slice(0, MAX_EMPLOYEE_IDS) : [];
  if (set.length) {
    params.push(set);
    wh.push(`d.employee_id = ANY($${params.length}::uuid[])`);
  }
  if (department) {
    params.push(department);
    wh.push(`lower(btrim(e.department)) = lower(btrim($${params.length}))`);
  }
  const cap = Math.min(Math.max(Number(limit) || DAYS_LIMIT, 1), DAYS_LIMIT);
  params.push(cap);
  const { rows } = await client.query(
    `SELECT d.*, e.full_name AS employee_name, e.department, e.entity_id,
            ce.legal_name AS entity_name,
            r.name AS rule_name, r.code AS rule_code,
            r.sop_document_id, s.title AS sop_title,
            lt.name AS leave_type_name,
            al.latitude, al.longitude, al.within_geofence, al.location_source,
            al.geo_label, al.distance_m, al.device_trusted,
            dev.label AS device_label
       FROM attendance_day d
       LEFT JOIN employee e ON e.employee_id = d.employee_id
       LEFT JOIN corporate_entity ce ON ce.entity_id = e.entity_id
       LEFT JOIN hr_rule r ON r.hr_rule_id = d.hr_rule_id
       LEFT JOIN sop_document s ON s.sop_document_id = r.sop_document_id
       LEFT JOIN leave_request lr ON lr.leave_request_id = d.leave_request_id
       LEFT JOIN leave_type lt ON lt.leave_type_id = lr.leave_type_id
       LEFT JOIN attendance_log al ON al.attendance_id = d.attendance_id
       LEFT JOIN hr_device dev ON dev.hr_device_id = al.hr_device_id
      WHERE ${wh.join(" AND ")}
      ORDER BY d.work_date DESC, e.full_name
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** What a period owes per employee — payroll's input (0698). */
async function chargesFor(client, { from, to }) {
  const { rows } = await client.query(
    `SELECT employee_id,
            sum(deduction_amount) FILTER (WHERE NOT justified)::numeric(18,2) AS deduction_total,
            count(*) FILTER (WHERE status = 'LATE' AND NOT justified)::int AS late_days,
            count(*) FILTER (WHERE status = 'ABSENT' AND NOT justified)::int AS absent_days,
            count(*) FILTER (WHERE status IN ('PRESENT','LATE'))::int AS present_days
       FROM attendance_day
      WHERE work_date BETWEEN $1 AND $2
      GROUP BY employee_id`,
    [from, to],
  );
  return rows;
}

module.exports = { reconcileDate, setJustified, daysFor, chargesFor, workingDaysInMonth, timezoneOf, DAYS_LIMIT, MAX_EMPLOYEE_IDS };
