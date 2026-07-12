/** AI action manifest (AI_READINESS Rule 1) for WMS equipment. */
"use strict";

const service = require("./equipment.service");
const validator = require("./equipment.validator");

module.exports = {
  entity: "equipment",
  module_key: "MOD-37",
  screens: ["equipment"],

  reads: [
    { key: "list_equipment", service: service.list, describe: "List handling equipment (forklifts, reach-stackers)." },
    { key: "get_equipment", service: service.get, describe: "Get one equipment unit by id." },
  ],

  writes: [
    {
      key: "create_equipment",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-37", action: "create" },
      confirm: true,
      describe: "Register a handling equipment unit.",
    },
    {
      key: "update_equipment",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-37", action: "edit" },
      confirm: true,
      describe: "Update an equipment unit (label, asset link, location).",
    },
    {
      key: "set_equipment_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-37", action: "edit" },
      confirm: true,
      describe: "Change equipment status (AVAILABLE / IN_USE / MAINTENANCE / OUT_OF_SERVICE).",
    },
  ],
};
