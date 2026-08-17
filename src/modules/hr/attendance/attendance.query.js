/**
 * The lateness query — raised at the punch, settled by the reconciler (0704).
 *
 * ── WHY THIS IS ONE MODULE AND NOT TWO CALL SITES ──────────────────────────
 *
 * A query used to be raised only by the nightly reconciler. Somebody who walked
 * in ninety minutes late on Tuesday was asked about it on Wednesday, by which
 * point the honest answer — "the ferry was cancelled" — has to be RECALLED
 * rather than simply given, and the manager who watched them arrive has moved
 * on. Asking at the punch is the whole point of asking at all.
 *
 * But both paths now write the same row, and they must not disagree about its
 * wording, its severity or its identity. So the wording is one pure function
 * and the write is one upsert, keyed on the partial unique index 0704 adds:
 *
 *     ux_hr_query_auto_day (employee_id, work_date, hr_rule_id)
 *                          WHERE source <> 'MANUAL'
 *
 * ── THE UPSERT IS THE DESIGN, NOT A CONVENIENCE ────────────────────────────
 *
 * At clock-in there is no `attendance_day` row yet, so there is nowhere to put
 * `hr_query_id` — which is exactly what the reconciler checks before raising.
 * Left alone it would raise a SECOND query that night for the same morning.
 * `ON CONFLICT … DO UPDATE` means the reconciler ADOPTS the punch's query and
 * updates it with the settled figure instead, and the database refuses the
 * duplicate even if some future path forgets to look.
 *
 * ── WHAT THE RECONCILER MAY AND MAY NOT OVERWRITE ──────────────────────────
 *
 * It may sharpen the facts: the settled minutes and the deduction that follows.
 * It must NOT touch `status`, `response` or `responded_at`. Somebody who
 * answered at 09:05 has answered; re-opening their query at midnight because a
 * batch job ran would discard a reply and ask them again for no reason.
 */
"use strict";
const { logger } = require("../../../config/logger");

/**
 * The words. Pure, so the two paths cannot drift and the phrasing is testable
 * without a database — this text is read by the person being charged, and it is
 * the only explanation they get.
 *
 * `settled` distinguishes the two moments. At the punch the deduction is a
 * PROSPECT ("this would carry…"), because the day is not over and leave, a
 * correction or a manager's waiver can still change it. Stating it as a fact at
 * 08:40 and then charging something different is how a system loses the benefit
 * of having asked early.
 */
function composeQuery({ rule, workDate, minutesLate = null, expectedStart = null, deduction = 0, absent = false, settled = false }) {
  const subject = `${rule.name} — ${workDate}`;
  const what = absent
    ? `You were recorded absent on ${workDate}, with no approved leave.`
    : `You clocked in ${minutesLate} minute(s) after your ${expectedStart || "expected"} start on ${workDate}.`;

  let cost = "";
  if (Number(deduction) > 0) {
    cost = settled
      ? ` Under "${rule.name}" this carries a deduction of ${deduction}, which stands until this query is resolved.`
      : ` Under "${rule.name}" this would carry a deduction of ${deduction} unless it is explained or waived.`;
  } else if (!settled && rule.effect !== "QUERY_ONLY") {
    // The rule charges, but not at this many minutes yet. Saying so is more use
    // than silence: it tells somebody who is 20 minutes late that they are
    // inside the grace window, which is information they can act on tomorrow.
    cost = " No deduction applies at this point.";
  }
  return { subject, body: `${what}${cost}\n\nPlease explain.` };
}

/**
 * Raise or refresh the auto-query for one person, one day, one rule.
 *
 * Returns the query id either way, so a caller can link to it without caring
 * which of the two paths got there first.
 */
async function upsertAutoQuery(client, {
  employeeId, workDate, rule, source,
  minutesLate = null, expectedStart = null, deduction = 0,
  absent = false, settled = false, attendanceId = null, actorId = null,
}) {
  const { subject, body } = composeQuery({ rule, workDate, minutesLate, expectedStart, deduction, absent, settled });
  const { rows } = await client.query(
    `INSERT INTO hr_query (employee_id, subject, body, severity, due_at, issued_by,
                           work_date, hr_rule_id, attendance_id, source, minutes_late)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6, $7,$8,$9,$10,$11)
     ON CONFLICT (employee_id, work_date, hr_rule_id)
       WHERE source <> 'MANUAL' AND work_date IS NOT NULL AND hr_rule_id IS NOT NULL
     DO UPDATE SET
       -- The reconciler sharpens the facts it now knows.
       subject       = EXCLUDED.subject,
       body          = EXCLUDED.body,
       minutes_late  = COALESCE(EXCLUDED.minutes_late, hr_query.minutes_late),
       attendance_id = COALESCE(EXCLUDED.attendance_id, hr_query.attendance_id),
       -- NOT status, response or responded_at. Somebody who answered at 09:05
       -- has answered; a batch job at midnight must not discard their reply and
       -- ask again. The source column is likewise kept as the FIRST
       -- raiser: it records where the conversation started.
       updated_at    = now()
     RETURNING hr_query_id, source, status`,
    [employeeId, subject, body, rule.query_severity,
      String(rule.query_due_days), actorId, workDate, rule.hr_rule_id,
      attendanceId, source, minutesLate],
  );
  const row = rows[0];
  logger.debug(
    { employee: employeeId, date: workDate, rule: rule.code, source, adopted: row.source !== source },
    "[attendance] auto-query upserted",
  );
  return row;
}

/** The auto-query already standing for this person, day and rule — what the
 *  reconciler looks for before deciding whether it is raising or adopting. */
async function findAutoQuery(client, { employeeId, workDate, ruleId }) {
  if (!employeeId || !workDate || !ruleId) return null;
  const { rows } = await client.query(
    `SELECT * FROM hr_query
      WHERE employee_id = $1 AND work_date = $2 AND hr_rule_id = $3 AND source <> 'MANUAL'
      LIMIT 1`,
    [employeeId, workDate, ruleId],
  );
  return rows[0] || null;
}

module.exports = { composeQuery, upsertAutoQuery, findAutoQuery };
