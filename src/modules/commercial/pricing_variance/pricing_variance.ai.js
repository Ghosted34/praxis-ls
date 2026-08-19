/**
 * AI manifest (MOD-27 pricing variance).
 *
 * Read-only since §2.1: the index is a derived projection over the dossier
 * reconciliation, so there is nothing for the assistant to compute or store.
 * The old `compute_pricing_variance` write is gone with BUG-4 (it accepted a
 * caller-supplied actual_cost). The reads keep the Sales boundary: never raw
 * cost. Match proposals live on the reconciliation itself
 * (dossier_reconciliation.ai.js) — propose, never confirm.
 */
"use strict";
const service = require("./pricing_variance.service");
module.exports = {
  entity: "pricing_variance", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_pricing_variance", service: (c, p) => service.listSales(c, p), permission: { module: "MOD-27", action: "view" }, describe: "Sales pricing-variance list derived from the reconciliation records (R/Y/G flag + quote; never raw cost)." },
    { key: "get_pricing_variance", service: (c, p) => service.getSales(c, p.id || p), permission: { module: "MOD-27", action: "view" }, describe: "One pricing-variance projection, Sales view (no cost)." },
  ],
  writes: [],
};
