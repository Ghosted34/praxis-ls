/** AI action manifest (AI_READINESS Rule 1) for the vehicle registry. */
"use strict";

const service = require("./vehicle.service");
const validator = require("./vehicle.validator");

module.exports = {
  entity: "vehicle",
  module_key: "MOD-39",
  screens: ["vehicles"],

  reads: [
    { key: "list_vehicles", service: service.list, describe: "List fleet vehicles." },
    { key: "get_vehicle", service: service.get, describe: "Get one vehicle by id." },
  ],

  writes: [
    {
      key: "create_vehicle",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-39", action: "create" },
      confirm: true,
      describe: "Register a vehicle (registration, category, linked asset).",
    },
    {
      key: "update_vehicle",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-39", action: "update" },
      confirm: true,
      describe: "Update a vehicle (details or status).",
    },
  ],
};
