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
    status: "live",
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
    status: "live",
    labelKey: "dash.dwellDays",
    hintKey: "dash.dwellDaysHint",
    badgeKey: null,
    tone: "mute",
    icon: "clock",
    drillTo: "/operations/milestones",
    sensitive_field: null,
  },
];

/**
 * Live tile values. See `money.js` for the guard contract.
 *
 * PR-2 additions (late_vs_eta, dwell_days) — the zero policy, per tile:
 *
 *   late_vs_eta   a COUNT: an installed tenant with nothing late answers 0,
 *                 and 0 is the truth ("nothing is past its ETA"). ETA is a
 *                 DATE column, so "late" is `eta < CURRENT_DATE` — a file due
 *                 today is not late yet — and only while it is still moving
 *                 (OPEN/IN_PROGRESS) with no ATA recorded.
 *
 *   dwell_days    an AVERAGE, and an average over nothing is not 0 days. It
 *                 goes through `num()` so SQL NULL survives: no delivery in
 *                 the window → null → the tile is unavailable and drops out
 *                 of the band, rather than asserting "0 days" — which would be
 *                 a claim about speed, not an absence of data (§6.3, D3).
 *                 The pair is the chain's own milestones, not dossier.eta/ata:
 *                 the first `is_anchor` stage DONE (vessel/flight arrived,
 *                 gate-in — the event the schedule hangs on) to an
 *                 `is_target_lock` stage DONE (the delivery commitment), per
 *                 the 0650 engine's meaning of those flags. Window: deliveries
 *                 completed in the last 90 days — "current period" read as a
 *                 rolling window, because a calendar month resets the tile to
 *                 unavailable on the 1st of every month for any tenant that
 *                 delivers less than daily.
 */
async function values(client, { count, num, ratio }) {
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
  out.late_vs_eta = await count(
    client,
    "SELECT count(*) n FROM dossier_visible " +
      "WHERE status IN ('OPEN','IN_PROGRESS') AND eta IS NOT NULL AND eta < CURRENT_DATE AND ata IS NULL",
  );
  out.dwell_days = await num(
    client,
    "SELECT round(AVG(EXTRACT(EPOCH FROM (dl.completed_at - ar.completed_at)) / 86400.0)) AS n " +
      "FROM milestone_instance dl " +
      "JOIN dossier_visible d ON d.dossier_id = dl.dossier_id " +
      "JOIN LATERAL (" +
      "SELECT a.completed_at FROM milestone_instance a " +
      "WHERE a.dossier_id = dl.dossier_id AND a.is_anchor AND a.status = 'DONE' AND a.completed_at IS NOT NULL " +
      "ORDER BY a.stage_seq ASC LIMIT 1" +
      ") ar ON true " +
      "WHERE dl.is_target_lock AND dl.status = 'DONE' AND dl.completed_at IS NOT NULL " +
      "AND dl.completed_at >= ar.completed_at " +
      "AND dl.completed_at >= now() - interval '90 days'",
  );
  return out;
}

module.exports = { ENTRIES, values };
