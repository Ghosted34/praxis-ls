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
    { key: "update_costing", service: (c, p) => (({ costing_id, lines, ...patch }) => service.updateDraft(c, { id: costing_id, patch, lines: lines || null }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-46", action: "edit" }, confirm: true, describe: "Edit a DRAFT costing by id." },
    { key: "costing_status", service: (c, p) => service.setStatus(c, { id: p.costing_id, to: p.to }), schema: validator.schemas.aiSetStatus, permission: { module: "MOD-46", action: "approve" }, confirm: true, describe: "Advance a costing by id (SUBMIT_VALIDATION→SUBMIT_APPROVAL→APPROVE, or REJECT)." },
  ],
};
