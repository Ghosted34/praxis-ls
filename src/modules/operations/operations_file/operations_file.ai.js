"use strict";
const service = require("./operations_file.service");
const validator = require("./operations_file.validator");
module.exports = {
  entity: "dossier", module_key: "MOD-29", screens: [],
  reads: [
    { key: "list_dossiers", service: service.list, describe: "List operation files (dossiers)." },
    { key: "get_dossier", service: service.get, describe: "Get a dossier by id." },
  ],
  writes: [
    { key: "open_dossier", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-29", action: "create" }, confirm: true, describe: "Open a new operations file (dossier)." },
    { key: "update_dossier", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Update an open dossier." },
    { key: "transition_dossier", service: service.transition, schema: validator.schemas.transition, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Advance a dossier (IN_PROGRESS/COMPLETED/CANCELLED)." },
  ],
};
