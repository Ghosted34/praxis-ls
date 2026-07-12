/** AI action manifest (AI_READINESS Rule 1) for appraisals. */
"use strict";

const service = require("./appraisal.service");
const validator = require("./appraisal.validator");

module.exports = {
  entity: "appraisal",
  module_key: "MOD-13",
  screens: ["appraisals"],

  reads: [
    { key: "list_appraisals", service: service.list, describe: "List performance appraisals." },
    { key: "get_appraisal", service: service.get, describe: "Get one appraisal by id." },
  ],

  writes: [
    {
      key: "create_appraisal",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-13", action: "create" },
      confirm: true,
      describe: "Record an appraisal against a KPI target for a period.",
    },
    {
      key: "update_appraisal",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-13", action: "edit" },
      confirm: true,
      describe: "Update an appraisal (actual value, rating, comments).",
    },
  ],
};
