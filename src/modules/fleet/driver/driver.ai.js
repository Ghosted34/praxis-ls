/** AI action manifest (AI_READINESS Rule 1) for driver licences. */
"use strict";

const service = require("./driver.service");
const validator = require("./driver.validator");

module.exports = {
  entity: "driver",
  module_key: "MOD-44",
  screens: ["drivers"],

  reads: [
    { key: "list_drivers", service: service.list, describe: "List driver licences." },
    { key: "get_driver", service: service.get, describe: "Get one driver licence by id." },
  ],

  writes: [
    {
      key: "create_driver",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-44", action: "create" },
      confirm: true,
      describe: "Register a driver licence for an employee (class, number, expiry).",
    },
    {
      key: "update_driver",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-44", action: "update" },
      confirm: true,
      describe: "Update a driver licence (class, expiry, certification).",
    },
  ],
};
