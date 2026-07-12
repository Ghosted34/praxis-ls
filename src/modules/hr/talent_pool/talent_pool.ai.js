/** AI action manifest (AI_READINESS Rule 1) for the talent pool. */
"use strict";

const service = require("./talent_pool.service");
const validator = require("./talent_pool.validator");

module.exports = {
  entity: "talent_pool",
  module_key: "MOD-19",
  screens: ["talent-pool"],

  reads: [
    { key: "list_talent", service: service.list, describe: "List talent-pool candidates." },
    { key: "get_talent", service: service.get, describe: "Get one talent-pool entry by id." },
  ],

  writes: [
    {
      key: "create_talent",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-19", action: "create" },
      confirm: true,
      describe: "Add a candidate to the talent pool.",
    },
    {
      key: "update_talent",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-19", action: "edit" },
      confirm: true,
      describe: "Update a talent-pool entry (skills, notes).",
    },
  ],
};
