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
  PROOF_OWED: "reconciliation.proof_owed",
  // The statement left the building (PR 3, Q19): posted to a channel or a
  // person, with the vault id of what was attached. Answers "was it sent" in
  // the audit without opening Smart Comms.
  STATEMENT_SENT: "reconciliation.statement_sent",
  // Q18, wire warn-default: someone drafted a final invoice against a file
  // whose conversation is still open. An event — not a log line — because the
  // whole point of the warning is that it can be counted.
  SETTLEMENT_DUE: "reconciliation.settlement_due",
};
