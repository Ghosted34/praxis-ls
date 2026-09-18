/** AI action manifest (AI_READINESS Rule 1) for fleet dispatch. */
"use strict";

const service = require("./fleet_dispatch.service");
const validator = require("./fleet_dispatch.validator");

module.exports = {
  entity: "fleet_dispatch",
  module_key: "MOD-42",
  screens: ["dispatch"],

  reads: [
    { key: "list_dispatch", service: service.list, permission: { module: "MOD-42", action: "view" }, describe: "List vehicle dispatch assignments." },
    { key: "get_dispatch", service: service.get, permission: { module: "MOD-42", action: "view" }, describe: "Get one dispatch by id." },
  ],

  writes: [
    {
      key: "create_dispatch",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-42", action: "create" },
      confirm: true,
      describe: "Assign a vehicle (and driver) for an operations file.",
    },
    {
      key: "update_dispatch",
      service: (c, p, actor) => (({ fleet_dispatch_id, ...patch }) => service.update(c, { id: fleet_dispatch_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-42", action: "edit" },
      confirm: true,
      describe: "Update a dispatch assignment.",
    },
    {
      key: "set_dispatch_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.fleet_dispatch_id, status: p.status, odometer: p.odometer, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-42", action: "edit" },
      confirm: true,
      describe: "Check a vehicle out or back in (ASSIGNED → OUT → RETURNED, or CANCELLED).",
    },
  ],
};
