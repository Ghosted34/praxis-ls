/** Quote request (MOD-20-intake) — pure lifecycle.
 *
 * The five legacy KPI tiles (RECEIVED / UNDER_REVIEW / QUOTED / CONVERTED /
 * CLOSED_NO_ACTION) are status VALUES — descriptive labels — not the source
 * of truth. The single source of truth is `quote_request.converted_opportunity_id`
 * (a FK), and the trigger `quote_request_sync_converted()` keeps status in
 * sync with it. So "is this converted" is one query, not two — the legacy
 * had a row-renderer check and a drawer check, and they disagreed.
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

/** The five KPI tiles the legacy exposes. */
const KPI_TILES = ["TOTAL", "RECEIVED", "UNDER_REVIEW", "QUOTED", "CONVERTED_TO_OPPORTUNITY"];

module.exports = { STATUSES, NEXT, assertTransition, KPI_TILES };
