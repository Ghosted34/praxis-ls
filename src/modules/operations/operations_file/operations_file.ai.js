"use strict";
const service = require("./operations_file.service");
const validator = require("./operations_file.validator");
module.exports = {
  entity: "dossier", module_key: "MOD-29", screens: [],
  reads: [
    { key: "list_dossiers", service: service.list, permission: { module: "MOD-29", action: "view" }, describe: "List operations files." },
    { key: "get_dossier", service: service.get, permission: { module: "MOD-29", action: "view" }, describe: "Get an operations file by id." },
  ],
  writes: [
    { key: "open_dossier", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-29", action: "create" }, confirm: true, describe: "Open a new operations file." },
    { key: "update_dossier", service: service.update, schema: validator.schemas.aiUpdate, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Update an open operations file (payload includes its id)." },
    { key: "transition_dossier", service: service.transition, schema: validator.schemas.aiTransition, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Advance an operations file by id one step along OPEN→IN_PROGRESS→COMPLETED (CANCELLED allowed from OPEN or IN_PROGRESS). Cannot skip states." },
  ],
};
