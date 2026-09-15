/**
 * Human Capital — the HR domain, six tiles deep (D12).
 *
 * Declared in PR-1, flipped by PR-4. Two things the other domains did not
 * need spelled out:
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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
    labelKey: "dash.attrition90d",
    hintKey: "dash.attrition90dHint",
    badgeKey: null,
    tone: "bad",
    icon: "people",
    drillTo: "/hr/employees",
    sensitive_field: null,
  },
];

async function values() {
  return {};
}

module.exports = { ENTRIES, values };
