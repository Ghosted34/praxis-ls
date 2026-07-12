/** AI action manifest (AI_READINESS Rule 1) for fuel logs. */
"use strict";

const service = require("./fuel_log.service");
const validator = require("./fuel_log.validator");

module.exports = {
  entity: "fuel_log",
  module_key: "MOD-43",
  screens: ["fuel"],

  reads: [
    { key: "list_fuel", service: service.list, describe: "List fuel logs." },
    { key: "get_fuel", service: service.get, describe: "Get one fuel log by id." },
  ],

  writes: [
    {
      key: "create_fuel",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-43", action: "create" },
      confirm: true,
      describe: "Record a fuel purchase (odometer, litres, cost) against a vehicle.",
    },
    {
      key: "update_fuel",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-43", action: "edit" },
      confirm: true,
      describe: "Update a fuel log entry.",
    },
  ],
};
