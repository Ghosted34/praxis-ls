/**
 * Money — the currency-bearing tiles.
 *
 * WHY THE OVERDUE TILE CALLS THE RECEIVABLES SERVICE INSTEAD OF WRITING ITS
 * OWN SQL. "Past due" is a definition, not a count: outstanding = total_ttc
 * net of payment_allocation, aged against payment_due_on, in minor units so
 * float addition cannot drift the total away from the ageing report's. The
 * finance module owns that definition (`smart_receivables.service.overdue`);
 * a second SQL expression of it in the tower would disagree with the hub in
 * the one place a CEO notices — tile says 6.8, hub says 6.79. Importing the
 * service is the same pattern `dashboard.service.js` already uses for the
 * map's geo/itinerary reads.
 *
 * revenue keeps its own statement: it is one COALESCE'd SUM over `invoice`,
 * and `dashboard.repo.js` still answers the legacy key from the identical
 * text. The pairing is documented in `doc/KPI_BAND_ENGINEERING_GUIDE.md` §1:
 * an all-time total, badged "Locked", never MTD.
 */
"use strict";

const ENTRIES = [
  {
    id: "revenue",
    domain: "money",
    unit: "money",
    module: "MOD-51",
    sourceRelation: "invoice",
    status: "live",
    labelKey: "dash.revenue",
    hintKey: "dash.revenueHint",
    badgeKey: "dash.locked",
    tone: "orange",
    icon: "revenue",
    drillTo: "/finance/invoices",
    sensitive_field: null,
  },
  {
    id: "receivables_overdue",
    domain: "money",
    unit: "money",
    module: "MOD-52",
    sourceRelation: "invoice",
    status: "live",
    labelKey: "dash.pastDue",
    hintKey: "dash.pastDueHint",
    badgeKey: "dash.pastDueBadge",
    tone: "warn",
    icon: "overdue",
    drillTo: "/finance/receivables",
    sensitive_field: null,
  },
  {
    id: "proformas_open",
    domain: "money",
    unit: "count",
    module: "MOD-50",
    sourceRelation: "invoice",
    status: "live",
    labelKey: "dash.proformasOpen",
    hintKey: "dash.proformasOpenHint",
    badgeKey: "dash.proformasOpenBadge",
    tone: "blue",
    icon: "proforma",
    drillTo: "/finance/proformas",
    sensitive_field: null,
  },
  {
    id: "journals_unposted",
    domain: "money",
    unit: "count",
    module: "MOD-55",
    sourceRelation: "journal_entry",
    status: "live",
    labelKey: "dash.journalsUnposted",
    hintKey: "dash.journalsUnpostedHint",
    badgeKey: "dash.journalsUnpostedBadge",
    tone: "mute",
    icon: "journal",
    drillTo: "/finance/journals",
    sensitive_field: null,
  },
  // Declared now, flipped by PR-3 (the guide's parallel-PR split). A hidden
  // entry costs nothing and buys the migration a stable id to seed toward.
  {
    id: "cash_collected",
    domain: "money",
    unit: "money",
    module: "MOD-52",
    sourceRelation: "payment_receipt",
    status: "hidden",
    labelKey: "dash.cashCollected",
    hintKey: "dash.cashCollectedHint",
    badgeKey: null,
    tone: "ok",
    icon: "receipt",
    drillTo: "/finance/receivables",
    sensitive_field: null,
  },
  {
    id: "payables_overdue",
    domain: "money",
    unit: "money",
    module: "MOD-53",
    sourceRelation: "supplier_invoice",
    status: "hidden",
    labelKey: "dash.payablesOverdue",
    hintKey: "dash.payablesOverdueHint",
    badgeKey: "dash.payablesOverdueBadge",
    tone: "warn",
    icon: "overdue",
    drillTo: "/finance/debt",
    sensitive_field: null,
  },
  {
    id: "cash_requests_awaiting",
    domain: "money",
    unit: "count",
    module: "MOD-49",
    sourceRelation: "cash_request",
    status: "hidden",
    labelKey: "dash.cashRequests",
    hintKey: "dash.cashRequestsHint",
    badgeKey: "dash.cashRequestsBadge",
    tone: "bad",
    icon: "approvals",
    drillTo: "/costing/cash-requests",
    sensitive_field: null,
  },
  {
    id: "margin_closed",
    domain: "money",
    unit: "pct",
    module: "MOD-46",
    sourceRelation: "costing_result",
    status: "hidden",
    labelKey: "dash.marginClosed",
    hintKey: "dash.marginClosedHint",
    badgeKey: null,
    tone: "orange",
    icon: "margin",
    drillTo: "/commercial/margin-simulation",
    // A masked reader gets NO tile — "margin 0.0" from a role that must not
    // see margin is a leak-shaped answer to a question they may not ask.
    sensitive_field: "dossier.margin",
  },
  {
    id: "dso",
    domain: "money",
    unit: "days",
    module: "MOD-51",
    sourceRelation: "invoice",
    status: "hidden",
    labelKey: "dash.dso",
    hintKey: "dash.dsoHint",
    badgeKey: null,
    tone: "blue",
    icon: "overdue",
    drillTo: "/finance/receivables",
    sensitive_field: null,
  },
];

/**
 * Values for the LIVE money tiles. Guarded in the repo's own style — a
 * missing table answers null (unavailable), an empty one answers 0 (an
 * asserted zero). Never let an error past here: the band is additive, a
 * broken query costs one tile, not the tower.
 */
async function values(client, { num, count }) {
  const out = {};
  out.revenue = await num(
    client,
    "SELECT COALESCE(SUM(total_ttc), 0) n FROM invoice WHERE type='FINAL' AND status IN ('ISSUED_LOCKED','APPROVED_LOCKED','POSTED_LOCKED')",
  );
  try {
    // LAZY require, inside the try: if the receivables module cannot even
    // load — feature off in a stripped deploy, its own dependency missing —
    // the failure must cost ONE tile, not the whole `/kpis` response. A
    // require that throws at the top of this function took the band down with
    // it in the first smoke run; the ordering below makes each tile's answer
    // independent of every other's.
    const receivables = require("../../finance/smart_receivables/smart_receivables.service");
    const over = await receivables.overdue(client);
    out.receivables_overdue = Number(over && over.total) || 0;
  } catch {
    // The guard swallow of `count()`, deliberate: the receivables feature may
    // be off; null means the tile is UNAVAILABLE, which is exactly right.
    out.receivables_overdue = null;
  }
  out.proformas_open = await count(
    client,
    "SELECT count(*) n FROM invoice WHERE type='PROFORMA'",
  );
  out.journals_unposted = await count(
    client,
    "SELECT count(*) n FROM journal_entry WHERE status='draft'",
  );
  return out;
}

module.exports = { ENTRIES, values };
