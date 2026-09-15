"use strict";
// Event keys emitted by MOD-76 Budget Reconciliation.
//
// The chain is Operations prepares → Finance settles → the MD is TOLD
// (owner decision Q6): there is no second approval, so there is no approval
// event here — `settled` is an outcome, not a request for a decision.
module.exports = {
  MODULE: "MOD-76",
  LINE_RECORDED: "reconciliation.line_recorded",
  PROOF_ATTACHED: "reconciliation.proof_attached",
  SUBMITTED: "reconciliation.submitted",
  REJECTED: "reconciliation.rejected",
  SETTLED: "reconciliation.settled",
  REOPENED: "reconciliation.reopened",
};
