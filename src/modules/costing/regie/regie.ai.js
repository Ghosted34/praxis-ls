"use strict";
const service = require("./regie.service");
const validator = require("./regie.validator");
module.exports = {
  entity: "regie_advance",
  module_key: "MOD-49",
  screens: [],
  reads: [
    { key: "list_regie_advances", service: service.list, permission: { module: "MOD-49", action: "view" }, describe: "List regie d'avances (cash advances)." },
    { key: "get_regie_advance", service: service.get, permission: { module: "MOD-49", action: "view" }, describe: "Get a regie d'avance by id." },
  ],
  writes: [
    { key: "issue_regie_advance", service: service.issue, schema: validator.schemas.issue, permission: { module: "MOD-49", action: "create" }, confirm: true, describe: "Issue a cash advance to a holder (Dr 581 / Cr 521). KB 6.8." },
    { key: "age_regie_advances", service: service.ageDue, schema: validator.schemas.ageDue, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Reclassify unjustified advances past their window (Dr 4211 / Cr 581). KB 6.8." },
  ],
};
