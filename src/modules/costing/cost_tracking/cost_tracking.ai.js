"use strict";
const service = require("./cost_tracking.service");
const validator = require("./cost_tracking.validator");
module.exports = {
  entity: "cost_entry", module_key: "MOD-47", screens: [],
  reads: [{ key: "reconcile_dossier", service: service.reconcileDossier, describe: "Budget vs actual reconciliation for a dossier (MOD-48)." }],
  writes: [{ key: "record_cost", service: service.recordCost, schema: validator.schemas.record, permission: { module: "MOD-47", action: "create" }, confirm: true, describe: "Record an actual dossier cost and post it to the ledger (débours→4731). KB §6.7." }],
};
