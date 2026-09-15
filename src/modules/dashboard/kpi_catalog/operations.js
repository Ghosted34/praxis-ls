/**
 * Operations — the movement queue, and the three governance signals that
 * describe work on files (approvals, compliance flags, the location queue).
 *
 * The SLA tile deliberately keeps its own one-liner instead of trusting
 * `kpis()`' NULLIF: the band's ratio policy needs the DENOMINATOR as well as
 * the value — "0 %" computed over 30 arrivals and "0 %" meaning "nothing has
 * been measured yet" must be distinguishable (guide §6.4). The statement is
 * otherwise the same `dossier_visible` pair the legacy key uses.
 *
 * `needs_location` reuses the repo's `NEEDS_LOCATION_EXPR` and `TOWER_FROM`
 * rather than restating them. Those expressions ARE the definition of "the
 * map cannot honestly plot this file"; a second copy is how the banner and
 * the tile start disagreeing about the same dossier.
 */
"use strict";

const ENTRIES = [
  {
    id: "sla_on_time",
    domain: "operations",
    unit: "pct",
    module: "MOD-29",
    sourceRelation: "dossier_visible",
    status: "live",
    labelKey: "dash.onTime",
    hintKey: "dash.onTimeHint",
    badgeKey: "dash.slaBadge",
    tone: "ok",
    icon: "sla",
    drillTo: "/operations/files",
    sensitive_field: null,
  },
  {
    id: "files_active",
    domain: "operations",
    unit: "count",
    module: "MOD-29",
    sourceRelation: "dossier_visible",
    status: "live",
    labelKey: "dash.filesActive",
    hintKey: "dash.filesActiveHint",
    badgeKey: "dash.filesActiveBadge",
    tone: "blue",
    icon: "files",
    drillTo: "/operations/files",
    sensitive_field: null,
  },
  {
    id: "approvals_awaiting",
    domain: "operations",
    unit: "count",
    module: "MOD-00A",
    sourceRelation: "approval_task",
    status: "live",
    labelKey: "dash.approvalsAwaiting",
    hintKey: "dash.approvalsAwaitingHint",
    badgeKey: "dash.approvalsAwaitingBadge",
    tone: "orange",
    icon: "approvals",
    drillTo: "/approvals",
    sensitive_field: null,
  },
  {
    id: "compliance_open",
    domain: "operations",
    unit: "count",
    module: "MOD-65",
    sourceRelation: "compliance_flag",
    status: "live",
    labelKey: "dash.complianceOpen",
    hintKey: "dash.complianceOpenHint",
    badgeKey: "dash.complianceOpenBadge",
    tone: "bad",
    icon: "compliance",
    drillTo: "/vault/compliance-flags",
    sensitive_field: null,
  },
  {
    id: "needs_location",
    domain: "operations",
    unit: "count",
    module: "MOD-00A",
    sourceRelation: "dossier_visible",
    status: "live",
    labelKey: "dash.needsLocation",
    hintKey: "dash.needsLocationHint",
    badgeKey: "dash.needsLocationBadge",
    tone: "warn",
    icon: "location",
    drillTo: "/operations/files",
    sensitive_field: null,
  },
  {
    id: "late_vs_eta",
    domain: "operations",
    unit: "count",
    module: "MOD-29",
    sourceRelation: "dossier_visible",
    status: "hidden",
    labelKey: "dash.lateVsEta",
    hintKey: "dash.lateVsEtaHint",
    badgeKey: "dash.lateVsEtaBadge",
    tone: "bad",
    icon: "overdue",
    drillTo: "/operations/files",
    sensitive_field: null,
  },
  {
    id: "dwell_days",
    domain: "operations",
    unit: "days",
    module: "MOD-31",
    sourceRelation: "milestone_instance",
    status: "hidden",
    labelKey: "dash.dwellDays",
    hintKey: "dash.dwellDaysHint",
    badgeKey: null,
    tone: "mute",
    icon: "clock",
    drillTo: "/operations/milestones",
    sensitive_field: null,
  },
];

/** Live tile values. See `money.js` for the guard contract. */
async function values(client, { count, ratio }) {
  // Imported rather than restated: this expression pair IS the tower's
  // definition of "unplottable", and the banner and the tile must not drift.
  const { TOWER_FROM, NEEDS_LOCATION_EXPR } = require("../dashboard/dashboard.repo");
  const out = {};
  out.sla_on_time = await ratio(
    client,
    "SELECT round(100.0 * count(*) FILTER (WHERE ata <= eta)) AS value, " +
      "count(*) FILTER (WHERE ata IS NOT NULL AND eta IS NOT NULL) AS denominator " +
      "FROM dossier_visible",
  );
  out.files_active = await count(
    client,
    "SELECT count(*) n FROM dossier_visible WHERE status IN ('OPEN','IN_PROGRESS')",
  );
  out.approvals_awaiting = await count(
    client,
    "SELECT count(*) n FROM approval_task WHERE status = 'PENDING'",
  );
  out.compliance_open = await count(
    client,
    "SELECT count(*) n FROM compliance_flag WHERE resolved_at IS NULL",
  );
  out.needs_location = await count(
    client,
    `SELECT COUNT(*) n ${TOWER_FROM} WHERE d.status IN ('OPEN','IN_PROGRESS') AND ${NEEDS_LOCATION_EXPR}`,
  );
  return out;
}

module.exports = { ENTRIES, values };
