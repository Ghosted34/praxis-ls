"use strict";
const service = require("./cost_tracking.service");
const validator = require("./cost_tracking.validator");
module.exports = {
  entity: "cost_entry", module_key: "MOD-47", screens: [],
  reads: [
    { key: "reconcile_dossier", service: service.reconcileDossier, permission: { module: "MOD-47", action: "view" }, describe: "Budget vs actual reconciliation for one dossier, with how much the client has advanced against it (MOD-48)." },
    { key: "cost_tracking_portfolio", service: (c, p) => service.portfolio(c, p || {}), permission: { module: "MOD-47", action: "view" }, describe: "Every dossier with a budget or an actual, each with budget, actual, variance and advance coverage. Answers portfolio questions such as which files are over budget." },
    { key: "cost_tracking_kpis", service: (c, p) => service.portfolioKpis(c, p || {}), permission: { module: "MOD-47", action: "view" }, describe: "Portfolio totals: files tracked, how many are over budget, total budget/actual/variance and overall advance coverage." },
  ],
  writes: [{ key: "record_cost", service: service.recordCost, schema: validator.schemas.record, permission: { module: "MOD-47", action: "create" }, confirm: true, describe: "Record an actual dossier cost and post it to the ledger (débours→4731). KB §6.7." }],
};
