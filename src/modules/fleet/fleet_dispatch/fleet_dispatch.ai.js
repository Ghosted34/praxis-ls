/** AI action manifest (AI_READINESS Rule 1) for fleet dispatch. */
"use strict";

const service = require("./fleet_dispatch.service");
const validator = require("./fleet_dispatch.validator");

module.exports = {
  entity: "fleet_dispatch",
  module_key: "MOD-42",
  screens: ["dispatch"],

  reads: [
    { key: "list_dispatch", service: service.list, describe: "List vehicle dispatch assignments." },
    { key: "get_dispatch", service: service.get, describe: "Get one dispatch by id." },
  ],

  writes: [
    {
      key: "create_dispatch",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-42", action: "create" },
      confirm: true,
      describe: "Assign a vehicle (and driver) for a dossier.",
    },
    {
      key: "update_dispatch",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-42", action: "edit" },
      confirm: true,
      describe: "Update a dispatch assignment.",
    },
    {
      key: "set_dispatch_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-42", action: "edit" },
      confirm: true,
      describe: "Check a vehicle out or back in (ASSIGNED → OUT → RETURNED, or CANCELLED).",
    },
  ],
};
