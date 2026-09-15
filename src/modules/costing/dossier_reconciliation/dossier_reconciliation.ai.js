/**
 * AI manifest (MOD-76 Budget Reconciliation).
 *
 * READS ONLY, AND THAT IS THE WHOLE DESIGN — owner decision Q20.
 *
 * The previous version of this module carried a matcher that scored untagged
 * cost entries against catalogue items and PROPOSED mappings for a human to
 * confirm. It is retired (13801). With the line keyed on `costing_line_id` and
 * the actual entered by the person who physically spent the money, there is
 * nothing left to guess: "what needs an AI? Justify. Prove, and I can approve."
 *
 * Nothing here writes. Recording an actual, attaching the proof, writing the
 * reason for an overrun, submitting and settling each name a responsible human
 * in a database column, and an act whose entire meaning is "a person took
 * responsibility for this" cannot be delegated to a model without becoming a
 * lie about who did.
 */
"use strict";
const service = require("./dossier_reconciliation.service");

module.exports = {
  entity: "dossier_reconciliation",
  module_key: "MOD-76",
  screens: [],
  reads: [
    {
      key: "get_budget_reconciliation",
      service: (c, p) => service.sheetFor(c, { dossierId: p.dossier_id || p.dossierId || p }),
      permission: { module: "MOD-76", action: "view" },
      describe:
        "Budget vs actual for one operations file, per budget line: what the approved costing authorised, what cash requests committed and paid, what was actually spent, the variance and its reason, and the supporting documents. All TTC.",
    },
    {
      key: "list_receipts_owed",
      service: (c, p) => service.receiptsOwed(c, { userId: p.user_id || null }),
      permission: { module: "MOD-76", action: "view" },
      describe:
        "Cash to account for: money a person has received against a line that needs a receipt, with no supporting document attached yet. Omit user_id for everyone.",
    },
  ],
  writes: [],
};
