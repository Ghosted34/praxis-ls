/** AI action manifest (AI_READINESS Rule 1) for leave / allowance requests. */
"use strict";

const service = require("./leave_allowance.service");
const validator = require("./leave_allowance.validator");

module.exports = {
  entity: "leave_allowance",
  module_key: "MOD-15",
  screens: ["leave"],

  reads: [
    { key: "list_leave", service: service.list, describe: "List leave / salary-advance / mission requests." },
    { key: "get_leave", service: service.get, describe: "Get one request by id." },
  ],

  writes: [
    {
      key: "create_leave",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-15", action: "create" },
      confirm: true,
      describe: "Raise a leave, salary-advance or mission request.",
    },
    {
      key: "update_leave",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-15", action: "update" },
      confirm: true,
      describe: "Update a request before it is decided.",
    },
    {
      key: "decide_leave",
      service: service.decide,
      schema: validator.schemas.decision,
      permission: { module: "MOD-15", action: "approve" },
      confirm: true,
      describe: "Approve or reject a leave / allowance request.",
    },
  ],
};
