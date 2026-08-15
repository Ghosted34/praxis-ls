/** Quote request (MOD-20-intake) — pure lifecycle and KPI arithmetic.
 *
 * TWO RULES, AND THEY ARE THE FEATURE.
 *
 * 1. `quote_request.status` is the INTAKE lifecycle and nothing else. Pipeline
 *    stages live on `opportunity.pipeline_stage_id`; the commercial funnel
 *    lives on `lead.status`. The legacy overloaded one column with all three,
 *    which is why its live register reports "converted: 0" against 26 rows.
 *
 * 2. THE TILES PARTITION THE SET. Every status value belongs to exactly one
 *    tile, and the tiles sum to TOTAL — under every filter combination, with no
 *    row left over. That is not a display detail: a register whose counters do
 *    not add up is the exact failure F6 exists to correct, and it is very easy
 *    to reintroduce by adding a status and forgetting a tile.
 *
 *    So the tiles are DERIVED from STATUSES here rather than hand-listed, and
 *    `assertPartitions()` proves it. A seventh status added tomorrow either
 *    lands in a tile or fails the test; it cannot silently vanish from the
 *    summary the way CLARIFICATION_REQUIRED and CLOSED_NO_ACTION did.
 *
 * "Is this converted" is one query, never two: `converted_opportunity_id IS NOT
 * NULL`, kept in step with `status` by the trg_quote_request_sync_converted
 * trigger. The legacy computed it in the row renderer AND in the drawer, and
 * the two disagreed, so a converted row greyed out in the list while the drawer
 * still offered Convert.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const STATUSES = [
  "RECEIVED",
  "UNDER_REVIEW",
  "CLARIFICATION_REQUIRED",
  "QUOTED",
  "CONVERTED_TO_OPPORTUNITY",
  "CLOSED_NO_ACTION",
];

/** States from which nothing may be edited, attached or detached any more. */
const TERMINAL = ["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"];

const NEXT = {
  RECEIVED: ["UNDER_REVIEW", "CLARIFICATION_REQUIRED", "CLOSED_NO_ACTION"],
  UNDER_REVIEW: ["QUOTED", "CLARIFICATION_REQUIRED", "CLOSED_NO_ACTION"],
  CLARIFICATION_REQUIRED: ["UNDER_REVIEW", "CLOSED_NO_ACTION"],
  QUOTED: ["CONVERTED_TO_OPPORTUNITY", "CLOSED_NO_ACTION"],
  CONVERTED_TO_OPPORTUNITY: [],
  CLOSED_NO_ACTION: [],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move quote request ${from} -> ${to}`, 422);
  }
  return true;
}

const isTerminal = (status) => TERMINAL.includes(status);

/**
 * One tile per status, in lifecycle order, plus TOTAL. Derived — see rule 2.
 * `key` is the status value (TOTAL is the sum); `label` is the English caption
 * the register renders.
 */
const TILE_LABELS = {
  TOTAL: "Total",
  RECEIVED: "Received",
  UNDER_REVIEW: "Under review",
  CLARIFICATION_REQUIRED: "Needs clarification",
  QUOTED: "Quoted",
  CONVERTED_TO_OPPORTUNITY: "Converted",
  CLOSED_NO_ACTION: "Closed",
};

const KPI_TILES = ["TOTAL", ...STATUSES];

/** A zeroed tile set — so a tile with no rows renders 0 rather than disappearing. */
const emptyKpi = () => KPI_TILES.reduce((acc, k) => { acc[k] = 0; return acc; }, {});

/**
 * Fold `[{ status, c }]` (the GROUP BY the repo runs) into the tile set.
 *
 * An UNRECOGNISED status is counted into TOTAL and into `OTHER`, never dropped.
 * The CHECK constraint should make that impossible, but a value written before
 * a constraint change, or by a hand-run UPDATE, must show up as a discrepancy
 * on the screen rather than quietly unbalancing the tiles — the whole defect
 * being fixed here is counters that silently fail to add up.
 */
function kpiFrom(groupedRows = []) {
  const kpi = emptyKpi();
  for (const r of groupedRows) {
    const c = Number(r.c) || 0;
    kpi.TOTAL += c;
    if (Object.prototype.hasOwnProperty.call(kpi, r.status) && r.status !== "TOTAL") kpi[r.status] += c;
    else { kpi.OTHER = (kpi.OTHER || 0) + c; }
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
  STATUSES, TERMINAL, NEXT, assertTransition, isTerminal,
  KPI_TILES, TILE_LABELS, emptyKpi, kpiFrom, assertPartitions,
};
