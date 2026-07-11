"use strict";
const service = require("./costing.service");
const validator = require("./costing.validator");
module.exports = {
  entity: "costing", module_key: "MOD-46", screens: [],
  reads: [
    { key: "list_costings", service: service.list, describe: "List dossier costings." },
    { key: "get_costing", service: service.get, describe: "Get a costing with lines + computed margin." },
  ],
  writes: [
    { key: "create_costing", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-46", action: "create" }, confirm: true, describe: "Create a DRAFT dossier costing (budget, margin, débours excluded §6.7)." },
    { key: "update_costing", service: service.updateDraft, schema: validator.schemas.update, permission: { module: "MOD-46", action: "edit" }, confirm: true, describe: "Edit a DRAFT costing." },
    { key: "costing_status", service: service.setStatus, schema: validator.schemas.setStatus, permission: { module: "MOD-46", action: "approve" }, confirm: true, describe: "Advance a costing (validate/approve/reject)." },
  ],
};
