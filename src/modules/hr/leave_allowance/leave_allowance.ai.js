/** AI action manifest (AI_READINESS Rule 1) for leave / allowance requests. */
"use strict";

const service = require("./leave_allowance.service");
const validator = require("./leave_allowance.validator");

module.exports = {
  entity: "leave_allowance",
  module_key: "MOD-15",
  screens: ["leave"],

  reads: [
    { key: "list_leave", service: service.list, permission: { module: "MOD-15", action: "view" }, describe: "List leave / salary-advance / mission requests." },
    { key: "get_leave", service: service.get, permission: { module: "MOD-15", action: "view" }, describe: "Get one request by id." },
  ],

  writes: [
    {
      key: "create_leave",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-15", action: "create" },
      confirm: true,
      describe: "Raise a leave, salary-advance or mission request.",
    },
    {
      key: "update_leave",
      service: (c, p, actor) => (({ leave_request_id, ...patch }) => service.update(c, { id: leave_request_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-15", action: "edit" },
      confirm: true,
      describe: "Update a request before it is decided.",
    },
    {
      key: "decide_leave",
      service: (c, p, actor) => service.decide(c, { id: p.leave_request_id, status: p.status, actor }),
      schema: validator.schemas.aiDecision,
      permission: { module: "MOD-15", action: "approve" },
      confirm: true,
      describe: "Approve or reject a leave / allowance request.",
    },
  ],
};
