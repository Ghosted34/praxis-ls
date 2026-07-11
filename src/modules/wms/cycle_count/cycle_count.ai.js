/** AI action manifest (AI_READINESS Rule 1) for cycle counts. */
"use strict";

const service = require("./cycle_count.service");
const validator = require("./cycle_count.validator");

module.exports = {
  entity: "cycle_count",
  module_key: "MOD-38",
  screens: ["cycle-counts"],

  reads: [
    { key: "list_cycle_counts", service: service.list, describe: "List cycle counts." },
    { key: "get_cycle_count", service: service.get, describe: "Get one cycle count by id." },
  ],

  writes: [
    {
      key: "create_cycle_count",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-38", action: "create" },
      confirm: true,
      describe: "Record a cycle count for a location with any discrepancies.",
    },
    {
      key: "update_cycle_count",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-38", action: "update" },
      confirm: true,
      describe: "Update a cycle count (discrepancy, certified report).",
    },
  ],
};
