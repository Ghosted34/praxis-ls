/** Contact enquiry (MOD-25) — pure lifecycle and KPI arithmetic for the
 *  enquiry desk (F9, doc/SALES_CRM_FEATURES.md).
 *
 * TWO RULES, AND THEY ARE THE FEATURE.
 *
 * 1. `contact_enquiry.status` is the CORRESPONDENCE lifecycle and nothing else:
 *    NEW -> READ -> RESPONDED -> CLOSED. It shipped as NEW / TRIAGED / CLOSED,
 *    where TRIAGED is not a state of the correspondence at all — it is the fact
 *    that a lead was raised. Two concerns in one column, and the cost was
 *    exact: with TRIAGED occupying the vocabulary there was nowhere to record
 *    that anyone had REPLIED, so the KPI row this desk exists to show could not
 *    be computed. Whether an enquiry was triaged is now ONE query —
 *    `lead_id IS NOT NULL OR partnership_request_id IS NOT NULL` — see
 *    `isTriaged` below, which is the only place that question is answered.
 *
 * 2. THE TILES PARTITION THE SET. Every status belongs to exactly one tile, and
 *    the tiles sum to TOTAL — under every filter combination, with no row left
 *    over.
 *
 *    The legacy renders four tiles (Total / New (unread) / Responded / Closed)
 *    over four statuses (NEW / READ / RESPONDED / CLOSED). READ is in no tile,
 *    so an enquiry that has been opened and not yet answered is counted into
 *    Total and displayed nowhere, and the three sub-tiles do not add up to the
 *    first. F9's definition of done is "every enquiry falls into exactly one
 *    KPI tile", so the row here is the legacy's four PLUS a Read tile. That is
 *    a deliberate deviation from "four KPI tiles" in the block: four tiles that
 *    do not add up is the defect, not the specification.
 *
 *    The tiles are DERIVED from STATUSES rather than hand-listed, and
 *    `assertPartitions()` proves the fold. A fifth status added tomorrow either
 *    lands in a tile or fails the test; it cannot silently vanish the way READ
 *    did.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const STATUSES = ["NEW", "READ", "RESPONDED", "CLOSED"];

/** The four the legacy register filters on. */
const ENQUIRY_TYPES = ["GENERAL_ENQUIRY", "PARTNERSHIP", "CAREERS", "MEDIA"];

const TYPE_LABELS = {
  GENERAL_ENQUIRY: "General enquiry",
  PARTNERSHIP: "Partnership",
  CAREERS: "Careers",
  MEDIA: "Media",
};

/**
 * Allowed moves.
 *
 * NEW -> RESPONDED is legal without passing through READ: answering a message
 * from the list, without opening it first, is a real thing operators do and
 * refusing it would only teach them to click twice.
 *
 * CLOSED is not terminal — it reopens to READ. A closed enquiry that gets a
 * follow-up is common, and the alternative is a second enquiry row that loses
 * the thread. Reopening is the ONLY move out of CLOSED, so it is an explicit
 * act rather than a side effect of somebody editing a note.
 */
const NEXT = {
  NEW: ["READ", "RESPONDED", "CLOSED"],
  READ: ["RESPONDED", "CLOSED"],
  RESPONDED: ["READ", "CLOSED"],
  CLOSED: ["READ"],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move enquiry ${from} -> ${to}`, 422);
  }
  return true;
}

/**
 * Closed means closed for correspondence. Replying to, or annotating, a closed
 * enquiry means reopening it first — so the register never shows a CLOSED row
 * whose last reply went out after it was closed.
 */
const isClosed = (status) => status === "CLOSED";

/**
 * THE single answer to "was this triaged". Never a status value, never
 * recomputed in a renderer. The legacy's analogue was computed two different
 * ways and the two disagreed.
 */
const isTriaged = (row = {}) => Boolean(row.lead_id || row.partnership_request_id);

/** One tile per status, in lifecycle order, plus TOTAL. Derived — see rule 2. */
const TILE_LABELS = {
  TOTAL: "Total messages",
  NEW: "New (unread)",
  READ: "Read",
  RESPONDED: "Responded",
  CLOSED: "Closed",
};

const KPI_TILES = ["TOTAL", ...STATUSES];

/** A zeroed tile set — so a tile with no rows renders 0 rather than disappearing. */
const emptyKpi = () => KPI_TILES.reduce((acc, k) => { acc[k] = 0; return acc; }, {});

/**
 * Fold `[{ status, c }]` (the GROUP BY the repo runs) into the tile set.
 *
 * An UNRECOGNISED status is counted into TOTAL and into `OTHER`, never dropped.
 * The CHECK constraint should make that impossible, but a value written before
 * a constraint change — TRIAGED on a database the 0689 UPDATE has not reached —
 * must show up as a discrepancy on the screen rather than quietly unbalancing
 * the tiles. Counters that silently fail to add up are the whole defect here.
 */
function kpiFrom(groupedRows = []) {
  const kpi = emptyKpi();
  for (const r of groupedRows) {
    const c = Number(r.c) || 0;
    kpi.TOTAL += c;
    if (Object.prototype.hasOwnProperty.call(kpi, r.status) && r.status !== "TOTAL") kpi[r.status] += c;
    else kpi.OTHER = (kpi.OTHER || 0) + c;
  }
  return kpi;
}

/**
 * The invariant, as a function so a test can assert it rather than a comment
 * asking a reader to believe it. Returns true or throws.
 */
function assertPartitions(kpi) {
  const sum = STATUSES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER || 0);
  if (sum !== kpi.TOTAL) {
    throw new AppError(
      "KPI_NOT_PARTITIONED",
      `KPI tiles sum to ${sum} but TOTAL is ${kpi.TOTAL} — a status value belongs to no tile`,
      500,
    );
  }
  return true;
}

module.exports = {
  STATUSES, ENQUIRY_TYPES, TYPE_LABELS, NEXT,
  assertTransition, isClosed, isTriaged,
  KPI_TILES, TILE_LABELS, emptyKpi, kpiFrom, assertPartitions,
};
