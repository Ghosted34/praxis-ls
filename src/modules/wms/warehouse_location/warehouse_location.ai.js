/** AI action manifest (AI_READINESS Rule 1) for warehouse locations. */
"use strict";

const service = require("./warehouse_location.service");
const validator = require("./warehouse_location.validator");

module.exports = {
  entity: "warehouse_location",
  module_key: "MOD-34",
  screens: ["locations"],

  reads: [
    { key: "list_locations", service: service.list, describe: "List warehouse locations (zone/aisle/rack/bin/yard)." },
    { key: "get_location", service: service.get, describe: "Get one location by id." },
  ],

  writes: [
    {
      key: "create_location",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-34", action: "create" },
      confirm: true,
      describe: "Create a warehouse location slot.",
    },
    {
      key: "update_location",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-34", action: "edit" },
      confirm: true,
      describe: "Update a location (slotting, capacity).",
    },
  ],
};
