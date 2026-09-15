"use strict";
// Event keys emitted by MOD-49 cash request / disbursal.

const transition = (status) => "cash_request." + String(status).toLowerCase();
module.exports = {
  MODULE: "MOD-49",
  CREATED: "cash_request.created",
  UPDATED: "cash_request.updated",
  ARCHIVED: "cash_request.archived",
  DISBURSED: "cash_request.disbursed",
  PARTIALLY_DISBURSED: "cash_request.partially_disbursed",
  // 12771 — the treasury settled the request at what it actually paid, which
  // releases the unpaid commitment back to the file's budget.
  CLOSED_SHORT: "cash_request.closed_short",
  // 12771 — the régie holder acknowledged taking one instalment. Audit only:
  // there is no decision here to route or approve.
  RECEIPT_ACKNOWLEDGED: "cash_request.receipt_acknowledged",
  JUSTIFIED: "cash_request.justified",
  transition,
};
