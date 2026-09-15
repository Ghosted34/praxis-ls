/**
 * Human Capital — the HR domain, six tiles deep (D12).
 *
 * Declared in PR-1, flipped live by PR-4. Two things the other domains did
 * not need spelled out:
 *
 * THE DOMAIN EXISTS BECAUSE PERMISSIONS RUN BOTH WAYS. "HR sees human
 * capital, Operations does not" is the grant gate; "the roles with payroll
 * rows must not see salary figures" is the field-visibility layer — which is
 * why `payroll_run_state` declares `sensitive_field` even though the tile
 * itself shows a count: the guide's single rule (§4.3) is *masked field ⇒
 * tile unavailable*, applied uniformly, because a per-tile debate about which
 * aggregates leak is how a band ends up shipping one exception too many. If
 * PR-4 finds a tile that genuinely survives masking, that is a catalog
 * feature decision (`sensitive_scope: "drill"`), not a one-off in a resolver.
 *
 * ATTRITION IS EVENT-SOURCED ON PURPOSE. A count of deactivated employees can
 * be written from `employee` status alone; it was specified against the
 * `employee.deactivated` event stream so a reactivation does not silently
 * vanish from the 90-day window the way a status column rewrite would.
 */
"use strict";

const ENTRIES = [
  {
    id: "headcount",
    domain: "human_capital",
    unit: "count",
    module: "MOD-02",
    sourceRelation: "employee",
    status: "live",
    labelKey: "dash.headcount",
    hintKey: "dash.headcountHint",
    badgeKey: null,
    tone: "blue",
    icon: "people",
    drillTo: "/hr/employees",
    sensitive_field: null,
  },
  {
    id: "attendance_today",
    domain: "human_capital",
    unit: "pair",
    module: "MOD-14",
    sourceRelation: "attendance_log",
    status: "live",
    labelKey: "dash.attendanceToday",
    hintKey: "dash.attendanceTodayHint",
    badgeKey: null,
    tone: "ok",
    icon: "clock",
    drillTo: "/hr/attendance",
    sensitive_field: null,
  },
  {
    id: "leave_pending",
    domain: "human_capital",
    unit: "count",
    module: "MOD-15",
    sourceRelation: "leave_request",
    status: "live",
    labelKey: "dash.leavePending",
    hintKey: "dash.leavePendingHint",
    badgeKey: null,
    tone: "warn",
    icon: "files",
    drillTo: "/hr/leave",
    sensitive_field: null,
  },
  {
    id: "vacancies_open",
    domain: "human_capital",
    unit: "count",
    module: "MOD-11",
    sourceRelation: "vacancy",
    status: "live",
    labelKey: "dash.vacanciesOpen",
    hintKey: "dash.vacanciesOpenHint",
    badgeKey: null,
    tone: "mute",
    icon: "people",
    drillTo: "/hr/vacancies",
    sensitive_field: null,
  },
  {
    id: "payroll_run_state",
    domain: "human_capital",
    unit: "count",
    module: "MOD-17",
    sourceRelation: "payroll_run",
    status: "live",
    labelKey: "dash.payrollRunState",
    hintKey: "dash.payrollRunStateHint",
    badgeKey: null,
    tone: "orange",
    icon: "journal",
    drillTo: "/hr/payroll",
    // Masks the AMOUNT inside the drill, not the tile: the run's existence is
    // payroll business, the figure is salary business (see header).
    sensitive_field: "employee.salary",
  },
  {
    id: "attrition_90d",
    domain: "human_capital",
    unit: "count",
    module: "MOD-02",
    sourceRelation: "event_log",
    status: "live",
    labelKey: "dash.attrition90d",
    hintKey: "dash.attrition90dHint",
    badgeKey: null,
    tone: "bad",
    icon: "people",
    drillTo: "/hr/employees",
    sensitive_field: null,
  },
];

/**
 * The attendance pair, as one statement. The DENOMINATOR is the whole point
 * (guide §6.4): "0 clocked in" and "nobody was expected" must arrive as
 * different answers, so the expected set is computed, not defaulted to the
 * active headcount — a Sunday that reads "0 / 25" is asserting twenty-five
 * absences nobody was expected to commit.
 *
 * The working-day rule mirrors the reconciler's precedence
 * (attendance.rules.isWorkingDay): the employee's `work_days` override first,
 * else the tenant `hr.weekend_days` setting (both seeded shapes — a bare
 * array and `{days: [...]}` — with the [0,6] default and the same
 * junk-falls-back-to-default behaviour leave_allowance.service.weekendDays
 * applies), and approved or taken leave plus `public_holiday` remove the day
 * entirely, because `reconcileDay` lets approved leave beat even a real
 * punch. What this deliberately does NOT consult is the per-entity working
 * calendar (attendance.calendar layer 2): that resolver loads a JS context
 * per entity, which is a report's cost, not a headline tile's — the hint line
 * names the basis ("expected today") so the smaller truth stays honest.
 *
 * "Today" is the TENANT's zone from `hr.timezone`, never the server clock's
 * UTC date — the dayWindowSql lesson: `clock_in_at::date` drops a 00:30
 * Douala punch onto yesterday.
 */
const ATTENDANCE_TODAY_SQL = `
  WITH cfg AS (
    SELECT COALESCE(NULLIF((SELECT s.value #>> '{}'
                              FROM setting s
                             WHERE s.section = 'hr' AND s.key = 'timezone'), ''),
                    'Africa/Douala') AS tz,
           (SELECT s.value FROM setting s
             WHERE s.section = 'hr' AND s.key = 'weekend_days') AS weekend_raw
  ), today AS (
    SELECT (now() AT TIME ZONE cfg.tz)::date AS d, cfg.tz AS tz FROM cfg
  ), weekend AS (
    SELECT CASE WHEN cardinality(w.days) > 0 THEN w.days ELSE ARRAY[0,6]::smallint[] END AS days
    FROM (
      SELECT COALESCE(ARRAY(SELECT t.x::smallint
                              FROM jsonb_array_elements(
                                       CASE WHEN jsonb_typeof(cfg.weekend_raw) = 'array'
                                            THEN cfg.weekend_raw
                                            WHEN jsonb_typeof(cfg.weekend_raw) = 'object'
                                             AND jsonb_typeof(cfg.weekend_raw -> 'days') = 'array'
                                              THEN cfg.weekend_raw -> 'days'
                                            ELSE NULL::jsonb END) AS t(x)
                             WHERE t.x::text ~ '^[0-6]$'),
                     ARRAY[]::smallint[]) AS days
      FROM cfg
    ) w
  ), expected AS (
    SELECT e.employee_id
      FROM employee e, today, weekend
     WHERE e.is_active
       AND (CASE WHEN cardinality(e.work_days) > 0
                 THEN EXTRACT(DOW FROM today.d)::smallint = ANY(e.work_days)
                 ELSE NOT (EXTRACT(DOW FROM today.d)::smallint = ANY(weekend.days))
            END)
       AND NOT EXISTS (SELECT 1
                         FROM leave_request lr
                        WHERE lr.employee_id = e.employee_id
                          AND lr.status IN ('APPROVED','TAKEN')
                          AND lr.starts_on <= today.d AND lr.ends_on >= today.d)
       AND NOT EXISTS (SELECT 1
                         FROM public_holiday ph
                        WHERE ph.is_active
                          AND (ph.holiday_on = today.d
                               OR (ph.is_recurring
                                   AND date_part('month', ph.holiday_on) = date_part('month', today.d)
                                   AND date_part('day',   ph.holiday_on) = date_part('day',   today.d))))
  )
  SELECT
    (SELECT count(*) FROM expected ex
       WHERE EXISTS (SELECT 1
                       FROM attendance_log al
                      WHERE al.employee_id = ex.employee_id
                        AND al.clock_in_at >= (today.d::timestamp AT TIME ZONE today.tz)
                        AND al.clock_in_at <  ((today.d + 1)::timestamp AT TIME ZONE today.tz))) AS value,
    (SELECT count(*) FROM expected) AS denominator
  FROM today`;

/**
 * Values for the live Human Capital tiles. Guard contract per money.js: a
 * missing relation answers null (the tile is unavailable), an empty one
 * answers 0 (an asserted zero) — never the reverse, and never an error past
 * this function: the band is additive, one broken query costs one tile.
 *
 * Each key is written by a guard call and guards swallow, so every live id is
 * answered even against a dead client — that is what index.checkValueCoverage
 * leans on when a domain PR flips entries.
 */
async function values(client, { count, ratio }) {
  const out = {};
  out.headcount = await count(
    client,
    "SELECT count(*) n FROM employee WHERE is_active",
  );
  out.attendance_today = await ratio(client, ATTENDANCE_TODAY_SQL);
  out.leave_pending = await count(
    client,
    // The same queue the Leave screen decides (status=REQUESTED with salary
    // advances excluded — they have had their own tab since 0698): the tile
    // and the hub must not disagree about the one number HR opens it for.
    "SELECT count(*) n FROM leave_request WHERE status = 'REQUESTED' AND COALESCE(kind, 'leave') <> 'salary_advance'",
  );
  out.vacancies_open = await count(
    client,
    "SELECT count(*) n FROM vacancy WHERE status = 'OPEN'",
  );
  out.payroll_run_state = await count(
    client,
    // "State" as a count: runs not yet in a terminal state — DISBURSED and
    // REJECTED are the state machine's ends, everything between is payroll
    // mid-cycle, including a stuck run from an older period, which a
    // "latest run" reading would silently declare settled. 0 asserts "every
    // run is disbursed or rejected", which is as true on a young tenant with
    // no payroll as on a disciplined one.
    "SELECT count(*) n FROM payroll_run WHERE status NOT IN ('DISBURSED','REJECTED')",
  );
  out.attrition_90d = await count(
    client,
    // The EVENT stream, not employee.status — see the header. event_log is
    // append-only (trg_eventlog_ro), so a later reactivation cannot rewrite
    // the window; it adds employee.reactivated beside, and the departure
    // stays counted for its 90 days.
    "SELECT count(*) n FROM event_log WHERE event_type_key = 'employee.deactivated' AND created_at >= now() - interval '90 days'",
  );
  return out;
}

module.exports = { ENTRIES, values };
