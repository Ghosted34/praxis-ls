"use strict";
const service = require("./pricing_variance.service");
const validator = require("./pricing_variance.validator");
module.exports = {
  entity: "pricing_variance", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_pricing_variance", service: (c, p) => service.listSales(c, p), describe: "Sales pricing-variance list (R/Y/G flag + quote; never raw cost)." },
    { key: "get_pricing_variance", service: (c, p) => service.getSales(c, p.id || p), describe: "One pricing-variance entry, Sales view (no cost)." },
  ],
  writes: [
    { key: "compute_pricing_variance", service: service.compute, schema: validator.schemas.compute, permission: { module: "MOD-56", action: "view" }, confirm: true, describe: "Finance: compute + persist a dossier's pricing variance (quote vs actual cost)." },
  ],
};
