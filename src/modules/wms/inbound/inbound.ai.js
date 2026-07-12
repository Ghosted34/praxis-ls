/** AI action manifest (AI_READINESS Rule 1) for inbound / GRN. */
"use strict";

const service = require("./inbound.service");
const validator = require("./inbound.validator");

module.exports = {
  entity: "inbound",
  module_key: "MOD-33",
  screens: ["inbound"],

  reads: [
    { key: "list_inbound", service: service.list, describe: "List goods-received notes (GRN)." },
    { key: "get_inbound", service: service.get, describe: "Get one GRN by id." },
  ],

  writes: [
    {
      key: "create_inbound",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-33", action: "create" },
      confirm: true,
      describe: "Open a goods-received note for a dossier.",
    },
    {
      key: "update_inbound",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-33", action: "edit" },
      confirm: true,
      describe: "Update a GRN.",
    },
    {
      key: "set_inbound_qa",
      service: service.setQa,
      schema: validator.schemas.qa,
      permission: { module: "MOD-33", action: "edit" },
      confirm: true,
      describe: "Clear QA on a GRN (PASSED with a putaway location, or REJECTED).",
    },
  ],
};
