/** AI action manifest (AI_READINESS Rule 1) for SOP documents. */
"use strict";

const service = require("./sop_onboarding.service");
const validator = require("./sop_onboarding.validator");

module.exports = {
  entity: "sop_onboarding",
  module_key: "MOD-16",
  screens: ["sops"],

  reads: [
    { key: "list_sops", service: service.list, describe: "List standard operating procedure documents." },
    { key: "get_sop", service: service.get, describe: "Get one SOP document by id." },
  ],

  writes: [
    {
      key: "create_sop",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-16", action: "create" },
      confirm: true,
      describe: "Register an SOP document (title, category, version).",
    },
    {
      key: "update_sop",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-16", action: "edit" },
      confirm: true,
      describe: "Update an SOP document (version bump, activation).",
    },
  ],
};
