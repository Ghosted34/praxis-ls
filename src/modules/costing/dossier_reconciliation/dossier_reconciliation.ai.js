/**
 * AI manifest (MOD-47 dossier reconciliation).
 *
 * READ WHAT IS AND IS NOT HERE — same discipline as MOD-09 bank
 * reconciliation (reconciliation.ai.js). The assistant can read the
 * reconciliation and its match proposals; the proposals themselves are
 * created by the matcher at draft time. It CANNOT confirm or reject a
 * proposed mapping, cannot submit, validate or reject the document — every
 * one of those acts names a responsible human in a database column, and an
 * action whose whole meaning is "a person took responsibility for this"
 * cannot be delegated to a model without becoming a lie about who did.
 */
"use strict";
const service = require("./dossier_reconciliation.service");
module.exports = {
  entity: "dossier_reconciliation",
  module_key: "MOD-47",
  screens: [],
  reads: [
    {
      key: "get_dossier_reconciliation",
      service: (c, p) => service.get(c, p.id || p),
      permission: { module: "MOD-47", action: "view" },
      describe: "One reconciliation: quoted/budget/actual, the three variances, per-line detail, débours pass-through totals and pending match proposals.",
    },
    {
      key: "latest_dossier_reconciliation",
      service: (c, p) => service.latest(c, { dossierId: p.dossier_id }),
      permission: { module: "MOD-47", action: "view" },
      describe: "The latest reconciliation for an operations file.",
    },
  ],
  writes: [],
};
