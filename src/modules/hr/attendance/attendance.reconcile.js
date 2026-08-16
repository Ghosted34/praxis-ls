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

const MODULE = "MOD-14";

/** The tenant's workplace clock. Douala unless told otherwise (0697). */
async function timezoneOf(client) {
  const v = await getSetting(client, "hr", "timezone", "Africa/Douala");
  return typeof v === "string" && v.trim() ? v.trim() : "Africa/Douala";
}

/** Tenant-wide shift defaults; per-employee columns override them. */
async function policyOf(client) {
  const v = (await getSetting(client, "hr", "attendance_policy", null)) || {};
  return {
    start: typeof v.work_start === "string" ? v.work_start : "08:00",
    grace: Number.isFinite(Number(v.grace_minutes)) ? Number(v.grace_minutes) : 10,
  };
}

/** Which days the tenant does not work. Shared with leave (0696). */
async function weekendOf(client) {
  const v = await getSetting(client, "hr", "weekend_days", null);
  const list = Array.isArray(v) ? v : v && Array.isArray(v.days) ? v.days : null;
  const clean = (list || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return clean.length ? clean : leaveRules.DEFAULT_WEEKEND;
}

/** The active rule of a kind, or null. First by code, so the choice is stable. */
async function activeRule(client, kind) {
  const { rows } = await client.query(
    "SELECT * FROM hr_rule WHERE kind = $1 AND is_active ORDER BY code LIMIT 1",
    [kind],
  );
  return rows[0] || null;
}

/** Working days in a calendar month, for the daily rate. */
function workingDaysInMonth(year, month, { weekendDays, workDays, holidays }) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d += 1) {
    const at = new Date(Date.UTC(year, month - 1, d));
    if (!rules.isWorkingDay(at.getUTCDay(), { work_days: workDays, weekendDays })) continue;
    if (leaveRules.isNonWorkingDay(at, { weekendDays: [], holidays })) continue;
    n += 1;
  }
  return n;
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
  const [policy, weekendDays, latenessRule, absenceRule] = await Promise.all([
    policyOf(client),
    weekendOf(client),
    activeRule(client, "LATENESS"),
    activeRule(client, "ABSENCE"),
  ]);

  const { rows: holidays } = await client.query("SELECT holiday_on, is_recurring FROM public_holiday WHERE is_active");
  const parsed = leaveRules.parseDate(day);
  if (!parsed) throw new Error(`reconcileDate: unusable date ${day}`);
  const asDate = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  const isHoliday = leaveRules.isNonWorkingDay(asDate, { weekendDays: [], holidays });

  const { rows: roster } = await client.query(
    `SELECT employee_id, full_name, base_salary, expected_start_time, grace_minutes, work_days
       FROM employee WHERE is_active ORDER BY employee_id`,
  );

  // One query each rather than per employee: a 300-person roster would
  // otherwise be 900 round trips for one night's reconciliation.
  const { rows: punches } = await client.query(
    `SELECT DISTINCT ON (employee_id) employee_id, attendance_id, clock_in_at, clock_out_at
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
  // A punch is matched to the day it fell on IN THE WORKPLACE ZONE. Matching on
  // `clock_in_at::date` would be the UTC date, which puts a 00:30 Douala punch
  // on the previous day and a 23:30 one on the next.
  const punchBy = {};
  for (const p of punches) {
    if (rules.localDate(p.clock_in_at, timeZone) === day) punchBy[p.employee_id] = p;
  }

  const actorId = await resolveActorId(client, actor.user_id);
  let charged = 0;
  let written = 0;

  for (const emp of roster) {
    const workDays = emp.work_days && emp.work_days.length ? emp.work_days.map(Number) : null;
    const isWorking = rules.isWorkingDay(asDate.getUTCDay(), { work_days: workDays, weekendDays });
    const punch = punchBy[emp.employee_id] || null;
    const leave = leaveBy[emp.employee_id] || null;

    const monthDays = workingDaysInMonth(parsed.y, parsed.m, { weekendDays, workDays, holidays });
    const dailyRate = rules.dailyRate(emp.base_salary, monthDays);
    const expectedStart = emp.expected_start_time || policy.start;
    const grace = emp.grace_minutes === null || emp.grace_minutes === undefined ? policy.grace : Number(emp.grace_minutes);

    const decided = rules.reconcileDay({
      clock_in_at: punch ? punch.clock_in_at : null,
      clock_out_at: punch ? punch.clock_out_at : null,
      on_leave: !!leave,
      leave_is_paid: leave ? leave.is_paid : true,
      is_holiday: isHoliday,
      is_working_day: isWorking,
      expected_start_time: expectedStart,
      grace_minutes: grace,
      timeZone,
      daily_rate: dailyRate,
      latenessRule,
      absenceRule,
    });

    const row = await upsertDay(client, {
      employee_id: emp.employee_id,
      work_date: day,
      status: decided.status,
      expected_start_time: expectedStart,
      grace_minutes: grace,
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

    // The query is raised AFTER the row exists, so it can point at it — and
    // only once, however many times the day is reconciled.
    const rule = decided.hr_rule_id === (latenessRule && latenessRule.hr_rule_id) ? latenessRule : absenceRule;
    if (rule && rule.auto_query && !row.hr_query_id && !row.justified && decided.hr_rule_id) {
      await raiseQuery(client, { day: row, employee: emp, rule, actorId });
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

/** Raise the rule's query and point the day at it. */
async function raiseQuery(client, { day, employee, rule, actorId }) {
  const what = day.status === "ABSENT"
    ? `You were recorded absent on ${day.work_date}, with no approved leave.`
    : `You clocked in ${day.minutes_late} minute(s) after your ${day.expected_start_time} start on ${day.work_date}.`;
  const cost = Number(day.deduction_amount) > 0
    ? ` Under "${rule.name}" this carries a deduction of ${day.deduction_amount}, which stands until this query is resolved.`
    : "";
  const { rows } = await client.query(
    `INSERT INTO hr_query (employee_id, subject, body, severity, due_at, issued_by)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6) RETURNING hr_query_id`,
    [employee.employee_id, `${rule.name} — ${day.work_date}`, `${what}${cost}\n\nPlease explain.`,
      rule.query_severity, String(rule.query_due_days), actorId],
  );
  await client.query("UPDATE attendance_day SET hr_query_id = $2 WHERE attendance_day_id = $1", [day.attendance_day_id, rows[0].hr_query_id]);
  logger.debug({ employee: employee.employee_id, date: day.work_date, rule: rule.code }, "[attendance] auto-query raised");
  return rows[0].hr_query_id;
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

/** One employee's reconciled month, for My HR and the payroll review sheet. */
async function daysFor(client, { employeeId = null, from, to }) {
  const params = [from, to];
  let where = "d.work_date BETWEEN $1 AND $2";
  if (employeeId) { params.push(employeeId); where += ` AND d.employee_id = $${params.length}`; }
  const { rows } = await client.query(
    `SELECT d.*, e.full_name AS employee_name, r.name AS rule_name, r.code AS rule_code,
            r.sop_document_id, s.title AS sop_title
       FROM attendance_day d
       LEFT JOIN employee e ON e.employee_id = d.employee_id
       LEFT JOIN hr_rule r ON r.hr_rule_id = d.hr_rule_id
       LEFT JOIN sop_document s ON s.sop_document_id = r.sop_document_id
      WHERE ${where}
      ORDER BY d.work_date DESC, e.full_name`,
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

module.exports = { reconcileDate, setJustified, daysFor, chargesFor, workingDaysInMonth, timezoneOf };
