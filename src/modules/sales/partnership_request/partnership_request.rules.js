/**
 * Partnership request (MOD-25) — pure lifecycle and KPI arithmetic. No SQL, no
 * I/O, so every rule below is testable without a database.
 *
 * THE LIFECYCLE, AND THE ONE PLACE IT IS STRICTER THAN THE LEGACY.
 *
 * The legacy's update.php takes any of its four statuses by POST and writes it,
 * so NEW -> APPROVED in one call is legal and leaves no record that anybody
 * looked. Here, APPROVED is reachable only from IN_REVIEW. That is not
 * ceremony: approving a vendor registration is what creates a party this
 * company can be invoiced by, and "somebody opened it" is the minimum evidence
 * that decision should rest on. Rejection stays reachable from either state —
 * an obviously unsuitable application should not need a review step first.
 *
 * REJECTED IS NOT TERMINAL. An agent turned down for a missing certificate
 * re-applies with it, and the register that cannot re-open its own decision
 * grows a second row for the same company — which is precisely what makes the
 * duplicate-supplier check later matter. Re-opening returns the row to
 * IN_REVIEW; the original decision_reason stays on the audit trail.
 *
 * THE TILES. The legacy renders four — total, agency, vendor, pending — and
 * they do not partition anything: agency + vendor already IS total, and pending
 * cuts a different dimension entirely. They are kept, because they are the four
 * an intake desk actually wants, but they are DERIVED here from two complete
 * partitions (one per status, one per type) and `assertPartitions` proves both
 * add up before a response leaves the service. The failure this guards against
 * is the one F6 documents at length: a fifth status added later that belongs to
 * no tile, so the counters quietly describe a subset of the register.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const STATUSES = ["NEW", "IN_REVIEW", "APPROVED", "REJECTED"];
const TYPES = ["AGENCY_PARTNERSHIP", "VENDOR_REGISTRATION"];

/** Statuses whose applicant-facing fields are frozen. Notes stay writable. */
const DECIDED = ["APPROVED"];

const NEXT = {
  NEW: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [],
  // Re-application: the applicant came back with the document that was missing.
  REJECTED: ["IN_REVIEW"],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move partnership request ${from} -> ${to}`, 422);
  }
  return true;
}

/** True once the record's applicant fields are history rather than a draft. */
const isDecided = (status) => DECIDED.includes(status);

/**
 * Does approving THIS application create a supplier?
 *
 * A vendor registration always does — that is the whole correction F10 makes to
 * the legacy's "approved vendors must be manually onboarded". An agency
 * partnership does so only when the approver asks: an approved forwarding agent
 * is often a party we will be invoiced by (destination charges), and just as
 * often one we only ever send work to, and nothing in the application says
 * which. So the approver decides, per application, and the default is no.
 */
function suppliersFor({ proposal_type: type }, requested) {
  if (type === "VENDOR_REGISTRATION") return true;
  return requested === true;
}

const TILE_LABELS = {
  TOTAL: "Total proposals",
  AGENCY_PARTNERSHIP: "Agency partnerships",
  VENDOR_REGISTRATION: "Vendor registrations",
  PENDING: "Pending review",
  NEW: "New",
  IN_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** What the register renders across the top, in the legacy's order. */
const KPI_TILES = ["TOTAL", "AGENCY_PARTNERSHIP", "VENDOR_REGISTRATION", "PENDING"];

/** Everything the fold produces — the four tiles plus both full partitions. */
const KPI_KEYS = ["TOTAL", ...STATUSES, ...TYPES, "PENDING"];

const emptyKpi = () => KPI_KEYS.reduce((acc, k) => { acc[k] = 0; return acc; }, {});

/**
 * Fold the two GROUP BYs the repo runs into one tile set.
 *
 * TOTAL is taken from the STATUS partition (either would do; taking it from one
 * and checking the other against it is what makes `assertPartitions` able to
 * detect a disagreement at all). An unrecognised value is counted into
 * OTHER_STATUS / OTHER_TYPE rather than dropped: the CHECK constraints should
 * make it impossible, but a value written before a constraint change must show
 * on the screen as a discrepancy, not vanish from the summary.
 */
function kpiFrom({ statusRows = [], typeRows = [] } = {}) {
  const kpi = emptyKpi();
  for (const r of statusRows) {
    const c = Number(r.c) || 0;
    kpi.TOTAL += c;
    if (STATUSES.includes(r.status)) kpi[r.status] += c;
    else kpi.OTHER_STATUS = (kpi.OTHER_STATUS || 0) + c;
  }
  for (const r of typeRows) {
    const c = Number(r.c) || 0;
    if (TYPES.includes(r.proposal_type)) kpi[r.proposal_type] += c;
    else kpi.OTHER_TYPE = (kpi.OTHER_TYPE || 0) + c;
  }
  // The legacy's fourth tile. Its own list.php counts NEW + 'UNDER_REVIEW'
  // while its update.php only ever writes 'IN_REVIEW' — so the tile on the live
  // screen has counted nothing but NEW rows since the day it shipped.
  kpi.PENDING = kpi.NEW + kpi.IN_REVIEW;
  return kpi;
}

/** Both partitions add up to TOTAL. Returns true or throws. */
function assertPartitions(kpi) {
  const byStatus = STATUSES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER_STATUS || 0);
  const byType = TYPES.reduce((n, t) => n + (kpi[t] || 0), 0) + (kpi.OTHER_TYPE || 0);
  if (byStatus !== kpi.TOTAL) {
    throw new AppError("KPI_NOT_PARTITIONED",
      `Status tiles sum to ${byStatus} but TOTAL is ${kpi.TOTAL} — a status belongs to no tile`, 500);
  }
  if (byType !== kpi.TOTAL) {
    throw new AppError("KPI_NOT_PARTITIONED",
      `Type tiles sum to ${byType} but TOTAL is ${kpi.TOTAL} — a proposal type belongs to no tile`, 500);
  }
  return true;
}

module.exports = {
  STATUSES, TYPES, DECIDED, NEXT, assertTransition, isDecided, suppliersFor,
  KPI_TILES, KPI_KEYS, TILE_LABELS, emptyKpi, kpiFrom, assertPartitions,
};
